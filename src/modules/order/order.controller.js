"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./order.service");

const create = asyncHandler(async (req, res) => {
  return created(res, await service.createFromCart(req.user, req.body));
});

const verify = asyncHandler(async (req, res) => {
  return ok(res, await service.verifyPayment(req.user, req.body));
});

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listForUser(req.user.id, req.query);
  return ok(res, items, { meta });
});

const getOne = asyncHandler(async (req, res) => {
  return ok(res, await service.getOne(req.user.id, req.params.id));
});

module.exports = { create, verify, list, getOne };
