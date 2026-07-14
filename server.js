"use strict";

const http = require("http");
const app = require("./src/app");
const config = require("./src/config");
const logger = require("./src/utils/logger");
const { connectDB, disconnectDB } = require("./src/config/db");
const cache = require("./src/services/cache.service");
const adminBootstrap = require("./src/services/adminBootstrap.service");
const orderService = require("./src/modules/order/order.service");

const server = http.createServer(app);

// How often we sweep for paid orders whose Shiprocket push failed the first
// time. 10 min balances "self-healing on transient outages" against wasted
// API calls when there's nothing to retry.
const SHIPROCKET_RETRY_INTERVAL_MS = 10 * 60 * 1000;
let shiprocketSweepTimer = null;

async function start() {
  // Connect DB but DON'T block server startup on it — if Mongo is down the
  // server still comes up and serves /health + cached reads (degraded mode).
  connectDB();

  // Ensure the admin user exists / has the right password as soon as Mongo
  // is reachable. Wired on the 'connected' event so it runs after reconnects
  // too, and runs immediately if we're already connected.
  adminBootstrap.wire();

  // Background retrier for orders whose post-payment Shiprocket sync
  // didn't stick the first time. Keeps the shipping side hands-off so an
  // admin doesn't need to hit "Push to Shiprocket" for a transient failure.
  shiprocketSweepTimer = setInterval(() => {
    orderService
      .retryPendingShiprocketSyncs()
      .then((res) => {
        if (res.attempted > 0) {
          logger.info("shiprocket retry sweep", res);
        }
      })
      .catch((err) => logger.warn("shiprocket sweep threw", { err: err.message }));
  }, SHIPROCKET_RETRY_INTERVAL_MS);
  // Don't hold the event loop open on shutdown.
  shiprocketSweepTimer.unref();

  server.listen(config.port, () => {
    logger.info(`Decor N Art-backend listening`, { port: config.port, env: config.env });
  });
}

// --- Last-resort process guards ---
// asyncHandler should catch everything; these exist so a stray error in a
// detached callback (timer, event emitter) logs instead of silently killing
// the process. We keep serving rather than exiting on unhandledRejection.
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", {
    err: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on("uncaughtException", (err) => {
  // A truly uncaught exception leaves the process in an unknown state. We log
  // it; in production a supervisor (pm2/systemd/k8s) should restart. We do NOT
  // call process.exit() abruptly mid-flight here — graceful shutdown handles it.
  logger.error("uncaughtException", { err: err.message, stack: err.stack });
});

// --- Graceful shutdown: stop taking new conns, drain, close deps ---
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`received ${signal}, shutting down gracefully`);

  if (shiprocketSweepTimer) clearInterval(shiprocketSweepTimer);

  server.close(async () => {
    await Promise.allSettled([disconnectDB(), cache.close()]);
    logger.info("shutdown complete");
    process.exit(0);
  });

  // Force-exit if drain takes too long.
  setTimeout(() => {
    logger.warn("forced shutdown after timeout");
    process.exit(1);
  }, 10000).unref();
}

["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => shutdown(sig)));

start();

module.exports = server;
