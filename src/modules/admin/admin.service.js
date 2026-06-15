"use strict";

const Product = require("../product/product.model");
const User = require("../auth/auth.model");
const Order = require("../order/order.model");
const cache = require("../../services/cache.service");
const { getPagination, buildMeta } = require("../../utils/paginate");
const { ApiError } = require("../../utils/ApiError");

// Server-side caches keyed by filter args; invalidated on any product mutation
// so the storefront sees changes within a request or two.
function invalidateProductCaches() {
  // Best-effort: cache.service may be in-memory or Redis; both expose .delByPrefix
  if (typeof cache.delByPrefix === "function") {
    cache.delByPrefix("product:list:").catch(() => {});
    cache.delByPrefix("product:detail:").catch(() => {});
  } else if (typeof cache.flush === "function") {
    cache.flush().catch(() => {});
  }
}

async function listProducts(query) {
  const { page, limit, skip } = getPagination(query);
  const filter = {};
  if (query.status && query.status !== "all") filter.status = query.status;
  if (query.category) filter.category = query.category;
  if (query.q) filter.$or = [
    { name: { $regex: query.q, $options: "i" } },
    { slug: { $regex: query.q, $options: "i" } },
  ];

  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);

  return {
    items: items.map(serialize),
    meta: buildMeta({ page, limit, total }),
  };
}

async function getProduct(id) {
  const doc = await Product.findById(id).lean();
  if (!doc) throw ApiError.notFound("Product not found");
  return serialize(doc);
}

async function createProduct(payload) {
  const exists = await Product.exists({ slug: payload.slug });
  if (exists) throw ApiError.conflict("A product with that slug already exists");
  const doc = await Product.create({
    ...payload,
    status: payload.status || "active",
  });
  invalidateProductCaches();
  return serialize(doc.toObject());
}

async function updateProduct(id, payload) {
  if (payload.slug) {
    const clash = await Product.exists({ slug: payload.slug, _id: { $ne: id } });
    if (clash) throw ApiError.conflict("A product with that slug already exists");
  }
  const doc = await Product.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true, runValidators: true }
  ).lean();
  if (!doc) throw ApiError.notFound("Product not found");
  invalidateProductCaches();
  return serialize(doc);
}

async function deleteProduct(id) {
  const doc = await Product.findByIdAndDelete(id).lean();
  if (!doc) throw ApiError.notFound("Product not found");
  invalidateProductCaches();
  return { id };
}

async function dashboard() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    productCount,
    activeProductCount,
    lowStock,
    userCount,
    orderCount,
    recentOrderCount,
    revenueAgg,
    recentOrders,
  ] = await Promise.all([
    Product.countDocuments({}),
    Product.countDocuments({ status: "active" }),
    Product.countDocuments({ stock: { $lt: 5 }, status: "active" }),
    User.countDocuments({}),
    Order.countDocuments({}),
    Order.countDocuments({ createdAt: { $gte: since } }),
    Order.aggregate([
      { $match: { "payment.status": "paid" } },
      { $group: { _id: null, total: { $sum: "$summary.total" } } },
    ]),
    Order.find({}).sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  return {
    counts: {
      products: productCount,
      activeProducts: activeProductCount,
      lowStock,
      users: userCount,
      orders: orderCount,
      recentOrders: recentOrderCount,
    },
    revenue: {
      lifetimePaid: (revenueAgg[0] && revenueAgg[0].total) || 0,
    },
    recentOrders: recentOrders.map((o) => ({
      id: String(o._id),
      orderNumber: o.orderNumber,
      total: o.summary?.total || 0,
      status: o.status,
      paymentStatus: o.payment?.status,
      createdAt: o.createdAt,
    })),
  };
}

function serialize(doc) {
  return {
    id: String(doc._id),
    slug: doc.slug,
    name: doc.name,
    description: doc.description || "",
    price: doc.price,
    occasion: doc.occasion || "",
    occasions: doc.occasions || [],
    category: doc.category,
    stems: doc.stems || "",
    images: doc.images || [],
    stock: doc.stock ?? 0,
    isNew: !!doc.isNew,
    isBestseller: !!doc.isBestseller,
    status: doc.status,
    rating: doc.rating ?? 0,
    ratingCount: doc.ratingCount ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  dashboard,
};
