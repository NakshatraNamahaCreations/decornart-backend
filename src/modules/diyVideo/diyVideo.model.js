"use strict";

const mongoose = require("mongoose");

/**
 * DIY Video — the storefront's "DIY Inspiration / Create. Inspire.
 * Repeat." card grid pulls from this collection. Each row is a
 * clickable card with a title, subtitle, thumbnail, and a video URL
 * that opens in a lightbox on the storefront.
 */
const diyVideoSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: "", maxlength: 120 },
    subtitle: { type: String, trim: true, default: "", maxlength: 160 },
    // Thumbnail image shown on the card (Cloudinary URL).
    thumbnail: { type: String, required: true, trim: true },
    // Video URL — Cloudinary MP4, YouTube, Vimeo, or any direct file.
    // The storefront's parseVideoUrl helper picks the right player.
    videoUrl: { type: String, required: true, trim: true },
    position: { type: Number, default: 0, index: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

diyVideoSchema.index({ active: 1, position: 1 });

module.exports = mongoose.model("DiyVideo", diyVideoSchema);
