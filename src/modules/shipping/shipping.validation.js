"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const ruleBody = z.object({
  name: z.string().trim().min(2).max(120),
  pincodePrefix: z
    .string()
    .trim()
    .regex(/^\d{0,6}$/, "Digits only, up to 6 characters")
    .optional()
    .or(z.literal("")),
  state: z.string().trim().max(80).optional().or(z.literal("")),
  charge: z.coerce.number().min(0),
  freeShippingThreshold: z.coerce.number().min(0).optional(),
  estimatedDaysMin: z.coerce.number().int().min(0).optional(),
  estimatedDaysMax: z.coerce.number().int().min(0).optional(),
  codAvailable: z.boolean().optional(),
  priority: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const ruleUpdate = ruleBody.partial();

const quoteBody = z.object({
  pincode: z.string().trim().regex(/^\d{6}$/, "Pincode must be 6 digits"),
  subtotal: z.coerce.number().min(0),
});

const idParam = z.object({ id: objectId });

module.exports = { ruleBody, ruleUpdate, quoteBody, idParam };
