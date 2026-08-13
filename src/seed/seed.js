"use strict";

/**
 * Seeds the catalog from products.seed.json (extracted from the Phase-1 UI mock
 * so the shape matches the frontend exactly). Run: `npm run seed` or
 * `npm run seed:fresh` to wipe products first.
 */

const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const config = require("../config");
const logger = require("../utils/logger");
const Product = require("../modules/product/product.model");

const FRESH = process.argv.includes("--fresh");

const descriptions = {
  signature: "A considered, architectural tie — our florists' signature hand.",
  beautiful: "Made to order, one stem at a time, by a single pair of hands.",
  classic: "An everyday bloom, generous and unfussy.",
  seasonal: "Cut this week, gone the next — whatever the season offers.",
};

async function run() {
  await mongoose.connect(config.mongo.uri, { serverSelectionTimeoutMS: 8000 });
  logger.info("seed: connected");

  const raw = fs.readFileSync(path.join(__dirname, "products.seed.json"), "utf8");
  const seed = JSON.parse(raw);

  if (FRESH) {
    await Product.deleteMany({});
    logger.info("seed: cleared products");
  }

  let upserted = 0;
  for (const p of seed) {
    const doc = {
      slug: p.slug,
      name: p.name,
      price: p.price,
      occasion: p.occasion,
      occasions: p.occasions || [],
      category: p.category,
      isNew: !!p.isNew,
      isBestseller: !!p.isBestseller,
      description: descriptions[p.category] || "",
      images: [`/assets/${p.slug}.png`],
      stock: 100,
      status: "active",
    };
    await Product.updateOne({ slug: p.slug }, { $set: doc }, { upsert: true });
    upserted += 1;
  }

  logger.info(`seed: upserted ${upserted} products`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  logger.error("seed failed", { err: err.message });
  process.exit(1);
});
