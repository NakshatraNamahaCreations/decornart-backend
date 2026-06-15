"use strict";

const Contact = require("./contact.model");
const email = require("../../services/email.service");
const config = require("../../config");

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

module.exports = { create };
