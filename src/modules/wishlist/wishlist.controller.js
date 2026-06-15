"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./wishlist.service");

const get = asyncHandler(async (req, res) => ok(res, await service.get(req.user.id)));
const add = asyncHandler(async (req, res) =>
  created(res, await service.add(req.user.id, req.body.productId))
);
const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.user.id, req.params.productId))
);

module.exports = { get, add, remove };
