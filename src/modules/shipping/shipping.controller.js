"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./shipping.service");

const quote = asyncHandler(async (req, res) => {
  return ok(res, await service.quote(req.body));
});

const list = asyncHandler(async (_req, res) => {
  return ok(res, await service.list());
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

module.exports = { quote, list, getOne, createOne, updateOne, deleteOne };
