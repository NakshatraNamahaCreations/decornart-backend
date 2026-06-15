"use strict";

const router = require("express").Router();
const ctrl = require("./review.controller");
const v = require("./review.validation");
const validate = require("../../middleware/validate");
const { protect } = require("../../middleware/auth");

router.get(
  "/product/:productId",
  validate({ params: v.productParam, query: v.listQuery }),
  ctrl.list
);
router.post(
  "/product/:productId",
  protect,
  validate({ params: v.productParam, body: v.create }),
  ctrl.create
);

module.exports = router;
