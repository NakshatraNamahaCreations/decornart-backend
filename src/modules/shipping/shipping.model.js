"use strict";

const mongoose = require("mongoose");

// Pincode-based shipping rules. Rules are keyed by a pincode PREFIX so
// admins don't have to enumerate every ZIP — e.g. "560" matches all
// Bengaluru codes 560000-560999. Longer prefixes win in the quote logic.
const shippingRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Empty pincode prefixes act as a state-level or fallback rule.
    pincodePrefix: {
      type: String,
      trim: true,
      default: "",
      index: true,
      maxlength: 6,
    },
    state: { type: String, trim: true, default: "", maxlength: 80 },
    charge: { type: Number, required: true, min: 0 },
    freeShippingThreshold: { type: Number, default: 0, min: 0 },
    estimatedDaysMin: { type: Number, default: 3, min: 0 },
    estimatedDaysMax: { type: Number, default: 7, min: 0 },
    codAvailable: { type: Boolean, default: true },
    // Ordering when multiple rules could match. Higher priority wins after
    // prefix-length ranking.
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

// Compound index for the common quote query.
shippingRuleSchema.index({ active: 1, pincodePrefix: 1 });

module.exports = mongoose.model("ShippingRule", shippingRuleSchema);
