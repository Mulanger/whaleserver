# Polymarket Whale Watcher — API Server

Stateless HTTP + WebSocket API server that serves whale data to the mobile app.

## Tech Stack

- Node.js 22 LTS, TypeScript
- Fastify 5 (HTTP framework)
- MongoDB (data store)
- Redis (pub/sub, rate limiting)
- Firebase Cloud Messaging (push notifications)

## Getting Started

### Prerequisites

- Node.js 22+
- MongoDB instance
- Redis instance

### Installation

```bash
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/v1/whales` | Whale feed with filters | No |
| GET | `/v1/whales/:id` | Single whale detail | No |
| WS | `/v1/whales/stream` | Real-time whale stream | No |
| GET | `/v1/markets` | Market list | No |
| GET | `/v1/markets/:slug` | Market detail | No |
| GET | `/v1/market-pages` | Indexable market-page sitemap items | No |
| GET | `/v1/market-pages/:slug` | Enriched market page snapshot | No |
| GET | `/v1/trader-pages` | Indexable trader profile sitemap items | No |
| GET | `/v1/traders/:wallet` | Trader stats | No |
| GET | `/v1/leaderboard` | Windowed whale leaderboard with cached all-time P/L summary fields | No |
| POST | `/v1/auth/anonymous` | Anonymous auth | No |
| POST | `/v1/alerts/subscribe` | Subscribe to alerts | Yes |
| DELETE | `/v1/alerts/subscribe` | Unsubscribe | Yes |
| GET | `/v1/alerts/me` | Get subscription | Yes |
| GET | `/health` | Health check | No |
| GET | `/metrics` | Prometheus metrics | No |

## Alerts + Anonymous Auth Contract

### `POST /v1/auth/anonymous`

Request:

```json
{
  "deviceId": "550e8400-e29b-41d4-a716-446655440000",
  "platform": "ios"
}
```

Allowed `platform` values: `"ios" | "android" | "web" | "unknown"`.

Response `200`:

```json
{
  "token": "<jwt>",
  "userId": "anon_550e8400-e29b-41d4-a716-446655440000"
}
```

### Auth on `/v1/alerts/*`

- Requires `Authorization: Bearer <jwt>`.
- `userId` is derived from JWT `sub`.
- Optional sliding refresh header: `x-new-token`.

### `POST /v1/alerts/subscribe`

Request:

```json
{
  "fcmToken": "<fcm-token>",
  "minUsd": 25000,
  "megaOnly": false,
  "categories": ["Crypto", "Tech"],
  "quietHours": { "start": "22:00", "end": "07:00", "tz": "Europe/Berlin" }
}
```

Notes:
- Upsert key: `(userId, fcmToken)`.
- `fcmToken` can be a mobile app token or a Firebase Web Messaging browser token.
- `categories: []` means all categories.
- `quietHours` is optional.

Response: `204 No Content`.

### `DELETE /v1/alerts/subscribe`

Request body can be empty, or:

```json
{ "fcmToken": "<fcm-token>" }
```

Behavior:
- When `fcmToken` is provided, only that subscription is removed for the current user.
- When omitted/empty body, all subscriptions for the current user are removed.

Response: `204 No Content`.

### `GET /v1/alerts/me`

Response `200`:

```json
{
  "subscription": {
    "fcmToken": "<fcm-token>",
    "minUsd": 25000,
    "megaOnly": false,
    "categories": [],
    "quietHours": null
  }
}
```

If no subscription exists: `404`.

### Push Matching Rules

- Match when `whale.usdSize >= minUsd`.
- If `megaOnly = true`, require `whale.usdSize >= 250000`.
- If `categories` is empty, match all categories; otherwise category must match.
- Respect `quietHours` when provided.
- Push payload includes `data.tradeId = whale.id`.
- Dedupe key: `(whaleId, fcmToken)`.
- Invalid/unregistered FCM tokens are removed.

## Environment Variables

See `.env.example` for all configuration options.

## Deployment

### Railway

```bash
railway up
```

Uses `railway.json` for configuration with 2 replicas.

### Docker

```bash
docker build -t api-server .
docker run -p 3000:3000 --env-file .env api-server
```

## Architecture

```
Whale Watcher → Redis pub/sub → API Server → Mobile App
                    ↓
              MongoDB (reads)
```

The API server subscribes to Redis for real-time whale updates, broadcasts to WebSocket clients, and sends FCM push notifications to subscribed users.

## Market Page SEO Endpoints

`GET /v1/market-pages?indexable=true&limit=250`

Returns qualified market-page sitemap items from `market_page_snapshots`.

`GET /v1/market-pages/:slug`

Returns a precomputed market-page snapshot plus recent whale trades. The collection is populated by the `whale-watcher` market-page snapshot worker. Deploy watcher before relying on these endpoints in production. The website keeps a feed-scan fallback during rollout.

## Trader Page SEO Endpoint

`GET /v1/trader-pages?indexable=true&limit=500`

Returns stable trader profile sitemap items from `trader_page_index`. The collection is populated by the `whale-watcher` trader-page index worker and intentionally keeps wallets after they fall out of the live leaderboard so discovered `/trader/:wallet` URLs remain stable.

## Leaderboard Profit Fields

`GET /v1/leaderboard?window=1d|7d|30d|365d&limit=50` returns the normal windowed volume/trade-count leaderboard and enriches each cached row with all-time resolved P/L fields from `trade_outcomes` when available:

- `allTimeProfitUsd`: sum of resolved BUY-trade `pnlUsd`.
- `allTimeProfitKnown`: true when at least one resolved P/L trade exists.
- `allTimePnlTradeCount`: count of resolved BUY trades included in the P/L sum.
- `recentFormResults`: latest five resolved BUY trade results as `W`/`L`, newest first.
- `recentFormWinRatePct`: win percentage across `recentFormResults`.

These fields are computed once per API leaderboard cache refresh, not by every browser visitor.
