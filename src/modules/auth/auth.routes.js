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

// Public reset flow. Both endpoints go through authLimiter so an attacker
// can't brute-force tokens or email-enumerate in bulk. Neither requires an
// existing session — the token in /reset acts as the auth for that request.
router.post(
  "/forgot",
  authLimiter,
  validate({ body: v.forgotPassword }),
  ctrl.forgotPassword
);
router.post(
  "/reset",
  authLimiter,
  validate({ body: v.resetPassword }),
  ctrl.resetPassword
);
router.get("/me", protect, ctrl.me);
router.patch("/me", protect, validate({ body: v.updateProfile }), ctrl.updateProfile);
router.post(
  "/password",
  protect,
  authLimiter,
  validate({ body: v.changePassword }),
  ctrl.changePassword
);
router.post("/addresses", protect, validate({ body: v.address }), ctrl.addAddress);
router.patch(
  "/addresses/:id",
  protect,
  validate({ params: v.addressIdParam, body: v.addressUpdate }),
  ctrl.updateAddress
);
router.delete(
  "/addresses/:id",
  protect,
  validate({ params: v.addressIdParam }),
  ctrl.deleteAddress
);

module.exports = router;
