"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

// Craft-supply category slugs. Mirrors decornart-bouquets/lib/data/
// categories.js and decornart-admin's ProductForm so all three layers
// agree on the allowed values.
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

const categoryEnum = z.enum(CATEGORIES);

// Specifications block — every key is optional so partial sets are fine.
const specsSchema = z
  .object({
    material: z.string().trim().max(120).optional(),
    pack: z.string().trim().max(120).optional(),
    origin: z.string().trim().max(120).optional(),
    finish: z.string().trim().max(120).optional(),
  })
  .partial()
  .optional();

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
  category: categoryEnum,
  // Craft-supply detail fields.
  packContents: z.array(z.string().trim().max(300)).optional(),
  usage: z.array(z.string().trim().max(300)).optional(),
  specs: specsSchema,
  // Legacy use-case tags — admin no longer writes these but the
  // storefront filter still reads them, so keep them accepted on the
  // payload for backwards compat with older data flows.
  occasion: z.string().trim().max(60).optional(),
  occasions: z.array(z.string().trim().max(60)).optional(),
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
  category: categoryEnum.optional(),
});

module.exports = { productBody, productUpdate, idParam, listQuery, CATEGORIES };
