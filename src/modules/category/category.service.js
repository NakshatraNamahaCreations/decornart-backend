"use strict";

const Product = require("../product/product.model");
const cache = require("../../services/cache.service");
const { CATEGORIES } = require("./category.constants");

const LIST_KEY = "category:list";
const LIST_TTL = 120; // seconds — counts are cheap to recompute

/**
 * Return the catalogue of craft-supply categories with live product counts.
 * The metadata (slug/name/description) is static; the count is aggregated
 * from active products. Cached read-through so the dashboard, nav, and
 * homepage tiles can hit this endpoint without re-aggregating each time.
 */
async function list() {
  return cache.remember(LIST_KEY, LIST_TTL, async () => {
    const grouped = await Product.aggregate([
      { $match: { status: "active" } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);
    const counts = new Map(grouped.map((g) => [g._id, g.count]));
    return CATEGORIES.map((c) => ({
      slug: c.slug,
      name: c.name,
      description: c.description,
      count: counts.get(c.slug) || 0,
    }));
  });
}

module.exports = { list };
