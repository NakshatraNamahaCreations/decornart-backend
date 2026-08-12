"use strict";

const mongoose = require("mongoose");

// Store settings live as a single upserted document. We key with a fixed
// `key: "site"` so the model is straightforward to query — the admin edits
// this one row and the storefront reads it (via a scrubbed public endpoint).
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "site", unique: true, immutable: true },

    store: {
      name: { type: String, default: "Decor N Art", trim: true, maxlength: 120 },
      tagline: { type: String, default: "", trim: true, maxlength: 200 },
      logo: { type: String, default: "", trim: true },
      email: { type: String, default: "", trim: true, lowercase: true, maxlength: 160 },
      phone: { type: String, default: "", trim: true, maxlength: 40 },
      address: { type: String, default: "", trim: true, maxlength: 400 },
      gstin: { type: String, default: "", trim: true, maxlength: 40 },
    },

    // Formatting / accounting
    currency: {
      code: { type: String, default: "INR", trim: true, uppercase: true, maxlength: 3 },
      symbol: { type: String, default: "₹", trim: true, maxlength: 4 },
    },
    tax: {
      gstRate: { type: Number, default: 0.05, min: 0, max: 1 }, // 5 % default
      inclusive: { type: Boolean, default: false },
    },

    // Checkout defaults — used when no pincode-specific ShippingRule matches.
    // Actual computation happens in shipping.service.quote(). The two extra
    // charges below (express / same-day) are surfaced to the storefront so
    // the checkout page can render admin-configurable delivery options
    // without hardcoding the amount.
    checkout: {
      defaultShippingCharge: { type: Number, default: 99, min: 0 },
      freeShippingThreshold: { type: Number, default: 999, min: 0 },
      expressShippingCharge: { type: Number, default: 150, min: 0 },
      sameDayShippingCharge: { type: Number, default: 250, min: 0 },
      codEnabled: { type: Boolean, default: true },
    },

    // Payment gateway config. The Razorpay secret still lives in env — we
    // only surface the key id here so the admin can flip between test/live
    // without redeploying. codEnabled is the master COD switch.
    payment: {
      razorpayKeyId: { type: String, default: "", trim: true, maxlength: 120 },
      razorpayMode: {
        type: String,
        enum: ["test", "live"],
        default: "test",
      },
      codEnabled: { type: Boolean, default: true },
    },

    socials: {
      instagram: { type: String, default: "", trim: true },
      youtube: { type: String, default: "", trim: true },
      pinterest: { type: String, default: "", trim: true },
      whatsapp: { type: String, default: "", trim: true },
      facebook: { type: String, default: "", trim: true },
      twitter: { type: String, default: "", trim: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
