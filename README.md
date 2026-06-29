# Decor N Art — Backend

Node.js + Express + MongoDB backend for the Decor N Art bouquet e-commerce site.
Built as a **fault-isolated modular monolith**: one runnable service, but every
domain is a self-contained module (`model` + `validation` + `service` +
`controller` + `routes`) that can be lifted into its own microservice later
without touching the others.

## Why a modular monolith (not microservices yet)

Your stated requirement was *"if 1 API fails the others must not fail."* That is
a **fault-isolation** property, not a deployment-topology one — and it's enforced
here inside a single process (details below). A single service is also what
"complete backend, one thing I can run" implies. Each domain folder is cleanly
separable, so splitting into real services + a broker later is a lift, not a
rewrite. Say the word and I'll do that split.

## Fault isolation — how one failing API can't take down the rest

| Layer | Mechanism |
|---|---|
| Per-route | `utils/asyncHandler.js` wraps every controller — any throw/reject is funneled to the central handler as a clean response for **that request only**. |
| Central handler | `middleware/errorHandler.js` normalises Mongoose/JWT/Zod/Mongo-dup/DB-down errors and **always** responds. Nothing leaks or hangs. |
| DB outage | `config/db.js` never crashes on connect failure; queries fast-fail (`bufferTimeoutMS`) and map to a clean **503** for DB-backed routes. Health + cached reads keep serving. |
| Module load | `app.js` mounts each router in a `try/catch` — a broken module serves a 503 stub; the rest of the API still boots. |
| Cache | `services/cache.service.js` — Redis with in-memory fallback; a cache outage just removes the speedup. |
| Payments | `services/payment.service.js` — circuit breaker + mock mode; Razorpay down → 503 on **/orders** only. |
| Email | `services/email.service.js` — fire-and-forget; SMTP down never fails the order/contact request. |
| Slow handler | `middleware/timeout.js` — per-request timeout so one stuck route can't tie up the server. |
| Last resort | `server.js` — `unhandledRejection`/`uncaughtException` guards log instead of silently dying; graceful shutdown on SIGINT/SIGTERM. |

Verified locally with **no Mongo and no Redis running**: server boots, `/health`
responds, validation → clean 400, unknown route → clean 404, DB-backed route →
clean 503, and `/health` keeps working after the failing call. The process never
crashed.

## Performance defaults (baked in)

- Compound + text indexes on the catalog (`status+category+price`, text on
  `name+description`); unique indexes where they matter.
- `.lean()` reads, `select()` projections, parallel `count + find` (no waterfall).
- Batched `$in` hydration for cart/wishlist (**no N+1**).
- Read-through Redis cache on product list/detail with prefix invalidation on writes.
- Pagination capped (`limit` ≤ 60) so no unbounded payloads.
- HTTP `Cache-Control` + `stale-while-revalidate` on public reads.
- Mongo connection pooling (`maxPoolSize`), `compression`, atomic
  `$addToSet`/`$inc`/`$pull` updates to avoid read-modify-write races.

## Project structure

```
src/
├── app.js                  # express assembly, independent router mounting, /health
├── config/                 # env (validated) + db (non-crashing connect)
├── middleware/             # auth, validate, rateLimit, timeout, requestContext, errorHandler
├── utils/                  # ApiError, ApiResponse, asyncHandler, safeCall, paginate, logger
├── services/               # cache (redis+fallback), payment (razorpay+breaker), email (best-effort)
├── seed/                   # seed.js + products.seed.json (matches the Phase-1 UI shape)
└── modules/
    ├── auth/  product/  cart/  order/
    └── wishlist/  review/  newsletter/  contact/
server.js                   # entry: boot, process guards, graceful shutdown
```

## Run

```bash
cp .env.example .env        # set JWT_SECRET; defaults work for local dev
npm install
npm run seed                # load the 16-product catalog (needs Mongo up)
npm run dev                 # or: npm start
```

Mongo is expected at `mongodb://127.0.0.1:27017/Decor N Art` by default. Redis,
Razorpay and email are **optional** — disabled in `.env.example`, the app
degrades gracefully without them (mock payment, in-memory cache, no-op email).

## API (base: `/api/v1`)

Every response is `{ success, data, meta? }` or `{ success:false, error:{ code, message, details?, requestId } }`.

**Auth** — `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` ·
`POST /auth/logout` · `GET /auth/me` · `POST /auth/addresses`

**Products** — `GET /products` (filters: `category, occasion, minPrice, maxPrice,
sort, q, bestseller, page, limit`) · `GET /products/:slug` · `GET /products/:slug/related`

**Cart** (user or guest via `x-cart-id` header) — `GET /cart` ·
`POST /cart/items` · `PATCH /cart/items/:productId` · `DELETE /cart/items/:productId` ·
`POST /cart/promo`

**Orders** (auth) — `POST /orders` (creates from cart + payment order) ·
`POST /orders/verify` · `GET /orders` · `GET /orders/:id`

**Wishlist** (auth) — `GET /wishlist` · `POST /wishlist/items` · `DELETE /wishlist/items/:productId`

**Reviews** — `GET /reviews/product/:productId` · `POST /reviews/product/:productId` (auth)

**Newsletter** — `POST /newsletter/subscribe`

**Contact** — `POST /contact`

**Health** — `GET /health` (reports db/cache/payment mode; works even when DB is down)

## Notes / tradeoffs

- Totals (subtotal, GST 5%, shipping, promo) are computed **server-side** in
  `cart.service.js` — the client can't tamper with prices.
- DB-down reads fail in ~4s (the `bufferTimeoutMS` ceiling) so brief reconnect
  blips still succeed; in production a load balancer should pull an instance via
  `/health`. Lower `bufferTimeoutMS` for instant fail if you prefer.
- Razorpay signature verification is timing-safe. In mock mode it accepts so the
  checkout UI works end-to-end without live keys.
- Email/queueing is direct + best-effort here; swap for a RabbitMQ/BullMQ worker
  in production (the call site is already isolated via `safeCall`).
