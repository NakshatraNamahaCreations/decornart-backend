"use strict";

const rateLimit = require("express-rate-limit");
const config = require("../config");
const { ApiError } = require("../utils/ApiError");

function handler(_req, _res, next) {
  next(ApiError.tooMany("Too many requests, please slow down."));
}

// General API limiter.
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// Tighter limiter for auth endpoints to blunt credential stuffing.
const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

module.exports = { apiLimiter, authLimiter };
