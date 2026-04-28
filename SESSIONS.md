# Sessions

## Session 9 — 2026-04-28

**Task:** Implement Phase 11 (Observability) and Railway deployment config.

**Completed:**
- Created `src/observability.ts` — Sentry initialization and Prometheus metrics
- Added `@sentry/node` and `prom-client` to `package.json`
- Updated `src/config.ts` to add `SENTRY_DSN` env var
- Updated `src/index.ts` — Added Sentry init, request hooks for HTTP metrics, /metrics endpoint
- Updated `src/ws/hub.ts` — Track `ws_connections_total` and `ws_connections_active`
- Updated `src/push/dispatcher.ts` — Track `pushes_sent_total{platform, result}`
- Created `railway.json` — Railway deployment config with 2 replicas, healthcheck at /health
- Updated `.env.example` to include `SENTRY_DSN`

**Observability implemented per spec §11:**
- Pino structured logs ✓
- Sentry for exceptions (optional via SENTRY_DSN) ✓
- Prometheus `/metrics` endpoint ✓
  - `http_requests_total{route, status}`
  - `http_request_duration_ms{route}`
  - `ws_connections_total{platform}`
  - `ws_connections_active`
  - `pushes_sent_total{platform, result}`
- Health probes at `/health` and `/ready` ✓

---

## Session 8 — 2026-04-28

**Task:** Implement Phase 10 (Configuration) from `03_API_SERVER.md`.

**Completed:**
- Created `.env` file with real credentials provided by user
- Created `.gitignore` to exclude `.env`, `node_modules`, `dist`, logs

**Configuration values set:**
- MongoDB: `mongodb+srv://mulen:MtEtY254dExQv95@kevinsdb.sqfdxab.mongodb.net/...`
- Redis: `redis://default:...@switchback.proxy.rlwy.net:24396`
- Firebase: project_id=polymarketwhalewatcher, client_email=firebase-adminsdk-fbsvc@...

**Note:** JWT_SECRET generated and set in .env.

---

## Session 7 — 2026-04-28

**Task:** Implement Phase 9 (Rate Limiting) from `03_API_SERVER.md`.

**Completed:**
- Created `src/redis/rate_limit.ts` — Dedicated Redis client for rate limiting
- Updated `src/index.ts` — Configured `@fastify/rate-limit` with Redis store for global rate limiting across instances
- Updated `src/routes/v1/whales.ts` — GET /: 60/min, GET /:id: 120/min
- Updated `src/routes/v1/markets.ts` — 60/min for all market endpoints
- Updated `src/routes/v1/alerts.ts` — 10/min for POST /subscribe, DELETE /subscribe
- Updated `src/routes/v1/auth.ts` — 5/min for POST /anonymous

**Phase 9 implementation details:**
- Redis store for global rate limiting across all API instances
- Key generator uses x-forwarded-for header (Cloudflare) or request.ip
- Error response: `{ error: 'rate_limit_exceeded', message: '...', retryAfter: '...' }`
- Per-route limits via `config: { rateLimit: { max, timeWindow } }`
- WebSocket rate limiting handled separately in hub (5 concurrent per IP)

---

## Session 6 — 2026-04-28

**Task:** Implement Phase 8 (Push Notification Dispatch) from `03_API_SERVER.md`.

**Completed:**
- Updated `src/db/repos/alerts_repo.ts` — Added `tryInsertNotificationLog()` and `markNotificationFailed()` for MongoDB-based dedup
- Updated `src/push/dispatcher.ts` — Now uses MongoDB's unique index on `(whaleId, fcmToken)` for atomic dedup across instances
- Removed `checkAndSetNotificationLog()` from `src/redis/locks.ts` — Redis-based dedup replaced with MongoDB

**Phase 8 implementation details:**
- Dedup: writes to `notification_log` collection BEFORE sending, catches E11000 to skip if another instance sent
- FCM message shape: title `🐋 $SIZE $SIDE whale`, body `$MARKET · $OUTCOME @ $PRICE¢`
- iOS: apns payload with sound and mutable-content
- Android: priority high, channelId whale_alerts
- Quiet hours: calculated in user's timezone, handles overnight ranges
- Rate limiting: max 5 pushes/hour per user via Redis `push_count` key
- Invalid token handling: deletes subscription on invalid FCM token error

---

## Session 5 — 2026-04-28

**Task:** Implement Phase 7 (WebSocket Implementation) from `03_API_SERVER.md`.

**Completed:**
- Updated `src/ws/hub.ts` — Added per-IP connection limiting (max 5 per IP), message rate limiting (100/sec), IP tracking
- Updated `src/routes/v1/stream.ts` — Real IP extraction from x-forwarded-for or request.ip, integrated rate limiting

**Phase 7 implementation details:**
- Hub tracks connections per IP with `ipCounts` Map
- Max 5 concurrent WebSocket connections per IP (closes with code 1008)
- Max 100 messages/sec per connection (closes with code 1008 on excess)
- Client IP extracted from `x-forwarded-for` header or `request.ip`
- Backpressure: disconnect slow clients that can't keep up

---

## Session 4 — 2026-04-28

**Task:** Implement Phase 6 (MongoDB Collections) from `03_API_SERVER.md`.

**Completed:**
- Created `src/db/indexes.ts` — Index initialization for all API server collections
- Updated `src/index.ts` — Calls `ensureIndexes()` after MongoDB connection

