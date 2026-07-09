"use strict";

const { z } = require("zod");

const storeShape = z
  .object({
    name: z.string().trim().max(120),
    tagline: z.string().trim().max(200).optional().or(z.literal("")),
    logo: z.string().trim().url().max(500).optional().or(z.literal("")),
    email: z.string().trim().email().max(160).optional().or(z.literal("")),
    phone: z.string().trim().max(40).optional().or(z.literal("")),
    address: z.string().trim().max(400).optional().or(z.literal("")),
    gstin: z.string().trim().max(40).optional().or(z.literal("")),
  })
  .partial();

const currencyShape = z
  .object({
    code: z.string().trim().toUpperCase().length(3),
    symbol: z.string().trim().max(4),
  })
  .partial();

const taxShape = z
  .object({
    gstRate: z.coerce.number().min(0).max(1),
    inclusive: z.boolean(),
  })
  .partial();

const checkoutShape = z
  .object({
    defaultShippingCharge: z.coerce.number().min(0),
    freeShippingThreshold: z.coerce.number().min(0),
    codEnabled: z.boolean(),
  })
  .partial();

const paymentShape = z
  .object({
    razorpayKeyId: z.string().trim().max(120).optional().or(z.literal("")),
    razorpayMode: z.enum(["test", "live"]),
    codEnabled: z.boolean(),
  })
  .partial();

const socialsShape = z
  .object({
    instagram: z.string().trim().max(500).optional().or(z.literal("")),
    youtube: z.string().trim().max(500).optional().or(z.literal("")),
    pinterest: z.string().trim().max(500).optional().or(z.literal("")),
    whatsapp: z.string().trim().max(500).optional().or(z.literal("")),
    facebook: z.string().trim().max(500).optional().or(z.literal("")),
    twitter: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .partial();

const settingsUpdate = z
  .object({
    store: storeShape.optional(),
    currency: currencyShape.optional(),
    tax: taxShape.optional(),
    checkout: checkoutShape.optional(),
    payment: paymentShape.optional(),
    socials: socialsShape.optional(),
  })
  .strict();

module.exports = { settingsUpdate };
