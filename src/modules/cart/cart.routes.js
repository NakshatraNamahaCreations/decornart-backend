"use strict";

const router = require("express").Router();
const ctrl = require("./cart.controller");
const v = require("./cart.validation");
const validate = require("../../middleware/validate");
const { optionalAuth } = require("../../middleware/auth");

// optionalAuth: works for both logged-in users and guests (x-cart-id header).
router.use(optionalAuth);

router.get("/", ctrl.get);
router.post("/items", validate({ body: v.addItem }), ctrl.addItem);
router.patch("/items/:productId", validate({ params: v.itemParam, body: v.updateItem }), ctrl.updateItem);
router.delete("/items/:productId", validate({ params: v.itemParam }), ctrl.removeItem);
router.post("/promo", validate({ body: v.promo }), ctrl.applyPromo);

module.exports = router;
