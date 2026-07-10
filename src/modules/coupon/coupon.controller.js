"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./coupon.service");

// ── Admin CRUD ────────────────────────────────────────────────────────
const list = asyncHandler(async (req, res) => {
  const { items, meta } = await service.list(req.query);
  return ok(res, items, { meta });
});

const getOne = asyncHandler(async (req, res) => {
  return ok(res, await service.getById(req.params.id));
});

const createOne = asyncHandler(async (req, res) => {
  return created(res, await service.create(req.body));
});

const updateOne = asyncHandler(async (req, res) => {
  return ok(res, await service.update(req.params.id, req.body));
});

const deleteOne = asyncHandler(async (req, res) => {
  return ok(res, await service.remove(req.params.id));
});

// ── Public — cart validation ──────────────────────────────────────────
const validate = asyncHandler(async (req, res) => {
  const userId = req.user?.id || req.body.userId;
  const preview = await service.validateForCart({ ...req.body, userId });
  return ok(res, preview);
});

// ── Public — active coupons for storefront display ───────────────────
const listPublic = asyncHandler(async (_req, res) => {
  return ok(res, await service.listPublic());
});

module.exports = { list, getOne, createOne, updateOne, deleteOne, validate, listPublic };
