"use strict";

const router = require("express").Router();
const ctrl = require("./banner.controller");
const v = require("./banner.validation");
const validate = require("../../middleware/validate");

// Public: shopper apps read active + scheduled banners by slot.
router.get("/", validate({ query: v.publicListQuery }), ctrl.listPublic);

module.exports = router;
