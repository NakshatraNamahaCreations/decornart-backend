"use strict";

const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    price: { type: Number, required: true, min: 0 },
    // primary occasion label + queryable tags
    occasion: { type: String, trim: true },
    occasions: { type: [String], default: [], index: true },
    category: {
      type: String,
      enum: ["signature", "handmade", "classic", "seasonal"],
      required: true,
      index: true,
    },
    stems: { type: String, trim: true },
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
