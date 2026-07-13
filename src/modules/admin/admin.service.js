"use strict";

const Product = require("../product/product.model");
const User = require("../auth/auth.model");
const Order = require("../order/order.model");
const Category = require("../category/category.model");
const categoryService = require("../category/category.service");
const cache = require("../../services/cache.service");
const { getPagination, buildMeta } = require("../../utils/paginate");
const { ApiError } = require("../../utils/ApiError");

// Any product mutation invalidates the category:list cache because the
// per-category counts change.
function invalidateCategoryCaches() {
  if (typeof cache.delByPrefix === "function") {
    cache.delByPrefix("category:").catch(() => {});
  }
}

async function ensureCategoryExists(slug) {
  if (!slug) return;
  const exists = await Category.exists({ slug });
  if (!exists) throw ApiError.badRequest(`Unknown category: ${slug}`);
}

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
  await ensureCategoryExists(payload.category);
  const doc = await Product.create({
    ...payload,
    status: payload.status || "active",
  });
  invalidateProductCaches();
  invalidateCategoryCaches();
  return serialize(doc.toObject());
}

async function updateProduct(id, payload) {
  if (payload.slug) {
    const clash = await Product.exists({ slug: payload.slug, _id: { $ne: id } });
    if (clash) throw ApiError.conflict("A product with that slug already exists");
  }
  if (payload.category) await ensureCategoryExists(payload.category);
  const doc = await Product.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true, runValidators: true }
  ).lean();
  if (!doc) throw ApiError.notFound("Product not found");
  invalidateProductCaches();
  invalidateCategoryCaches();
  return serialize(doc);
}

async function deleteProduct(id) {
  const doc = await Product.findByIdAndDelete(id).lean();
  if (!doc) throw ApiError.notFound("Product not found");
  invalidateProductCaches();
  invalidateCategoryCaches();
  return { id };
}

// ── Categories (admin CRUD) ────────────────────────────────────────────
function listCategoriesAdmin() {
  return categoryService.listForAdmin();
}

function getCategoryAdmin(id) {
  return categoryService.getById(id);
}

function createCategory(payload) {
  return categoryService.create(payload);
}

function updateCategory(id, payload) {
  return categoryService.update(id, payload);
}

function deleteCategory(id) {
  return categoryService.remove(id);
}

function reorderCategories(ids) {
  return categoryService.reorder(ids);
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
    salesSeries,
    topProducts,
    statusBreakdown,
    lowStockList,
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
    // Last-30-day daily revenue (only paid orders count toward revenue).
    Order.aggregate([
      { $match: { createdAt: { $gte: since }, "payment.status": "paid" } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          revenue: { $sum: "$summary.total" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Top 5 selling products by qty across all-time orders.
    Order.aggregate([
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          slug: { $first: "$items.slug" },
          name: { $first: "$items.name" },
          qty: { $sum: "$items.qty" },
          revenue: { $sum: "$items.lineTotal" },
        },
      },
      { $sort: { qty: -1 } },
      { $limit: 5 },
    ]),
    // Order status breakdown for the last 30 days.
    Order.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Product.find({ stock: { $lt: 5 }, status: "active" })
      .select("slug name stock")
      .sort({ stock: 1 })
      .limit(5)
      .lean(),
  ]);

  // Fill the 30-day sales series so gaps render as zero (chart doesn't skip
  // dates). Client just consumes the ordered array.
  const salesByDay = new Map(salesSeries.map((d) => [d._id, d]));
  const series = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const hit = salesByDay.get(key);
    series.push({
      date: key,
      revenue: hit ? hit.revenue : 0,
      orders: hit ? hit.orders : 0,
    });
  }

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
    salesSeries: series,
    topProducts: topProducts.map((p) => ({
      id: p._id ? String(p._id) : null,
      slug: p.slug,
      name: p.name,
      qty: p.qty,
      revenue: p.revenue,
    })),
    statusBreakdown: statusBreakdown.reduce((acc, s) => {
      acc[s._id || "unknown"] = s.count;
      return acc;
    }, {}),
    lowStockList: lowStockList.map((p) => ({
      id: String(p._id),
      slug: p.slug,
      name: p.name,
      stock: p.stock,
    })),
  };
}

