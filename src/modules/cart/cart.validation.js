"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const addItem = z.object({
  productId: objectId,
  qty: z.coerce.number().int().min(1).max(99).default(1),
  // Optional — the picked variant's _id when the product has variants.
  variantId: objectId.optional(),
  // Optional — the picked color name from Product.colors.
  color: z.string().trim().min(1).max(40).optional(),
});

const updateItem = z.object({
  qty: z.coerce.number().int().min(0).max(99),
});

const itemParam = z.object({
  productId: objectId,
});

// Sent as ?variantId=... on the URL for update/remove so the same product
// added at two variants can be updated / removed independently. `color`
// serves the same purpose for the color selector.
const itemQuery = z.object({
  variantId: objectId.optional(),
  color: z.string().trim().min(1).max(40).optional(),
});

const promo = z.object({
  code: z.string().trim().min(1).max(40),
});

module.exports = { addItem, updateItem, itemParam, itemQuery, promo };
