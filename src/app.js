"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const cookieParser = require("cookie-parser");

const config = require("./config");
const { isDbHealthy } = require("./config/db");
const cache = require("./services/cache.service");
const payment = require("./services/payment.service");

const requestContext = require("./middleware/requestContext");
const timeout = require("./middleware/timeout");
const { apiLimiter } = require("./middleware/rateLimit");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.set("trust proxy", 1);

// --- Security & parsing ---
app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin / curl (no origin) and whitelisted origins
      if (!origin || config.cors.origins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);
app.use(compression());
app.use(express.json({ limit: config.request.jsonLimit }));
app.use(express.urlencoded({ extended: true, limit: config.request.jsonLimit }));
app.use(cookieParser());
app.use(requestContext);
app.use(timeout());

// --- Health (always works, even if DB/cache are down) ---
app.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      uptime: Math.round(process.uptime()),
      db: isDbHealthy() ? "up" : "down",
      cache: cache.isReady() ? "redis" : "memory",
      payment: payment.getMode(),
      env: config.env,
    },
  });
});

// --- API routes ---
// Each domain router is mounted independently. A throw inside one router is
// caught by asyncHandler -> errorHandler and scoped to that request only; it
// can never affect a sibling router. Even a broken require in one module is
// isolated below so the rest of the API still boots.
const api = express.Router();
api.use(apiLimiter);

const modules = [
  ["/auth", "./modules/auth/auth.routes"],
  ["/products", "./modules/product/product.routes"],
  ["/categories", "./modules/category/category.routes"],
  ["/cart", "./modules/cart/cart.routes"],
  ["/orders", "./modules/order/order.routes"],
  ["/wishlist", "./modules/wishlist/wishlist.routes"],
  ["/reviews", "./modules/review/review.routes"],
  ["/newsletter", "./modules/newsletter/newsletter.routes"],
  ["/contact", "./modules/contact/contact.routes"],
  ["/admin", "./modules/admin/admin.routes"],
];

const logger = require("./utils/logger");
for (const [path, mod] of modules) {
  try {
    api.use(path, require(mod));
  } catch (err) {
    // One module failing to load must not take down the whole API. Mount a
    // 503 stub for that path and keep serving everything else.
    logger.error(`failed to mount ${path}; serving 503 stub`, { err: err.message });
    api.use(path, (_req, res) =>
      res.status(503).json({
        success: false,
        error: { code: "UNAVAILABLE", message: `${path} is temporarily unavailable` },
      })
    );
  }
}

app.use("/api/v1", api);

// --- 404 + central error handler (must be last) ---
app.use(notFound);
app.use(errorHandler);

module.exports = app;
