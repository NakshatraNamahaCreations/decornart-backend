"use strict";

const router = require("express").Router();
const ctrl = require("./wishlist.controller");
const v = require("./wishlist.validation");
const validate = require("../../middleware/validate");
const { protect } = require("../../middleware/auth");

router.use(protect); // wishlist is per-user

router.get("/", ctrl.get);
router.post("/items", validate({ body: v.addItem }), ctrl.add);
router.delete("/items/:productId", validate({ params: v.itemParam }), ctrl.remove);

module.exports = router;
