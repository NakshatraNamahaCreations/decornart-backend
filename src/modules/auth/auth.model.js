"use strict";

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const addressSchema = new mongoose.Schema(
  {
    // Recipient name at this address — separate from `label` so admins /
    // couriers still see who to hand the parcel to.
    name: { type: String, trim: true },
    label: { type: String, trim: true }, // e.g. "Home", "Office"
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    landmark: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    phone: { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true, // creates a unique index
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String, trim: true },
    role: { type: String, enum: ["customer", "admin"], default: "customer", index: true },
    // Admin-controlled soft-block. When true, /auth/login rejects the user
    // and protected routes 403 mid-session (the auth middleware checks).
    blocked: { type: Boolean, default: false, index: true },
    addresses: { type: [addressSchema], default: [] },
    refreshTokens: { type: [String], default: [], select: false },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toPublic = function () {
  return {
    id: String(this._id),
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    blocked: !!this.blocked,
    addresses: this.addresses,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model("User", userSchema);
