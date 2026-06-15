"use strict";

const mongoose = require("mongoose");
const config = require("./index");
const logger = require("../utils/logger");

/**
 * Connects to Mongo with pooling. Crucially, a DB outage does NOT crash the
 * process: Mongoose buffers/reconnects, and per-request DB errors surface as
 * 503s via the error handler. The HTTP server keeps serving health + any
 * route that doesn't touch the DB.
 */
let connectedOnce = false;

async function connectDB() {
  mongoose.set("strictQuery", true);
  // Fail fast (don't hang 10s) when disconnected; the error handler maps this
  // to a clean 503 so the route degrades quickly instead of stalling.
  mongoose.set("bufferTimeoutMS", 4000);

  mongoose.connection.on("connected", () => {
    connectedOnce = true;
    logger.info("mongo connected");
  });
  mongoose.connection.on("disconnected", () => logger.warn("mongo disconnected"));
  mongoose.connection.on("reconnected", () => logger.info("mongo reconnected"));
  mongoose.connection.on("error", (err) =>
    logger.error("mongo connection error", { err: err.message })
  );

  try {
    await mongoose.connect(config.mongo.uri, {
      maxPoolSize: config.mongo.maxPoolSize,
      minPoolSize: config.mongo.minPoolSize,
      serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS,
    });
  } catch (err) {
    // Don't kill the process on first-connect failure — let it retry in the
    // background so the rest of the API (health, cached reads) stays up.
    logger.error("initial mongo connect failed; serving in degraded mode", {
      err: err.message,
    });
  }
}

function isDbHealthy() {
  return mongoose.connection.readyState === 1;
}

async function disconnectDB() {
  try {
    await mongoose.connection.close(false);
    logger.info("mongo connection closed");
  } catch (err) {
    logger.warn("error closing mongo", { err: err.message });
  }
}

module.exports = { connectDB, disconnectDB, isDbHealthy, connectedOnce: () => connectedOnce };
