"use strict";

const router = require("express").Router();
const ctrl = require("./settings.controller");

// Public: shopper apps read the storefront-safe projection.
router.get("/", ctrl.getPublic);

module.exports = router;
