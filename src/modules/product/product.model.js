"use strict";

const mongoose = require("mongoose");

// Legacy list — kept only for the exported `CATEGORIES` constant that a few
// call sites still import. Categories now live in their own collection; the
// product's `category` field is a free-text slug validated against the
// Category collection at the admin controller layer.
const CATEGORIES = [
  "flower-basket-materials",
  "gift-cards",
  "pipe-cleaners",
  "gift-box",
  "craft-essentials",
  "crochet-materials",
  "ribbons",
  "wrapping-papers",
];

const productSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    price: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
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
      thickness: { type: String, trim: true },
      length: { type: String, trim: true },
    },

    // ── Curated customer reviews shown on the product page's Reviews
    // tab. Admin-managed today — the storefront's Reviews tab uses this
    // list when present, otherwise falls back to a demo set.
    reviews: {
      type: [
        {
          _id: false,
          name: { type: String, required: true, trim: true, maxlength: 80 },
          rating: { type: Number, required: true, min: 1, max: 5 },
          date: { type: String, trim: true, default: "", maxlength: 40 },
          title: { type: String, trim: true, default: "", maxlength: 160 },
          body: { type: String, required: true, trim: true, maxlength: 2000 },
          verified: { type: Boolean, default: false },
          helpful: { type: Number, default: 0, min: 0 },
        },
      ],
      default: [],
    },

    // ── FAQs shown on the product page's FAQ tab. Optional; empty array
    // means the tab renders the "no questions yet" state on the storefront.
    faqs: {
      type: [
        {
          _id: false,
          q: { type: String, required: true, trim: true },
          a: { type: String, required: true, trim: true },
        },
      ],
      default: [],
    },

    // ── Feature badges shown on the product page under the gallery
    // (Soft & Fluffy, Easy to Bend, …). Each row is a small
    // { icon, title, copy } triple. `icon` is a key into the storefront's
    // shared icon library so the admin can pick from a preset set
    // rather than paste raw SVG. Empty array falls back to a category
    // default set on the storefront.
    featureBadges: {
      type: [
        {
          _id: false,
          icon: { type: String, trim: true, default: "" },
          title: { type: String, required: true, trim: true, maxlength: 40 },
          copy: { type: String, trim: true, default: "", maxlength: 60 },
        },
      ],
      default: [],
    },

    // ── Materials the product is made from (facet filter on the
    // storefront sidebar). Multi-value — a product can be, say,
    // ["paper", "jute"]. Stored lowercase; admin picks from a preset
    // list ("paper", "wood", "cotton", "glass", "jute").
    materials: { type: [String], default: [], index: true },

    // ── Brand style vibes this product fits (multi-value facet).
    // Admin picks any of "luxury", "minimalist", "modern", "classic",
    // "rustic", "romantic", "artisan" — mirrored on the storefront
    // sidebar as multi-select checkboxes.
    brandStyles: { type: [String], default: [], index: true },

    // ── Optional color variants a shopper can pick from on the product
    // page. Empty array means the product has no color selector.
    colors: { type: [String], default: [] },

    // ── Optional hex overrides per color name. Custom (non-preset)
    // colors added in the admin need an explicit swatch hex; the static
    // COLOR_HEX map on the storefront covers presets only. Storefront
    // reads this first, then falls back to the static map, then grey.
    colorSwatches: {
      type: [
        {
          _id: false,
          color: { type: String, required: true, trim: true, maxlength: 40 },
          hex: { type: String, required: true, trim: true, maxlength: 20 },
        },
      ],
      default: [],
    },

    // ── Per-colour image overrides. When the shopper picks a colour whose
    // name matches an entry here, the storefront swaps the hero image to
    // this URL. Only pipe-cleaner products populate this today; every
    // other product keeps `colors` without an image override and falls
    // back to the base gallery. Stored as an array (not a map) so admins
    // can leave entries partially filled and the Mongoose ODM stays happy.
    colorImages: {
      type: [
        {
          _id: false,
          color: { type: String, required: true, trim: true, maxlength: 40 },
          image: { type: String, required: true, trim: true },
        },
      ],
      default: [],
    },

    // ── Priced variants (e.g. "6mm" / "8mm" pipe cleaners, "50 g" / "100 g"
    // yarn). When present, the shopper picks one at add-to-cart time and
    // that variant's price/image/stock override the parent product's.
    // Empty array means "no variants — single-price product". Mongoose
    // auto-assigns each subdoc an `_id` which we surface as `id` in the API.
    // Label rendered above the variant picker on the storefront (e.g.
    // "Thickness", "Size", "Weight"). Falls back to "Variant" client-side.
    variantLabel: { type: String, trim: true, default: "", maxlength: 40 },
    variants: [
      {
        name: { type: String, required: true, trim: true, maxlength: 60 },
        price: { type: Number, required: true, min: 0 },
        stock: { type: Number, default: 100, min: 0 },
        sku: { type: String, trim: true, default: "", maxlength: 80 },
        image: { type: String, trim: true, default: "" },
      },
    ],

    // ── Optional product video. Rendered by the "View Video" button and
    // the DIY tutorial card on the storefront's Description tab. `url` may
    // be a direct MP4 (Cloudinary or elsewhere) or a YouTube/Vimeo link.
    // Nested-path definition (same pattern as `specs`) — reliable with
    // `$set` on Mongoose 8.
    video: {
      url: { type: String, trim: true, default: "" },
      title: { type: String, trim: true, default: "", maxlength: 80 },
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
