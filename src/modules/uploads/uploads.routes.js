"use strict";

const router = require("express").Router();
const ctrl = require("./uploads.controller");
const { protect, restrictTo } = require("../../middleware/auth");

router.post("/sign", protect, restrictTo("admin"), ctrl.sign);

module.exports = router;
