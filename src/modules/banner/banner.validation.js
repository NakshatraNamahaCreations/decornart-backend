"use strict";

const { z } = require("zod");
const { SLOTS } = require("./banner.model");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const bannerBody = z.object({
  slot: z.enum(SLOTS),
  eyebrow: z.string().trim().max(120).optional(),
  title: z.string().trim().max(200).optional(),
  script: z.string().trim().max(120).optional(),
  scriptStyle: z.enum(["script", "serif", "uppercase"]).optional(),
  subtitle: z.string().trim().max(300).optional(),
  image: z.string().trim().url().max(500).optional().or(z.literal("")),
  imageMobile: z.string().trim().url().max(500).optional().or(z.literal("")),
  href: z.string().trim().max(500).optional(),
  ctaLabel: z.string().trim().max(60).optional(),
  position: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
  startAt: z.coerce.date().nullable().optional(),
  endAt: z.coerce.date().nullable().optional(),
  visibleOn: z.enum(["both", "desktop", "mobile"]).optional(),
  categorySlug: z.string().trim().toLowerCase().max(80).optional().or(z.literal("")),
});

const bannerUpdate = bannerBody.partial();

const listQuery = z.object({
  slot: z.enum([...SLOTS, "all"]).optional(),
  status: z.enum(["all", "active", "inactive"]).optional(),
});

const publicListQuery = z.object({
  slot: z.enum(SLOTS),
  categorySlug: z.string().trim().toLowerCase().max(80).optional(),
});

const reorderBody = z.object({
  ids: z.array(objectId).min(1),
});

const idParam = z.object({ id: objectId });

module.exports = { bannerBody, bannerUpdate, listQuery, publicListQuery, reorderBody, idParam };
