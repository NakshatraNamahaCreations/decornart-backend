"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const productBody = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, hyphens"),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional(),
  price: z.coerce.number().min(0),
  occasion: z.string().trim().max(60).optional(),
  occasions: z.array(z.string().trim().max(60)).optional(),
  category: z.enum(["signature", "handmade", "classic", "seasonal"]),
  stems: z.string().trim().max(400).optional(),
  images: z.array(z.string().trim().url()).optional(),
  stock: z.coerce.number().int().min(0).optional(),
  isNew: z.boolean().optional(),
  isBestseller: z.boolean().optional(),
  status: z.enum(["active", "draft", "archived"]).optional(),
});

const productUpdate = productBody.partial();

const idParam = z.object({ id: objectId });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(80).optional(),
  status: z.enum(["active", "draft", "archived", "all"]).optional(),
  category: z.enum(["signature", "handmade", "classic", "seasonal"]).optional(),
});

module.exports = { productBody, productUpdate, idParam, listQuery };
