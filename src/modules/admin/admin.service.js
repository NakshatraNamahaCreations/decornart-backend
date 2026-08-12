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
  // stockStatus filter — narrows the result set to in-stock or out-of-
  // stock products. Matches the parent product's `stock` field; variant-
  // level stock is checked separately on the storefront product page.
  // Both filters are intentionally permissive so neither is empty when
  // legacy docs carry stock as null / missing.
  // "in-stock"  = anything except an explicit 0 (positive OR missing/null)
  // "out-of-stock" = an explicit 0 OR missing/null
  if (query.stockStatus === "in") filter.stock = { $ne: 0 };
  else if (query.stockStatus === "out") filter.stock = { $in: [0, null] };

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

// Reduce a reviews array into { rating, ratingCount } — used by both
// create and update flows so the storefront's product card can show an
// average star rating without having to load the full review list.
function summarizeReviews(reviews) {
  const list = Array.isArray(reviews) ? reviews : [];
  const nums = list
    .map((r) => Number(r?.rating))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  return {
    // Round to one decimal so the API returns "4.5" not "4.5000000001".
    rating: Math.round(avg * 10) / 10,
    ratingCount: list.length,
  };
}

async function createProduct(payload) {
  const exists = await Product.exists({ slug: payload.slug });
  if (exists) throw ApiError.conflict("A product with that slug already exists");
  await ensureCategoryExists(payload.category);
  const summary = summarizeReviews(payload.reviews);
  const doc = await Product.create({
    ...payload,
    // Derive aggregate rating from admin-authored reviews so the storefront
    // card renders stars without loading the full review list.
    rating: summary.rating,
    ratingCount: summary.ratingCount,
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

  // eslint-disable-next-line no-console
  console.log(
    "[admin.updateProduct] payload.reviews:",
    Array.isArray(payload.reviews) ? payload.reviews.length : "n/a",
    payload.reviews
  );

  // Fetch the doc so we can drive updates through save() semantics — this
  // is the only pattern Mongoose guarantees for subdocument arrays
  // (reviews, faqs, featureBadges, colorImages, colorSwatches, variants).
  // `updateOne + $set` was dropping subdoc arrays silently in some cases
  // (especially arrays declared with `_id: false`).
  const doc = await Product.findById(id);
  if (!doc) throw ApiError.notFound("Product not found");

  // Subdocument arrays — replace via direct array assignment (not `.set`)
  // and mark modified so Mongoose emits the update op. `.set()` on a
  // DocumentArray path in Mongoose 8 can silently re-use the previous
  // cached array when the shape matches, which is exactly the failure
  // mode we've been chasing for reviews.
  const SUBDOC_ARRAYS = [
    "reviews",
    "faqs",
    "featureBadges",
    "colorImages",
    "colorSwatches",
    "variants",
  ];

  for (const [key, value] of Object.entries(payload)) {
    if (key === "video" && value && typeof value === "object") {
      // Nested-path object (not a subdoc array). Assign leaves so Mongoose
      // doesn't drop the parent — same quirk as before.
      doc.video = {
        url: typeof value.url === "string" ? value.url : "",
        title: typeof value.title === "string" ? value.title : "",
      };
      doc.markModified("video");
      continue;
    }
    if (SUBDOC_ARRAYS.includes(key)) {
      // Direct assignment on the DocumentArray path — Mongoose casts each
      // element via the subdoc schema when we reassign the whole array.
      doc[key] = Array.isArray(value) ? value : [];
      doc.markModified(key);
      continue;
    }
    doc.set(key, value);
  }

  // Skip Mongoose validators on save — Zod has already validated the
  // payload, and we don't want a stale legacy field on the doc to block
  // an otherwise-valid admin update.
  await doc.save({ validateBeforeSave: false });

  // Defensive follow-up: force-write reviews via updateOne with strict:false
  // so the field is guaranteed to hit Mongo even if Mongoose subdoc casting
  // silently dropped the array during save(). Also refresh the aggregate
  // rating/ratingCount so the shop card can render stars. No-op when
  // reviews wasn't in the payload at all.
  if (Array.isArray(payload.reviews)) {
    const summary = summarizeReviews(payload.reviews);
    await Product.collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          reviews: payload.reviews,
          rating: summary.rating,
          ratingCount: summary.ratingCount,
        },
      }
    );
    // eslint-disable-next-line no-console
    console.log(
      "[admin.updateProduct] force-wrote reviews via raw collection:",
      payload.reviews.length,
      "avg:",
      summary.rating
    );
  }

  invalidateProductCaches();
  invalidateCategoryCaches();
  // Re-read as a plain object so `serialize` gets consistent field shape
  // (e.g. subdoc arrays as plain arrays, not DocumentArray instances).
  const fresh = await Product.findById(id).lean();
  // eslint-disable-next-line no-console
  console.log(
    "[admin.updateProduct] fresh doc.reviews:",
    Array.isArray(fresh?.reviews) ? fresh.reviews.length : "n/a"
  );
  return serialize(fresh);
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

