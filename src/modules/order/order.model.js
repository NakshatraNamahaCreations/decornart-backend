"use strict";

const mongoose = require("mongoose");

const orderLineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    slug: String,
    name: String,
    price: Number, // snapshot at purchase time
    qty: Number,
    lineTotal: Number,
  },
  { _id: false }
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
        enum: ["created", "paid", "failed"],
        default: "created",
        index: true,
      },
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
