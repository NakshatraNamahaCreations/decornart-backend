"use strict";

const crypto = require("crypto");
const config = require("../config");
const logger = require("../utils/logger");
const { ApiError } = require("../utils/ApiError");

/**
 * Shiprocket wrapper — isolated behind its own module with a lightweight
 * circuit breaker (same pattern as payment.service.js). If Shiprocket is
 * unreachable, the breaker opens and the caller sees a clean 503; the rest of
 * the API is unaffected. When credentials aren't configured, we run in
 * "mock" mode so checkout + admin flows still work end-to-end.
 *
 * Auth: Shiprocket returns a 10-day JWT from /external/auth/login. We cache
 * it in-process and refresh proactively on the last day, or reactively on a
 * 401. Callers never see the token.
 */

const BASE = config.shiprocket.baseUrl.replace(/\/$/, "");

let mode = config.shiprocket.enabled ? "live" : "mock";
const hasStaticToken = !!config.shiprocket.token;
const hasApiUser =
  !!config.shiprocket.email && !!config.shiprocket.password;
if (mode === "live" && !hasStaticToken && !hasApiUser) {
  logger.warn(
    "shiprocket credentials missing (need SHIPROCKET_TOKEN or SHIPROCKET_EMAIL+PASSWORD); running in mock mode"
  );
  mode = "mock";
}

// --- Auth token cache ---------------------------------------------------
// When SHIPROCKET_TOKEN is set we skip login entirely — treated as long-
// lived. Otherwise we login with the API-user email/password and cache the
// returned JWT (Shiprocket issues 10-day tokens; we refresh at day 9).
let cachedToken = null;
let tokenExpiresAt = 0;
let loginPromise = null;

async function login() {
  if (mode === "mock") return "mock-token";
  if (hasStaticToken) return config.shiprocket.token;
  // Route login through the circuit breaker too — otherwise bad credentials
  // keep hammering /external/auth/login and Shiprocket eventually blocks
  // the account with "User blocked due to too many failed login attempts."
  assertClosed();
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/external/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: config.shiprocket.email,
          password: config.shiprocket.password,
        }),
      });
      if (!res.ok) {
        const body = await safeJson(res);
        const msg = body?.message || `Shiprocket login failed (${res.status})`;
        recordFailure();
        // Extend the cooldown when Shiprocket says the account is blocked —
        // 30s is not enough to let a block clear, and quick retries push the
        // block deeper. Give it 15 minutes so the payment flow doesn't
        // repeatedly light up the same error in the logs.
        if (/blocked/i.test(msg)) {
          breaker.openUntil = Date.now() + 15 * 60 * 1000;
        }
        throw new Error(msg);
      }
      const data = await res.json();
      if (!data.token) {
        recordFailure();
        throw new Error("Shiprocket login: no token returned");
      }
      cachedToken = data.token;
      tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;
      recordSuccess();
      logger.info("shiprocket login ok");
      return cachedToken;
    } finally {
      loginPromise = null;
    }
  })();
  return loginPromise;
}

async function getToken() {
  if (mode === "mock") return "mock-token";
  if (hasStaticToken) return config.shiprocket.token;
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  return login();
}

// --- Circuit breaker ----------------------------------------------------
const breaker = { failures: 0, openUntil: 0, threshold: 3, cooldownMs: 30000 };

function assertClosed() {
  if (Date.now() < breaker.openUntil) {
    throw ApiError.unavailable("Shipping provider temporarily unavailable. Please retry shortly.");
  }
}
function recordSuccess() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}
function recordFailure() {
  breaker.failures += 1;
  if (breaker.failures >= breaker.threshold) {
    breaker.openUntil = Date.now() + breaker.cooldownMs;
    logger.warn("shiprocket breaker OPEN", { cooldownMs: breaker.cooldownMs });
  }
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Signed HTTP call with auto-retry on 401 (token expired). Callers pass a
 * request builder so we can rebuild headers with a fresh token on retry.
 */
async function request(pathOrUrl, { method = "GET", body, query } = {}, _retry = false) {
  assertClosed();
  if (mode === "mock") throw new Error("request() called in mock mode");

  const token = await getToken();
  const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE}${pathOrUrl}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.append(k, String(v));
    }
  }

  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    recordFailure();
    throw new Error(`Shiprocket request failed: ${err.message}`);
  }

  if (res.status === 401 && !_retry) {
    cachedToken = null;
    tokenExpiresAt = 0;
    return request(pathOrUrl, { method, body, query }, true);
  }

  const data = await safeJson(res);
  if (!res.ok) {
    recordFailure();
    const msg = data?.message || data?.errors?.[0] || `Shiprocket ${res.status}`;
    throw new Error(msg);
  }
  recordSuccess();
  return data;
}

