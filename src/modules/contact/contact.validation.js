"use strict";

const { z } = require("zod");

const create = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().toLowerCase(),
  phone: z.string().trim().min(7).max(20).optional(),
  subject: z.string().trim().max(160).optional(),
  message: z.string().trim().min(5).max(4000),
  type: z.enum(["contact", "wholesale"]).optional(),
});

const idParam = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid id"),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(160).optional(),
  type: z.enum(["all", "contact", "wholesale"]).optional(),
  status: z.enum(["all", "new", "handled"]).optional(),
});

const statusUpdate = z.object({
  status: z.enum(["new", "handled"]),
});

module.exports = { create, idParam, listQuery, statusUpdate };
