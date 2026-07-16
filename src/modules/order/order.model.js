"use strict";

const mongoose = require("mongoose");

const orderLineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    // Snapshot of the picked variant on Product.variants[] (if any) so the
    // invoice / audit trail keeps a record even if the admin later renames
    // or deletes the variant.
    variantId: { type: String, default: null },
    variantName: { type: String, default: "" },
    // Snapshot of the picked color name (e.g. "Rose Red") so the invoice /
    // account order page can render it even if the admin later removes the
    // color from the product's palette.
    color: { type: String, default: "" },
    slug: String,
    name: String,
    // Snapshot of the primary image at purchase time so account/order pages
    // render the exact thumbnail the shopper saw at checkout, even if the
    // product later has its imagery changed.
    image: { type: String, default: "" },
    price: Number, // snapshot at purchase time
    qty: Number,
    lineTotal: Number,
  },
  { _id: false }
);

// Admin-authored notes attached to an order (visible to admins only). Each
// entry is append-only so we retain the operator audit trail.
const adminNoteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true, trim: true, maxlength: 2000 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

// Status transitions written whenever an admin updates order.status. Powers
// the timeline on the admin order detail page.
const statusEventSchema = new mongoose.Schema(
  {
    from: String,
    to: String,
    note: { type: String, trim: true, maxlength: 500 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [orderLineSchema], default: [] },
    summary: {
      subtotal: Number,
      gst: Number,
      shipping: Number,
      discount: Number,
      total: Number,
    },
    promoCode: { type: String, default: null },
    shippingAddress: { type: Object },
    payment: {
      provider: { type: String, default: "razorpay" },
      razorpayOrderId: String,
      razorpayPaymentId: String,
      status: {
        type: String,
        enum: ["created", "paid", "failed", "refunded"],
        default: "created",
        index: true,
      },
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"],
      default: "pending",
      index: true,
    },
    // AWB / courier tracking. Populated automatically when the Shiprocket
    // integration is enabled (order.service.verifyPayment calls the SR
    // client and stashes the results here); admins can also edit these
    // fields manually from the admin panel.
    tracking: {
      awb: { type: String, trim: true },
      courier: { type: String, trim: true },
      url: { type: String, trim: true },
      // Shiprocket-specific handles so we can call subsequent APIs
      // (pickup / label / cancel) without a second lookup.
      shiprocketOrderId: { type: String, trim: true },
      shipmentId: { type: String, trim: true },
      courierCompanyId: { type: Number },
      labelUrl: { type: String, trim: true },
      pickupScheduled: { type: Boolean, default: false },
      pickupScheduledDate: { type: Date },
      lastSyncedAt: { type: Date },
      // Populated when the automatic post-payment sync fails so the admin
      // detail panel can show *why* the order didn't reach Shiprocket, and a
      // background sweep can retry until it does. Cleared on success.
      lastSyncError: { type: String, trim: true },
      lastSyncErrorAt: { type: Date },
      syncAttempts: { type: Number, default: 0 },
    },
    adminNotes: { type: [adminNoteSchema], default: [] },
    statusHistory: { type: [statusEventSchema], default: [] },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
