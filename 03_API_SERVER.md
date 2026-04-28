# Polymarket Whale Watcher — Mobile API Server

This document specifies the **API server** that the Flutter mobile app talks to. It is a separate process from the whale watcher worker (document `02_WHALE_WATCHER_BACKEND.md`), but they share a MongoDB database. This is a build spec for a coding agent. Follow steps in order.

---

## 1. What this service does

The API server is a stateless HTTP + WebSocket service that:

1. Serves a paginated REST feed of whales from MongoDB.
2. Streams new whales to subscribed clients over WebSocket as they happen.
3. Exposes endpoints for market browsing, trade detail, and trader stats.
4. Manages user push-notification preferences (FCM tokens, thresholds, categories).
5. Sends push notifications via Firebase Cloud Messaging when whales cross subscriber thresholds.
6. Authenticates clients (anonymous or signed-in) and rate-limits abuse.

It does **not**:
- Talk to Polymarket (that's the watcher's job).
- Hold private keys, custody funds, or place trades.
- Do any heavy computation — Mongo and Redis do the work.

Statelessness is important: you can run as many instances as you need behind a load balancer. The only state is in MongoDB and Redis.

---

## 2. How it fits with the watcher

```
                      ┌───────────────────────┐
                      │ Whale Watcher (doc 02)│
                      └─────────┬─────────────┘
                                │
              writes ✏        Redis pub/sub ──┐
                ▼                              │
         ┌────────────────┐                   │
         │   MongoDB      │                   │
         └───────┬────────┘                   │
                 │ reads                       │ subscribes
                 ▼                             ▼
         ┌─────────────────────────────────────────┐
         │         API Server (this doc)           │
         │  ┌────────┐  ┌────────┐  ┌───────────┐  │
         │  │  REST  │  │   WS   │  │ FCM push  │  │
         │  └────────┘  └────────┘  └───────────┘  │
         └────────────────┬────────────────────────┘
                          │
                          ▼
                    Mobile clients
```

When a whale is published to Redis by the watcher, every running API instance receives it. Each instance:
1. Forwards it to any of its WebSocket-connected mobile clients whose filter matches.
2. Queries Mongo for users who subscribed to alerts above this whale's USD size and in matching categories, then sends FCM push notifications.

To prevent N instances all sending the same N push notifications, see §8.

---

## 3. Tech stack

| Choice | Version | Why |
|---|---|---|
| Node.js | 22 LTS | Same runtime as watcher, code reuse for shared types |
| TypeScript | 5.6+ | Type safety |
| Fastify | 5+ | Faster than Express, great schema validation, first-class WebSocket support |
| `@fastify/websocket` | 11+ | WebSocket plugin |
| `@fastify/rate-limit` | 10+ | Rate limiting |
| `@fastify/jwt` | 9+ | JWT auth |
| `@fastify/cors` | 10+ | CORS for any web companion |
| `mongodb` (official) | 6+ | Same driver as watcher |
| `ioredis` | 5+ | Redis client |
| `firebase-admin` | 12+ | FCM push notifications |
| `zod` | 3+ | Request/response validation |
| `pino` | 9+ | Structured logging |

We pick **Fastify over Express** because:
- 2-3x faster JSON throughput, which matters for a feed API.
- Built-in JSON-schema validation we'll use heavily.
- Cleaner plugin architecture for keeping endpoints organized.
- WebSocket support is a first-class plugin, not an afterthought.

### Project layout

