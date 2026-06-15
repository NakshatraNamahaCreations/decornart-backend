"use strict";

const router = require("express").Router();
const ctrl = require("./newsletter.controller");
const v = require("./newsletter.validation");
const validate = require("../../middleware/validate");

router.post("/subscribe", validate({ body: v.subscribe }), ctrl.subscribe);

module.exports = router;
