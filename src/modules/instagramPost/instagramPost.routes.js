"use strict";

const router = require("express").Router();
const ctrl = require("./instagramPost.controller");

router.get("/", ctrl.listPublic);

module.exports = router;
