"use strict";

const router = require("express").Router();
const ctrl = require("./coupon.controller");
const v = require("./coupon.validation");
const validate = require("../../middleware/validate");
const { optionalAuth } = require("../../middleware/auth");

// Public: list currently redeemable coupons (active, in-window, not fully used)
// for the storefront to display on the cart.
router.get("/", ctrl.listPublic);

// Public: validate a code against a cart (guest or signed-in). optionalAuth
// so per-user limits kick in for signed-in shoppers.
router.post("/validate", optionalAuth, validate({ body: v.validateBody }), ctrl.validate);

module.exports = router;
