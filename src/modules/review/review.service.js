"use strict";

const mongoose = require("mongoose");
const Review = require("./review.model");
const Product = require("../product/product.model");
const cache = require("../../services/cache.service");
const { getPagination, buildMeta } = require("../../utils/paginate");
const { ApiError } = require("../../utils/ApiError");

/**
 * Recomputes a product's average rating from its reviews in ONE aggregation
 * pass and writes the rolled-up rating/ratingCount back onto the product, so
 * product reads never have to join reviews. Cache for that product is busted.
 */
async function recomputeRating(productId) {
  const [agg] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    { $group: { _id: "$product", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  const rating = agg ? Math.round(agg.avg * 10) / 10 : 0;
  const ratingCount = agg ? agg.count : 0;
  const product = await Product.findByIdAndUpdate(
    productId,
    { rating, ratingCount },
    { new: true }
  ).lean();
  if (product) cache.delByPrefix(`product:detail:${product.slug}`).catch(() => {});
  cache.delByPrefix("product:list").catch(() => {});
  return { rating, ratingCount };
}

async function create(user, productId, payload) {
  const exists = await Product.exists({ _id: productId, status: "active" });
  if (!exists) throw ApiError.notFound("Product not found");

  let review;
  try {
    review = await Review.create({
      product: productId,
      user: user.id,
      userName: user.name,
      rating: payload.rating,
      title: payload.title,
      body: payload.body,
    });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict("You already reviewed this product");
    throw err;
  }

  const stats = await recomputeRating(productId);
  return { review: serialize(review), ...stats };
}

async function listForProduct(productId, query) {
  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Review.find({ product: productId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("userName rating title body createdAt")
      .lean(),
    Review.countDocuments({ product: productId }),
  ]);
  return {
    items: items.map((r) => ({ ...r, id: String(r._id), _id: undefined })),
    meta: buildMeta({ page, limit, total }),
  };
}

function serialize(r) {
  const o = r.toObject ? r.toObject() : r;
  return {
    id: String(o._id),
    userName: o.userName,
    rating: o.rating,
    title: o.title,
    body: o.body,
    createdAt: o.createdAt,
  };
}

module.exports = { create, listForProduct };
