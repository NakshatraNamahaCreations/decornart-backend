"use strict";

const { z } = require("zod");

// Category slugs live in the DB now. Storefront filter accepts any lowercase
// slug shape — an unknown slug simply matches zero products.
const categorySlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+$/, "Invalid category slug");

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  // Cap set high so the storefront can pull a full match set (up to 1000)
  // in one call for sidebar facet counts. Typical page-size requests stay
  // small (30–60); this only kicks in for the count-only side-channel.
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  category: categorySlug.optional(),
  occasion: z.string().trim().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z.enum(["featured", "price-asc", "price-desc", "newest"]).optional(),
  q: z.string().trim().max(80).optional(),
  bestseller: z.coerce.boolean().optional(),
  isNew: z.coerce.boolean().optional(),
  // Availability filter driven from the storefront's sidebar. "in" →
  // stock > 0, "out" → stock === 0. Omit for no filter.
  stockStatus: z.enum(["in", "out"]).optional(),
  // Material facet — comma-separated list (e.g. ?material=paper,wood)
  // for multi-select on the storefront. Service layer splits + trims.
  material: z.string().trim().max(200).optional(),
  // Brand style facet — comma-separated (e.g. ?brandStyle=luxury,modern).
  brandStyle: z.string().trim().max(200).optional(),
});

const slugParam = z.object({
  slug: z.string().trim().min(1).max(120),
});

module.exports = { listQuery, slugParam };
