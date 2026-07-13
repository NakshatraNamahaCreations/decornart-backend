"use strict";

const Coupon = require("./coupon.model");
const Order = require("../order/order.model");
const { getPagination, buildMeta } = require("../../utils/paginate");
const { ApiError } = require("../../utils/ApiError");

async function list(query) {
  const { page, limit, skip } = getPagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (query.status && query.status !== "all") filter.status = query.status;
  if (query.q) {
    filter.$or = [
      { code: { $regex: query.q.toUpperCase(), $options: "i" } },
      { description: { $regex: query.q, $options: "i" } },
    ];
  }
  const [items, total] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Coupon.countDocuments(filter),
  ]);
  return { items: items.map(serialize), meta: buildMeta({ page, limit, total }) };
}

async function getById(id) {
  const doc = await Coupon.findById(id).lean();
  if (!doc) throw ApiError.notFound("Coupon not found");
  // Compute the same-day usage count from Order.promoCode. The `usageCount`
  // on the doc will drift if orders are deleted directly; this aggregation
  // gives the source-of-truth usage figure for the detail view.
  const actualUsage = await Order.countDocuments({
    promoCode: doc.code,
    "payment.status": "paid",
  });
  return { ...serialize(doc), actualUsage };
}

async function create(payload) {
  const exists = await Coupon.exists({ code: payload.code });
  if (exists) throw ApiError.conflict("A coupon with that code already exists");
  const doc = await Coupon.create(payload);
  return serialize(doc.toObject());
}

async function update(id, payload) {
  if (payload.code) {
    const clash = await Coupon.exists({ code: payload.code, _id: { $ne: id } });
    if (clash) throw ApiError.conflict("A coupon with that code already exists");
  }
  const doc = await Coupon.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true, runValidators: true }
  ).lean();
  if (!doc) throw ApiError.notFound("Coupon not found");
  return serialize(doc);
}

async function remove(id) {
  const doc = await Coupon.findByIdAndDelete(id).lean();
  if (!doc) throw ApiError.notFound("Coupon not found");
  return { id: String(doc._id) };
}

/**
 * Validate a code against a cart subtotal. Returns discount amount + coupon
 * summary. The storefront checkout uses this to preview savings before order
 * creation; the order flow re-validates the same way on submit so a client
 * that fakes a payload can't sneak an unauthorised discount through.
 */
async function validateForCart({ code, subtotal, userId }) {
  const doc = await Coupon.findOne({ code: code.toUpperCase() });
  if (!doc) throw ApiError.notFound("Invalid coupon code");
  if (doc.status !== "active") throw ApiError.badRequest("Coupon is no longer active");
  const now = new Date();
  if (doc.validFrom && now < doc.validFrom) throw ApiError.badRequest("Coupon is not yet active");
  if (doc.validTo && now > doc.validTo) throw ApiError.badRequest("Coupon has expired");
  if (doc.usageLimit > 0 && doc.usageCount >= doc.usageLimit) {
    throw ApiError.badRequest("Coupon usage limit reached");
  }
  if (doc.minOrderValue > 0 && subtotal < doc.minOrderValue) {
    throw ApiError.badRequest(
      `This coupon needs a minimum order of ₹${doc.minOrderValue}`
    );
  }
  if (userId && doc.perUserLimit > 0) {
    const used = await Order.countDocuments({
      user: userId,
      promoCode: doc.code,
      "payment.status": "paid",
    });
    if (used >= doc.perUserLimit) {
      throw ApiError.badRequest("You have already used this coupon");
    }
  }

  let discount = 0;
  if (doc.discountType === "percentage") {
    discount = Math.floor(subtotal * (doc.discountValue / 100));
    if (doc.maxDiscount > 0) discount = Math.min(discount, doc.maxDiscount);
  } else {
    discount = Math.min(doc.discountValue, subtotal);
  }
  discount = Math.max(0, discount);

  return {
    code: doc.code,
    discountType: doc.discountType,
    discountValue: doc.discountValue,
    discount,
    subtotal,
    total: Math.max(0, subtotal - discount),
  };
}

async function listPublic({ userId } = {}) {
  const now = new Date();
  const docs = await Coupon.find({
    status: "active",
    $or: [{ validFrom: { $lte: now } }, { validFrom: null }],
    $and: [
      { $or: [{ validTo: { $gte: now } }, { validTo: null }] },
    ],
  })
    .sort({ createdAt: -1 })
    .lean();

  // Drop coupons whose global cap is exhausted.
  const notGloballyCapped = docs.filter(
    (c) => !(c.usageLimit > 0 && c.usageCount >= c.usageLimit)
  );

  // For a signed-in shopper, hide any coupon they've already exhausted per-user.
  // Guests see everything else — they haven't identified themselves yet.
  let eligible = notGloballyCapped;
  if (userId) {
    const perUserCoupons = notGloballyCapped.filter((c) => c.perUserLimit > 0);
    if (perUserCoupons.length) {
      const counts = await Promise.all(
        perUserCoupons.map((c) =>
          Order.countDocuments({
            user: userId,
            promoCode: c.code,
            "payment.status": "paid",
          })
        )
      );
      const usedByCode = new Map(perUserCoupons.map((c, i) => [c.code, counts[i]]));
      eligible = notGloballyCapped.filter((c) => {
        if (!(c.perUserLimit > 0)) return true;
        return (usedByCode.get(c.code) || 0) < c.perUserLimit;
      });
    }
  }

  return eligible.map((c) => ({
    code: c.code,
    description: c.description || "",
    discountType: c.discountType,
    discountValue: c.discountValue,
    maxDiscount: c.maxDiscount || 0,
    minOrderValue: c.minOrderValue || 0,
    validTo: c.validTo,
  }));
}

async function incrementUsage(code) {
  if (!code) return;
  await Coupon.updateOne({ code: code.toUpperCase() }, { $inc: { usageCount: 1 } });
}

function serialize(c) {
  return {
    id: String(c._id),
    code: c.code,
    description: c.description || "",
    discountType: c.discountType,
    discountValue: c.discountValue,
    maxDiscount: c.maxDiscount || 0,
    minOrderValue: c.minOrderValue || 0,
    usageLimit: c.usageLimit || 0,
    usageCount: c.usageCount || 0,
    perUserLimit: c.perUserLimit || 0,
    validFrom: c.validFrom,
    validTo: c.validTo,
    categorySlugs: c.categorySlugs || [],
    productIds: (c.productIds || []).map(String),
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

module.exports = { list, listPublic, getById, create, update, remove, validateForCart, incrementUsage };
