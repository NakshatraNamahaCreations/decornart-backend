"use strict";

const Newsletter = require("./newsletter.model");
const email = require("../../services/email.service");

/**
 * Idempotent subscribe via upsert — re-subscribing an existing email is a
 * no-op success, never a duplicate-key error surfaced to the user.
 */
async function subscribe({ email: addr, source }) {
  const doc = await Newsletter.findOneAndUpdate(
    { email: addr },
    { $setOnInsert: { email: addr, source: source || "footer" }, $set: { status: "subscribed" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  email.send({
    to: addr,
    subject: "Welcome to the Decor N Art atelier",
    html: "<p>Thank you for subscribing. Expect quiet, considered florals.</p>",
  });

  return { email: doc.email, status: doc.status };
}

module.exports = { subscribe };
