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
  limit: z.coerce.number().int().min(1).max(60).optional(),
  category: categorySlug.optional(),
  occasion: z.string().trim().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z.enum(["featured", "price-asc", "price-desc", "newest"]).optional(),
  q: z.string().trim().max(80).optional(),
  bestseller: z.coerce.boolean().optional(),
  isNew: z.coerce.boolean().optional(),
});

const slugParam = z.object({
  slug: z.string().trim().min(1).max(120),
});

module.exports = { listQuery, slugParam };
