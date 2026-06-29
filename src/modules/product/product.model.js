"use strict";

const mongoose = require("mongoose");

// Craft-supply categories. Mirrors the enums in admin.validation.js /
// product.validation.js and the storefront's lib/data/categories.js.
const CATEGORIES = [
  "flower-basket-materials",
  "gift-cards",
  "pipe-cleaners",
  "gift-box",
  "craft-essentials",
  "crochet-materials",
  "ribbons",
  "wrapping-papers",
  "artificial-plants",
];

const productSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    price: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: CATEGORIES,
      required: true,
      index: true,
    },

    // ── Craft-supply detail fields (consumed by ProductView accordions)
    packContents: { type: [String], default: [] },
    usage: { type: [String], default: [] },
    specs: {
      material: { type: String, trim: true },
      pack: { type: String, trim: true },
      origin: { type: String, trim: true },
      finish: { type: String, trim: true },
    },

    // ── Legacy use-case tags (storefront filter still reads these;
    // admin no longer writes them but old docs may still have them).
    occasion: { type: String, trim: true },
    occasions: { type: [String], default: [], index: true },

    images: { type: [String], default: [] },
    stock: { type: Number, default: 100, min: 0 },
    isNew: { type: Boolean, default: false },
    isBestseller: { type: Boolean, default: false, index: true },
    status: { type: String, enum: ["active", "draft", "archived"], default: "active", index: true },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Compound index for the common shop query: filter by status+category, sort by price.
productSchema.index({ status: 1, category: 1, price: 1 });
// Text index for search.
productSchema.index({ name: "text", description: "text" });

productSchema.methods.toCard = function () {
  return {
    id: String(this._id),
    slug: this.slug,
    name: this.name,
    price: this.price,
    occasion: this.occasion,
    occasions: this.occasions,
    category: this.category,
    image: this.images[0] || null,
    isNew: this.isNew,
    isBestseller: this.isBestseller,
    rating: this.rating,
  };
};

module.exports = mongoose.model("Product", productSchema);
module.exports.CATEGORIES = CATEGORIES;
