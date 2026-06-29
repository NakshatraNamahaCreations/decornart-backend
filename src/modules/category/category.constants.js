"use strict";

// Single source of truth for the craft-supply categories. The product
// model/validation enums are kept in sync by hand — collapse into a shared
// constants module once the schema fully stabilises.
const CATEGORIES = [
  {
    slug: "flower-basket-materials",
    name: "Flower Basket Materials",
    description: "Baskets, boxes & florist foam for hand-tied arrangements.",
  },
  {
    slug: "gift-cards",
    name: "Gift Cards",
    description: "Folded cards and tag essentials for every gift.",
  },
  {
    slug: "pipe-cleaners",
    name: "Pipe Cleaners",
    description: "Chenille stems in every colour for crafting and decor.",
  },
  {
    slug: "gift-box",
    name: "Gift Box",
    description: "Ready-to-gift boxes and sleeves in assorted sizes.",
  },
  {
    slug: "craft-essentials",
    name: "Craft Essentials",
    description: "Glue, scissors, tape and the tools your projects need.",
  },
  {
    slug: "crochet-materials",
    name: "Crochet Materials",
    description: "Yarn, cotton thread, hooks and notions for stitching.",
  },
  {
    slug: "ribbons",
    name: "Ribbons",
    description: "Satin, organza and jute spools for trims and ties.",
  },
  {
    slug: "wrapping-papers",
    name: "Wrapping Sheets & Papers",
    description: "Kraft, tissue and printed sheets for premium wrap.",
  },
  {
    slug: "artificial-plants",
    name: "Artificial Plants & Planters",
    description: "Lifelike foliage and planters for home and office decor.",
  },
];

module.exports = { CATEGORIES };