```
api-server/
├── src/
│   ├── index.ts                    # Boot, signals, plugin registration
│   ├── config.ts                   # Env loading + zod validation
│   ├── logger.ts                   # Pino instance
│   ├── db/
│   │   ├── mongo.ts                # Mongo connection
│   │   └── repos/
│   │       ├── whales_repo.ts      # Read queries against `trades` collection
│   │       ├── markets_repo.ts
│   │       ├── traders_repo.ts
│   │       └── alerts_repo.ts      # CRUD on `alert_subscriptions`
│   ├── redis/
│   │   ├── subscriber.ts           # Subscribes to 'whales' channel
│   │   └── locks.ts                # Distributed lock for FCM dedup
│   ├── auth/
│   │   ├── anonymous.ts            # Anonymous device tokens
│   │   └── jwt.ts                  # JWT issuance + verification
│   ├── routes/
│   │   ├── v1/
│   │   │   ├── whales.ts           # GET /v1/whales, GET /v1/whales/:id
│   │   │   ├── stream.ts           # WS /v1/whales/stream
│   │   │   ├── markets.ts          # GET /v1/markets, GET /v1/markets/:slug
│   │   │   ├── traders.ts          # GET /v1/traders/:wallet
│   │   │   ├── alerts.ts           # POST /v1/alerts/subscribe, DELETE
│   │   │   └── auth.ts             # POST /v1/auth/anonymous
│   │   └── health.ts
│   ├── push/
│   │   ├── fcm.ts                  # Firebase Admin SDK wrapper
│   │   └── dispatcher.ts           # Listens to redis, sends pushes
│   ├── ws/
│   │   ├── hub.ts                  # In-process connection registry
│   │   └── filters.ts              # Match whale → subscribed client filter
│   └── shared/
│       ├── types.ts                # Shared with watcher via npm workspace or copy
│       └── errors.ts               # ApiError class, HTTP error mapping
├── test/
│   └── ... (vitest + supertest)
├── Dockerfile
├── package.json
└── tsconfig.json
```

---

## 4. API surface

All routes are prefixed `/v1`. Versioning is mandatory — the day you regret not having it, it's already too late.

### 4.1 Whales feed

#### `GET /v1/whales`

The mobile app's primary endpoint. Returns the most recent whales matching filters.

**Query params:**

| Name | Type | Default | Notes |
|---|---|---|---|
| `minUsd` | number | 25000 | Inclusive minimum USD size |
| `maxUsd` | number | — | Inclusive maximum |
| `tier` | string | — | `mega`, `large`, `whale`, `mini` |
| `category` | string | — | Single category match |
| `categories` | csv | — | Multiple categories OR'd together |
| `side` | string | — | `BUY` or `SELL` |
| `marketSlug` | string | — | Filter to one market |
| `traderWallet` | string | — | Filter to one trader |
| `cursor` | string | — | Opaque pagination cursor |
| `limit` | int | 50 | Max 100 |

**Response 200:**
```json
{
  "items": [ /* WhaleDto, see below */ ],
  "nextCursor": "eyJ0cyI6MTczNTY4OTYwMCwiaWQiOiJhYmMifQ"
}
```

`WhaleDto` matches the mobile spec (UI doc §6.2) one-for-one. Build it from the Mongo doc by stripping the `raw` field and renaming.

**Pagination is cursor-based**, not offset-based. The cursor is base64-encoded JSON `{ ts: number, id: string }` — used for `WHERE timestamp < ts OR (timestamp = ts AND _id < id)`. Never use offset pagination on a feed that's growing in real time, or users get duplicates.

```typescript
async function getWhales(filter: WhaleFilter, cursor?: Cursor, limit = 50) {
  const q: any = {};
  if (filter.minUsd != null) q.usdSize = { $gte: filter.minUsd };
  if (filter.maxUsd != null) q.usdSize = { ...q.usdSize, $lte: filter.maxUsd };
  if (filter.tier) q.tier = filter.tier;
  if (filter.categories?.length) q['market.category'] = { $in: filter.categories };
  if (filter.side) q.side = filter.side;
  if (filter.marketSlug) q['market.slug'] = filter.marketSlug;
  if (filter.traderWallet) q['trader.proxyWallet'] = filter.traderWallet.toLowerCase();
  if (cursor) q.$or = [
    { timestamp: { $lt: cursor.ts } },
    { timestamp: cursor.ts, _id: { $lt: cursor.id } },
  ];
  const docs = await trades.find(q)
    .sort({ timestamp: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();
  const hasMore = docs.length > limit;
  const items = (hasMore ? docs.slice(0, limit) : docs).map(toWhaleDto);
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ ts: items[items.length-1].timestamp, id: items[items.length-1].id })).toString('base64url')
    : null;
  return { items, nextCursor };
}
```

