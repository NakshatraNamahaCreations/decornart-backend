"use strict";

const Wishlist = require("./wishlist.model");
const Product = require("../product/product.model");
const { ApiError } = require("../../utils/ApiError");

async function getOrCreate(userId) {
  let wl = await Wishlist.findOne({ user: userId });
  if (!wl) wl = await Wishlist.create({ user: userId, products: [] });
  return wl;
}

async function hydrate(wl) {
  if (!wl.products.length) return { items: [] };
  // single batched lookup — no per-id N+1
  const products = await Product.find({ _id: { $in: wl.products }, status: "active" })
    .select("slug name price category images isNew isBestseller rating")
    .lean();
  const items = products.map((p) => ({
    id: String(p._id),
    slug: p.slug,
    name: p.name,
    price: p.price,
    category: p.category,
    image: (p.images && p.images[0]) || null,
    isNew: p.isNew,
    isBestseller: p.isBestseller,
    rating: p.rating,
  }));
  return { items };
}

async function get(userId) {
  return hydrate(await getOrCreate(userId));
}

async function add(userId, productId) {
  const product = await Product.exists({ _id: productId, status: "active" });
  if (!product) throw ApiError.notFound("Product not available");
  // $addToSet is atomic + idempotent — no duplicate, no read-modify-write race
  await Wishlist.updateOne(
    { user: userId },
    { $addToSet: { products: productId } },
    { upsert: true }
  );
  return get(userId);
}

async function remove(userId, productId) {
  await Wishlist.updateOne({ user: userId }, { $pull: { products: productId } });
  return get(userId);
}

module.exports = { get, add, remove };
