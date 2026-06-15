"use strict";

const router = require("express").Router();
const ctrl = require("./contact.controller");
const v = require("./contact.validation");
const validate = require("../../middleware/validate");

router.post("/", validate({ body: v.create }), ctrl.create);

module.exports = router;
