"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./review.service");

const create = asyncHandler(async (req, res) =>
  created(res, await service.create(req.user, req.params.productId, req.body))
);

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listForProduct(req.params.productId, req.query);
  res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  return ok(res, items, { meta });
});

module.exports = { create, list };
