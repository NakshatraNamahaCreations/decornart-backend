"use strict";

const { z } = require("zod");

// Mirrors admin.validation.js — kept in sync by hand for now; collapse
// into a shared constants module once the schema stabilises.
const CATEGORIES = [
  "flower-basket-materials",
  "gift-cards",
  "pipe-cleaners",
  "gift-box",
  "craft-essentials",
  "crochet-materials",
  "ribbons",
  "wrapping-papers",
  "artificial-plants",
];

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
  category: z.enum(CATEGORIES).optional(),
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
