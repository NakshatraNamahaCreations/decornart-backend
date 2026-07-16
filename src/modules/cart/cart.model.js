"use strict";

const mongoose = require("mongoose");

const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    // Optional — the picked variant on the product doc (Product.variants[].
    // _id). String rather than ObjectId so guest carts can be stringified /
    // deep-copied without Mongoose gotchas.
    variantId: { type: String, default: null },
    // Optional — the picked color name (e.g. "Rose Red"). Two lines with
    // the same product + variant but different colors are kept separate so
    // the shopper sees each colour as its own row.
    color: { type: String, default: null },
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
