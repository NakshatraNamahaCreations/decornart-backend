"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(40)
  .regex(/^[A-Z0-9_-]+$/, "Use A–Z, 0–9, dash or underscore only");

// Base object without the cross-field refinement — we .partial() this for
// updates and re-apply the refinement below.
const couponBase = z.object({
  code,
  description: z.string().trim().max(300).optional(),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.coerce.number().min(0),
  maxDiscount: z.coerce.number().min(0).optional(),
  minOrderValue: z.coerce.number().min(0).optional(),
  usageLimit: z.coerce.number().int().min(0).optional(),
  perUserLimit: z.coerce.number().int().min(0).optional(),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().nullable().optional(),
  categorySlugs: z.array(z.string().trim().toLowerCase()).optional(),
  productIds: z.array(objectId).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const percentCap = (data) =>
  data.discountType !== "percentage" || data.discountValue == null || data.discountValue <= 100;

const couponBody = couponBase.refine(percentCap, {
  message: "Percentage discount cannot exceed 100",
  path: ["discountValue"],
});

const couponUpdate = couponBase.partial().refine(percentCap, {
  message: "Percentage discount cannot exceed 100",
  path: ["discountValue"],
});

const validateBody = z.object({
  code: code,
  subtotal: z.coerce.number().min(0),
  userId: objectId.optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(80).optional(),
  status: z.enum(["all", "active", "inactive"]).optional(),
});

const idParam = z.object({ id: objectId });

module.exports = { couponBody, couponUpdate, validateBody, listQuery, idParam };
