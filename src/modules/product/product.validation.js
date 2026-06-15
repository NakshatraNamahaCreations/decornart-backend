"use strict";

const { z } = require("zod");

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
  category: z.enum(["signature", "handmade", "classic", "seasonal"]).optional(),
  occasion: z.string().trim().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z.enum(["featured", "price-asc", "price-desc", "newest"]).optional(),
  q: z.string().trim().max(80).optional(),
  bestseller: z.coerce.boolean().optional(),
});

const slugParam = z.object({
  slug: z.string().trim().min(1).max(120),
});

module.exports = { listQuery, slugParam };
