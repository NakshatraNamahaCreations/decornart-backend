"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok } = require("../../utils/ApiResponse");
const service = require("./settings.service");

const getPublic = asyncHandler(async (_req, res) => {
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
  return ok(res, await service.getPublic());
});

const getForAdmin = asyncHandler(async (_req, res) => {
  return ok(res, await service.get());
});

const update = asyncHandler(async (req, res) => {
  return ok(res, await service.update(req.body));
});

module.exports = { getPublic, getForAdmin, update };
