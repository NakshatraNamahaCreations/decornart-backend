"use strict";

const logger = require("./logger");

/**
 * Wraps a call to a NON-CRITICAL external dependency (cache, email, analytics).
 * If it throws or times out, we log and return `fallback` instead of letting
 * the failure bubble into the request. This is how a Redis/SMTP outage degrades
 * a single feature instead of failing the API.
 *
 * For CRITICAL deps (DB writes that must succeed) do NOT use this — let those
 * throw so the request returns an honest error.
 */
async function safeCall(label, fn, { fallback = null, timeoutMs = 2000 } = {}) {
  try {
    return await withTimeout(fn(), timeoutMs, label);
  } catch (err) {
    logger.warn(`degraded: ${label} failed, using fallback`, { err: err.message });
    return fallback;
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { safeCall, withTimeout };
