"use strict";

const { z } = require("zod");

const subscribe = z.object({
  email: z.string().trim().email().toLowerCase(),
  source: z.string().trim().max(40).optional(),
});

module.exports = { subscribe };
