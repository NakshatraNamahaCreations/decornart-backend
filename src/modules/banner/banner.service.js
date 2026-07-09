"use strict";

const Banner = require("./banner.model");
const cache = require("../../services/cache.service");
const { ApiError } = require("../../utils/ApiError");

function invalidate() {
  if (typeof cache.delByPrefix === "function") {
    cache.delByPrefix("banner:").catch(() => {});
  }
}

/**
 * Storefront-facing list. Filters to active + scheduled banners so the
 * frontend can trust the payload without re-checking dates client-side.
 */
async function listPublic({ slot, categorySlug }) {
  const now = new Date();
  const filter = {
    slot,
    active: true,
    $and: [
      { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null }, { endAt: { $gte: now } }] },
    ],
  };
  if (slot === "category-banner" && categorySlug) filter.categorySlug = categorySlug;

  const items = await Banner.find(filter).sort({ position: 1, createdAt: -1 }).lean();
  return items.map(serialize);
}

// ── Admin ─────────────────────────────────────────────────────────────
async function listForAdmin(query = {}) {
  const filter = {};
  if (query.slot && query.slot !== "all") filter.slot = query.slot;
  if (query.status === "active") filter.active = true;
  if (query.status === "inactive") filter.active = false;
  const items = await Banner.find(filter).sort({ slot: 1, position: 1 }).lean();
  return items.map(serialize);
}

async function getById(id) {
  const b = await Banner.findById(id).lean();
  if (!b) throw ApiError.notFound("Banner not found");
  return serialize(b);
}

async function create(payload) {
  if (payload.position == null) {
    const last = await Banner.find({ slot: payload.slot })
      .sort({ position: -1 })
      .limit(1)
      .lean();
    payload.position = (last[0]?.position ?? -1) + 1;
  }
  const doc = await Banner.create(payload);
  invalidate();
  return serialize(doc.toObject());
}

async function update(id, payload) {
  const doc = await Banner.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true, runValidators: true }
  ).lean();
  if (!doc) throw ApiError.notFound("Banner not found");
  invalidate();
  return serialize(doc);
}

async function remove(id) {
  const doc = await Banner.findByIdAndDelete(id).lean();
  if (!doc) throw ApiError.notFound("Banner not found");
  invalidate();
  return { id: String(doc._id) };
}

async function reorder(ids) {
  const ops = ids.map((id, index) => ({
    updateOne: { filter: { _id: id }, update: { $set: { position: index } } },
  }));
  if (ops.length) await Banner.bulkWrite(ops);
  invalidate();
  return { updated: ops.length };
}

function serialize(b) {
  return {
    id: String(b._id),
    slot: b.slot,
    eyebrow: b.eyebrow || "",
    title: b.title || "",
    script: b.script || "",
    scriptStyle: b.scriptStyle || "script",
    subtitle: b.subtitle || "",
    image: b.image || "",
    imageMobile: b.imageMobile || "",
    href: b.href || "",
    ctaLabel: b.ctaLabel || "",
    position: b.position || 0,
    active: b.active !== false,
    startAt: b.startAt,
    endAt: b.endAt,
    visibleOn: b.visibleOn || "both",
    categorySlug: b.categorySlug || "",
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

module.exports = { listPublic, listForAdmin, getById, create, update, remove, reorder };
