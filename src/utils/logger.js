"use strict";

/**
 * Minimal zero-dependency structured logger. Swap for pino in production.
 * Logging must never throw — every call is guarded.
 */

const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const current = levels[process.env.LOG_LEVEL] ?? levels.info;

function emit(level, msg, meta) {
  if (levels[level] > current) return;
  try {
    const line = {
      t: new Date().toISOString(),
      level,
      msg,
      ...(meta && typeof meta === "object" ? meta : meta !== undefined ? { meta } : {}),
    };
    const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
    out.write(JSON.stringify(line) + "\n");
  } catch (_) {
    /* never let logging crash the app */
  }
}

module.exports = {
  error: (m, meta) => emit("error", m, meta),
  warn: (m, meta) => emit("warn", m, meta),
  info: (m, meta) => emit("info", m, meta),
  debug: (m, meta) => emit("debug", m, meta),
};