#### `GET /v1/whales/:id`

Returns a single whale with full enrichment, including up-to-date trader stats.

```json
{
  "id": "...",
  "tier": "mega",
  "side": "BUY",
  "outcome": "YES",
  "usdSize": 487200,
  "shares": 1160952,
  "priceCents": 42,
  "timestamp": 1735689600,
  "market": { /* full market */ },
  "trader": { /* full trader, with vol30d/winRate/tradeCount populated */ },
  "transactionHash": "0x...",
  "polymarketUrl": "https://polymarket.com/event/.../..."
}
```

If `trader.vol30d` is null in the trade doc, the API server should `$lookup` against the `traders` collection to fill it. Cache the joined result in memory for 30 seconds.

#### `WS /v1/whales/stream`

WebSocket endpoint. Client connects, optionally sends a subscribe message, and receives whales as they happen.

**Connect**: `wss://api.polywatch.app/v1/whales/stream`

**Client → server messages** (JSON):
```json
{ "type": "subscribe", "filter": { "minUsd": 50000, "categories": ["Crypto","Politics"] } }
{ "type": "unsubscribe" }
{ "type": "ping" }
```

**Server → client messages** (JSON):
```json
{ "type": "hello", "serverTime": 1735689600 }
{ "type": "whale", "data": { /* WhaleDto */ } }
{ "type": "pong" }
{ "type": "error", "code": "RATE_LIMIT", "message": "..." }
```

A client can re-subscribe to change filters without reconnecting.

**Server → client heartbeat**: server sends `{type:"pong"}` every 20s even without client ping. Disconnect after 60s of silence both ways.

**Connection limits**: max 5 concurrent connections per IP, max 1 active subscription per connection.

### 4.2 Markets

#### `GET /v1/markets`

Browse markets, ordered by 24h volume by default.

Query: `search`, `category`, `active` (default true), `cursor`, `limit`.

#### `GET /v1/markets/:slug`

Single market detail, including current YES/NO prices and recent whales (top 20 from this market in the last 7 days).

### 4.3 Traders

#### `GET /v1/traders/:wallet`

Single trader stats and recent whales.

### 4.4 Alerts

These all require an authenticated request (anonymous or signed-in token, see §5).

#### `POST /v1/auth/anonymous`

Issue an anonymous JWT for a device.

```json
// request
{ "deviceId": "<UUID generated client-side>", "platform": "ios" }
// response
{ "token": "ey...", "userId": "anon_<id>" }
```

#### `POST /v1/alerts/subscribe`

```json
// request (Authorization: Bearer ...)
{
  "fcmToken": "fGdY...",
  "minUsd": 50000,
  "megaOnly": false,
  "categories": ["Crypto","Politics"],
  "quietHours": { "start": "22:00", "end": "07:00", "tz": "America/New_York" }
}
// response: 204
```

Upserts the row in `alert_subscriptions` keyed by `userId + fcmToken`.

#### `DELETE /v1/alerts/subscribe`

Removes the subscription for the current device.

#### `GET /v1/alerts/me`

Returns the current user's subscription state (so the app can hydrate the Alerts screen on launch).

### 4.5 Health

#### `GET /health`

Public, no auth. Returns 200 with `{ ok: true, mongo: true, redis: true }` when healthy. Used by the load balancer.

### 4.6 What we deliberately don't build for v1

- Comments / social.
- User profiles for human users.
- Cross-device sync of favorites (use device-local for now).
- Advanced search (we just do prefix on market title for now).

