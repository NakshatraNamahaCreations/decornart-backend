"use strict";

const config = require("../config");
const logger = require("../utils/logger");
const { ApiError, httpCode } = require("../utils/ApiError");

function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Central error handler — the single exit for every failure. Express routes it
 * any error passed to next(err). It normalises known error types (Mongoose,
 * JWT, Zod-via-ApiError) into a consistent JSON envelope and ALWAYS responds,
 * so a thrown error in one handler can never leak or hang the process.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let status = err.statusCode || 500;
  let code = err.code || httpCode(status);
  let message = err.message || "Internal server error";
  let details = err.details;

  // --- Normalise common non-ApiError failures ---
  if (err.name === "ValidationError" && err.errors) {
    // Mongoose schema validation
    status = 400;
    code = "BAD_REQUEST";
    message = "Validation failed";
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err.name === "CastError") {
    status = 400;
    code = "BAD_REQUEST";
    message = `Invalid value for ${err.path}`;
  } else if (err.code === 11000) {
    // Mongo duplicate key
    status = 409;
    code = "CONFLICT";
    const field = Object.keys(err.keyValue || {})[0] || "field";
    message = `${field} already in use`;
  } else if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    status = 401;
    code = "UNAUTHORIZED";
    message = "Invalid or expired token";
  } else if (
    err.name === "MongooseError" ||
    err.name === "MongoServerSelectionError" ||
    err.name === "MongoNotConnectedError" ||
    /buffering timed out/i.test(err.message || "")
  ) {
    // DB unreachable — degrade this route to a clean 503; the rest of the API
    // (health, cached reads) keeps serving.
    status = 503;
    code = "UNAVAILABLE";
    message = "Service temporarily unavailable. Please try again shortly.";
  } else if (err.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "Request body too large";
  }

  // Unexpected (non-operational) 500s: log full stack, hide details from client.
  if (status >= 500) {
    logger.error("unhandled error", {
      id: req.id,
      path: req.originalUrl,
      err: err.message,
      stack: config.isProd ? undefined : err.stack,
    });
    if (config.isProd) message = "Something went wrong on our end.";
  }

  if (res.headersSent) return; // can't write twice; connection will close cleanly

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId: req.id,
    },
  });
}

module.exports = { notFound, errorHandler };
