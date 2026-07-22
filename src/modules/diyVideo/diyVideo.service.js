"use strict";

const DiyVideo = require("./diyVideo.model");
const { ApiError } = require("../../utils/ApiError");

function serialize(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    subtitle: doc.subtitle || "",
    thumbnail: doc.thumbnail,
    videoUrl: doc.videoUrl,
    position: doc.position ?? 0,
    active: !!doc.active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// Public — only active rows, ordered by position then newest.
async function listPublic() {
  const items = await DiyVideo.find({ active: true })
    .sort({ position: 1, createdAt: -1 })
    .lean();
  return items.map(serialize);
}

// Admin — all rows, ordered by position then newest.
async function listAdmin() {
  const items = await DiyVideo.find({})
    .sort({ position: 1, createdAt: -1 })
    .lean();
  return items.map(serialize);
}

async function getOne(id) {
  const doc = await DiyVideo.findById(id).lean();
  if (!doc) throw ApiError.notFound("DIY video not found");
  return serialize(doc);
}

async function createOne(payload) {
  const doc = await DiyVideo.create({ ...payload });
  return serialize(doc.toObject());
}

async function updateOne(id, payload) {
  const doc = await DiyVideo.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true, runValidators: true }
  ).lean();
  if (!doc) throw ApiError.notFound("DIY video not found");
  return serialize(doc);
}

async function deleteOne(id) {
  const doc = await DiyVideo.findByIdAndDelete(id).lean();
  if (!doc) throw ApiError.notFound("DIY video not found");
  return { id: String(doc._id) };
}

// Bulk reorder — writes the incoming id order back as `position` values.
// One bulk write instead of N updates.
async function reorder(ids) {
  const ops = ids.map((id, i) => ({
    updateOne: { filter: { _id: id }, update: { $set: { position: i } } },
  }));
  if (ops.length) await DiyVideo.bulkWrite(ops);
  return listAdmin();
}

module.exports = {
  listPublic,
  listAdmin,
  getOne,
  createOne,
  updateOne,
  deleteOne,
  reorder,
};
