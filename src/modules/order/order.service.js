"use strict";

const crypto = require("crypto");
const Order = require("./order.model");
const Product = require("../product/product.model");
const cartService = require("../cart/cart.service");
const couponService = require("../coupon/coupon.service");
const payment = require("../../services/payment.service");
const email = require("../../services/email.service");
const shiprocket = require("../../services/shiprocket.service");
const logger = require("../../utils/logger");
const { getPagination, buildMeta } = require("../../utils/paginate");
const { ApiError } = require("../../utils/ApiError");

function genOrderNumber() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `DN-${ymd}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * Creates an order from the user's server-side cart. Totals are recomputed from
 * the DB here — never trusted from the client. Returns the order plus the
 * payment provider's order object for the frontend to open checkout.
 */
async function createFromCart(user, { shippingAddress, shippingMethod }) {
  const cart = await cartService.getOrCreate(user.id, false);
  // Passing pincode + the picked shippingMethod makes hydrate compute the
  // exact same shipping charge the shopper saw at checkout — no drift
  // between preview and Razorpay total.
  const hydrated = await cartService.hydrate(cart, {
    pincode: shippingAddress?.pincode,
    shippingMethod,
  });
  if (!hydrated.items.length) throw ApiError.badRequest("Cart is empty");

  const orderNumber = genOrderNumber();

  // Create the payment order first (guarded service). If payment is down this
  // throws a 503 — and ONLY this request fails.
  const payOrder = await payment.createOrder({
    amount: hydrated.summary.total,
    receipt: orderNumber,
    notes: { userId: user.id },
  });

  const order = await Order.create({
    orderNumber,
    user: user.id,
    items: hydrated.items.map((i) => ({
      product: i.productId,
      variantId: i.variantId || null,
      variantName: i.variantName || "",
      slug: i.slug,
      name: i.name,
      image: i.image || "",
      price: i.price,
      qty: i.qty,
      lineTotal: i.lineTotal,
    })),
    summary: {
      subtotal: hydrated.summary.subtotal,
      gst: hydrated.summary.gst,
      shipping: hydrated.summary.shipping,
      discount: hydrated.summary.discount,
      total: hydrated.summary.total,
    },
    promoCode: hydrated.promoCode,
    shippingAddress,
    payment: { razorpayOrderId: payOrder.id, status: "created" },
  });

  return {
    order: serialize(order),
    payment: {
      orderId: payOrder.id,
      amount: payOrder.amount,
      currency: payOrder.currency,
      mock: !!payOrder.mock,
    },
  };
}

/**
 * Verifies the Razorpay signature and finalises the order: decrement stock,
 * clear cart, send confirmation email (best-effort). Stock decrement uses an
 * atomic guarded update so two concurrent buyers can't oversell.
 */
async function verifyPayment(user, { razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const order = await Order.findOne({
    "payment.razorpayOrderId": razorpayOrderId,
    user: user.id,
  });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.payment.status === "paid") return serialize(order); // idempotent

  const valid = payment.verifySignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
  });
  if (!valid) {
    order.payment.status = "failed";
    await order.save();
    throw ApiError.badRequest("Payment verification failed");
  }

  // Atomic stock decrement per line; skip silently if a product vanished.
  // When the line was purchased with a variant, decrement that variant's
  // stock via the positional $ operator instead of the parent product's.
  await Promise.all(
    order.items.map((i) =>
      (i.variantId
        ? Product.updateOne(
            {
              _id: i.product,
              "variants._id": i.variantId,
              "variants.stock": { $gte: i.qty },
            },
            { $inc: { "variants.$.stock": -i.qty } }
          )
        : Product.updateOne(
            { _id: i.product, stock: { $gte: i.qty } },
            { $inc: { stock: -i.qty } }
          )
      ).catch(() => {})
    )
  );

  order.payment.status = "paid";
  order.payment.razorpayPaymentId = razorpayPaymentId;
  order.status = "confirmed";
  await order.save();

  // Best-effort — coupon usage, cart clear, and email failing must not fail
  // the response. The coupon counter drives the admin panel's "usage" column
  // and the global usageLimit enforcement in couponService.validateForCart.
  if (order.promoCode) {
    couponService.incrementUsage(order.promoCode).catch(() => {});
  }
  cartService.clear(user.id).catch(() => {});
  email.send({
    to: user.email,
    subject: `Decor N Art order ${order.orderNumber} confirmed`,
    html: `<p>Thank you, ${user.name}. Your order <b>${order.orderNumber}</b> is confirmed.</p>`,
  });

  // Push to Shiprocket + auto-assign AWB. Detached and best-effort — a
  // Shiprocket outage must NEVER fail the payment verification response
  // (customer already paid). Any error just leaves tracking blank; admin
  // can retry from the order detail page.
  syncOrderToShiprocket(order, user).catch((err) => {
    logger.warn("shiprocket sync failed for order", {
      orderNumber: order.orderNumber,
      err: err.message,
    });
  });

  return serialize(order);
}

/**
 * Two-step Shiprocket sync run after a successful payment:
 *   1. create the order on Shiprocket (returns shipmentId)
 *   2. assign AWB to the shipment (returns awb + courier)
 * Both step results are persisted to order.tracking. Second step failure
 * is tolerated — we still keep the shiprocketOrderId so admin can retry.
 *
 * If step 1 throws we persist the error message on the order so the admin
 * detail panel can show *why* the automatic push failed, and the background
 * sweep (retryPendingShiprocketSyncs) can keep retrying until success.
 */
async function syncOrderToShiprocket(order, user) {
  order.tracking = order.tracking || {};
  order.tracking.syncAttempts = (order.tracking.syncAttempts || 0) + 1;

  let created;
  try {
    created = await shiprocket.createOrder({
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      items: order.items,
      summary: order.summary,
      shippingAddress: order.shippingAddress,
      customerEmail: user?.email,
      payment: { status: order.payment.status },
    });
  } catch (err) {
    order.tracking.lastSyncError = err.message || String(err);
    order.tracking.lastSyncErrorAt = new Date();
    await order.save();
    throw err;
  }

  order.tracking.shiprocketOrderId = String(created.shiprocketOrderId || "");
  order.tracking.shipmentId = String(created.shipmentId || "");
  order.tracking.lastSyncedAt = new Date();
  // createOrder succeeded — clear any prior failure so the admin panel
  // doesn't keep flagging a resolved incident.
  order.tracking.lastSyncError = "";
  order.tracking.lastSyncErrorAt = undefined;

  try {
    const awb = await shiprocket.assignAWB(created.shipmentId);
    if (awb.awb) {
      order.tracking.awb = awb.awb;
      order.tracking.courier = awb.courier || "";
      order.tracking.url = awb.awb
        ? `https://shiprocket.co/tracking/${awb.awb}`
        : order.tracking.url;
    }
  } catch (err) {
    logger.warn("shiprocket assignAWB failed", { err: err.message });
  }

  await order.save();
}

