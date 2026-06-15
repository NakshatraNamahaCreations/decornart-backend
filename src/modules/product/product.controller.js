"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok } = require("../../utils/ApiResponse");
const service = require("./product.service");

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await service.list(req.query);
  // HTTP cache hint for CDNs/browsers on this public, cacheable read.
  res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  return ok(res, items, { meta });
});

const getBySlug = asyncHandler(async (req, res) => {
  const product = await service.getBySlug(req.params.slug);
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
  return ok(res, product);
});

const getRelated = asyncHandler(async (req, res) => {
  const related = await service.getRelated(req.params.slug);
  return ok(res, related);
});

module.exports = { list, getBySlug, getRelated };
