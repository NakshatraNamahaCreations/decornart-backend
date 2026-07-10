"use strict";

const config = require("../../config");
const asyncHandler = require("../../utils/asyncHandler");
const { ok, created } = require("../../utils/ApiResponse");
const service = require("./auth.service");
const User = require("./auth.model");
const { ApiError } = require("../../utils/ApiError");

const cookieOpts = {
  httpOnly: true,
  secure: config.isProd,
  sameSite: "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

const register = asyncHandler(async (req, res) => {
  const result = await service.register(req.body);
  res.cookie("accessToken", result.accessToken, cookieOpts);
  return created(res, result);
});

const login = asyncHandler(async (req, res) => {
  const result = await service.login(req.body);
  res.cookie("accessToken", result.accessToken, cookieOpts);
  return ok(res, result);
});

const refresh = asyncHandler(async (req, res) => {
  const token = req.body.refreshToken || req.cookies?.refreshToken;
  const tokens = await service.refresh(token);
  res.cookie("accessToken", tokens.accessToken, cookieOpts);
  return ok(res, tokens);
});

const logout = asyncHandler(async (req, res) => {
  await service.logout(req.user.id, req.body.refreshToken || req.cookies?.refreshToken);
  res.clearCookie("accessToken");
  return ok(res, { loggedOut: true });
});

const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) throw ApiError.notFound("User not found");
  return ok(res, {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    addresses: user.addresses,
  });
});

const addAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw ApiError.notFound("User not found");
  if (req.body.isDefault) user.addresses.forEach((a) => (a.isDefault = false));
  user.addresses.push(req.body);
  await user.save();
  return created(res, user.addresses);
});

const updateAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw ApiError.notFound("User not found");
  const target = user.addresses.id(req.params.id);
  if (!target) throw ApiError.notFound("Address not found");
  // When isDefault flips on, unset the flag on all siblings first.
  if (req.body.isDefault === true) {
    user.addresses.forEach((a) => {
      if (String(a._id) !== String(target._id)) a.isDefault = false;
    });
  }
  Object.assign(target, req.body);
  await user.save();
  return ok(res, user.addresses);
});

const deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw ApiError.notFound("User not found");
  const target = user.addresses.id(req.params.id);
  if (!target) throw ApiError.notFound("Address not found");
  target.deleteOne();
  await user.save();
  return ok(res, user.addresses);
});

const updateProfile = asyncHandler(async (req, res) => {
  return ok(res, await service.updateProfile(req.user.id, req.body));
});

const changePassword = asyncHandler(async (req, res) => {
  return ok(res, await service.changePassword(req.user.id, req.body));
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  addAddress,
  updateAddress,
  deleteAddress,
  updateProfile,
  changePassword,
};
