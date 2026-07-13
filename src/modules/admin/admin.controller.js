"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./admin.service");
const orderService = require("../order/order.service");

const listProducts = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listProducts(req.query);
  return ok(res, items, { meta });
});

const getProduct = asyncHandler(async (req, res) => {
  return ok(res, await service.getProduct(req.params.id));
});

const createProduct = asyncHandler(async (req, res) => {
  return created(res, await service.createProduct(req.body));
});

const updateProduct = asyncHandler(async (req, res) => {
  return ok(res, await service.updateProduct(req.params.id, req.body));
});

const deleteProduct = asyncHandler(async (req, res) => {
  return ok(res, await service.deleteProduct(req.params.id));
});

const dashboard = asyncHandler(async (_req, res) => {
  return ok(res, await service.dashboard());
});

// ── Orders ─────────────────────────────────────────────────────────────
const listOrders = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listOrders(req.query);
  return ok(res, items, { meta });
});

const getOrder = asyncHandler(async (req, res) => {
  return ok(res, await service.getOrder(req.params.id));
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  return ok(res, await service.updateOrderStatus(req.params.id, req.body, req.user));
});

const addOrderNote = asyncHandler(async (req, res) => {
  return ok(res, await service.addOrderNote(req.params.id, req.body, req.user));
});

const refundPayment = asyncHandler(async (req, res) => {
  return ok(res, await service.refundPayment(req.params.id, req.body, req.user));
});

const paymentsSummary = asyncHandler(async (req, res) => {
  return ok(res, await service.paymentsSummary(req.query));
});

const paymentsReport = asyncHandler(async (req, res) => {
  return ok(res, await service.paymentsReport(req.query));
});

const shippingReport = asyncHandler(async (req, res) => {
  return ok(res, await service.shippingReport(req.query));
});

// ── Customers ──────────────────────────────────────────────────────────
const listCustomers = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listCustomers(req.query);
  return ok(res, items, { meta });
});

const getCustomer = asyncHandler(async (req, res) => {
  return ok(res, await service.getCustomer(req.params.id));
});

const setCustomerBlocked = asyncHandler(async (req, res) => {
  return ok(res, await service.setCustomerBlocked(req.params.id, req.body.blocked));
});

// ── Categories ─────────────────────────────────────────────────────────
const listCategoriesAdmin = asyncHandler(async (_req, res) => {
  return ok(res, await service.listCategoriesAdmin());
});

const getCategoryAdmin = asyncHandler(async (req, res) => {
  return ok(res, await service.getCategoryAdmin(req.params.id));
});

const createCategory = asyncHandler(async (req, res) => {
  return created(res, await service.createCategory(req.body));
});

const updateCategory = asyncHandler(async (req, res) => {
  return ok(res, await service.updateCategory(req.params.id, req.body));
});

const deleteCategory = asyncHandler(async (req, res) => {
  return ok(res, await service.deleteCategory(req.params.id));
});

const reorderCategories = asyncHandler(async (req, res) => {
  return ok(res, await service.reorderCategories(req.body.ids));
});

// ── Shiprocket admin actions ──────────────────────────────────────────
const shiprocketRetry = asyncHandler(async (req, res) => {
  return ok(res, await orderService.retryShiprocketSync(req.params.id));
});
const shiprocketPickup = asyncHandler(async (req, res) => {
  return ok(res, await orderService.scheduleShiprocketPickup(req.params.id));
});
const shiprocketLabel = asyncHandler(async (req, res) => {
  return ok(res, await orderService.generateShiprocketLabel(req.params.id));
});
const shiprocketCancel = asyncHandler(async (req, res) => {
  return ok(res, await orderService.cancelShiprocketShipment(req.params.id));
});
const shiprocketTrack = asyncHandler(async (req, res) => {
  return ok(res, await orderService.refreshShiprocketTracking(req.params.id));
});

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  dashboard,
  listOrders,
  getOrder,
  updateOrderStatus,
  addOrderNote,
  refundPayment,
  paymentsSummary,
  paymentsReport,
  shippingReport,
  listCustomers,
  getCustomer,
  setCustomerBlocked,
  listCategoriesAdmin,
  getCategoryAdmin,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  shiprocketRetry,
  shiprocketPickup,
  shiprocketLabel,
  shiprocketCancel,
  shiprocketTrack,
};