// ── Orders (admin) ─────────────────────────────────────────────────────
function buildOrderFilter(query) {
  const filter = {};
  if (query.status && query.status !== "all") filter.status = query.status;
  if (query.paymentStatus && query.paymentStatus !== "all") {
    filter["payment.status"] = query.paymentStatus;
  }
  if (query.q) {
    filter.$or = [
      { orderNumber: { $regex: query.q, $options: "i" } },
      { "shippingAddress.phone": { $regex: query.q, $options: "i" } },
    ];
  }
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      // If a bare YYYY-MM-DD was passed, include the whole day.
      if (query.dateTo.length === 10) end.setUTCHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }
  return filter;
}

async function listOrders(query) {
  const { page, limit, skip } = getPagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildOrderFilter(query);
  const [items, total] = await Promise.all([
    Order.find(filter)
      .populate("user", "name email phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);
  return {
    items: items.map(serializeOrderCard),
    meta: buildMeta({ page, limit, total }),
  };
}

async function getOrder(id) {
  const order = await Order.findById(id)
    .populate("user", "name email phone")
    .lean();
  if (!order) throw ApiError.notFound("Order not found");
  return serializeOrder(order);
}

async function updateOrderStatus(id, { status, note, tracking }, admin) {
  const order = await Order.findById(id);
  if (!order) throw ApiError.notFound("Order not found");
  const from = order.status;
  order.status = status;
  if (tracking) {
    order.tracking = { ...(order.tracking?.toObject?.() || order.tracking || {}), ...tracking };
  }
  order.statusHistory.push({
    from,
    to: status,
    note: note || undefined,
    by: admin?.id,
    byName: admin?.name,
  });
  await order.save();
  const populated = await Order.findById(id).populate("user", "name email phone").lean();
  return serializeOrder(populated);
}

async function addOrderNote(id, { note }, admin) {
  const order = await Order.findById(id);
  if (!order) throw ApiError.notFound("Order not found");
  order.adminNotes.push({ note, by: admin?.id, byName: admin?.name });
  await order.save();
  const populated = await Order.findById(id).populate("user", "name email phone").lean();
  return serializeOrder(populated);
}

async function refundPayment(id, { note }, admin) {
  const order = await Order.findById(id);
  if (!order) throw ApiError.notFound("Order not found");
  if (order.payment?.status !== "paid") {
    throw ApiError.badRequest("Only paid orders can be refunded");
  }
  // We flag the order as refunded and record who did it. Money movement is
  // handled out-of-band via the payment gateway console until we wire up
  // programmatic refunds — this endpoint just captures the operational state.
  order.payment.status = "refunded";
  order.statusHistory.push({
    from: order.status,
    to: order.status,
    note: `Payment refunded${note ? `: ${note}` : ""}`,
    by: admin?.id,
    byName: admin?.name,
  });
  await order.save();
  const populated = await Order.findById(id).populate("user", "name email phone").lean();
  return serializeOrder(populated);
}

function buildDateMatch(query) {
  const { dateFrom, dateTo } = query || {};
  const match = {};
  if (dateFrom || dateTo) {
    match.createdAt = {};
    if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      if (String(dateTo).length === 10) end.setUTCHours(23, 59, 59, 999);
      match.createdAt.$lte = end;
    }
  }
  return match;
}

async function paymentsReport(query) {
  const match = buildDateMatch(query);

  const [statusAgg, providerAgg, dailyAgg, methodTotals] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$payment.status",
          count: { $sum: 1 },
          total: { $sum: "$summary.total" },
        },
      },
    ]),
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$payment.provider",
          count: { $sum: 1 },
          total: { $sum: "$summary.total" },
        },
      },
    ]),
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            status: "$payment.status",
          },
          count: { $sum: 1 },
          total: { $sum: "$summary.total" },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]),
    Order.aggregate([
      { $match: { ...match, "payment.status": "paid" } },
      {
        $group: {
          _id: null,
          gross: { $sum: "$summary.total" },
          gst: { $sum: "$summary.gst" },
          shipping: { $sum: "$summary.shipping" },
          discount: { $sum: "$summary.discount" },
          subtotal: { $sum: "$summary.subtotal" },
          orderCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const buckets = { paid: 0, failed: 0, created: 0, refunded: 0 };
  const bucketRevenue = { paid: 0, failed: 0, created: 0, refunded: 0 };
  for (const b of statusAgg) {
    const key = b._id || "created";
    if (buckets[key] !== undefined) {
      buckets[key] = b.count;
      bucketRevenue[key] = b.total;
    }
  }

  // Merge daily rows by date (each date may have multiple status entries).
  const daily = new Map();
  for (const row of dailyAgg) {
    const date = row._id.date;
    const status = row._id.status || "created";
    if (!daily.has(date)) {
      daily.set(date, { date, paid: 0, failed: 0, created: 0, refunded: 0, paidRevenue: 0 });
    }
    const entry = daily.get(date);
    if (entry[status] !== undefined) entry[status] = row.count;
    if (status === "paid") entry.paidRevenue = row.total;
  }

  const totals = methodTotals[0] || {};

  return {
    counts: buckets,
    revenueByStatus: bucketRevenue,
    revenue: {
      gross: bucketRevenue.paid,
      refunded: bucketRevenue.refunded,
      net: bucketRevenue.paid - bucketRevenue.refunded,
      gst: totals.gst || 0,
      shipping: totals.shipping || 0,
      discount: totals.discount || 0,
      subtotal: totals.subtotal || 0,
      paidOrders: totals.orderCount || 0,
      averageOrderValue: totals.orderCount ? (totals.gross || 0) / totals.orderCount : 0,
    },
    providers: providerAgg.map((p) => ({
      provider: p._id || "unknown",
      count: p.count,
      total: p.total,
    })),
    daily: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

async function shippingReport(query) {
  const match = buildDateMatch(query);

  const [statusAgg, courierAgg, totalsAgg, trackingAgg, topStatesAgg] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          shippingRevenue: { $sum: "$summary.shipping" },
        },
      },
    ]),
    Order.aggregate([
      { $match: { ...match, "tracking.courier": { $exists: true, $ne: "" } } },
      {
        $group: {
          _id: "$tracking.courier",
          count: { $sum: 1 },
          shippingRevenue: { $sum: "$summary.shipping" },
        },
      },
      { $sort: { count: -1 } },
    ]),
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalShippingCharged: { $sum: "$summary.shipping" },
          totalOrders: { $sum: 1 },
        },
      },
    ]),
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          withAwb: {
            $sum: {
              $cond: [{ $and: [{ $ne: ["$tracking.awb", null] }, { $ne: ["$tracking.awb", ""] }] }, 1, 0],
            },
          },
          pickupScheduled: {
            $sum: { $cond: [{ $eq: ["$tracking.pickupScheduled", true] }, 1, 0] },
          },
          delivered: {
            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
          },
          shipped: {
            $sum: { $cond: [{ $eq: ["$status", "shipped"] }, 1, 0] },
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
          },
        },
      },
    ]),
    Order.aggregate([
      { $match: { ...match, "shippingAddress.state": { $exists: true, $ne: "" } } },
      {
        $group: {
          _id: "$shippingAddress.state",
          orders: { $sum: 1 },
          shippingRevenue: { $sum: "$summary.shipping" },
        },
      },
      { $sort: { orders: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const statusBuckets = {
    pending: 0,
    confirmed: 0,
    processing: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
  };
  for (const s of statusAgg) {
    const key = s._id || "pending";
    if (statusBuckets[key] !== undefined) statusBuckets[key] = s.count;
  }

  const totals = totalsAgg[0] || {};
  const tracking = trackingAgg[0] || {};

  return {
    counts: statusBuckets,
    totals: {
      orders: totals.totalOrders || 0,
      shippingRevenue: totals.totalShippingCharged || 0,
      averageShipping: totals.totalOrders ? (totals.totalShippingCharged || 0) / totals.totalOrders : 0,
    },
    tracking: {
      withAwb: tracking.withAwb || 0,
      pickupScheduled: tracking.pickupScheduled || 0,
      delivered: tracking.delivered || 0,
      shipped: tracking.shipped || 0,
      cancelled: tracking.cancelled || 0,
    },
    couriers: courierAgg.map((c) => ({
      courier: c._id || "unknown",
      count: c.count,
      shippingRevenue: c.shippingRevenue,
    })),
    topStates: topStatesAgg.map((s) => ({
      state: s._id,
      orders: s.orders,
      shippingRevenue: s.shippingRevenue,
    })),
  };
}

async function paymentsSummary(query) {
  const { dateFrom, dateTo } = query || {};
  const match = {};
  if (dateFrom || dateTo) {
    match.createdAt = {};
    if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      if (String(dateTo).length === 10) end.setUTCHours(23, 59, 59, 999);
      match.createdAt.$lte = end;
    }
  }
  const agg = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$payment.status",
        count: { $sum: 1 },
        total: { $sum: "$summary.total" },
      },
    },
  ]);
  // Normalise the reducer output so the frontend gets predictable keys.
  const buckets = { paid: 0, failed: 0, created: 0, refunded: 0 };
  const revenue = { paid: 0, refunded: 0 };
  for (const b of agg) {
    const key = b._id || "created";
    if (buckets[key] !== undefined) buckets[key] = b.count;
    if (key === "paid") revenue.paid = b.total;
    if (key === "refunded") revenue.refunded = b.total;
  }
  return {
    counts: buckets,
    revenue: {
      gross: revenue.paid,
      refunded: revenue.refunded,
      net: revenue.paid - revenue.refunded,
    },
  };
}

