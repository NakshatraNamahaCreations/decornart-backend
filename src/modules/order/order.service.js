"use strict";

const crypto = require("crypto");
const Order = require("./order.model");
const Product = require("../product/product.model");
const cartService = require("../cart/cart.service");
const couponService = require("../coupon/coupon.service");
const payment = require("../../services/payment.service");
const email = require("../../services/email.service");
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

  return serialize(order);
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

module.exports = { createFromCart, verifyPayment, listForUser, getOne };
