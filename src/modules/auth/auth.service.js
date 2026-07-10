"use strict";

const jwt = require("jsonwebtoken");
const config = require("../../config");
const { ApiError } = require("../../utils/ApiError");
const User = require("./auth.model");

function signTokens(user) {
  const sub = String(user._id);
  const accessToken = jwt.sign({ sub, role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.accessTtl,
  });
  const refreshToken = jwt.sign({ sub, type: "refresh" }, config.jwt.secret, {
    expiresIn: config.jwt.refreshTtl,
  });
  return { accessToken, refreshToken };
}

async function register({ name, email, password, phone }) {
  const exists = await User.exists({ email });
  if (exists) throw ApiError.conflict("Email already registered");

  const user = new User({ name, email, phone });
  await user.setPassword(password);
  const tokens = signTokens(user);
  user.refreshTokens = [tokens.refreshToken];
  await user.save();
  return { user: user.toPublic(), ...tokens };
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select("+passwordHash +refreshTokens");
  if (!user) throw ApiError.unauthorized("Invalid credentials");
  const valid = await user.verifyPassword(password);
  if (!valid) throw ApiError.unauthorized("Invalid credentials");
  if (user.blocked) throw ApiError.forbidden("This account has been suspended");

  const tokens = signTokens(user);
  // keep last 5 sessions
  user.refreshTokens = [...(user.refreshTokens || []), tokens.refreshToken].slice(-5);
  await user.save();
  return { user: user.toPublic(), ...tokens };
}

async function refresh(refreshToken) {
  if (!refreshToken) throw ApiError.unauthorized("Refresh token required");
  let payload;
  try {
    payload = jwt.verify(refreshToken, config.jwt.secret);
  } catch (_) {
    throw ApiError.unauthorized("Invalid refresh token");
  }
  const user = await User.findById(payload.sub).select("+refreshTokens");
  if (!user || !(user.refreshTokens || []).includes(refreshToken)) {
    throw ApiError.unauthorized("Refresh token revoked");
  }
  const tokens = signTokens(user);
  // rotate: drop the used token, store the new one
  user.refreshTokens = [
    ...user.refreshTokens.filter((t) => t !== refreshToken),
    tokens.refreshToken,
  ].slice(-5);
  await user.save();
  return tokens;
}

async function logout(userId, refreshToken) {
  if (!refreshToken) return;
  await User.updateOne({ _id: userId }, { $pull: { refreshTokens: refreshToken } });
}

/**
 * Partial profile update — name / email / phone. Email conflict check runs
 * only when the incoming value differs from the current one so no-op saves
 * don't trip on the shopper's own row.
 */
async function updateProfile(userId, payload) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound("User not found");
  if (payload.email && payload.email !== user.email) {
    const taken = await User.exists({ email: payload.email, _id: { $ne: userId } });
    if (taken) throw ApiError.conflict("Email already registered");
    user.email = payload.email;
  }
  if (payload.name != null) user.name = payload.name;
  if (payload.phone != null) user.phone = payload.phone;
  await user.save();
  return user.toPublic();
}

/**
 * Verify the current password before setting the new one and revoke ALL
 * outstanding refresh tokens so any concurrent sessions are booted after a
 * password change (standard security posture).
 */
async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select("+passwordHash +refreshTokens");
  if (!user) throw ApiError.notFound("User not found");
  const ok = await user.verifyPassword(currentPassword);
  if (!ok) throw ApiError.unauthorized("Current password is incorrect");
  await user.setPassword(newPassword);
  user.refreshTokens = [];
  await user.save();
  return { ok: true };
}

module.exports = { register, login, refresh, logout, updateProfile, changePassword };
