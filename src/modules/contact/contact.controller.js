"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { created } = require("../../utils/ApiResponse");
const service = require("./contact.service");

const create = asyncHandler(async (req, res) =>
  created(res, await service.create(req.body))
);

module.exports = { create };
