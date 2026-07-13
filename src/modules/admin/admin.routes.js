"use strict";

const router = require("express").Router();
const ctrl = require("./admin.controller");
const v = require("./admin.validation");
const couponCtrl = require("../coupon/coupon.controller");
const couponV = require("../coupon/coupon.validation");
const bannerCtrl = require("../banner/banner.controller");
const bannerV = require("../banner/banner.validation");
const settingsCtrl = require("../settings/settings.controller");
const settingsV = require("../settings/settings.validation");
const shippingCtrl = require("../shipping/shipping.controller");
const shippingV = require("../shipping/shipping.validation");
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

// ── Orders ─────────────────────────────────────────────────────────────
router.get("/orders", validate({ query: v.orderListQuery }), ctrl.listOrders);
router.get("/orders/:id", validate({ params: v.idParam }), ctrl.getOrder);
router.patch(
  "/orders/:id/status",
  validate({ params: v.idParam, body: v.orderStatusUpdate }),
  ctrl.updateOrderStatus
);
router.post(
  "/orders/:id/notes",
  validate({ params: v.idParam, body: v.orderNoteBody }),
  ctrl.addOrderNote
);
router.post(
  "/orders/:id/refund",
  validate({ params: v.idParam, body: v.orderRefundBody }),
  ctrl.refundPayment
);
router.get("/payments/summary", ctrl.paymentsSummary);

// ── Reports ────────────────────────────────────────────────────────────
router.get("/reports/payments", ctrl.paymentsReport);
router.get("/reports/shipping", ctrl.shippingReport);

// ── Shiprocket actions on a specific order ────────────────────────────
router.post("/orders/:id/shiprocket/sync", validate({ params: v.idParam }), ctrl.shiprocketRetry);
router.post("/orders/:id/shiprocket/pickup", validate({ params: v.idParam }), ctrl.shiprocketPickup);
router.post("/orders/:id/shiprocket/label", validate({ params: v.idParam }), ctrl.shiprocketLabel);
router.post("/orders/:id/shiprocket/cancel", validate({ params: v.idParam }), ctrl.shiprocketCancel);
router.get("/orders/:id/shiprocket/track", validate({ params: v.idParam }), ctrl.shiprocketTrack);

// ── Customers ──────────────────────────────────────────────────────────
router.get("/customers", validate({ query: v.customerListQuery }), ctrl.listCustomers);
router.get("/customers/:id", validate({ params: v.idParam }), ctrl.getCustomer);
router.patch(
  "/customers/:id/status",
  validate({ params: v.idParam, body: v.customerBlockBody }),
  ctrl.setCustomerBlocked
);

// ── Categories ─────────────────────────────────────────────────────────
router.get("/categories", ctrl.listCategoriesAdmin);
router.post("/categories", validate({ body: v.categoryBody }), ctrl.createCategory);
router.post(
  "/categories/reorder",
  validate({ body: v.categoryReorderBody }),
  ctrl.reorderCategories
);
router.get("/categories/:id", validate({ params: v.idParam }), ctrl.getCategoryAdmin);
router.patch(
  "/categories/:id",
  validate({ params: v.idParam, body: v.categoryUpdate }),
  ctrl.updateCategory
);
router.delete("/categories/:id", validate({ params: v.idParam }), ctrl.deleteCategory);

// ── Coupons ────────────────────────────────────────────────────────────
router.get("/coupons", validate({ query: couponV.listQuery }), couponCtrl.list);
router.post("/coupons", validate({ body: couponV.couponBody }), couponCtrl.createOne);
router.get("/coupons/:id", validate({ params: couponV.idParam }), couponCtrl.getOne);
router.patch(
  "/coupons/:id",
  validate({ params: couponV.idParam, body: couponV.couponUpdate }),
  couponCtrl.updateOne
);
router.delete("/coupons/:id", validate({ params: couponV.idParam }), couponCtrl.deleteOne);

// ── Settings ───────────────────────────────────────────────────────────
router.get("/settings", settingsCtrl.getForAdmin);
router.patch("/settings", validate({ body: settingsV.settingsUpdate }), settingsCtrl.update);

// ── Shipping rules ─────────────────────────────────────────────────────
router.get("/shipping/rules", shippingCtrl.list);
router.post("/shipping/rules", validate({ body: shippingV.ruleBody }), shippingCtrl.createOne);
router.get("/shipping/rules/:id", validate({ params: shippingV.idParam }), shippingCtrl.getOne);
router.patch(
  "/shipping/rules/:id",
  validate({ params: shippingV.idParam, body: shippingV.ruleUpdate }),
  shippingCtrl.updateOne
);
router.delete("/shipping/rules/:id", validate({ params: shippingV.idParam }), shippingCtrl.deleteOne);

// ── Banners ────────────────────────────────────────────────────────────
router.get("/banners", validate({ query: bannerV.listQuery }), bannerCtrl.listForAdmin);
router.post("/banners", validate({ body: bannerV.bannerBody }), bannerCtrl.createOne);
router.post(
  "/banners/reorder",
  validate({ body: bannerV.reorderBody }),
  bannerCtrl.reorder
);
router.get("/banners/:id", validate({ params: bannerV.idParam }), bannerCtrl.getOne);
router.patch(
  "/banners/:id",
  validate({ params: bannerV.idParam, body: bannerV.bannerUpdate }),
  bannerCtrl.updateOne
);
router.delete("/banners/:id", validate({ params: bannerV.idParam }), bannerCtrl.deleteOne);

module.exports = router;
