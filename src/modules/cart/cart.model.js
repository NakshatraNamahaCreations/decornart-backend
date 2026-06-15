"use strict";

const mongoose = require("mongoose");

const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    qty: { type: Number, required: true, min: 1, max: 99 },
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    // owner is either a userId (logged in) or a guest cart token. Unique so a
    // user/guest has exactly one cart.
    owner: { type: String, required: true, unique: true, index: true },
    isGuest: { type: Boolean, default: true },
    lines: { type: [lineSchema], default: [] },
    promoCode: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Cart", cartSchema);
