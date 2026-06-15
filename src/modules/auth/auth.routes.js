"use strict";

const router = require("express").Router();
const ctrl = require("./auth.controller");
const v = require("./auth.validation");
const validate = require("../../middleware/validate");
const { protect } = require("../../middleware/auth");
const { authLimiter } = require("../../middleware/rateLimit");

router.post("/register", authLimiter, validate({ body: v.register }), ctrl.register);
router.post("/login", authLimiter, validate({ body: v.login }), ctrl.login);
router.post("/refresh", validate({ body: v.refresh }), ctrl.refresh);
router.post("/logout", protect, ctrl.logout);
router.get("/me", protect, ctrl.me);
router.post("/addresses", protect, validate({ body: v.address }), ctrl.addAddress);

module.exports = router;
