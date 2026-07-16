"use strict";

const crypto = require("crypto");
const Product = require("./product.model");
const cache = require("../../services/cache.service");
const config = require("../../config");
const { getPagination, buildMeta } = require("../../utils/paginate");
const { ApiError } = require("../../utils/ApiError");

const SORT_MAP = {
  "price-asc": { price: 1 },
  "price-desc": { price: -1 },
  newest: { createdAt: -1 },
  featured: { isBestseller: -1, createdAt: -1 },
};

// Escape user input before dropping it into a $regex so a stray `.` or `*`
// doesn't turn a literal search into an accidental wildcard (or worse —
// a ReDoS-prone pattern).
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFilter(q) {
  const filter = { status: "active" };
  if (q.category) filter.category = q.category;
  if (q.occasion) filter.occasions = q.occasion;
  if (q.bestseller) filter.isBestseller = true;
  if (q.isNew) filter.isNew = true;
  if (q.minPrice != null || q.maxPrice != null) {
    filter.price = {};
    if (q.minPrice != null) filter.price.$gte = q.minPrice;
    if (q.maxPrice != null) filter.price.$lte = q.maxPrice;
  }
  if (q.q) {
    // Word-by-word contains match across name / description / category /
    // occasions. Every whitespace-separated term must appear somewhere on
    // the product, so "butterfly gift" matches products whose fields
    // contain BOTH "butterfly" AND "gift" (order-independent). This gives
    // the responsive LIKE behavior shoppers expect from a search box,
    // rather than MongoDB's stemmed $text OR-across-words match.
    const terms = q.q
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length) {
      filter.$and = terms.map((t) => {
        const rx = new RegExp(escapeRegex(t), "i");
        return {
          $or: [
            { name: rx },
            { description: rx },
            { category: rx },
            { occasions: rx },
          ],
        };
      });
    }
  }
  return filter;
}

function cacheKey(prefix, obj) {
  const hash = crypto.createHash("md5").update(JSON.stringify(obj)).digest("hex").slice(0, 12);
  return `${prefix}:${hash}`;
}

async function list(query) {
  const { page, limit, skip } = getPagination(query);
  const filter = buildFilter(query);
  const sort = SORT_MAP[query.sort] || SORT_MAP.featured;
  const key = cacheKey("product:list", { filter, sort, page, limit });

  // Read-through cache. If cache is down, remember() just runs the loader.
  return cache.remember(key, config.redis.productListTtl, async () => {
    // Run count + fetch in parallel (no waterfall). lean() returns plain JS
    // objects — faster, less memory than full Mongoose docs.
    const [items, total] = await Promise.all([
      Product.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .select("slug name price occasion occasions category images isNew isBestseller rating colors")
        .lean(),
      Product.countDocuments(filter),
    ]);
    const cards = items.map((p) => ({
      id: String(p._id),
      slug: p.slug,
      name: p.name,
      price: p.price,
      occasion: p.occasion,
      occasions: p.occasions,
      category: p.category,
      image: (p.images && p.images[0]) || null,
      // Second image (if the admin uploaded one) doubles as the hover
      // preview on ProductCard. Null when the product only has one image.
      imageHover: (p.images && p.images[1]) || null,
      isNew: p.isNew,
      isBestseller: p.isBestseller,
      rating: p.rating,
      colors: p.colors || [],
    }));
    return { items: cards, meta: buildMeta({ page, limit, total }) };
  });
}

async function getBySlug(slug) {
  const key = `product:detail:${slug}`;
  const product = await cache.remember(key, config.redis.productDetailTtl, async () => {
    const doc = await Product.findOne({ slug, status: "active" }).lean();
    if (!doc) return null;
    return { ...doc, id: String(doc._id), _id: undefined };
  });
  if (!product) throw ApiError.notFound("Product not found");
  return product;
}

async function getRelated(slug, limit = 4) {
  const base = await Product.findOne({ slug, status: "active" }).lean();
  if (!base) return [];
  const items = await Product.find({
    status: "active",
    slug: { $ne: slug },
    $or: [{ category: base.category }, { occasions: { $in: base.occasions } }],
  })
    .limit(limit)
    .select("slug name price category images isNew isBestseller rating")
    .lean();
  return items.map((p) => ({
    id: String(p._id),
    slug: p.slug,
    name: p.name,
    price: p.price,
    category: p.category,
    image: (p.images && p.images[0]) || null,
    imageHover: (p.images && p.images[1]) || null,
    isNew: p.isNew,
    isBestseller: p.isBestseller,
    rating: p.rating,
  }));
}

/** Resolve a set of ids to lightweight cards — used by cart/wishlist hydration. */
async function getManyByIds(ids) {
  if (!ids || !ids.length) return [];
  const items = await Product.find({ _id: { $in: ids }, status: "active" })
    .select("slug name price category images stock")
    .lean();
  return items;
}

module.exports = { list, getBySlug, getRelated, getManyByIds };
