"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok } = require("../../utils/ApiResponse");
const service = require("./category.service");

const list = asyncHandler(async (_req, res) => {
  const items = await service.list();
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
  return ok(res, items);
});

module.exports = { list };
