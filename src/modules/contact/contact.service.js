"use strict";

const Contact = require("./contact.model");
const email = require("../../services/email.service");
const config = require("../../config");
const { ApiError } = require("../../utils/ApiError");
const { getPagination, buildMeta } = require("../../utils/paginate");

async function create(payload) {
  const doc = await Contact.create(payload);

  // Notify the studio inbox — best-effort, never blocks the user's submit.
  email.send({
    to: config.email.from,
    subject: `New ${doc.type} enquiry from ${doc.name}`,
    html: `<p><b>${doc.name}</b> (${doc.email})</p><p>${doc.message}</p>`,
  });

  return { id: String(doc._id), status: doc.status };
}

function serialize(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    phone: doc.phone || "",
    subject: doc.subject || "",
    message: doc.message,
    type: doc.type,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function listAdmin(query) {
  const { page, limit, skip } = getPagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};
  if (query.type && query.type !== "all") filter.type = query.type;
  if (query.status && query.status !== "all") filter.status = query.status;
  if (query.q) {
    filter.$or = [
      { name: { $regex: query.q, $options: "i" } },
      { email: { $regex: query.q, $options: "i" } },
      { phone: { $regex: query.q, $options: "i" } },
      { subject: { $regex: query.q, $options: "i" } },
      { message: { $regex: query.q, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    Contact.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Contact.countDocuments(filter),
  ]);

  return {
    items: items.map(serialize),
    meta: buildMeta({ page, limit, total }),
  };
}

async function getAdmin(id) {
  const doc = await Contact.findById(id).lean();
  if (!doc) throw ApiError.notFound("Enquiry not found");
  return serialize(doc);
}

async function updateStatus(id, status) {
  const doc = await Contact.findByIdAndUpdate(
    id,
    { $set: { status } },
    { new: true }
  ).lean();
  if (!doc) throw ApiError.notFound("Enquiry not found");
  return serialize(doc);
}

async function remove(id) {
  const doc = await Contact.findByIdAndDelete(id).lean();
  if (!doc) throw ApiError.notFound("Enquiry not found");
  return { id: String(doc._id) };
}

module.exports = { create, listAdmin, getAdmin, updateStatus, remove };