---

## 5. Authentication

Two tiers:

1. **Anonymous device token** — every device gets one on first launch. Lets us track per-device alert preferences without a real user account.
2. **Signed-in user** (post-v1) — when you add email/social sign-in, upgrade the anonymous token to a real user token. Defer to v2.

### 5.1 Anonymous flow

- Mobile app, on first launch, generates a UUID v4, stores in keychain/keystore.
- Calls `POST /v1/auth/anonymous` with that UUID + platform.
- Server creates a `users` doc with `_id = "anon_<uuid>"` if not exists, returns a JWT.
- JWT TTL = 30 days, refreshed on every successful API call (sliding expiry via response header `X-New-Token` if within 7 days of expiry).

### 5.2 JWT shape

```typescript
{
  "sub": "anon_<uuid>",
  "platform": "ios" | "android",
  "iat": 1735689600,
  "exp": 1738281600,
  "type": "anonymous"
}
```

Sign with HS256 and a 256-bit secret. Rotate the secret quarterly with a 30-day overlap (accept tokens signed by the old secret too during rotation).

### 5.3 Public vs auth endpoints

| Endpoint | Auth required? |
|---|---|
| `GET /v1/whales` | No — feed is public |
| `GET /v1/whales/:id` | No |
| `WS /v1/whales/stream` | No (but rate-limited harder) |
| `GET /v1/markets*` | No |
| `GET /v1/traders/*` | No |
| `POST /v1/auth/anonymous` | No (it's the bootstrap) |
| `*/v1/alerts/*` | Yes |
| `GET /health` | No |

---

## 6. MongoDB collections (this service's reads + writes)

The watcher writes `trades`, `markets`, `traders`. The API server **reads** those, and **writes** to:

### 6.1 `users`

```typescript
{
  _id: string;                // "anon_<uuid>" or "user_<id>" later
  type: 'anonymous' | 'user';
  platform: 'ios' | 'android';
  createdAt: Date;
  lastSeenAt: Date;
}
```

Indexes: `{ lastSeenAt: 1 }` for the cleanup job that deletes inactive anon accounts after 6 months.

### 6.2 `alert_subscriptions`

```typescript
{
  _id: ObjectId;
  userId: string;             // FK → users._id
  fcmToken: string;
  platform: 'ios' | 'android';
  minUsd: number;
  megaOnly: boolean;
  categories: string[];       // empty = all
  quietHours: {
    start: string;            // "22:00"
    end: string;              // "07:00"
    tz: string;               // IANA tz
  } | null;
  createdAt: Date;
  updatedAt: Date;
  lastNotifiedAt: Date | null;
}
```

Indexes:
```typescript
await alertSubscriptions.createIndexes([
  { key: { userId: 1, fcmToken: 1 }, unique: true },
  { key: { fcmToken: 1 } },                         // for cleanup
  { key: { minUsd: 1, categories: 1 } },            // dispatcher fan-out query
]);
```

### 6.3 `notification_log`

```typescript
{
  _id: ObjectId;
  whaleId: string;            // FK → trades._id
  fcmToken: string;
  sentAt: Date;
  result: 'sent' | 'failed';
  errorCode?: string;
}
```

Index: `{ whaleId: 1, fcmToken: 1 }, unique: true`. Used to prevent duplicate sends across instances (see §8.2).

TTL: 7 days (`expireAfterSeconds`).

---

## 7. WebSocket implementation

### 7.1 The hub

Each API server instance maintains an in-memory hub of connected sockets.

```typescript
type ClientEntry = {
  socket: WebSocket;
  filter: WhaleFilter;
  userId: string | null;
  ip: string;
  connectedAt: number;
  lastSeenAt: number;
};

class Hub {
  private clients = new Map<string, ClientEntry>();   // connId → entry

  add(conn: ClientEntry): string { /* generate ID, store, return */ }
  remove(connId: string) { /* close + delete */ }
  broadcast(whale: WhaleDto) {
    for (const [_, c] of this.clients) {
      if (matches(whale, c.filter)) {
        c.socket.send(JSON.stringify({ type: 'whale', data: whale }));
      }
    }
  }
}
```

The hub subscribes to the Redis `whales` channel at startup. Every published whale → `hub.broadcast(whale)`.

### 7.2 Filter matching

Pure function, no I/O:

```typescript
function matches(whale: WhaleDto, f: WhaleFilter): boolean {
  if (f.minUsd != null && whale.usdSize < f.minUsd) return false;
  if (f.maxUsd != null && whale.usdSize > f.maxUsd) return false;
  if (f.side && whale.side !== f.side) return false;
  if (f.tier && whale.tier !== f.tier) return false;
  if (f.categories?.length && !f.categories.includes(whale.market.category ?? '')) return false;
  if (f.marketSlug && whale.market.slug !== f.marketSlug) return false;
  return true;
}
```

### 7.3 Backpressure

If a client's send queue exceeds 100 messages, disconnect them — they're either slow or hostile.

### 7.4 Per-IP limits

- Max 5 concurrent connections per IP.
- Max 100 messages/sec from any single connection (drop and disconnect on excess).

---

## 8. Push notification dispatch

This is the hairiest part. Many subscribers, many whales, multiple API instances. Get it wrong and users get duplicate or missed notifications.

### 8.1 Trigger

The dispatcher subscribes to the same Redis `whales` channel as the WebSocket hub. On each new whale:

```typescript
async function onWhale(whale: WhaleDto) {
  // Find all subscribers who match
  const matching = await alertSubs.find({
    minUsd: { $lte: whale.usdSize },
    $or: [
      { categories: { $size: 0 } },
      { categories: whale.market.category },
    ],
    // megaOnly logic:
    $or: [
      { megaOnly: false },
      { megaOnly: true, ...{} /* and tier === mega */ },
    ],
  }).toArray();

  // ... megaOnly check is easier in code than in mongo
  const targets = matching.filter(s => !s.megaOnly || whale.tier === 'mega');

  for (const sub of targets) {
    if (inQuietHours(sub)) continue;
    await maybeSendPush(whale, sub);
  }
}
```

Mongo's query language doesn't compose OR-of-different-fields nicely for the megaOnly case; doing the filter in code is fine and faster than $expr gymnastics.

### 8.2 Dedup across instances

**Problem**: Three API instances subscribe to Redis. All three receive the same whale. Without coordination, all three try to send the same push to the same user.

**Solution**: write to `notification_log` *before* sending, with a unique index on `(whaleId, fcmToken)`. Whichever instance wins the insert sends the push. Others get `E11000` and skip.

```typescript
async function maybeSendPush(whale: WhaleDto, sub: AlertSubscription) {
  try {
    await notificationLog.insertOne({
      whaleId: whale.id,
      fcmToken: sub.fcmToken,
      sentAt: new Date(),
      result: 'sent',
    });
  } catch (e: any) {
    if (e.code === 11000) return;       // another instance got it
    throw e;
  }
  try {
    await fcm.send(buildMessage(whale, sub));
    await alertSubs.updateOne({ _id: sub._id }, { $set: { lastNotifiedAt: new Date() } });
  } catch (e: any) {
    await notificationLog.updateOne(
      { whaleId: whale.id, fcmToken: sub.fcmToken },
      { $set: { result: 'failed', errorCode: e.code ?? 'unknown' } }
    );
    if (isInvalidTokenError(e)) {
      // token is dead, remove the subscription
      await alertSubs.deleteOne({ _id: sub._id });
    }
  }
}
```

### 8.3 FCM message shape

```typescript
function buildMessage(whale: WhaleDto, sub: AlertSubscription): admin.messaging.Message {
  return {
    token: sub.fcmToken,
    notification: {
      title: `🐋 ${formatUsdShort(whale.usdSize)} ${whale.side} whale`,
      body: `${whale.market.title} · ${whale.outcome} @ ${whale.priceCents}¢`,
    },
    data: {
      type: 'whale',
      tradeId: whale.id,
    },
    apns: {
      payload: { aps: { sound: 'default', 'mutable-content': 1 } },
      headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
    },
    android: {
      priority: 'high',
      notification: { channelId: 'whale_alerts', sound: 'default' },
    },
  };
}
```

### 8.4 Quiet hours

```typescript
function inQuietHours(sub: AlertSubscription): boolean {
  if (!sub.quietHours) return false;
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: sub.quietHours.tz }));
  const mins = local.getHours() * 60 + local.getMinutes();
  const [sh, sm] = sub.quietHours.start.split(':').map(Number);
  const [eh, em] = sub.quietHours.end.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  // Handle overnight ranges (e.g. 22:00 → 07:00)
  if (start <= end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}
```

### 8.5 Rate limiting per user

Even if a user has a low threshold, don't send more than 5 pushes per hour per user. After that, batch into a digest "12 new whales — tap to see".

Track in Redis:
```
INCR push_count:<userId>:<bucket>     EXPIRE 3600
```
where bucket is the hour. If >5, suppress and remember to send a digest at the end of the bucket (or just suppress for v1).

---

## 9. Rate limiting

Use `@fastify/rate-limit` plus a Redis store so limits are global across instances.

| Endpoint | Limit |
|---|---|
| `GET /v1/whales` | 60 req/min per IP |
| `GET /v1/whales/:id` | 120 req/min per IP |
| `GET /v1/markets*` | 60/min per IP |
| `POST /v1/alerts/*` | 10/min per user |
| `POST /v1/auth/anonymous` | 5/min per IP |
| `WS /v1/whales/stream` | 5 concurrent per IP |

Return 429 with `Retry-After` header when hit.

---

## 10. Configuration

`.env.example`:

```
NODE_ENV=production
LOG_LEVEL=info
PORT=3000

# Mongo (same as watcher)
MONGO_URI=mongodb+srv://...
MONGO_DB=polywatch

# Redis (same as watcher)
REDIS_URL=redis://localhost:6379
REDIS_CHANNEL=whales

# Auth
JWT_SECRET=                         # 256-bit base64
JWT_PREVIOUS_SECRET=                # for rotation overlap
JWT_TTL_SECONDS=2592000             # 30 days

# Firebase
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=               # multiline, escape \n

# CORS (allow your web companion if you build one)
CORS_ORIGINS=https://polywatch.app,https://www.polywatch.app

# Push
MAX_PUSHES_PER_USER_PER_HOUR=5
```

---

## 11. Observability

Same standards as the watcher.

- **Pino** structured logs.
- **Sentry** for exceptions.
- **Prometheus** metrics endpoint at `/metrics`:
  - Counter: `http_requests_total{route, status}`
  - Histogram: `http_request_duration_ms{route}`
  - Counter: `ws_connections_total{platform}`
  - Gauge: `ws_connections_active`
  - Counter: `pushes_sent_total{platform, result}`
- **Health probes**:
  - `/health` — basic liveness
  - `/ready` — checks Mongo + Redis connectivity, returns 503 if either is down

---

## 12. Deployment

### 12.1 Dockerfile

```dockerfile
FROM node:22-slim AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 12.2 Where to run

- **Fly.io** with `min_machines_running = 2` for redundancy, autoscale up to 6.
- **Railway** with the API service type, 2+ replicas.
- **AWS ECS Fargate** behind ALB.

Front it with **Cloudflare** for TLS, DDoS protection, and WebSocket support (Cloudflare supports WS natively).

### 12.3 Sticky sessions for WebSocket

WebSocket connections are long-lived, so make sure your load balancer doesn't kill them at random.
- ALB / Cloudflare: idle timeout ≥ 120s.
- App-level: send pongs every 20s to keep the connection warm.

You don't need session affinity (sticky sessions) because WS state is per-connection anyway.

### 12.4 Graceful shutdown

```typescript
process.on('SIGTERM', async () => {
  log.info('shutting down');
  await fastify.close();        // stop accepting new HTTP/WS, drain existing
  await Promise.all([mongo.close(), redis.quit(), redisSub.quit()]);
  process.exit(0);
});
```

Fastify's `close()` waits for in-flight requests but **doesn't** wait for WebSocket connections — manually iterate the hub and call `socket.close(1001, 'server shutdown')` first.

---

## 13. Local development

```bash
# Bring up shared infra (mongo + redis) — same compose file as the watcher
cd ../whale-watcher && docker compose up -d mongo redis

# Run the API
cd ../api-server
npm install
cp .env.example .env
# fill in JWT_SECRET (e.g. `openssl rand -base64 32`)
# fill in Firebase creds (download a service-account JSON from Firebase console)
npm run dev    # tsx --watch src/index.ts
```

For testing without Firebase, set `FIREBASE_PROJECT_ID=mock` and the `fcm` module will log instead of send.

---

## 14. Testing

- **Unit tests** for `matches()`, `inQuietHours()`, cursor encode/decode, JWT issue/verify.
- **Integration tests** with a real local Mongo + Redis:
  - Insert a fixture whale → assert `GET /v1/whales` returns it.
  - Connect a WS client → publish to Redis → assert client receives it.
  - Subscribe alerts → publish a matching whale → assert FCM mock was called once even with 3 simulated instances (test the dedup lock).
- **Load test** (`k6` or `autocannon`) before launch:
  - 1000 concurrent WS connections, each receiving ~10 whales/min, p99 deliver < 500ms.
  - 100 req/s on `GET /v1/whales`, p95 < 100ms.

---

## 15. Security checklist

- [ ] All inputs validated with zod. Reject unknown fields strictly.
- [ ] All Mongo queries use parameterized filters; never construct from raw user input strings.
- [ ] JWT secret is in env, never in code or repo.
- [ ] FCM service-account JSON is in env (or secret manager), never in repo.
- [ ] CORS allow-list is explicit; no `*`.
- [ ] HTTPS only in prod (HSTS header).
- [ ] Rate limits in place on every endpoint.
- [ ] No PII in logs (wallet addresses fine — they're public).
- [ ] FCM tokens treated as secrets — never returned in any GET response.
- [ ] Errors return generic messages externally; full details only in logs.
- [ ] Dependabot or Renovate on for dependency updates.

---

## 16. Cost back-of-the-napkin

Rough monthly cost at 1,000 daily active users:

| Item | Cost |
|---|---|
| MongoDB Atlas M10 | $60 |
| Redis (Upstash) | $10 |
| 2× API instances (Fly shared-cpu-1x 512MB) | $10 |
| 1× watcher instance (same) | $5 |
| Firebase FCM | $0 (free tier covers this) |
| Cloudflare | $0 (free plan) |
| **Total** | **~$85/mo** |

This scales linearly to ~10K DAU before you need to revisit. Mongo will be the first thing to upgrade.

---

## 17. v1 launch checklist

- [ ] All endpoints respond correctly to curl smoke tests.
- [ ] WS roundtrip from watcher → Mongo → API → mobile client works end-to-end in <1s.
- [ ] Push notification arrives on a real device within 5s of the watcher detecting a whale.
- [ ] Dedup verified: spin up 3 API instances, watch only one push fire per (whale, user) pair.
- [ ] Rate limits verified: hammered with `autocannon`, returns 429s as expected.
- [ ] Health and readiness probes correctly reflect Mongo / Redis state.
- [ ] Sentry has captured at least one test error.
- [ ] Deploy is a single `git push` to a tag.

When all boxes are ticked, the API is production-ready, and your mobile app has something solid to point at.
