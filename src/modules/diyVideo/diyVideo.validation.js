"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const diyVideoBody = z.object({
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(160).optional().or(z.literal("")),
  thumbnail: z.string().trim().url().max(600),
  videoUrl: z.string().trim().max(600),
  position: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const diyVideoUpdate = diyVideoBody.partial();

const idParam = z.object({ id: objectId });

const reorderBody = z.object({
  ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1),
});

module.exports = { diyVideoBody, diyVideoUpdate, idParam, reorderBody };