// Targeted stock update — bypasses the full-product PATCH so admins can
// tweak numbers from the inventory page without round-tripping the whole
// payload. Passing `variantId` narrows the update to that variant via
// the positional operator; otherwise the parent product's `stock` moves.
async function updateInventory(id, { stock, variantId }) {
  if (variantId) {
    const result = await Product.updateOne(
      { _id: id, "variants._id": variantId },
      { $set: { "variants.$.stock": stock } }
    );
    if (result.matchedCount === 0) {
      throw ApiError.notFound("Variant not found on this product");
    }
  } else {
    const result = await Product.updateOne(
      { _id: id },
      { $set: { stock } }
    );
    if (result.matchedCount === 0) {
      throw ApiError.notFound("Product not found");
    }
  }
  invalidateProductCaches();
  const doc = await Product.findById(id).lean();
  return serialize(doc);
}

// Hard-deletes the User doc. Orders keep their `user` ObjectId reference
// (which will resolve to null on populate) so historical revenue/order
// records stay intact for reporting. Admin accounts are guarded so this
// endpoint can never lock the console out.
async function deleteCustomer(id) {
  const user = await User.findById(id).lean();
  if (!user) throw ApiError.notFound("Customer not found");
  if (user.role === "admin") {
    throw ApiError.badRequest("Admin accounts cannot be deleted from here.");
  }
  await User.deleteOne({ _id: id });
  return { id: String(user._id) };
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
    compareAt: doc.compareAt || null,
    occasion: doc.occasion || "",
    occasions: doc.occasions || [],
    category: doc.category,
    // Craft-supply detail fields — required for the admin edit form to
    // round-trip existing values instead of showing empty inputs.
    packContents: doc.packContents || [],
    usage: doc.usage || [],
    specs: doc.specs || {},
    faqs: doc.faqs || [],
    reviews: (doc.reviews || []).map((r) => ({
      name: r?.name || "",
      rating: r?.rating ?? 5,
      date: r?.date || "",
      title: r?.title || "",
      body: r?.body || "",
      verified: !!r?.verified,
      helpful: r?.helpful ?? 0,
    })),
    // Per-product feature badges shown on the storefront gallery. The
    // admin form's Feature badges section round-trips through this.
    featureBadges: (doc.featureBadges || []).map((b) => ({
      icon: b?.icon || "",
      title: b?.title || "",
      copy: b?.copy || "",
    })),
    materials: doc.materials || [],
    brandStyles: doc.brandStyles || [],
    colors: doc.colors || [],
    // Per-colour hero image overrides (pipe-cleaner products). Kept as
    // an array so the admin form can rebuild its { color → url } map.
    colorImages: (doc.colorImages || []).map((c) => ({
      color: c?.color || "",
      image: c?.image || "",
    })),
    // Per-colour hex overrides for custom colours the admin picked. The
    // storefront reads this first when rendering a swatch, then falls
    // back to its static COLOR_HEX map, then to a neutral grey.
    colorSwatches: (doc.colorSwatches || []).map((c) => ({
      color: c?.color || "",
      hex: c?.hex || "",
    })),
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
    video: {
      url: doc.video?.url || "",
      title: doc.video?.title || "",
    },
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
  deleteCustomer,
  updateInventory,
  listCategoriesAdmin,
  getCategoryAdmin,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
};
