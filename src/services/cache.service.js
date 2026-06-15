"use strict";

const config = require("../config");
const logger = require("../utils/logger");

/**
 * Cache abstraction. Tries Redis (if enabled and the module is installed),
 * otherwise falls back to a bounded in-memory map. Every method swallows its
 * own errors and degrades to "cache miss" — a cache outage never breaks a
 * request, it just removes the speedup.
 */

const MEM_MAX = 500;
const mem = new Map(); // key -> { value, expiresAt }

let redis = null;
let redisReady = false;

function initRedis() {
  if (!config.redis.enabled) return;
  let IORedis;
  try {
    IORedis = require("ioredis");
  } catch (_) {
    logger.warn("ioredis not installed; using in-memory cache");
    return;
  }
  try {
    redis = new IORedis(config.redis.url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    redis.on("ready", () => {
      redisReady = true;
      logger.info("redis ready");
    });
    redis.on("end", () => (redisReady = false));
    redis.on("error", (err) => {
      redisReady = false;
      logger.warn("redis error; falling back to memory", { err: err.message });
    });
  } catch (err) {
    logger.warn("redis init failed; using in-memory cache", { err: err.message });
  }
}

function memSet(key, value, ttlSec) {
  if (mem.size >= MEM_MAX) {
    // crude LRU: drop oldest insertion
    const oldest = mem.keys().next().value;
    mem.delete(oldest);
  }
  mem.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

function memGet(key) {
  const hit = mem.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    mem.delete(key);
    return null;
  }
  // refresh recency
  mem.delete(key);
  mem.set(key, hit);
  return hit.value;
}

async function get(key) {
  try {
    if (redisReady) {
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
    }
  } catch (err) {
    logger.warn("cache.get redis failed", { err: err.message });
  }
  return memGet(key);
}

async function set(key, value, ttlSec) {
  try {
    if (redisReady) {
      await redis.set(key, JSON.stringify(value), "EX", ttlSec);
      return;
    }
  } catch (err) {
    logger.warn("cache.set redis failed", { err: err.message });
  }
  memSet(key, value, ttlSec);
}

/** Invalidate by prefix (e.g. "product:list:" after a catalog write). */
async function delByPrefix(prefix) {
  try {
    if (redisReady) {
      const stream = redis.scanStream({ match: `${prefix}*`, count: 100 });
      const pipeline = redis.pipeline();
      for await (const keys of stream) keys.forEach((k) => pipeline.del(k));
      await pipeline.exec();
    }
  } catch (err) {
    logger.warn("cache.delByPrefix redis failed", { err: err.message });
  }
  for (const k of mem.keys()) if (k.startsWith(prefix)) mem.delete(k);
}

/**
 * Read-through helper: return cached value or run the loader, cache, return.
 * If the cache layer is down, it transparently just runs the loader.
 */
async function remember(key, ttlSec, loader) {
  const cached = await get(key);
  if (cached !== null && cached !== undefined) return cached;
  const fresh = await loader();
  if (fresh !== null && fresh !== undefined) {
    set(key, fresh, ttlSec).catch(() => {}); // fire-and-forget; don't block response
  }
  return fresh;
}

async function close() {
  try {
    if (redis) await redis.quit();
  } catch (_) {
    /* ignore */
  }
}

initRedis();

module.exports = { get, set, delByPrefix, remember, close, isReady: () => redisReady };