// ── Customers (admin) ──────────────────────────────────────────────────
async function listCustomers(query) {
  const { page, limit, skip } = getPagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = { role: "customer" };
  if (query.status === "blocked") filter.blocked = true;
  if (query.status === "active") filter.blocked = { $ne: true };
  if (query.q) {
    filter.$or = [
      { name: { $regex: query.q, $options: "i" } },
      { email: { $regex: query.q, $options: "i" } },
      { phone: { $regex: query.q, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  // Fold in per-user order aggregates in a single pipeline so the list stays
  // paginated even if some customers have hundreds of orders each.
  const userIds = items.map((u) => u._id);
  const agg = await Order.aggregate([
    { $match: { user: { $in: userIds } } },
    {
      $group: {
        _id: "$user",
        orderCount: { $sum: 1 },
        totalSpent: {
          $sum: {
            $cond: [{ $eq: ["$payment.status", "paid"] }, "$summary.total", 0],
          },
        },
        lastOrderAt: { $max: "$createdAt" },
      },
    },
  ]);
  const byId = new Map(agg.map((a) => [String(a._id), a]));

  return {
    items: items.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      phone: u.phone || "",
      blocked: !!u.blocked,
      createdAt: u.createdAt,
      orderCount: byId.get(String(u._id))?.orderCount || 0,
      totalSpent: byId.get(String(u._id))?.totalSpent || 0,
      lastOrderAt: byId.get(String(u._id))?.lastOrderAt || null,
    })),
    meta: buildMeta({ page, limit, total }),
  };
}

async function getCustomer(id) {
  const user = await User.findById(id).lean();
  if (!user) throw ApiError.notFound("Customer not found");
  const [orders, agg] = await Promise.all([
    Order.find({ user: id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    Order.aggregate([
      { $match: { user: user._id } },
      {
        $group: {
          _id: null,
          orderCount: { $sum: 1 },
          totalSpent: {
            $sum: {
              $cond: [{ $eq: ["$payment.status", "paid"] }, "$summary.total", 0],
            },
          },
        },
      },
    ]),
  ]);
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    blocked: !!user.blocked,
    role: user.role,
    addresses: user.addresses || [],
    createdAt: user.createdAt,
    stats: {
      orderCount: agg[0]?.orderCount || 0,
      totalSpent: agg[0]?.totalSpent || 0,
    },
    orders: orders.map((o) => ({
      id: String(o._id),
      orderNumber: o.orderNumber,
      total: o.summary?.total || 0,
      status: o.status,
      paymentStatus: o.payment?.status,
      createdAt: o.createdAt,
    })),
  };
}

async function setCustomerBlocked(id, blocked) {
  const user = await User.findByIdAndUpdate(
    id,
    { $set: { blocked: !!blocked } },
    { new: true }
  ).lean();
  if (!user) throw ApiError.notFound("Customer not found");
  // Revoke refresh tokens when blocking so the shopper can't mint fresh
  // access tokens after we suspend them.
  if (blocked) {
    await User.updateOne({ _id: id }, { $set: { refreshTokens: [] } });
  }
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    blocked: !!user.blocked,
  };
}

function serializeOrderCard(o) {
  return {
    id: String(o._id),
    orderNumber: o.orderNumber,
    customer: o.user
      ? { id: String(o.user._id), name: o.user.name, email: o.user.email }
      : null,
    itemCount: (o.items || []).reduce((sum, i) => sum + (i.qty || 0), 0),
    total: o.summary?.total || 0,
    status: o.status,
    paymentStatus: o.payment?.status,
    createdAt: o.createdAt,
  };
}

function serializeOrder(o) {
  return {
    id: String(o._id),
    orderNumber: o.orderNumber,
    customer: o.user
      ? {
          id: String(o.user._id),
          name: o.user.name,
          email: o.user.email,
          phone: o.user.phone || "",
        }
      : null,
    items: o.items || [],
    summary: o.summary || {},
    promoCode: o.promoCode,
    shippingAddress: o.shippingAddress || null,
    payment: {
      provider: o.payment?.provider,
      status: o.payment?.status,
      razorpayOrderId: o.payment?.razorpayOrderId,
      razorpayPaymentId: o.payment?.razorpayPaymentId,
    },
    status: o.status,
    tracking: o.tracking || {},
    adminNotes: (o.adminNotes || []).map((n) => ({
      id: String(n._id),
      note: n.note,
      byName: n.byName,
      at: n.at,
    })),
    statusHistory: (o.statusHistory || []).map((s) => ({
      id: String(s._id),
      from: s.from,
      to: s.to,
      note: s.note,
      byName: s.byName,
      at: s.at,
    })),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
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
    // Craft-supply detail fields — required for the admin edit form to
    // round-trip existing values instead of showing empty inputs.
    packContents: doc.packContents || [],
    usage: doc.usage || [],
    specs: doc.specs || {},
    faqs: doc.faqs || [],
    colors: doc.colors || [],
    variantLabel: doc.variantLabel || "",
    variants: (doc.variants || []).map((v) => ({
      id: v._id ? String(v._id) : undefined,
      name: v.name,
      price: v.price,
      stock: v.stock ?? 0,
      sku: v.sku || "",
      image: v.image || "",
    })),
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
  listOrders,
  getOrder,
  updateOrderStatus,
  addOrderNote,
  refundPayment,
  paymentsSummary,
  paymentsReport,
  shippingReport,
  listCustomers,
  getCustomer,
  setCustomerBlocked,
  listCategoriesAdmin,
  getCategoryAdmin,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
};
