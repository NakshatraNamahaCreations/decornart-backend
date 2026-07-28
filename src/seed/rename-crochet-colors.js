"use strict";

/**
 * One-off cleanup for crochet products' color assignments.
 *
 *   1. Renames legacy admin-typed names like "Classic Bright Red" or
 *      "Classich Dark Khaki" (typo) to the canonical shade name that
 *      appears on the supplier's 41-colour yarn chart.
 *   2. Strips any colour that isn't on the chart entirely — the sidebar
 *      palette on /category/crochet-materials is built from what
 *      products carry, so anything left over shows up as an unwanted
 *      swatch. Removing those entries from `colors`, `colorSwatches`,
 *      and `colorImages` collapses the sidebar to the 41 chart shades.
 *
 * Idempotent — safe to re-run.
 *
 * Run once: `npm run rename:crochet-colors`
 */

const mongoose = require("mongoose");
const config = require("../config");
const logger = require("../utils/logger");
const Product = require("../modules/product/product.model");

// Rename map — old name → chart name. Anything not on the chart AND not
// in this map is dropped (see ALLOWED below).
const RENAMES = {
  "Classic Bright Purple": "Bright Purple",
  "Classic Bright Red": "Bright Red",
  "Classic Light Blue": "Light blue",
  "Classic Mist Blue": "Mist Blue",
  "Classic Powder": "Powder",
  "Classic Rouge Powder": "Rouge Powder",
  "Classic Wine Red": "Wine red",
  "Classich Dark Khaki": "Dark Khaki",
  "Classic Dark Khaki": "Dark Khaki",
  // Aliases the storefront also treated as chart entries.
  "Dark Coffee Brown": "Dark Coffee",
  "Champagne": "Champagne color",
  "Apricot": "Apricot color",
};

// The 41 supplier-chart shades. Case-insensitive membership check — any
// colour whose lowercased name isn't in this set gets stripped.
const ALLOWED = new Set(
  [
    "Pure white",
    "Milky white",
    "Rice noodles",
    "Apricot color",
    "Chestnut brown",
    "Dark Khaki",
    "Champagne color",
    "Turmeric",
    "Champagne gold",
    "Golden Yellow",
    "Gray",
    "Dark gray",
    "Light blue",
    "Mist Blue",
    "Sapphire blue",
    "Lake Blue",
    "Light purple",
    "Skin powder",
    "Deep Purple",
    "Purple",
    "Bright Purple",
    "Rich Purple",
    "Red",
    "Bright Red",
    "Cherry Red",
    "Wine red",
    "Coral Pink",
    "Rouge Powder",
    "Powder",
    "Rubber Red",
    "Peach powder",
    "Emerald green",
    "Kong Green",
    "Matcha green",
    "Bean Green",
    "Grass Green",
    "Dark green",
    "Green",
    "Kong Lan",
    "Bright Blue",
    "Black",
    "Dark Coffee",
  ].map((c) => c.toLowerCase())
);

function normalise(name) {
  if (!name) return null;
  const renamed = RENAMES[name] || name;
  return ALLOWED.has(renamed.toLowerCase()) ? renamed : null;
}

function normaliseList(list) {
  if (!Array.isArray(list)) return { next: list, changed: false, dropped: [] };
  const dropped = [];
  const next = [];
  const seen = new Set();
  for (const c of list) {
    const to = normalise(c);
    if (!to) {
      dropped.push(c);
      continue;
    }
    if (!seen.has(to)) {
      seen.add(to);
      next.push(to);
    }
  }
  const changed =
    dropped.length > 0 ||
    next.length !== list.length ||
    next.some((v, i) => v !== list[i]);
  return { next, changed, dropped };
}

function normaliseRows(rows, key) {
  if (!Array.isArray(rows)) return { next: rows, changed: false };
  const next = [];
  const seen = new Set();
  let changed = false;
  for (const row of rows) {
    if (!row || !row.color) continue;
    const to = normalise(row.color);
    if (!to) {
      changed = true;
      continue;
    }
    if (seen.has(to)) {
      changed = true;
      continue;
    }
    seen.add(to);
    if (to !== row.color) changed = true;
    next.push({ color: to, [key]: row[key] });
  }
  return { next, changed };
}

async function run() {
  await mongoose.connect(config.mongo.uri, { serverSelectionTimeoutMS: 8000 });
  logger.info("rename-crochet-colors: connected");

  const products = await Product.find({ category: "crochet-materials" });
  logger.info(`rename-crochet-colors: scanning ${products.length} products`);

  let touched = 0;
  for (const p of products) {
    let changed = false;

    const colors = normaliseList(p.colors);
    if (colors.changed) {
      p.colors = colors.next;
      changed = true;
      if (colors.dropped.length) {
        logger.info(`  · ${p.slug} — dropped: ${colors.dropped.join(", ")}`);
      }
    }

    const swatches = normaliseRows(p.colorSwatches, "hex");
    if (swatches.changed) {
      p.colorSwatches = swatches.next;
      changed = true;
    }

    const images = normaliseRows(p.colorImages, "image");
    if (images.changed) {
      p.colorImages = images.next;
      changed = true;
    }

    if (changed) {
      await p.save();
      touched += 1;
      logger.info(`    ${p.slug} → [${p.colors.join(", ")}]`);
    }
  }

  logger.info(`rename-crochet-colors: updated ${touched} product(s)`);
  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error("rename-crochet-colors: failed", { err: err.message });
  process.exit(1);
});
