"use strict";

const jwt = require("jsonwebtoken");
const config = require("../config");
const { ApiError } = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const User = require("../modules/auth/auth.model");

function extractToken(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  if (req.cookies && req.cookies.accessToken) return req.cookies.accessToken;
  return null;
}

function verify(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (_) {
    throw ApiError.unauthorized("Invalid or expired token");
  }
}

/** Hard gate — 401 if not authenticated. */
const protect = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized("Authentication required");
  const payload = verify(token);
  const user = await User.findById(payload.sub).lean();
  if (!user) throw ApiError.unauthorized("Account no longer exists");
  req.user = { id: String(user._id), email: user.email, role: user.role, name: user.name };
  next();
});

/** Soft gate — attaches req.user if a valid token exists, else continues. */
const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    const user = await User.findById(payload.sub).lean();
    if (user) {
      req.user = { id: String(user._id), email: user.email, role: user.role, name: user.name };
    }
  } catch (_) {
    /* ignore invalid token on optional routes */
  }
  next();
});

function restrictTo(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(ApiError.forbidden("You do not have access to this resource"));
    }
    next();
  };
}

module.exports = { protect, optionalAuth, restrictTo };
