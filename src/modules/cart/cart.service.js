"use strict";

const Cart = require("./cart.model");
const Product = require("../product/product.model");
const settingsService = require("../settings/settings.service");
const shippingService = require("../shipping/shipping.service");
const couponService = require("../coupon/coupon.service");
const config = require("../../config");
const { ApiError } = require("../../utils/ApiError");

// Legacy config-based promoCodes still supported (kept as a static fallback
// alongside DB-driven coupons managed from the admin panel). Tax/shipping now
// come from Settings + ShippingRule; the config values are used only if
// settings can't be read.
const { promoCodes } = config.commerce;

async function getOrCreate(owner, isGuest) {
  let cart = await Cart.findOne({ owner });
  if (!cart) cart = await Cart.create({ owner, isGuest, lines: [] });
  return cart;
}

/**
 * Hydrates lines to full product cards in ONE query (batched $in lookup, not a
 * find-per-line N+1) and computes all money on the server. Shipping and GST
 * come from Settings + ShippingRule so admins can tune them without redeploy.
 * Pass `pincode` to get a precise shipping preview; otherwise defaults apply.
 */
async function hydrate(cart, opts = {}) {
  const ids = cart.lines.map((l) => l.product);
  // Include `variants` so we can pluck price/image per line when a variantId
  // was recorded on the cart line.
  const products = ids.length
    ? await Product.find({ _id: { $in: ids } })
        .select("slug name price images stock category variants colorImages")
        .lean()
    : [];
  const byId = new Map(products.map((p) => [String(p._id), p]));

  // Pipe cleaners share one aggregated palette across the whole category,
  // so a shopper can pick a colour that isn't on THIS product's own
  // `colorImages` list. Batch-fetch sibling pipe-cleaner products that
  // do have those colours so the cart can still render the matching
  // swatch image. One query per hydrate call regardless of cart size.
  const missingPipeCleanerColors = new Set();
  for (const line of cart.lines) {
    const p = byId.get(String(line.product));
    if (!p || !line.color || p.category !== "pipe-cleaners") continue;
    const hasLocal =
      Array.isArray(p.colorImages) &&
      p.colorImages.some((c) => c && c.color === line.color);
    if (!hasLocal) missingPipeCleanerColors.add(line.color);
  }
  const pipeCleanerFallback = new Map(); // color → image url
  if (missingPipeCleanerColors.size > 0) {
    const siblings = await Product.find({
      category: "pipe-cleaners",
      "colorImages.color": { $in: [...missingPipeCleanerColors] },
    })
      .select("colorImages")
      .lean();
    for (const s of siblings) {
      for (const ci of s.colorImages || []) {
        if (ci?.color && ci.image && !pipeCleanerFallback.has(ci.color)) {
          pipeCleanerFallback.set(ci.color, ci.image);
        }
      }
    }
  }

  const items = [];
  for (const line of cart.lines) {
    const p = byId.get(String(line.product));
    if (!p) continue; // product removed since add — skip gracefully
    // Variant lookup: when the line was added with a variantId, the picked
    // variant's price/image/stock override the parent product's. If the
    // variant was later deleted by the admin, fall back to the parent.
    const variant =
      line.variantId && Array.isArray(p.variants)
        ? p.variants.find((v) => String(v._id) === String(line.variantId))
        : null;
    // Colour-image resolution: prefer this product's own upload for the
    // picked colour, then any sibling pipe-cleaner product's upload for
    // the same colour, then the variant / base image. Missing entries
    // silently fall through.
    const localColorImage =
      line.color && Array.isArray(p.colorImages)
        ? p.colorImages.find((c) => c && c.color === line.color)?.image
        : null;
    const colorImageUrl =
      localColorImage ||
      (line.color ? pipeCleanerFallback.get(line.color) : null);
    const price = variant ? variant.price : p.price;
    const stock = variant ? variant.stock : p.stock;
    const image =
      colorImageUrl || variant?.image || (p.images && p.images[0]) || null;
    const displayName = variant ? `${p.name} — ${variant.name}` : p.name;
    const qty = Math.min(line.qty, stock || line.qty);
    items.push({
      productId: String(p._id),
      variantId: line.variantId || null,
      variantName: variant?.name || null,
      color: line.color || null,
      slug: p.slug,
      name: displayName,
      price,
      image,
      category: p.category,
      qty,
      lineTotal: price * qty,
    });
  }

  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);

  // Settings-driven tax + shipping. Failing gracefully to config defaults so
  // a broken settings doc can never brick the cart.
  let gstRate = config.commerce.gstRate;
  let quote = null;
  try {
    const settings = await settingsService.get();
    gstRate = settings.tax?.gstRate ?? gstRate;
    quote = await shippingService.quote({ pincode: opts.pincode, subtotal });
  } catch {
    /* fall back to config-based numbers */
  }

  const gst = Math.round(subtotal * gstRate);
  // TESTING: shipping charges disabled everywhere so the storefront total
  // matches the Razorpay total without collecting a shipping fee. Restore
  // the block below when re-enabling paid shipping.
  const shipping = 0;
  /*
  // Baseline "standard" charge from quote (or config fallback). Order flow
  // overrides this with an express/same-day flat rate when the shopper picks
  // one — cart preview keeps the standard number so the storefront UI stays
  // stable until checkout.
  const standardCharge = quote
    ? quote.charge
    : subtotal === 0
      ? 0
      : subtotal >= config.commerce.freeShippingOver
        ? 0
        : config.commerce.flatShipping;
  const SHIPPING_METHOD_CHARGES = { express: 150, "same-day": 250 };
  const shipping =
    opts.shippingMethod && opts.shippingMethod !== "standard"
      ? SHIPPING_METHOD_CHARGES[opts.shippingMethod] ?? standardCharge
      : standardCharge;
  */

  // Discount resolution — prefer DB-driven coupons (admin panel), fall back
  // to the legacy static promoCodes map. If a code stored on the cart no
  // longer validates (expired, min-order not met, etc.), we drop the discount
  // silently and let the UI surface the message on the next explicit apply.
  let discount = 0;
  if (cart.promoCode) {
    let handled = false;
    try {
      const preview = await couponService.validateForCart({
        code: cart.promoCode,
        subtotal,
        userId: opts.userId || null,
      });
      discount = preview.discount;
      handled = true;
    } catch {
      /* fall through to legacy map */
    }
    if (!handled) {
      const pct = promoCodes[cart.promoCode];
      if (pct) discount = Math.round(subtotal * pct);
    }
  }

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
      freeShippingOver: quote?.freeShippingThreshold ?? config.commerce.freeShippingOver,
      toFreeShipping: Math.max(
        0,
        (quote?.freeShippingThreshold ?? config.commerce.freeShippingOver) - subtotal
      ),
      shippingQuote: quote,
    },
  };
}

