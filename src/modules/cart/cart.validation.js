"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const addItem = z.object({
  productId: objectId,
  qty: z.coerce.number().int().min(1).max(99).default(1),
});

const updateItem = z.object({
  qty: z.coerce.number().int().min(0).max(99),
});

const itemParam = z.object({
  productId: objectId,
});

const promo = z.object({
  code: z.string().trim().min(1).max(40),
});

module.exports = { addItem, updateItem, itemParam, promo };