/**
 * Background sweep: find paid orders whose Shiprocket sync hasn't yet
 * succeeded and retry them. Run on a timer from server.js so a transient
 * SR outage during checkout heals itself without admin action.
 *
 * "Needs sync" = payment.status=paid AND tracking.shiprocketOrderId is
 * missing/empty. `syncAttempts` gates a hard cap so a persistently
 * failing order (bad address, missing pickup location on the SR dashboard)
 * doesn't keep hammering the API forever — after MAX_ATTEMPTS the admin
 * still has the manual "Push to Shiprocket" button.
 */
const MAX_SYNC_ATTEMPTS = 12; // 12 * 10min sweep = ~2 hours of retries

async function retryPendingShiprocketSyncs() {
  const orders = await Order.find({
    "payment.status": "paid",
    $or: [
      { "tracking.shiprocketOrderId": { $in: [null, ""] } },
      { "tracking.shiprocketOrderId": { $exists: false } },
    ],
    $and: [
      {
        $or: [
          { "tracking.syncAttempts": { $lt: MAX_SYNC_ATTEMPTS } },
          { "tracking.syncAttempts": { $exists: false } },
        ],
      },
    ],
  })
    .populate("user", "email name")
    .limit(20);

  if (!orders.length) return { attempted: 0, ok: 0, failed: 0 };

  let ok = 0;
  let failed = 0;
  for (const order of orders) {
    try {
      await syncOrderToShiprocket(order, order.user || {});
      ok += 1;
      logger.info("shiprocket auto-retry ok", { orderNumber: order.orderNumber });
    } catch (err) {
      failed += 1;
      logger.warn("shiprocket auto-retry failed", {
        orderNumber: order.orderNumber,
        err: err.message,
      });
    }
  }
  return { attempted: orders.length, ok, failed };
}

