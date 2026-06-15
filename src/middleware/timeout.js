"use strict";

const config = require("../config");
const { ApiError } = require("../utils/ApiError");

/**
 * Guards against a single slow/hung handler tying up a connection forever.
 * If the response hasn't been sent within the limit, we forward a 503 to the
 * error handler. Isolation: one stuck route can't exhaust the server.
 */
function timeout(ms = config.request.timeoutMs) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        next(ApiError.unavailable("Request timed out"));
      }
    }, ms);
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}

module.exports = timeout;
