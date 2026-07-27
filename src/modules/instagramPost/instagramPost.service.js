"use strict";

const InstagramPost = require("./instagramPost.model");
const { ApiError } = require("../../utils/ApiError");

function serialize(doc) {
  return {
    id: String(doc._id),
    image: doc.image,
    alt: doc.alt || "",
    link: doc.link || "",
    position: doc.position ?? 0,
    active: !!doc.active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function listPublic() {
  const items = await InstagramPost.find({ active: true })
    .sort({ position: 1, createdAt: -1 })
    .lean();
  return items.map(serialize);
}

async function listAdmin() {
  const items = await InstagramPost.find({})
    .sort({ position: 1, createdAt: -1 })
    .lean();
  return items.map(serialize);
}

async function getOne(id) {
  const doc = await InstagramPost.findById(id).lean();
  if (!doc) throw ApiError.notFound("Instagram post not found");
  return serialize(doc);
}

async function createOne(payload) {
  const doc = await InstagramPost.create({ ...payload });
  return serialize(doc.toObject());
}

async function updateOne(id, payload) {
  const doc = await InstagramPost.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true, runValidators: true }
  ).lean();
  if (!doc) throw ApiError.notFound("Instagram post not found");
  return serialize(doc);
}

async function deleteOne(id) {
  const doc = await InstagramPost.findByIdAndDelete(id).lean();
  if (!doc) throw ApiError.notFound("Instagram post not found");
  return { id: String(doc._id) };
}

async function reorder(ids) {
  const ops = ids.map((id, i) => ({
    updateOne: { filter: { _id: id }, update: { $set: { position: i } } },
  }));
  if (ops.length) await InstagramPost.bulkWrite(ops);
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
