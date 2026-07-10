"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const { ApiError } = require("../../utils/ApiError");
const service = require("./cart.service");

/**
 * Resolves the cart owner. Logged-in users own a cart by id; guests must pass
 * an x-cart-id header (the frontend generates a UUID and stores it locally).
 */
function resolveOwner(req) {
  if (req.user) return { owner: req.user.id, isGuest: false };
  const guest = req.headers["x-cart-id"];
  if (!guest) throw ApiError.badRequest("Missing x-cart-id header for guest cart");
  return { owner: `guest:${guest}`, isGuest: true };
}

const get = asyncHandler(async (req, res) => {
  const { owner, isGuest } = resolveOwner(req);
  return ok(res, await service.get(owner, isGuest));
});

const addItem = asyncHandler(async (req, res) => {
  const { owner, isGuest } = resolveOwner(req);
  return created(res, await service.addItem(owner, isGuest, req.body));
});

const updateItem = asyncHandler(async (req, res) => {
  const { owner, isGuest } = resolveOwner(req);
  return ok(
    res,
    await service.updateItem(
      owner,
      isGuest,
      req.params.productId,
      req.body.qty,
      req.query.variantId || null
    )
  );
});

const removeItem = asyncHandler(async (req, res) => {
  const { owner, isGuest } = resolveOwner(req);
  return ok(
    res,
    await service.removeItem(
      owner,
      isGuest,
      req.params.productId,
      req.query.variantId || null
    )
  );
});

const applyPromo = asyncHandler(async (req, res) => {
  const { owner, isGuest } = resolveOwner(req);
  return ok(res, await service.applyPromo(owner, isGuest, req.body.code));
});

module.exports = { get, addItem, updateItem, removeItem, applyPromo };
