"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./instagramPost.service");

const listPublic = asyncHandler(async (_req, res) => {
  return ok(res, await service.listPublic());
});

const listAdmin = asyncHandler(async (_req, res) => {
  return ok(res, await service.listAdmin());
});

const getOne = asyncHandler(async (req, res) => {
  return ok(res, await service.getOne(req.params.id));
});

const createOne = asyncHandler(async (req, res) => {
  return created(res, await service.createOne(req.body));
});

const updateOne = asyncHandler(async (req, res) => {
  return ok(res, await service.updateOne(req.params.id, req.body));
});

const deleteOne = asyncHandler(async (req, res) => {
  return ok(res, await service.deleteOne(req.params.id));
});

const reorder = asyncHandler(async (req, res) => {
  return ok(res, await service.reorder(req.body.ids));
});

module.exports = {
  listPublic,
  listAdmin,
  getOne,
  createOne,
  updateOne,
  deleteOne,
  reorder,
};