/**
 * Backfill each order line with the current product's primary image whenever
 * the snapshot on the line is empty. Older orders (created before we started
 * snapshotting `image`) would otherwise render a slug-hashed placeholder on
 * the storefront. One batched $in query covers every product across every
 * order, so this stays O(1) round-trips regardless of order count.
 */
async function enrichOrderImages(orders) {
  const missing = new Set();
  for (const o of orders) {
    for (const l of o.items || []) {
      if (!l.image && l.product) missing.add(String(l.product));
    }
  }
  if (missing.size === 0) return orders;

  const products = await Product.find({ _id: { $in: [...missing] } })
    .select("images variants")
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  for (const o of orders) {
    for (const l of o.items || []) {
      if (l.image) continue;
      const p = byId.get(String(l.product));
      if (!p) continue;
      // Prefer the picked variant's image, else the product's first image.
      const variant =
        l.variantId && Array.isArray(p.variants)
          ? p.variants.find((v) => String(v._id) === String(l.variantId))
          : null;
      l.image = variant?.image || (p.images && p.images[0]) || "";
    }
  }
  return orders;
}

async function listForUser(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Order.find({ user: userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments({ user: userId }),
  ]);
  await enrichOrderImages(items);
  return { items: items.map(serializePlain), meta: buildMeta({ page, limit, total }) };
}

async function getOne(userId, id) {
  const order = await Order.findOne({ _id: id, user: userId }).lean();
  if (!order) throw ApiError.notFound("Order not found");
  await enrichOrderImages([order]);
  return serializePlain(order);
}

function serialize(doc) {
  return serializePlain(doc.toObject ? doc.toObject() : doc);
}
function serializePlain(o) {
  return {
    id: String(o._id),
    orderNumber: o.orderNumber,
    items: o.items,
    summary: o.summary,
    promoCode: o.promoCode,
    shippingAddress: o.shippingAddress,
    // Courier / AWB / tracking URL — populated by the admin when the order
    // ships. Empty object until the admin fills it in.
    tracking: o.tracking || {},
    paymentStatus: o.payment?.status,
    status: o.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

// ── Admin actions on Shiprocket-side shipment lifecycle ────────────────
// All of these look up the order by id, call the SR client, persist any
// returned handles on order.tracking, and return the fresh order. Errors
// bubble up — the admin controller turns them into 4xx/5xx.

async function retryShiprocketSync(orderId) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");
  await syncOrderToShiprocket(order, {});
  return serialize(order);
}

async function scheduleShiprocketPickup(orderId) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");
  const shipmentId = order.tracking?.shipmentId;
  if (!shipmentId) throw ApiError.badRequest("Order not yet synced to Shiprocket");
  const res = await shiprocket.requestPickup(shipmentId);
  order.tracking.pickupScheduled = true;
  if (res.pickupScheduledDate) {
    order.tracking.pickupScheduledDate = new Date(res.pickupScheduledDate);
  }
  await order.save();
  return serialize(order);
}

async function generateShiprocketLabel(orderId) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");
  const shipmentId = order.tracking?.shipmentId;
  if (!shipmentId) throw ApiError.badRequest("Order not yet synced to Shiprocket");
  const res = await shiprocket.generateLabel(shipmentId);
  if (res.labelUrl) {
    order.tracking.labelUrl = res.labelUrl;
    await order.save();
  }
  return serialize(order);
}

async function cancelShiprocketShipment(orderId) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");
  const awb = order.tracking?.awb;
  if (!awb) throw ApiError.badRequest("Order has no AWB assigned yet");
  await shiprocket.cancelShipment(awb);
  order.status = "cancelled";
  await order.save();
  return serialize(order);
}

async function refreshShiprocketTracking(orderId) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");
  const awb = order.tracking?.awb;
  if (!awb) throw ApiError.badRequest("Order has no AWB assigned yet");
  const t = await shiprocket.trackByAWB(awb);
  order.tracking.lastSyncedAt = new Date();
  await order.save();
  return { order: serialize(order), tracking: t };
}

module.exports = {
  createFromCart,
  verifyPayment,
  listForUser,
  getOne,
  retryShiprocketSync,
  scheduleShiprocketPickup,
  generateShiprocketLabel,
  cancelShiprocketShipment,
  refreshShiprocketTracking,
  retryPendingShiprocketSyncs,
};
