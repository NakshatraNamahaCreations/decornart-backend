"use strict";

const mongoose = require("mongoose");
const config = require("../config");
const logger = require("../utils/logger");
const User = require("../modules/auth/auth.model");

/**
 * Upserts the admin user from ADMIN_EMAIL / ADMIN_PASSWORD in .env so a fresh
 * Mongo + first boot still has an admin to sign in with. Idempotent: running
 * again with the same env vars only resets the password to match .env. Safe
 * to leave wired permanently.
 *
 * Runs once Mongo is connected. Silently no-ops if env vars aren't set.
 */
async function ensureAdmin() {
  const { email, password, name } = config.admin;
  if (!email || !password) return;
  if (password.length < 8) {
    logger.warn("ADMIN_PASSWORD must be at least 8 chars; skipping admin bootstrap");
    return;
  }

  try {
    let user = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash");
    if (!user) {
      user = new User({ name, email: email.toLowerCase(), role: "admin" });
      await user.setPassword(password);
      await user.save();
      logger.info("admin bootstrap: created admin user", { email });
      return;
    }

    let changed = false;
    if (user.role !== "admin") {
      user.role = "admin";
      changed = true;
    }
    // Rotate the password to match .env each boot — this is how you reset
    // a forgotten admin password (edit ADMIN_PASSWORD, restart).
    const matches = await user.verifyPassword(password);
    if (!matches) {
      await user.setPassword(password);
      changed = true;
    }
    if (changed) {
      await user.save();
      logger.info("admin bootstrap: synced admin user", { email });
    }
  } catch (err) {
    logger.error("admin bootstrap failed", { err: err.message });
  }
}

// Wire to the mongoose connection so this runs as soon as the DB is up,
// regardless of whether the server already started serving requests.
function wire() {
  if (mongoose.connection.readyState === 1) {
    ensureAdmin();
  }
  mongoose.connection.on("connected", () => ensureAdmin());
}

module.exports = { wire, ensureAdmin };
