"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./contact.service");

const create = asyncHandler(async (req, res) =>
  created(res, await service.create(req.body))
);

const listAdmin = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listAdmin(req.query);
  return ok(res, items, { meta });
});

const getAdmin = asyncHandler(async (req, res) =>
  ok(res, await service.getAdmin(req.params.id))
);

const updateStatus = asyncHandler(async (req, res) =>
  ok(res, await service.updateStatus(req.params.id, req.body.status))
);

const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.params.id))
);

module.exports = { create, listAdmin, getAdmin, updateStatus, remove };
