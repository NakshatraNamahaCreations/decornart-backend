"use strict";

const config = require("../config");
const logger = require("../utils/logger");
const { safeCall } = require("../utils/safeCall");

/**
 * Best-effort transactional email. Sending happens fire-and-forget via
 * safeCall, so an SMTP outage NEVER fails the order/contact request that
 * triggered it. In production, replace the direct send with a queue push
 * (RabbitMQ/BullMQ) and a worker.
 */

let transport = null;

(function init() {
  if (!config.email.enabled) return;
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (_) {
    logger.warn("nodemailer not installed; email disabled");
    return;
  }
  transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
  });
  logger.info("email transport ready");
})();

/** Returns immediately; the actual send is detached and self-contained. */
function send({ to, subject, html, text }) {
  // Detached on purpose — caller does not await.
  safeCall(
    "email.send",
    async () => {
      if (!transport) {
        logger.info("email (noop)", { to, subject });
        return { noop: true };
      }
      return transport.sendMail({ from: config.email.from, to, subject, html, text });
    },
    { fallback: null, timeoutMs: 8000 }
  ).catch(() => {});
}

module.exports = { send };
