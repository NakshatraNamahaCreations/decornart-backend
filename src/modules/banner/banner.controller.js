"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./banner.service");

const listPublic = asyncHandler(async (req, res) => {
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
  return ok(res, await service.listPublic(req.query));
});

const listForAdmin = asyncHandler(async (req, res) => {
  return ok(res, await service.listForAdmin(req.query));
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

const reorder = asyncHandler(async (req, res) => {
  return ok(res, await service.reorder(req.body.ids));
});

module.exports = { listPublic, listForAdmin, getOne, createOne, updateOne, deleteOne, reorder };
