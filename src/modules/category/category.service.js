"use strict";

const Category = require("./category.model");
const Product = require("../product/product.model");
const cache = require("../../services/cache.service");
const { ApiError } = require("../../utils/ApiError");
const { CATEGORIES } = require("./category.constants");

const LIST_KEY = "category:list";
const LIST_TTL = 120; // seconds

function invalidate() {
  if (typeof cache.delByPrefix === "function") {
    cache.delByPrefix("category:").catch(() => {});
  } else if (typeof cache.flush === "function") {
    cache.flush().catch(() => {});
  }
}

/**
 * Bootstrap: if the DB has no categories yet, seed from the static constants
 * so an empty install still ships with the 8 original slugs and the
 * storefront's category pages keep working.
 */
async function ensureSeeded() {
  const count = await Category.estimatedDocumentCount();
  if (count > 0) return;
  await Category.insertMany(
    CATEGORIES.map((c, i) => ({
      slug: c.slug,
      name: c.name,
      description: c.description || "",
      position: i,
      active: true,
    })),
    { ordered: false }
  ).catch(() => {}); // dupe key on retry is fine
}

/**
 * Public list — includes per-category active-product count. Cached briefly so
 * homepage/nav don't re-aggregate on every request.
 */
async function list() {
  return cache.remember(LIST_KEY, LIST_TTL, async () => {
    await ensureSeeded();
    const [cats, grouped] = await Promise.all([
      Category.find({ active: true })
        .sort({ position: 1, name: 1 })
        .lean(),
      Product.aggregate([
        { $match: { status: "active" } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ]),
    ]);
    const counts = new Map(grouped.map((g) => [g._id, g.count]));
    return cats.map((c) => ({
      id: String(c._id),
      slug: c.slug,
      name: c.name,
      description: c.description || "",
      banner: c.banner || "",
      image: c.image || "",
      position: c.position || 0,
      parent: c.parent ? String(c.parent) : null,
      count: counts.get(c.slug) || 0,
    }));
  });
}

// ── Admin CRUD ────────────────────────────────────────────────────────
async function listForAdmin() {
  await ensureSeeded();
  const [cats, grouped] = await Promise.all([
    Category.find({}).sort({ position: 1, name: 1 }).lean(),
    Product.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]),
  ]);
  const counts = new Map(grouped.map((g) => [g._id, g.count]));
  return cats.map((c) => serialize(c, counts.get(c.slug) || 0));
}

async function getById(id) {
  const c = await Category.findById(id).lean();
  if (!c) throw ApiError.notFound("Category not found");
  const count = await Product.countDocuments({ category: c.slug });
  return serialize(c, count);
}

async function create(payload) {
  const exists = await Category.exists({ slug: payload.slug });
  if (exists) throw ApiError.conflict("A category with that slug already exists");
  // Auto-append at the end unless caller sent a position.
  if (payload.position == null) {
    const last = await Category.find({}).sort({ position: -1 }).limit(1).lean();
    payload.position = (last[0]?.position ?? -1) + 1;
  }
  const doc = await Category.create(payload);
  invalidate();
  return serialize(doc.toObject(), 0);
}

async function update(id, payload) {
  const current = await Category.findById(id);
  if (!current) throw ApiError.notFound("Category not found");
  if (payload.slug && payload.slug !== current.slug) {
    const clash = await Category.exists({ slug: payload.slug, _id: { $ne: id } });
    if (clash) throw ApiError.conflict("A category with that slug already exists");
    // Cascade the slug rename to existing products so filters keep working.
    await Product.updateMany(
      { category: current.slug },
      { $set: { category: payload.slug } }
    );
  }
  Object.assign(current, payload);
  await current.save();
  invalidate();
  const count = await Product.countDocuments({ category: current.slug });
  return serialize(current.toObject(), count);
}

async function remove(id) {
  const doc = await Category.findById(id).lean();
  if (!doc) throw ApiError.notFound("Category not found");
  const productCount = await Product.countDocuments({ category: doc.slug });
  if (productCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete: ${productCount} product${productCount === 1 ? "" : "s"} still use this category. Move them first.`
    );
  }
  await Category.deleteOne({ _id: id });
  invalidate();
  return { id: String(doc._id) };
}

/**
 * Bulk reorder — accepts an array of ids in the desired order and writes
 * position = index for each. Used by drag-and-drop / up-down arrows.
 */
async function reorder(orderedIds) {
  const ops = orderedIds.map((id, index) => ({
    updateOne: { filter: { _id: id }, update: { $set: { position: index } } },
  }));
  if (ops.length) await Category.bulkWrite(ops);
  invalidate();
  return { updated: ops.length };
}

function serialize(c, count = 0) {
  return {
    id: String(c._id),
    slug: c.slug,
    name: c.name,
    description: c.description || "",
    banner: c.banner || "",
    image: c.image || "",
    position: c.position || 0,
    parent: c.parent ? String(c.parent) : null,
    active: c.active !== false,
    count,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

module.exports = {
  list,
  listForAdmin,
  getById,
  create,
  update,
  remove,
  reorder,
};
