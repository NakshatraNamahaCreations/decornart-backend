"use strict";

const crypto = require("crypto");
const logger = require("../utils/logger");

/**
 * Attaches a request id and logs completion timing. The id is echoed back so a
 * failing call can be traced without affecting any other request.
 */
function requestContext(req, res, next) {
  req.id = req.headers["x-request-id"] || crypto.randomBytes(6).toString("hex");
  res.setHeader("x-request-id", req.id);
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]("request", {
      id: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Math.round(ms),
    });
  });

  next();
}

module.exports = requestContext;
