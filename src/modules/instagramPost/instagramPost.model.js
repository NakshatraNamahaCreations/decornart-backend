"use strict";

const mongoose = require("mongoose");

const instagramPostSchema = new mongoose.Schema(
  {
    image: { type: String, required: true, trim: true },
    alt: { type: String, trim: true, default: "", maxlength: 200 },
    link: { type: String, trim: true, default: "", maxlength: 600 },
    position: { type: Number, default: 0, index: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

instagramPostSchema.index({ active: 1, position: 1 });

module.exports = mongoose.model("InstagramPost", instagramPostSchema);
