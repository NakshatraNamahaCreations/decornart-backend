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

module.exports = { create };
