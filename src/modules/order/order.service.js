"use strict";

const crypto = require("crypto");
const Order = require("./order.model");
const Product = require("../product/product.model");
const cartService = require("../cart/cart.service");
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
async function createFromCart(user, { shippingAddress }) {
  const cart = await cartService.getOrCreate(user.id, false);
  // Passing the shipping pincode makes hydrate compute the same shipping
  // charge the shopper saw at checkout — no drift between preview and order.
  const hydrated = await cartService.hydrate(cart, {
    pincode: shippingAddress?.pincode,
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
      slug: i.slug,
      name: i.name,
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
  await Promise.all(
    order.items.map((i) =>
      Product.updateOne(
        { _id: i.product, stock: { $gte: i.qty } },
        { $inc: { stock: -i.qty } }
      ).catch(() => {})
    )
  );

  order.payment.status = "paid";
  order.payment.razorpayPaymentId = razorpayPaymentId;
  order.status = "confirmed";
  await order.save();

  // Best-effort — clearing cart or email failing must not fail the response.
  cartService.clear(user.id).catch(() => {});
  email.send({
    to: user.email,
    subject: `Decor N Art order ${order.orderNumber} confirmed`,
    html: `<p>Thank you, ${user.name}. Your order <b>${order.orderNumber}</b> is confirmed.</p>`,
  });

  return serialize(order);
}

async function listForUser(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Order.find({ user: userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments({ user: userId }),
  ]);
  return { items: items.map(serializePlain), meta: buildMeta({ page, limit, total }) };
}

async function getOne(userId, id) {
  const order = await Order.findOne({ _id: id, user: userId }).lean();
  if (!order) throw ApiError.notFound("Order not found");
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
    paymentStatus: o.payment?.status,
    status: o.status,
    createdAt: o.createdAt,
  };
}

module.exports = { createFromCart, verifyPayment, listForUser, getOne };
