"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const instagramPostBody = z.object({
  image: z.string().trim().url().max(600),
  alt: z.string().trim().max(200).optional().or(z.literal("")),
  link: z
    .string()
    .trim()
    .max(600)
    .url()
    .optional()
    .or(z.literal("")),
  position: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const instagramPostUpdate = instagramPostBody.partial();

const idParam = z.object({ id: objectId });

const reorderBody = z.object({
  ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1),
});

module.exports = {
  instagramPostBody,
  instagramPostUpdate,
  idParam,
  reorderBody,
};
