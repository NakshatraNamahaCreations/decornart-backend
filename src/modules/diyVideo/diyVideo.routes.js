"use strict";

const router = require("express").Router();
const ctrl = require("./diyVideo.controller");

// Public — storefront reads active DIY videos ordered by position.
router.get("/", ctrl.listPublic);

module.exports = router;
