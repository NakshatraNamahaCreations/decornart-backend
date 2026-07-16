"use strict";

const { z } = require("zod");

const register = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8).max(128),
  phone: z.string().trim().min(7).max(20).optional(),
});

const login = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1).max(128),
});

const refresh = z.object({
  refreshToken: z.string().min(10).optional(),
});

const address = z.object({
  name: z.string().trim().max(120).optional(),
  label: z.string().trim().max(40).optional(),
  line1: z.string().trim().min(3).max(160),
  line2: z.string().trim().max(160).optional(),
  landmark: z.string().trim().max(160).optional(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, "Pincode must be 6 digits"),
  phone: z.string().trim().min(7).max(20),
  isDefault: z.boolean().optional(),
});

// Partial for PATCH so the shopper can edit any subset of fields.
const addressUpdate = address.partial();

const addressIdParam = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid address id"),
});

// Partial profile update — shopper can edit any subset of name/email/phone.
const updateProfile = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().toLowerCase(),
    phone: z.string().trim().min(7).max(20),
  })
  .partial();

const changePassword = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

const forgotPassword = z.object({
  email: z.string().trim().email().toLowerCase(),
});

// The token is the raw 64-char hex string emailed to the shopper; the
// backend hashes it before comparing against the stored hash.
const resetPassword = z.object({
  token: z.string().trim().min(20).max(128),
  newPassword: z.string().min(8).max(128),
});

module.exports = {
  register,
  login,
  refresh,
  address,
  addressUpdate,
  addressIdParam,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
};
