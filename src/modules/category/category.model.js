"use strict";

const mongoose = require("mongoose");

// Categories used to be an enum-only list baked into product.model. They now
// live in the DB so admins can add/edit/reorder/attach banners. The static
// list in category.constants.js is only used as a bootstrap seed the first
// time the server starts against an empty categories collection.
const categorySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, default: "", maxlength: 500 },
    // Banner shown on the storefront's /category/<slug> hero. Optional.
    banner: { type: String, trim: true, default: "" },
    // Optional square tile image used on the /categories index grid.
    image: { type: String, trim: true, default: "" },
    // Menu order — ascending sort. Ties broken by name.
    position: { type: Number, default: 0, index: true },
    // Sub-category support: leave null for top-level.
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null, index: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

categorySchema.index({ position: 1, name: 1 });

module.exports = mongoose.model("Category", categorySchema);
