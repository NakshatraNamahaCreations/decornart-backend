"use strict";

const mongoose = require("mongoose");

// Discount coupons / promo codes. Admin creates them; the storefront calls
// /coupons/validate at cart checkout to compute a discount preview, and the
// existing order.promoCode field records which code was used.
const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 40,
      index: true,
    },
    description: { type: String, trim: true, default: "", maxlength: 300 },

    // percentage → discount = min(order * (value/100), maxDiscount)
    // fixed      → discount = value (capped at order subtotal)
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0 },
    maxDiscount: { type: Number, default: 0, min: 0 },
    minOrderValue: { type: Number, default: 0, min: 0 },

    // 0 (default) means unlimited redemptions overall.
    usageLimit: { type: Number, default: 0, min: 0 },
    // Denormalised counter incremented each time an order applies the code.
    usageCount: { type: Number, default: 0, min: 0 },
    // 0 means unlimited per-user; we enforce this in coupon.service on validate.
    perUserLimit: { type: Number, default: 0, min: 0 },

    validFrom: { type: Date, default: () => new Date() },
    validTo: { type: Date, default: null },

    // Optional scope. Empty arrays mean "applies to any cart".
    categorySlugs: { type: [String], default: [] },
    productIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

couponSchema.index({ status: 1, validTo: 1 });

module.exports = mongoose.model("Coupon", couponSchema);
