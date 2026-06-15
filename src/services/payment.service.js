"use strict";

const crypto = require("crypto");
const config = require("../config");
const logger = require("../utils/logger");
const { ApiError } = require("../utils/ApiError");

/**
 * Razorpay wrapper isolated behind its own module with a lightweight circuit
 * breaker. If Razorpay is unreachable, the breaker opens and the ORDER route
 * returns a clean 503 — no other route is affected, and we stop hammering a
 * dead dependency. When credentials aren't configured, we run in "mock" mode
 * so the rest of the API and the checkout UI still work end to end.
 */

let client = null;
let mode = "mock";

(function init() {
  if (!config.payment.enabled) return;
  let Razorpay;
  try {
    Razorpay = require("razorpay");
  } catch (_) {
    logger.warn("razorpay module not installed; payment in mock mode");
    return;
  }
  if (!config.payment.razorpayKeyId || !config.payment.razorpayKeySecret) {
    logger.warn("razorpay keys missing; payment in mock mode");
    return;
  }
  client = new Razorpay({
    key_id: config.payment.razorpayKeyId,
    key_secret: config.payment.razorpayKeySecret,
  });
  mode = "live";
  logger.info("razorpay live mode");
})();

// --- circuit breaker ---
const breaker = { failures: 0, openUntil: 0, threshold: 3, cooldownMs: 30000 };

function assertClosed() {
  if (Date.now() < breaker.openUntil) {
    throw ApiError.unavailable("Payment provider is temporarily unavailable. Please retry shortly.");
  }
}
function recordSuccess() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}
function recordFailure() {
  breaker.failures += 1;
  if (breaker.failures >= breaker.threshold) {
    breaker.openUntil = Date.now() + breaker.cooldownMs;
    logger.warn("payment breaker OPEN", { cooldownMs: breaker.cooldownMs });
  }
}

async function createOrder({ amount, currency = "INR", receipt, notes }) {
  assertClosed();

  if (mode === "mock") {
    // Deterministic fake order so dev/checkout works without live keys.
    return {
      id: `order_mock_${crypto.randomBytes(8).toString("hex")}`,
      amount: amount * 100,
      currency,
      receipt,
      status: "created",
      mock: true,
    };
  }

  try {
    const order = await client.orders.create({
      amount: Math.round(amount * 100), // paise
      currency,
      receipt,
      notes,
    });
    recordSuccess();
    return order;
  } catch (err) {
    recordFailure();
    logger.error("razorpay createOrder failed", { err: err.message });
    throw ApiError.unavailable("Could not initiate payment. Please try again.");
  }
}

/** Verify the signature Razorpay returns to the client after checkout. */
function verifySignature({ orderId, paymentId, signature }) {
  if (mode === "mock") return true; // accept in mock mode
  const expected = crypto
    .createHmac("sha256", config.payment.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  // timing-safe compare
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { createOrder, verifySignature, getMode: () => mode };