// --- Public API ---------------------------------------------------------

/**
 * Check serviceability from the configured pickup pincode to a delivery
 * pincode. Returns the cheapest recommended courier (or a small ranked
 * list). Callers get { available, cheapest, couriers, etd, cod } — safe
 * to render straight in the storefront checkout.
 */
async function checkServiceability({ deliveryPincode, weightKg, subtotal, cod = false }) {
  const pickupPincode = config.shiprocket.pickup.pincode;
  const weight = weightKg || config.shiprocket.defaultParcel.weightKg;

  if (mode === "mock") {
    const charge = subtotal >= 999 ? 0 : 79;
    return {
      available: !!deliveryPincode,
      mock: true,
      cheapest: {
        courierCompanyId: 24,
        courierName: "Bluedart Surface",
        rate: charge,
        etd: "3-5 days",
        cod,
      },
      couriers: [
        { courierCompanyId: 24, courierName: "Bluedart Surface", rate: charge, etd: "3-5 days", cod },
        { courierCompanyId: 6, courierName: "Delhivery Express", rate: charge + 30, etd: "2-3 days", cod },
      ],
    };
  }

  const data = await request("/external/courier/serviceability/", {
    query: {
      pickup_postcode: pickupPincode,
      delivery_postcode: deliveryPincode,
      weight,
      cod: cod ? 1 : 0,
      declared_value: subtotal,
    },
  });
  const list = data?.data?.available_courier_companies || [];
  const couriers = list.map((c) => ({
    courierCompanyId: c.courier_company_id,
    courierName: c.courier_name,
    rate: Number(c.rate) || Number(c.freight_charge) || 0,
    etd: c.etd || `${c.estimated_delivery_days || ""}`.trim(),
    cod: c.cod === 1,
  }));
  const cheapest = couriers.slice().sort((a, b) => a.rate - b.rate)[0] || null;
  return { available: !!cheapest, cheapest, couriers };
}

/**
 * Create an ad-hoc order on Shiprocket. Meant to be called from
 * order.service after payment is verified; caller is expected to swallow
 * failures (best-effort) so a Shiprocket outage never voids a paid order.
 */
