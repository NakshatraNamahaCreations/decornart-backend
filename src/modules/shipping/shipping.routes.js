"use strict";

const router = require("express").Router();
const ctrl = require("./shipping.controller");
const v = require("./shipping.validation");
const validate = require("../../middleware/validate");

// Public: shopper checkout hits this to preview shipping before placing.
router.post("/quote", validate({ body: v.quoteBody }), ctrl.quote);

module.exports = router;