async function get(owner, isGuest) {
  const cart = await getOrCreate(owner, isGuest);
  return hydrate(cart, { userId: isGuest ? null : owner });
}

// Lines are keyed by (product, variantId, color). Two lines with the same
// product but different variants (e.g. 6mm vs 8mm) or different colors
// (e.g. Rose Red vs Blue) are stored separately.
function matchesLine(line, productId, variantId, color) {
  const sameProduct = String(line.product) === String(productId);
  const sameVariant =
    (line.variantId || null) === (variantId || null);
  const sameColor = (line.color || null) === (color || null);
  return sameProduct && sameVariant && sameColor;
}

async function addItem(owner, isGuest, { productId, qty, variantId = null, color = null }) {
  const product = await Product.findOne({ _id: productId, status: "active" })
    .select("stock variants")
    .lean();
  if (!product) throw ApiError.notFound("Product not available");

  // Resolve stock against the picked variant when the caller supplied a
  // variantId. If the variantId is unknown, reject cleanly rather than
  // silently falling back to the parent product.
  let stock = product.stock;
  if (variantId) {
    const variant = (product.variants || []).find(
      (v) => String(v._id) === String(variantId)
    );
    if (!variant) throw ApiError.badRequest("Unknown variant");
    stock = variant.stock;
  }
  if (stock < qty) throw ApiError.badRequest("Not enough stock");

  // NOTE: colour is intentionally NOT validated against product.colors.
  // Pipe-cleaner products show the shared category palette (aggregated
  // across all pipe-cleaner SKUs), so a shopper can legitimately pick a
  // colour that isn't on this specific product's list. The zod schema
  // already length-bounds the value, which is all the safety we need for
  // a free-form label.

  const cart = await getOrCreate(owner, isGuest);
  const existing = cart.lines.find((l) =>
    matchesLine(l, productId, variantId, color)
  );
  if (existing) existing.qty = Math.min(99, existing.qty + qty);
  else
    cart.lines.push({
      product: productId,
      variantId: variantId || null,
      color: color || null,
      qty,
    });
  await cart.save();
  return hydrate(cart);
}

async function updateItem(owner, isGuest, productId, qty, variantId = null, color = null) {
  const cart = await getOrCreate(owner, isGuest);
  const line = cart.lines.find((l) => matchesLine(l, productId, variantId, color));
  if (!line) throw ApiError.notFound("Item not in cart");
  if (qty === 0) {
    cart.lines = cart.lines.filter((l) => !matchesLine(l, productId, variantId, color));
  } else {
    line.qty = qty;
  }
  await cart.save();
  return hydrate(cart);
}

async function removeItem(owner, isGuest, productId, variantId = null, color = null) {
  const cart = await getOrCreate(owner, isGuest);
  cart.lines = cart.lines.filter((l) => !matchesLine(l, productId, variantId, color));
  await cart.save();
  return hydrate(cart);
}

async function applyPromo(owner, isGuest, code) {
  const normalized = code.toUpperCase();
  const cart = await getOrCreate(owner, isGuest);

  // Compute the current subtotal so the coupon validator can enforce the
  // "minimum order value" rule against real numbers.
  const preview = await hydrate(cart);
  const subtotal = preview.summary.subtotal;
  const userId = isGuest ? null : owner;

  // Prefer DB-managed coupons; fall back to the legacy hard-coded map. When
  // both fail, surface the DB validator's error (it's the more informative
  // one — "coupon expired", "minimum order ₹1499", etc.).
  try {
    await couponService.validateForCart({ code: normalized, subtotal, userId });
  } catch (dbErr) {
    if (!promoCodes[normalized]) throw dbErr;
  }

  cart.promoCode = normalized;
  await cart.save();
  return hydrate(cart, { userId });
}

async function clear(owner) {
  await Cart.updateOne({ owner }, { $set: { lines: [], promoCode: null } });
}

module.exports = { get, addItem, updateItem, removeItem, applyPromo, clear, hydrate, getOrCreate };
