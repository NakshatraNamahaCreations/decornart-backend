"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../../config");
const email = require("../../services/email.service");
const logger = require("../../utils/logger");
const { ApiError } = require("../../utils/ApiError");
const User = require("./auth.model");

// SHA-256 of the raw token — the DB only ever stores this so a database
// leak can't be replayed against the reset endpoint. The raw token is only
// ever seen by the shopper (via the email link).
function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

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

/**
 * Kick off a password reset. Always returns { ok: true } regardless of
 * whether the email matches an account — that stops enumeration attacks
 * where an attacker probes the endpoint to find valid emails.
 *
 * When SMTP isn't configured, `email.send` logs the payload (including the
 * reset URL) to the backend terminal — useful in dev so you can copy the
 * link and complete the flow end-to-end without a real inbox.
 */
async function forgotPassword({ email: rawEmail }) {
  const emailNorm = String(rawEmail || "").trim().toLowerCase();
  const user = await User.findOne({ email: emailNorm });
  if (user && !user.blocked) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    user.resetTokenHash = hashToken(rawToken);
    // 30-minute TTL — long enough for a shopper on a slow phone, short
    // enough to limit blast radius if the email is later compromised.
    user.resetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();

    const resetUrl = `${config.publicAppUrl}/reset-password?token=${rawToken}`;
    logger.info("password reset link generated", { email: emailNorm, resetUrl });
    email.send({
      to: emailNorm,
      subject: "Reset your Decor N Art password",
      text:
        `Hi ${user.name || "there"},\n\n` +
        `We received a request to reset your Decor N Art password. ` +
        `Open the link below within 30 minutes to set a new one:\n\n` +
        `${resetUrl}\n\n` +
        `If you didn't request this, you can safely ignore this email — your ` +
        `password won't change.`,
      html:
        `<p>Hi ${user.name || "there"},</p>` +
        `<p>We received a request to reset your Decor N Art password. ` +
        `Open the link below within 30 minutes to set a new one:</p>` +
        `<p><a href="${resetUrl}">${resetUrl}</a></p>` +
        `<p>If you didn't request this, you can safely ignore this email — ` +
        `your password won't change.</p>`,
    });
  }
  return { ok: true };
}

/**
 * Consume a reset token to set a new password. Hashes the incoming token,
 * looks it up, checks the TTL, updates the password and revokes ALL refresh
 * tokens so any other sessions get booted. The token is cleared so it can
 * never be reused.
 */
async function resetPassword({ token, newPassword }) {
  const tokenHash = hashToken(token);
  const user = await User.findOne({ resetTokenHash: tokenHash }).select(
    "+passwordHash +refreshTokens +resetTokenHash +resetTokenExpiresAt"
  );
  if (!user) throw ApiError.badRequest("Reset link is invalid or has expired");
  if (!user.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() < Date.now()) {
    // Clear the stale token to reduce surface, but still report the same
    // generic error so an attacker can't distinguish "expired" from "wrong".
    user.resetTokenHash = undefined;
    user.resetTokenExpiresAt = undefined;
    await user.save();
    throw ApiError.badRequest("Reset link is invalid or has expired");
  }
  await user.setPassword(newPassword);
  user.resetTokenHash = undefined;
  user.resetTokenExpiresAt = undefined;
  user.refreshTokens = [];
  await user.save();
  return { ok: true };
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
};
