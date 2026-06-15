"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./admin.service");

const listProducts = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listProducts(req.query);
  return ok(res, items, { meta });
});

const getProduct = asyncHandler(async (req, res) => {
  return ok(res, await service.getProduct(req.params.id));
});

const createProduct = asyncHandler(async (req, res) => {
  return created(res, await service.createProduct(req.body));
});

const updateProduct = asyncHandler(async (req, res) => {
  return ok(res, await service.updateProduct(req.params.id, req.body));
});

const deleteProduct = asyncHandler(async (req, res) => {
  return ok(res, await service.deleteProduct(req.params.id));
});

const dashboard = asyncHandler(async (_req, res) => {
  return ok(res, await service.dashboard());
});

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  dashboard,
};
