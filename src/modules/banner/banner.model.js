"use strict";

const mongoose = require("mongoose");

// Slots the storefront reads. Extend as needed — the enum keeps admins from
// creating typos that would render nowhere.
const SLOTS = [
  "homepage-hero", // main homepage slider
  "homepage-mid", // secondary homepage promo strip
  "announcement-bar", // top-of-page announcement text (image optional)
  "category-banner", // per-category hero (categorySlug required)
  // Per-page hero images. Each of these is a single-image slot; the
  // storefront falls back to a bundled asset when the admin hasn't
  // uploaded one yet, so publishing is optional.
  "about-hero",
  "beautiful-hero",
  "shop-hero",
  "offers-hero",
  "craft-essentials-hero",
  "inspiration-gallery-hero",
  "checkout-hero",
  "thank-you-hero",
  "collections-hero",
  "contact-hero",
  "categories-hero",
  "gallery-hero",
  // Homepage card lists — the storefront reads *all* active rows in each
  // of these slots and renders one card per row (ordered by `position`).
  // Admins can add / remove cards freely.
  "special-moments",
  "promo-banner",
];

const bannerSchema = new mongoose.Schema(
  {
    slot: { type: String, enum: SLOTS, required: true, index: true },
    // Small caps line above the main title on the hero. Optional.
    eyebrow: { type: String, trim: true, default: "", maxlength: 120 },
    title: { type: String, trim: true, default: "", maxlength: 200 },
    // Decorative accent line rendered under the title (e.g. "Never Forget ♥").
    // `scriptStyle` picks the CSS treatment on the storefront:
    //   "script"     — Allura cursive in magenta (default, matches hero brand)
    //   "serif"      — Cormorant italic in plum
    //   "uppercase"  — Poppins semibold, small caps
    script: { type: String, trim: true, default: "", maxlength: 120 },
    scriptStyle: {
      type: String,
      enum: ["script", "serif", "uppercase"],
      default: "script",
    },
    subtitle: { type: String, trim: true, default: "", maxlength: 300 },
    // Optional: announcement-bar banners are text-only.
    image: { type: String, trim: true, default: "" },
    imageMobile: { type: String, trim: true, default: "" },
    href: { type: String, trim: true, default: "" },
    ctaLabel: { type: String, trim: true, default: "", maxlength: 60 },
    position: { type: Number, default: 0, index: true },
    active: { type: Boolean, default: true, index: true },
    // Optional scheduling window. If startAt/endAt aren't set, "active" is
    // the only gate.
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    // Which viewports the banner appears on.
    visibleOn: {
      type: String,
      enum: ["both", "desktop", "mobile"],
      default: "both",
    },
    // For slot=category-banner: which category slug this attaches to.
    categorySlug: { type: String, trim: true, lowercase: true, default: "", index: true },
  },
  { timestamps: true }
);

bannerSchema.index({ slot: 1, position: 1 });
bannerSchema.statics.SLOTS = SLOTS;

module.exports = mongoose.model("Banner", bannerSchema);
module.exports.SLOTS = SLOTS;