**Indexes created per spec §6:**
- `users.lastSeenAt` — for cleanup job
- `alert_subscriptions.userId + fcmToken` (unique) — subscription upsert
- `alert_subscriptions.fcmToken` — for cleanup
- `alert_subscriptions.minUsd + categories` — dispatcher fan-out query
- `notification_log.whaleId + fcmToken` (unique) — dedup across instances
- `notification_log.sentAt` (TTL 7 days) — automatic old log cleanup

**Note:** MongoDB URI provided by user for local testing.

---

## Session 3 — 2026-04-28

**Task:** Implement Phase 5 (Authentication) from `03_API_SERVER.md`.

**Completed:**
- Updated `src/auth/jwt.ts` — Added `shouldRefreshToken()` function for sliding expiry detection
- Updated `src/index.ts` — JWT secret rotation support with array of [current, previous] secrets
- Updated `src/routes/v1/alerts.ts` — Added `preHandler` hook for sliding expiry with `X-New-Token` header
- Created `src/auth/sliding_expiry.ts` — Sliding expiry utility (not used directly, logic inline in alerts.ts)

**Phase 5 implementation details:**
- JWT TTL = 30 days (2592000 seconds)
- Sliding expiry: `X-New-Token` header added when token is within 7 days of expiry
- JWT secret rotation: accepts both current and previous secret during 30-day overlap period
- `JWT_PREVIOUS_SECRET` env var for rotation overlap

---

## Session 2 — 2026-04-28

**Task:** Implement Step 4 (API surface) from `03_API_SERVER.md`.

**Completed:**
- Fixed `src/routes/health.ts` — `/health` now returns full status `{ ok, mongo, redis }` per spec §4.5
- Fixed `src/routes/v1/stream.ts` — Properly integrated with Hub for WebSocket broadcast
- Fixed `src/routes/v1/markets.ts` — Added Zod validation for query params (search, category, active, cursor, limit)
- Fixed `src/routes/v1/alerts.ts` — Added Zod validation for query params on DELETE and GET /me
- Created `src/fastify.d.ts` — TypeScript declaration for Fastify hub decoration

**Verified implementation against spec:**
- `GET /v1/whales` — cursor-based pagination, base64url cursor encoding, filter params ✓
- `GET /v1/whales/:id` — single whale with trader enrichment ✓
- `WS /v1/whales/stream` — hello/pong/subscribe/unsubscribe/whale/error message types ✓
- `GET /v1/markets` — search, category, active, cursor, limit params ✓
- `GET /v1/markets/:slug` — returns market with recent whales ✓
- `GET /v1/traders/:wallet` — returns trader stats with recent whales ✓
- `POST /v1/auth/anonymous` — returns `{ token, userId }` ✓
- `POST /v1/alerts/subscribe` — 204 on success ✓
- `DELETE /v1/alerts/subscribe` — 204 on success ✓
- `GET /v1/alerts/me` — returns subscription state ✓
- `GET /health` — returns `{ ok, mongo, redis }` ✓

---

## Session 1 — 2026-04-28

**Task:** Set up API server project structure based on `03_API_SERVER.md` (Steps 1-3).

**Completed:**
- Created `api-server/` directory structure
- Created `package.json` with all dependencies (Fastify 5+, Node.js 22 LTS)
- Created `tsconfig.json` with strict TypeScript configuration
- Created `.env.example` with all required environment variables
- Created `Dockerfile` for production deployment
- Created `src/config.ts` — Zod-validated environment configuration
- Created `src/logger.ts` — Pino structured logging
- Created `src/index.ts` — Main entry point with Fastify boot, signal handling, plugin registration
- Created `src/db/mongo.ts` — MongoDB connection management
- Created `src/db/repos/whales_repo.ts` — Whale feed queries with cursor pagination
- Created `src/db/repos/markets_repo.ts` — Market browsing queries
- Created `src/db/repos/traders_repo.ts` — Trader stats queries
- Created `src/db/repos/alerts_repo.ts` — Alert subscription CRUD
- Created `src/redis/subscriber.ts` — Redis subscription to whales channel
- Created `src/redis/locks.ts` — Distributed locks for FCM dedup
- Created `src/auth/anonymous.ts` — Anonymous device user creation
- Created `src/auth/jwt.ts` — JWT issuance and verification
- Created `src/routes/v1/whales.ts` — GET /v1/whales, GET /v1/whales/:id
- Created `src/routes/v1/stream.ts` — WebSocket /v1/whales/stream
- Created `src/routes/v1/markets.ts` — GET /v1/markets, GET /v1/markets/:slug
- Created `src/routes/v1/traders.ts` — GET /v1/traders/:wallet
- Created `src/routes/v1/alerts.ts` — POST/DELETE /v1/alerts/subscribe, GET /v1/alerts/me
- Created `src/routes/v1/auth.ts` — POST /v1/auth/anonymous
- Created `src/routes/health.ts` — GET /health, GET /ready
- Created `src/push/fcm.ts` — Firebase Admin SDK wrapper
- Created `src/push/dispatcher.ts` — Redis listener for push notification dispatch
- Created `src/ws/hub.ts` — WebSocket connection registry
- Created `src/ws/filters.ts` — Whale filter matching
- Created `src/shared/types.ts` — Shared TypeScript interfaces
- Created `src/shared/errors.ts` — ApiError class and error mapping

**Notes:**
- All code follows TypeScript strict mode
- Uses ESM modules with NodeNext resolution
- Fastify 5+ with websocket plugin for WS support
- Zod for runtime validation
- Pino for structured logging
- Redis pub/sub for real-time whale streaming
- FCM push notifications with dedup via notification_log unique index
