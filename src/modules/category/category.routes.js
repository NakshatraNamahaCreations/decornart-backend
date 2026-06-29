"use strict";

const router = require("express").Router();
const ctrl = require("./category.controller");

router.get("/", ctrl.list);

module.exports = router;
