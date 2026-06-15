"use strict";

const router = require("express").Router();
const ctrl = require("./admin.controller");
const v = require("./admin.validation");
const validate = require("../../middleware/validate");
const { protect, restrictTo } = require("../../middleware/auth");

// Every admin route is gated: must be authenticated AND have role=admin.
router.use(protect, restrictTo("admin"));

router.get("/dashboard", ctrl.dashboard);

router.get("/products", validate({ query: v.listQuery }), ctrl.listProducts);
router.post("/products", validate({ body: v.productBody }), ctrl.createProduct);
router.get("/products/:id", validate({ params: v.idParam }), ctrl.getProduct);
router.patch(
  "/products/:id",
  validate({ params: v.idParam, body: v.productUpdate }),
  ctrl.updateProduct
);
router.delete("/products/:id", validate({ params: v.idParam }), ctrl.deleteProduct);

module.exports = router;
