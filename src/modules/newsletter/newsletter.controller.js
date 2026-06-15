"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { created } = require("../../utils/ApiResponse");
const service = require("./newsletter.service");

const subscribe = asyncHandler(async (req, res) =>
  created(res, await service.subscribe(req.body))
);

module.exports = { subscribe };
