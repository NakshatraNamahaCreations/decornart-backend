"use strict";

const ShippingRule = require("./shipping.model");
const settings = require("../settings/settings.service");
const cache = require("../../services/cache.service");
const shiprocket = require("../../services/shiprocket.service");
const logger = require("../../utils/logger");
const { ApiError } = require("../../utils/ApiError");

function invalidate() {
  if (typeof cache.delByPrefix === "function") {
    cache.delByPrefix("shipping:").catch(() => {});
  }
}

/**
 * Return the best-matching rule for a pincode. Precedence:
 *   1. Longest pincodePrefix match wins.
 *   2. On tie, higher `priority` wins.
 *   3. Falls back to settings defaults if no rule matches.
 */
async function findRule(pincode) {
  if (!pincode) return null;
  const rules = await ShippingRule.find({ active: true }).lean();
  const matches = rules.filter(
    (r) => !r.pincodePrefix || pincode.startsWith(r.pincodePrefix)
  );
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const lenDiff = (b.pincodePrefix?.length || 0) - (a.pincodePrefix?.length || 0);
    if (lenDiff !== 0) return lenDiff;
    return (b.priority || 0) - (a.priority || 0);
  });
  return matches[0];
}

/**
 * Compute the shipping quote for a cart. This is what cart.service should
 * call at hydrate time so the storefront and admin see the same number.
 */
async function quote({ pincode, subtotal }) {
  const s = await settings.get();
  const {
    defaultShippingCharge = 99,
    freeShippingThreshold = 999,
    codEnabled: cartCodEnabled = true,
  } = s.checkout || {};

  const rule = pincode ? await findRule(pincode) : null;

  // Ask Shiprocket for a live rate when we have a pincode. Best-effort: any
  // failure (network, breaker open, mock returns nothing) falls back to the
  // local rule / defaults so checkout never blocks on shiprocket.
  let srQuote = null;
  if (pincode) {
    try {
      const s = await shiprocket.checkServiceability({
        deliveryPincode: pincode,
        subtotal,
        cod: false,
      });
      if (s?.cheapest) srQuote = s.cheapest;
    } catch (err) {
      logger.warn("shiprocket serviceability failed; using local rule", {
        err: err.message,
      });
    }
  }

  const baseCharge = srQuote
    ? srQuote.rate
    : rule
      ? rule.charge
      : defaultShippingCharge;
  const threshold = rule && rule.freeShippingThreshold > 0
    ? rule.freeShippingThreshold
    : freeShippingThreshold;
  const freeShipping = threshold > 0 && subtotal >= threshold;
  const finalCharge = subtotal === 0 ? 0 : freeShipping ? 0 : baseCharge;
  const codAvailable = cartCodEnabled && s.payment?.codEnabled !== false && (rule ? rule.codAvailable : true);

  return {
    pincode: pincode || null,
    ruleId: rule ? String(rule._id) : null,
    ruleName: srQuote?.courierName || (rule ? rule.name : "default"),
    baseCharge,
    charge: finalCharge,
    freeShippingThreshold: threshold,
    freeShipping,
    codAvailable,
    estimatedDays: srQuote
      ? parseEtd(srQuote.etd)
      : rule
        ? { min: rule.estimatedDaysMin || 3, max: rule.estimatedDaysMax || 7 }
        : { min: 3, max: 7 },
    provider: srQuote ? "shiprocket" : rule ? "rule" : "default",
    courier: srQuote?.courierName || null,
  };
}

// "3-5 days" / "2 days" / "3-5" → { min, max } (defaults to 3/7 on garbage)
function parseEtd(str) {
  if (!str) return { min: 3, max: 7 };
  const nums = String(str).match(/\d+/g);
  if (!nums) return { min: 3, max: 7 };
  const min = Number(nums[0]);
  const max = Number(nums[1]) || min;
  return { min, max };
}

// ── Admin CRUD ────────────────────────────────────────────────────────
async function list() {
  const items = await ShippingRule.find({}).sort({ priority: -1, pincodePrefix: 1, name: 1 }).lean();
  return items.map(serialize);
}

async function getById(id) {
  const doc = await ShippingRule.findById(id).lean();
  if (!doc) throw ApiError.notFound("Shipping rule not found");
  return serialize(doc);
}

async function create(payload) {
  const doc = await ShippingRule.create(payload);
  invalidate();
  return serialize(doc.toObject());
}

async function update(id, payload) {
  const doc = await ShippingRule.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true, runValidators: true }
  ).lean();
  if (!doc) throw ApiError.notFound("Shipping rule not found");
  invalidate();
  return serialize(doc);
}

async function remove(id) {
  const doc = await ShippingRule.findByIdAndDelete(id).lean();
  if (!doc) throw ApiError.notFound("Shipping rule not found");
  invalidate();
  return { id: String(doc._id) };
}

function serialize(r) {
  return {
    id: String(r._id),
    name: r.name,
    pincodePrefix: r.pincodePrefix || "",
    state: r.state || "",
    charge: r.charge,
    freeShippingThreshold: r.freeShippingThreshold || 0,
    estimatedDaysMin: r.estimatedDaysMin ?? 3,
    estimatedDaysMax: r.estimatedDaysMax ?? 7,
    codAvailable: r.codAvailable !== false,
    priority: r.priority || 0,
    active: r.active !== false,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

module.exports = { list, getById, create, update, remove, quote, findRule };
