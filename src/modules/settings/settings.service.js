"use strict";

const Settings = require("./settings.model");
const cache = require("../../services/cache.service");

const CACHE_KEY = "settings:site";
const PUBLIC_KEY = "settings:public";
const TTL = 300; // 5 min

function invalidate() {
  if (typeof cache.del === "function") {
    cache.del(CACHE_KEY).catch(() => {});
    cache.del(PUBLIC_KEY).catch(() => {});
  } else if (typeof cache.flush === "function") {
    cache.flush().catch(() => {});
  }
}

/**
 * Get or create the singleton settings doc. New installs start from schema
 * defaults so the storefront can boot without any admin action.
 */
async function get() {
  let doc = await Settings.findOne({ key: "site" }).lean();
  if (!doc) {
    const fresh = await Settings.create({ key: "site" });
    doc = fresh.toObject();
  }
  return serialize(doc);
}

async function getCached() {
  return cache.remember(CACHE_KEY, TTL, () => get());
}

/**
 * Public projection — no gateway keys, no GSTIN, no admin-only fields. Shape
 * kept small so the storefront can call this once at boot.
 */
async function getPublic() {
  return cache.remember(PUBLIC_KEY, TTL, async () => {
    const s = await get();
    return {
      store: {
        name: s.store.name,
        tagline: s.store.tagline,
        logo: s.store.logo,
        email: s.store.email,
        phone: s.store.phone,
        address: s.store.address,
      },
      currency: s.currency,
      tax: { gstRate: s.tax.gstRate, inclusive: s.tax.inclusive },
      checkout: {
        freeShippingThreshold: s.checkout.freeShippingThreshold,
        defaultShippingCharge: s.checkout.defaultShippingCharge,
        expressShippingCharge: s.checkout.expressShippingCharge ?? 150,
        sameDayShippingCharge: s.checkout.sameDayShippingCharge ?? 250,
        codEnabled: s.checkout.codEnabled && s.payment.codEnabled,
      },
      socials: s.socials,
    };
  });
}

async function update(payload) {
  // $set with dotted paths so partial updates preserve untouched nested keys.
  const flat = flattenForSet(payload);
  const doc = await Settings.findOneAndUpdate(
    { key: "site" },
    { $set: flat },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  invalidate();
  return serialize(doc);
}

function flattenForSet(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      flattenForSet(v, path, out);
    } else {
      out[path] = v;
    }
  }
  return out;
}

function serialize(d) {
  return {
    id: d._id ? String(d._id) : undefined,
    store: d.store || {},
    currency: d.currency || {},
    tax: d.tax || {},
    checkout: d.checkout || {},
    payment: d.payment || {},
    socials: d.socials || {},
    updatedAt: d.updatedAt,
  };
}

module.exports = { get, getCached, getPublic, update };