async function createOrder(order) {
  if (mode === "mock") {
    return {
      mock: true,
      shiprocketOrderId: `SR_MOCK_${Date.now()}`,
      shipmentId: `SHP_MOCK_${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    };
  }
  const payload = buildOrderPayload(order);
  const data = await request("/external/orders/create/adhoc", {
    method: "POST",
    body: payload,
  });
  return {
    shiprocketOrderId: data.order_id,
    shipmentId: data.shipment_id,
    status: data.status,
  };
}

/**
 * Assign the cheapest-recommended courier's AWB to a shipment. If callers
 * already picked a courierCompanyId (e.g., admin manually selected one),
 * pass it — otherwise Shiprocket picks its default recommendation.
 */
async function assignAWB(shipmentId, { courierCompanyId } = {}) {
  if (mode === "mock") {
    return {
      mock: true,
      awb: `AWB${Date.now()}`,
      courier: "Bluedart Surface",
    };
  }
  const data = await request("/external/courier/assign/awb", {
    method: "POST",
    body: {
      shipment_id: shipmentId,
      ...(courierCompanyId ? { courier_id: courierCompanyId } : {}),
    },
  });
  const awb = data?.response?.data?.awb_code || data?.awb_code;
  const courier = data?.response?.data?.courier_name || data?.courier_name;
  return { awb, courier };
}

/** Schedule a pickup for one or more shipments. */
async function requestPickup(shipmentIds) {
  const ids = Array.isArray(shipmentIds) ? shipmentIds : [shipmentIds];
  if (mode === "mock") {
    return {
      mock: true,
      pickupScheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      pickupTokenNumber: `PT_MOCK_${Date.now()}`,
    };
  }
  const data = await request("/external/courier/generate/pickup", {
    method: "POST",
    body: { shipment_id: ids },
  });
  return {
    pickupScheduledDate: data?.response?.pickup_scheduled_date,
    pickupTokenNumber: data?.response?.pickup_token_number,
  };
}

/** Live tracking events for an AWB. */
async function trackByAWB(awb) {
  if (mode === "mock") {
    return {
      mock: true,
      awb,
      status: "In Transit",
      events: [
        { date: new Date().toISOString(), status: "Picked up", location: config.shiprocket.pickup.city },
      ],
    };
  }
  const data = await request(`/external/courier/track/awb/${encodeURIComponent(awb)}`);
  const t = data?.tracking_data;
  return {
    awb,
    status: t?.shipment_status_desc || t?.shipment_status || "unknown",
    events: (t?.shipment_track_activities || []).map((e) => ({
      date: e.date,
      status: e["sr-status-label"] || e.activity,
      location: e.location,
    })),
  };
}

/** Cancel one or more AWBs (post-shipment). */
async function cancelShipment(awbs) {
  const list = Array.isArray(awbs) ? awbs : [awbs];
  if (mode === "mock") return { mock: true, cancelled: list };
  const data = await request("/external/orders/cancel/shipment/awbs", {
    method: "POST",
    body: { awbs: list },
  });
  return { cancelled: list, message: data?.message };
}

/** Generate a shipping label PDF for one or more shipments. */
async function generateLabel(shipmentIds) {
  const ids = Array.isArray(shipmentIds) ? shipmentIds : [shipmentIds];
  if (mode === "mock") {
    return { mock: true, labelUrl: `https://mock.shiprocket/label/${ids.join(",")}.pdf` };
  }
  const data = await request("/external/courier/generate/label", {
    method: "POST",
    body: { shipment_id: ids },
  });
  return { labelUrl: data?.label_url };
}

// --- Helpers ------------------------------------------------------------

/**
 * Translate our internal order into the shape Shiprocket expects for
 * /external/orders/create/adhoc. Kept as a small pure function so it's
 * easy to eyeball and unit-test if we ever add fixtures.
 */
function buildOrderPayload(order) {
  const parcel = config.shiprocket.defaultParcel;
  const subtotal = order.summary?.subtotal || 0;
  const itemWeight = order.items?.reduce(
    (s, i) => s + (i.weightKg || parcel.weightKg) * (i.qty || 1),
    0
  );
  return {
    order_id: order.orderNumber,
    order_date: (order.createdAt || new Date()).toISOString().slice(0, 10),
    pickup_location: config.shiprocket.pickup.nickname,
    channel_id: "",
    comment: "",
    billing_customer_name: order.shippingAddress?.name || "Customer",
    billing_last_name: "",
    billing_address: order.shippingAddress?.line1 || "",
    billing_address_2: order.shippingAddress?.line2 || "",
    billing_city: order.shippingAddress?.city || "",
    billing_pincode: order.shippingAddress?.pincode || "",
    billing_state: order.shippingAddress?.state || "",
    billing_country: "India",
    billing_email: order.customerEmail || "customer@decornart.in",
    billing_phone: order.shippingAddress?.phone || "",
    shipping_is_billing: true,
    order_items: (order.items || []).map((i) => ({
      name: i.name,
      sku: i.slug || String(i.product),
      units: i.qty,
      selling_price: i.price,
    })),
    payment_method:
      order.paymentStatus === "paid" || order.payment?.status === "paid"
        ? "Prepaid"
        : "COD",
    sub_total: subtotal,
    length: parcel.lengthCm,
    breadth: parcel.breadthCm,
    height: parcel.heightCm,
    weight: itemWeight || parcel.weightKg,
  };
}

module.exports = {
  checkServiceability,
  createOrder,
  assignAWB,
  requestPickup,
  trackByAWB,
  cancelShipment,
  generateLabel,
  getMode: () => mode,
};
