"use strict";

/**
 * Parses ?page & ?limit with sane caps so a client can never request an
 * unbounded result set (a classic payload/latency trap). Returns skip/limit
 * plus a meta builder for the response envelope.
 */
function getPagination(query, { defaultLimit = 12, maxLimit = 60 } = {}) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  return { page, limit, skip: (page - 1) * limit };
}

function buildMeta({ page, limit, total }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    pages,
    hasNext: page < pages,
    hasPrev: page > 1,
  };
}

module.exports = { getPagination, buildMeta };
