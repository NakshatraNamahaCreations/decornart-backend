"use strict";

const Cart = require("./cart.model");
const Product = require("../product/product.model");
const config = require("../../config");
const { ApiError } = require("../../utils/ApiError");

const { gstRate, freeShippingOver, flatShipping, promoCodes } = config.commerce;

async function getOrCreate(owner, isGuest) {
  let cart = await Cart.findOne({ owner });
  if (!cart) cart = await Cart.create({ owner, isGuest, lines: [] });
  return cart;
}

/**
 * Hydrates lines to full product cards in ONE query (batched $in lookup, not a
 * find-per-line N+1) and computes all money on the server.
 */
async function hydrate(cart) {
  const ids = cart.lines.map((l) => l.product);
  const products = ids.length
    ? await Product.find({ _id: { $in: ids } })
        .select("slug name price images stock category")
        .lean()
    : [];
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const items = [];
  for (const line of cart.lines) {
    const p = byId.get(String(line.product));
    if (!p) continue; // product removed since add — skip gracefully
    const qty = Math.min(line.qty, p.stock || line.qty);
    items.push({
      productId: String(p._id),
      slug: p.slug,
      name: p.name,
      price: p.price,
      image: (p.images && p.images[0]) || null,
      category: p.category,
      qty,
      lineTotal: p.price * qty,
    });
  }

  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const gst = Math.round(subtotal * gstRate);
  const shipping = subtotal === 0 ? 0 : subtotal >= freeShippingOver ? 0 : flatShipping;

  let discount = 0;
  const pct = cart.promoCode ? promoCodes[cart.promoCode] : 0;
  if (pct) discount = Math.round(subtotal * pct);

  const total = Math.max(0, subtotal + gst + shipping - discount);

  return {
    owner: cart.owner,
    items,
    promoCode: cart.promoCode,
    summary: {
      subtotal,
      gst,
      gstRate,
      shipping,
      discount,
      total,
      freeShippingOver,
      toFreeShipping: Math.max(0, freeShippingOver - subtotal),
    },
  };
}

async function get(owner, isGuest) {
  const cart = await getOrCreate(owner, isGuest);
  return hydrate(cart);
}

async function addItem(owner, isGuest, { productId, qty }) {
  const product = await Product.findOne({ _id: productId, status: "active" }).select("stock").lean();
  if (!product) throw ApiError.notFound("Product not available");
  if (product.stock < qty) throw ApiError.badRequest("Not enough stock");

  const cart = await getOrCreate(owner, isGuest);
  const existing = cart.lines.find((l) => String(l.product) === productId);
  if (existing) existing.qty = Math.min(99, existing.qty + qty);
  else cart.lines.push({ product: productId, qty });
  await cart.save();
  return hydrate(cart);
}

async function updateItem(owner, isGuest, productId, qty) {
  const cart = await getOrCreate(owner, isGuest);
  const line = cart.lines.find((l) => String(l.product) === productId);
  if (!line) throw ApiError.notFound("Item not in cart");
  if (qty === 0) cart.lines = cart.lines.filter((l) => String(l.product) !== productId);
  else line.qty = qty;
  await cart.save();
  return hydrate(cart);
}

async function removeItem(owner, isGuest, productId) {
  const cart = await getOrCreate(owner, isGuest);
  cart.lines = cart.lines.filter((l) => String(l.product) !== productId);
  await cart.save();
  return hydrate(cart);
}

async function applyPromo(owner, isGuest, code) {
  const normalized = code.toUpperCase();
  if (!promoCodes[normalized]) throw ApiError.badRequest("Invalid promo code");
  const cart = await getOrCreate(owner, isGuest);
  cart.promoCode = normalized;
  await cart.save();
  return hydrate(cart);
}

async function clear(owner) {
  await Cart.updateOne({ owner }, { $set: { lines: [], promoCode: null } });
}

module.exports = { get, addItem, updateItem, removeItem, applyPromo, clear, hydrate, getOrCreate };
