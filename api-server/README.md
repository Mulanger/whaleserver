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
| GET | `/v1/traders/:wallet` | Trader stats | No |
| POST | `/v1/auth/anonymous` | Anonymous auth | No |
| POST | `/v1/alerts/subscribe` | Subscribe to alerts | Yes |
| DELETE | `/v1/alerts/subscribe` | Unsubscribe | Yes |
| GET | `/v1/alerts/me` | Get subscription | Yes |
| GET | `/health` | Health check | No |
| GET | `/metrics` | Prometheus metrics | No |

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