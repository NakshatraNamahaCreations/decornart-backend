"use strict";

/**
 * Uniform success envelope so the frontend always parses the same shape.
 * { success, data, meta? }
 */
function ok(res, data, { status = 200, meta } = {}) {
  return res.status(status).json({
    success: true,
    data: data ?? null,
    ...(meta ? { meta } : {}),
  });
}

function created(res, data, opts = {}) {
  return ok(res, data, { ...opts, status: 201 });
}

module.exports = { ok, created };
