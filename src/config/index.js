"use strict";

const dotenv = require("dotenv");
dotenv.config();

/**
 * Centralised, validated config. We read process.env once here so the rest of
 * the app never touches process.env directly. Missing critical vars fail fast
 * at boot (not mid-request), which is the only place a hard crash is acceptable.
 */

const required = ["JWT_SECRET"];

function bool(v, fallback = false) {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function int(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  env: process.env.NODE_ENV || "development",
  isProd: (process.env.NODE_ENV || "development") === "production",
  port: int(process.env.PORT, 4000),

  // In dev we allow a default secret so the server boots; in prod we require it.
  jwt: {
    secret: process.env.JWT_SECRET || "dev-insecure-secret-change-me",
    accessTtl: process.env.JWT_ACCESS_TTL || "15m",
    refreshTtl: process.env.JWT_REFRESH_TTL || "30d",
  },

  mongo: {
    uri: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/Decor N Art",
    // Connection pooling — reused sockets, no per-request handshake cost.
    maxPoolSize: int(process.env.MONGO_MAX_POOL, 20),
    minPoolSize: int(process.env.MONGO_MIN_POOL, 2),
    serverSelectionTimeoutMS: int(process.env.MONGO_SELECT_TIMEOUT, 5000),
  },

  redis: {
    enabled: bool(process.env.REDIS_ENABLED, false),
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
    // Default TTLs (seconds) for cached read endpoints.
    productListTtl: int(process.env.CACHE_PRODUCT_LIST_TTL, 60),
    productDetailTtl: int(process.env.CACHE_PRODUCT_DETAIL_TTL, 300),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:3001")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  admin: {
    email: process.env.ADMIN_EMAIL || "",
    password: process.env.ADMIN_PASSWORD || "",
    name: process.env.ADMIN_NAME || "Decor N Art Admin",
  },

  request: {
    timeoutMs: int(process.env.REQUEST_TIMEOUT_MS, 15000),
    jsonLimit: process.env.JSON_LIMIT || "1mb",
  },

  rateLimit: {
    windowMs: int(process.env.RATE_WINDOW_MS, 60000),
    max: int(process.env.RATE_MAX, 120),
    authMax: int(process.env.RATE_AUTH_MAX, 10),
  },

  payment: {
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
    enabled: bool(process.env.RAZORPAY_ENABLED, false),
  },

  email: {
    enabled: bool(process.env.EMAIL_ENABLED, false),
    host: process.env.SMTP_HOST,
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || "Decor N Art <no-reply@Decor N Art.in>",
  },

  // Commerce rules — kept server-side so the client can't tamper with totals.
  commerce: {
    gstRate: 0.05,
    freeShippingOver: 2500,
    flatShipping: 199,
    promoCodes: { ATELIER10: 0.1, BLOOM15: 0.15 },
  },

  // Shiprocket courier aggregator. When `enabled=false` (default) the
  // shiprocket.service runs in mock mode — returns deterministic fake
  // responses so checkout + order sync work end-to-end without hitting
  // Shiprocket. Flip `SHIPROCKET_ENABLED=true` and fill credentials to go live.
  shiprocket: {
    enabled: bool(process.env.SHIPROCKET_ENABLED, false),
    baseUrl: process.env.SHIPROCKET_BASE_URL || "https://apiv2.shiprocket.in/v1",
    // Two ways to authenticate with the Shiprocket API:
    //   1) SHIPROCKET_TOKEN=<jwt>       — static bearer token, no login call
    //   2) SHIPROCKET_EMAIL + PASSWORD  — dedicated "API User" you create at
    //      Shiprocket Dashboard → Settings → API → Configure. This is a
    //      different account from the OTP dashboard login.
    // If both are set, the static token wins.
    token: process.env.SHIPROCKET_TOKEN || "",
    email: process.env.SHIPROCKET_EMAIL || "",
    password: process.env.SHIPROCKET_PASSWORD || "",
    // Pickup warehouse. Shiprocket references pickup locations by a nickname
    // registered in their dashboard — the address fields are kept here for
    // local display (invoices / admin UI) and for the mock path.
    pickup: {
      nickname: process.env.SHIPROCKET_PICKUP_NICKNAME || "Primary",
      name: process.env.SHIPROCKET_PICKUP_NAME || "Decor N Art",
      phone: process.env.SHIPROCKET_PICKUP_PHONE || "9876543210",
      email: process.env.SHIPROCKET_PICKUP_EMAIL || "warehouse@decornart.in",
      address: process.env.SHIPROCKET_PICKUP_ADDRESS || "12, Akkamahadevi Road",
      address2: process.env.SHIPROCKET_PICKUP_ADDRESS_2 || "",
      city: process.env.SHIPROCKET_PICKUP_CITY || "Mysore",
      state: process.env.SHIPROCKET_PICKUP_STATE || "Karnataka",
      pincode: process.env.SHIPROCKET_PICKUP_PINCODE || "570001",
      country: process.env.SHIPROCKET_PICKUP_COUNTRY || "India",
    },
    // Default parcel dims used when a product doesn't carry its own weight /
    // dimensions. Weight in kg, dims in cm.
    defaultParcel: {
      weightKg: Number(process.env.SHIPROCKET_DEFAULT_WEIGHT_KG || 0.5),
      lengthCm: Number(process.env.SHIPROCKET_DEFAULT_LENGTH_CM || 20),
      breadthCm: Number(process.env.SHIPROCKET_DEFAULT_BREADTH_CM || 15),
      heightCm: Number(process.env.SHIPROCKET_DEFAULT_HEIGHT_CM || 10),
    },
  },
};

if (config.isProd) {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    // Fail fast at boot only — never mid-request.
    throw new Error(`Missing required env vars in production: ${missing.join(", ")}`);
  }
}

module.exports = config;
