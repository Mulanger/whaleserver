# Polymarket Whale Watcher — Leaderboard Feature

This is an addendum to the existing system. It adds a **trader leaderboard** to the mobile app, showing the top traders by cash volume over the past 7 days, 30 days, and 365 days. The Markets tab in the bottom nav is replaced by a Leaderboard tab.

This doc is structured so you can hand it to a coding agent piece by piece. It touches all three services (watcher, API, Flutter), but the changes to each are **additive** — none of them break existing behavior.

---

## 1. What you're building

A new tab where users see something like:

```
LEADERBOARD                          [7d] 30d 365d
─────────────────────────────────────────────────
1   whaleking          $2,847,392    312 trades
2   0xA3f2..bd9f       $1,920,118    189 trades
3   Mean-Record        $1,205,003    98 trades
4   Tragic-Decryption    $987,442    245 trades
...
```

Tap a trader → trader detail page showing their recent whale trades, win rate, biggest trades, and a follow button (which adds them to a personal favorites list, surfaced as a filter in the Feed).

This adds three things users want that the Markets tab couldn't deliver:
- **Characters.** Traders become recurring names. "What did Mean-Record do today?"
- **Conviction signals.** Big traders making moves matters more than random whales.
- **A reason to come back daily.** Rankings shift, top traders change.

---

## 2. The architectural problem

Your current system is built around **whale events** — discrete trades that exceed a USD floor. The data model is event-stream-shaped: each trade is a self-contained document with everything needed to display it.

A leaderboard needs the opposite: **aggregations over time** per trader. To rank traders by 30-day volume, you need to sum every trade they made in 30 days — including trades below the whale floor.

Three concrete consequences:

### 2.1 Your watcher currently filters out non-whale trades

The watcher polls Polymarket with `filterAmount=10000` (the `WHALE_USD_FLOOR`). Trades under $10K never reach Mongo. So a trader who did 1,000 trades of $5K each — $5M total volume, very active — would have zero entries in your DB.

**Implication**: To rank by *all* volume, you need to ingest *all* trades. That's a much bigger firehose.

**Mitigation**: We don't need every single trade. We can rank by **volume from trades ≥ a lower floor** (say $1,000). That cuts the data we store by 95%+ vs. unlimited ingest, while still capturing 99% of meaningful volume — most traders' total volume is concentrated in a small number of larger trades.

### 2.2 The 90-day TTL on `trades` will erase leaderboard history

Your watcher spec (doc 02 §6.1) sets:
```typescript
{ key: { ingestedAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 90 }
```

A 365-day leaderboard cannot be computed from a collection that drops data after 90 days.

**Mitigation**: We don't extend the TTL on `trades` — that collection stays focused on whales for the live feed. Instead, we maintain a **separate, lighter collection** of per-trader daily aggregates that we never expire (or expire after 2 years).

### 2.3 Computing leaderboard live is too expensive

Running `db.trades.aggregate([{$match: {timestamp: {$gte: 30daysAgo}}}, {$group: {...}}])` on every leaderboard request would scan tens or hundreds of thousands of documents per request. Slow, expensive, will fall over under load.

**Mitigation**: Pre-aggregate. Compute leaderboard rankings periodically (every few minutes), store the result, serve from cache. The leaderboard doesn't need to be live-real-time — once-a-minute freshness is fine.

---

## 3. What changes in each service (overview)

| Service | Change | Risk to existing system |
|---|---|---|
| **Watcher** | Add a parallel "all trades" pipeline writing to a new `trade_events` collection. Existing whale pipeline untouched. | Low. Same Polymarket API, separate write path. |
| **Watcher** | New periodic job: aggregate `trade_events` → `trader_daily_stats`. | Low. New job, doesn't touch existing ones. |
| **API server** | Add `/v1/leaderboard` and `/v1/traders/:wallet` endpoints. | Low. Read-only against new collection. |
| **API server** | Add a small in-memory cache for leaderboard results. | Low. Standalone. |
| **Mobile app** | Replace Markets tab with Leaderboard tab. New screens. | Low if Markets was already a stub. |

Nothing about whales, alerts, push notifications, or the live feed changes. The leaderboard is a **parallel rail** on the same train tracks.

---

## 4. Data model

Two new MongoDB collections. Both live in the same `polywatch` database as the existing collections.

### 4.1 `trade_events` — every trade above a low floor

This is the "all trades" stream. Document shape:

```typescript
{
  _id: string;                    // synthesized — same SHA1 scheme as whales
  proxyWallet: string;            // lowercase
  pseudonym: string | null;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  usdSize: number;                // size * price
  shares: number;
  priceCents: number;
  conditionId: string;            // market reference
  marketSlug: string;
  category: string | null;
  timestamp: number;              // unix seconds — when the trade happened
  ingestedAt: Date;
  isWhale: boolean;               // true if also in `trades` collection
}
```

Note: this is **lighter** than the `trades` document. No nested market/trader objects, no `raw` field, no enriched stats. Just the fields needed for aggregation.

**Indexes:**
```typescript
await tradeEvents.createIndexes([
  { key: { proxyWallet: 1, timestamp: -1 } },           // per-trader history
  { key: { timestamp: -1 } },                           // recent
  { key: { conditionId: 1, timestamp: -1 } },           // per-market
  { key: { ingestedAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 400 }, // 400-day TTL
]);
```

**Why 400-day TTL**: 365 days for the year-leader window + 35 days of buffer for late aggregations and timezone alignment. Beyond that, we keep the rolled-up aggregates in `trader_daily_stats`, not the raw events.

**Storage estimate**: at $1K floor, expect ~50K trades/day at peak Polymarket activity. ~50K × 400 bytes per doc × 400 days = **~8 GB**. That's well within Atlas M10 ($60/mo). If you later move to M0 free tier you'd need to lower the TTL.

### 4.2 `trader_daily_stats` — pre-aggregated per-trader-per-day

This is the leaderboard's source of truth. One document per (trader, UTC day):

```typescript
{
  _id: string;                    // `${proxyWallet}:${YYYY-MM-DD}`
  proxyWallet: string;            // lowercase
  pseudonym: string | null;       // most recent seen
  date: string;                   // 'YYYY-MM-DD' UTC
  volume: number;                 // sum of usdSize for this day
  tradeCount: number;             // count of trades this day
  buyVolume: number;
  sellVolume: number;
  whaleCount: number;             // how many were ≥ whale floor
  categories: Record<string, number>;  // { Politics: 3200, Crypto: 1500 }
  updatedAt: Date;
}
```

**Indexes:**
```typescript
await traderDailyStats.createIndexes([
  { key: { date: 1, volume: -1 } },                    // leaderboard query
  { key: { proxyWallet: 1, date: -1 } },               // per-trader timeline
]);
```

No TTL on this collection. Documents are small (~300 bytes) and there are at most ~tens of thousands per day. Even after a year that's <1 GB. Keep forever.

### 4.3 Existing collections — unchanged

`trades`, `markets`, `traders`, `users`, `alert_subscriptions`, `notification_log` — **don't touch**. They keep their current shape, indexes, and TTL.

The existing `traders` collection (currently used to cache richer per-trader stats like 30d volume from Polymarket's API) becomes redundant once we have `trader_daily_stats`. Don't delete it yet — just stop using it for new features. Plan to deprecate it in a future cleanup.

---

## 5. Watcher changes

Two new pieces. Both run in the same Node process as the existing watcher loop.

### 5.1 The "all trades" parallel pipeline

The existing watcher polls with `filterAmount=10000`. Add a **second poller** running on its own interval that polls with `filterAmount=1000` and writes to `trade_events` instead of `trades`.

**Why a second poller and not just lower the existing one's floor?** Three reasons:
- The whale pipeline does heavy enrichment (Gamma API lookup, Mongo upserts on `markets`). Doing that for 50K trades/day instead of 5K would 10x your API cost and add latency.
- If we crash the new pipeline, the whale pipeline keeps running. Loose coupling matters.
- We can tune the interval independently. Whale poller: 3s for freshness. Trade events poller: 30s (leaderboards don't need second-fresh data).

**Pseudocode:**

```typescript
// pipeline/all_trades_poller.ts
const TRADE_EVENTS_FLOOR = parseInt(process.env.TRADE_EVENTS_USD_FLOOR ?? '1000');

async function pollAllTrades() {
  const seenInMemory = new LRU<string>({ max: 200_000 });

  while (!shuttingDown) {
    try {
      const raw = await polymarket.getTrades({
        limit: 1000,
        takerOnly: true,
        filterType: 'CASH',
        filterAmount: TRADE_EVENTS_FLOOR,
      });

      const events: TradeEvent[] = [];
      for (const t of raw) {
        const id = synthesizeTradeId(t);   // same fn as whale pipeline
        if (seenInMemory.has(id)) continue;
        seenInMemory.set(id, true);

        const usd = t.size * t.price;
        if (usd < TRADE_EVENTS_FLOOR) continue;

        events.push({
          _id: id,
          proxyWallet: t.proxyWallet.toLowerCase(),
          pseudonym: t.pseudonym || null,
          side: t.side,
          outcome: t.outcome.toUpperCase() as 'YES' | 'NO',
          usdSize: usd,
          shares: t.size,
          priceCents: Math.round(t.price * 100),
          conditionId: t.conditionId,
          marketSlug: t.slug,
          category: null,                       // filled later by daily aggregator
          timestamp: t.timestamp,
          ingestedAt: new Date(),
          isWhale: usd >= WHALE_USD_FLOOR,
        });
      }

      if (events.length) {
        await tradeEvents.bulkWrite(
          events.map(e => ({ insertOne: { document: e } })),
          { ordered: false }
        ).catch(ignoreDuplicateKeyErrors);
        log.info({ inserted: events.length }, 'trade_events batch');
      }
    } catch (e) {
      log.warn({ err: e }, 'all_trades_poller error');
    }

    await sleep(parseInt(process.env.ALL_TRADES_INTERVAL_MS ?? '30000'));
  }
}
```

**Important — dedup with the whale pipeline:**

A trade ≥ $10K will be picked up by *both* pollers. That's fine because:
- They write to different collections (`trades` and `trade_events`).
- The synthesized ID is the same in both, so `trade_events` dedups against itself.
- Setting `isWhale: true` on the trade_events doc lets queries skip a join when needed.

**Ordering of writes**: don't bother coordinating the two pipelines. Eventually consistent is fine — the leaderboard doesn't care if a trade landed in `trade_events` 50ms before or after it landed in `trades`.

### 5.2 The daily aggregator job

Runs every **5 minutes**. Recomputes the daily aggregate for the **current UTC day** and the **previous UTC day** (in case of late-arriving trades around midnight). Older days stay frozen.

```typescript
// jobs/aggregate_daily_stats.ts
async function aggregateDay(dayUtc: string) {
  const start = utcDayStart(dayUtc);              // unix seconds at 00:00 UTC
  const end   = start + 86400;

  const cursor = tradeEvents.aggregate([
    { $match: { timestamp: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: '$proxyWallet',
        pseudonym:  { $last: '$pseudonym' },
        volume:     { $sum: '$usdSize' },
        tradeCount: { $sum: 1 },
        buyVolume:  { $sum: { $cond: [{ $eq: ['$side', 'BUY']  }, '$usdSize', 0] } },
        sellVolume: { $sum: { $cond: [{ $eq: ['$side', 'SELL'] }, '$usdSize', 0] } },
        whaleCount: { $sum: { $cond: ['$isWhale', 1, 0] } },
        // categories aggregation — see note below
      }
    },
  ]);

  const ops = [];
  for await (const doc of cursor) {
    ops.push({
      updateOne: {
        filter: { _id: `${doc._id}:${dayUtc}` },
        update: {
          $set: {
            proxyWallet: doc._id,
            pseudonym: doc.pseudonym,
            date: dayUtc,
            volume: doc.volume,
            tradeCount: doc.tradeCount,
            buyVolume: doc.buyVolume,
            sellVolume: doc.sellVolume,
            whaleCount: doc.whaleCount,
            updatedAt: new Date(),
          }
        },
        upsert: true,
      }
    });
  }
  if (ops.length) await traderDailyStats.bulkWrite(ops, { ordered: false });
}

async function runAggregator() {
  while (!shuttingDown) {
    const today = todayUtc();        // 'YYYY-MM-DD'
    const yesterday = yesterdayUtc();
    try {
      await aggregateDay(yesterday);
      await aggregateDay(today);
      log.info({ today, yesterday }, 'daily aggregates updated');
    } catch (e) {
      log.error({ err: e }, 'aggregator failed');
    }
    await sleep(5 * 60 * 1000);
  }
}
```

**On categories**: aggregating a `Record<string, number>` in Mongo's pipeline is awkward. The simplest approach: skip categories in the daily aggregate v1, add them later if users want category leaderboards. Don't over-engineer this.

**On UTC vs local time**: aggregate strictly in UTC. Don't try to be clever about user timezones. The mobile app can label the leaderboard "Last 7 days" without specifying a boundary, or just show "Updated 2 minutes ago" — users don't care if the boundary is midnight UTC vs midnight local.

### 5.3 Backfilling (one-time)

You'll want some history before launch so the leaderboard isn't empty. Two options:

**Option A — Wait.** Launch the new pollers, then let `trade_events` accumulate for 7 days. The 7d leaderboard is fully accurate after a week. The 30d and 365d leaderboards build up over time.

**Option B — Backfill from Polymarket.** The Data API supports `before=<timestamp>` pagination. You can pull historical trades. Estimated effort: ~30K API calls to backfill 30 days at $1K floor, taking a few hours respecting rate limits. Worth doing if you want a full 30d leaderboard at launch. Not worth doing for 365d — too much data, too brittle, just let it build up.

I recommend **launching with Option A** and just labeling the leaderboard accurately. "Past 7 days · since launch" is a fine label for the first week.

### 5.4 Watcher process — startup wiring

In the watcher's `index.ts`, add the new tasks alongside the existing ones:

```typescript
// existing
startWhalePoller();
startMarketRefreshJob();
startTraderStatsJob();    // optional — can deprecate after leaderboard ships

// new
if (process.env.TRADE_EVENTS_ENABLED === 'true') {
  startAllTradesPoller();
  startDailyAggregator();
}
```

**Gate behind a feature flag** (`TRADE_EVENTS_ENABLED`) for the first deploy. Ship the code, leave it off, verify the existing watcher still runs. Then flip the flag, watch logs, verify the new pipeline works without affecting the whale pipeline. Roll forward only if both are healthy.

---

## 6. API server changes

Two new endpoints. Both read from `trader_daily_stats`. No writes from this service.

### 6.1 `GET /v1/leaderboard`

```
GET /v1/leaderboard?window=7d&limit=50&cursor=
```

Query params:
- `window`: `7d` | `30d` | `365d`. Default `7d`.
- `limit`: 1–100, default 50.
- `cursor`: opaque pagination cursor (rank-based).

Response:
```json
{
  "window": "7d",
  "asOf": 1735689600,
  "items": [
    {
      "rank": 1,
      "proxyWallet": "0xa3f2...",
      "pseudonym": "whaleking",
      "displayName": null,
      "profileImage": null,
      "volume": 2847392.0,
      "tradeCount": 312,
      "whaleCount": 47,
      "topCategory": null
    }
    // ...
  ],
  "nextCursor": "..."
}
```

**Implementation:**

```typescript
async function getLeaderboard(window: '7d' | '30d' | '365d', limit: number, cursor?: number) {
  const days = { '7d': 7, '30d': 30, '365d': 365 }[window];
  const startDate = nDaysAgoUtc(days);

  // Cached result?
  const cached = leaderboardCache.get(window);
  if (cached && cached.expiresAt > Date.now()) return paginate(cached.data, limit, cursor);

  const items = await traderDailyStats.aggregate([
    { $match: { date: { $gte: startDate } } },
    {
      $group: {
        _id: '$proxyWallet',
        pseudonym:  { $last: '$pseudonym' },
        volume:     { $sum: '$volume' },
        tradeCount: { $sum: '$tradeCount' },
        whaleCount: { $sum: '$whaleCount' },
      }
    },
    { $sort: { volume: -1 } },
    { $limit: 500 },                  // cache top 500, paginate from memory
  ]).toArray();

  const ranked = items.map((it, i) => ({ rank: i + 1, ...it }));
  leaderboardCache.set(window, { data: ranked, expiresAt: Date.now() + 60_000 });

  return paginate(ranked, limit, cursor);
}
```

**Cache for 60 seconds in-memory.** The aggregator updates `trader_daily_stats` every 5 minutes — a 1-minute API cache is plenty fresh.

**Pagination is rank-based**: the cursor is just the offset (e.g. `cursor=50` for "give me ranks 51-100"). Encode it as `Buffer.from(String(rank)).toString('base64url')` so it looks consistent with the whale feed cursors.

**For the 365d window**, the aggregation has to scan ~365 × N daily docs. If N (active traders per day) is ~5,000, that's ~1.8M docs. Add an index hint and consider pre-computing 365d weekly:

```typescript
// In a slow path, this is borderline. Optimization: cache for 5 minutes instead of 1, OR
// run a separate "leaderboard_snapshots" job that pre-computes the 365d board hourly.
```

Don't over-engineer this. Profile real query times first, optimize if needed.

### 6.2 `GET /v1/traders/:wallet`

(Already specified in doc 03 §4.3 but never implemented — now you'll actually need it.)

```json
{
  "proxyWallet": "0xa3f2...",
  "pseudonym": "whaleking",
  "displayName": null,
  "profileImage": null,
  "stats": {
    "7d":   { "volume": 2847392, "tradeCount": 312, "whaleCount": 47 },
    "30d":  { "volume": 8234155, "tradeCount": 1090, "whaleCount": 142 },
    "365d": { "volume": 24891003, "tradeCount": 4203, "whaleCount": 521 }
  },
  "recentWhales": [ /* up to 20 from `trades` collection */ ],
  "dailyVolume": [ /* last 30 days, for a sparkline chart in the app */ ]
}
```

`recentWhales` reads from your existing `trades` collection (the whale-only one) — this is where the two collections naturally join. `dailyVolume` is just `trader_daily_stats.find({proxyWallet, date: {$gte: 30daysAgo}}).sort({date: 1})`.

### 6.3 Rate limits

Add these to your existing rate-limit config (doc 03 §9):
- `GET /v1/leaderboard` → 30 req/min per IP (cached, but still don't want abuse)
- `GET /v1/traders/:wallet` → 60 req/min per IP

### 6.4 No WebSocket events for leaderboard

Don't push leaderboard updates over the WebSocket. The leaderboard is poll-on-tab-open, not live. Keep the WebSocket focused on whale events.

---

## 7. Mobile app changes

### 7.1 Replace the Markets tab

In the bottom nav (UI doc §5.1), the order becomes:

```
[ Feed ] [ Leaderboard ] [ Alerts ] [ Profile ]
```

Delete `markets_page.dart` and any market-related routing. Delete `/v1/markets*` clients in the data layer. Keep market metadata on the trade detail screen — that's still useful — but no browse-markets surface.

### 7.2 New file structure

Add a `leaderboard` feature folder mirroring the existing pattern:

```
lib/features/leaderboard/
├── data/
│   ├── leaderboard_dto.dart
│   └── leaderboard_repository.dart
├── domain/
│   └── trader_rank.dart
└── presentation/
    ├── leaderboard_page.dart           # Main tab
    ├── leaderboard_controller.dart
    ├── trader_detail_page.dart         # Tap → /trader/:wallet
    └── widgets/
        ├── trader_row.dart
        ├── window_picker.dart          # 7d / 30d / 365d toggle
        └── trader_sparkline.dart       # Tiny chart on detail screen
```

### 7.3 Leaderboard screen — visual spec

Same dark aesthetic as the rest of the app. Reuse all existing color and typography tokens. Don't introduce new ones.

**Layout top to bottom:**

1. **Status bar** — system.
2. **Header**: microLabel `RANKINGS` over h1 `Leaderboard`. Right side: a 32pt info icon that opens a tooltip explaining "Ranked by USD volume of trades over $1,000 in the selected window."
3. **Window picker** (32pt tall): three pill segments — `7 Days` | `30 Days` | `365 Days`. Single-select. Active pill: `accent` bg, `accentText` color. Inactive: `surfaceMuted` bg, `textSecondary`. 16pt below header.
4. **Trader rows**, list view, 8pt gap between rows. Each row 64pt tall:

```
┌──────────────────────────────────────────────────────┐
│  1   ●  whaleking                                    │
│         312 trades · 47 whales         $2,847,392    │
└──────────────────────────────────────────────────────┘
```

   - Rank (left, 32pt wide column): integer 1-N. Top 3 get a tinted treatment — rank 1 in `buy` color (`#5DCAA5`), rank 2 in `textPrimary`, rank 3 in `#F0997B` (a muted bronze). Rank 4+ in `textMuted`.
   - Avatar (32pt circle): use the same gradient generator as the trade detail screen. If `profileImage` exists, show it; else gradient.
   - Name (bodyEmphasis, textPrimary): pseudonym if present, else short wallet address.
   - Subtitle (caption, textMuted): `{tradeCount} trades · {whaleCount} whales`.
   - Volume (right, metricBig): `$X.XM` or `$XXX,XXX`. Color is `textPrimary` for ranks 4+, `buy` color for rank 1 specifically.

5. **Bottom tab bar** — same as feed, four tabs.

**Empty / loading state**: 10 shimmer rows, same shimmer pattern as the feed.

**Pull-to-refresh**: yes. Bypasses the 60s API cache by sending `?fresh=true` (which the API can ignore for v1 — pull-to-refresh just feels good even when it doesn't do much).

### 7.4 Trader detail screen

Reachable from any leaderboard row OR from any whale card's trader name in the feed.

**Layout:**

1. Status bar + back nav.
2. **Hero block**: avatar (64pt) + pseudonym (h1) + wallet (caption, textMuted, copyable).
3. **Stats row** (3 columns, equal width): 7d volume / 30d volume / 365d volume. Each in microLabel + `metricBig` style. The currently-active leaderboard window's column is highlighted with `buy` color text.
4. **Sparkline**: a 60pt tall mini-chart of daily volume over the last 30 days. Use `fl_chart` package. Single-color line in `buy`, no axes, just visual.
5. **Recent whales section**: heading "RECENT WHALES" microLabel, then 5–10 whale cards (reuse the existing `whale_card.dart` from the feed). Tap → trade detail.
6. **Follow button** (sticky bottom): `accent` bg, full-width primary button, 12pt 500. "Follow trader" / "Unfollow". Adds the trader's wallet to a Hive-stored favorites list.

### 7.5 Follow integration with the Feed

A `Following` filter chip is added to the Feed's filter bar (UI doc §5.1, between size chips and category chips). When selected, the feed shows only whales from followed traders.

This is the leaderboard's payoff into the rest of the app: rankings → discover traders → follow → personalized feed. That's the loop that brings users back.

### 7.6 Routing

Add to `go_router`:
```
/leaderboard
/trader/:wallet
```

Push notifications already deep-link to `/trade/:id`. No changes needed there.

---

## 8. Rollout plan

**Phase 1 — Watcher (low risk):**
1. Deploy watcher with `TRADE_EVENTS_ENABLED=false`. Verify nothing changes.
2. Flip flag to `true` in staging or a test branch. Verify `trade_events` accumulates and the existing whale pipeline keeps running.
3. Verify daily aggregator produces correct `trader_daily_stats` docs (spot-check a few traders' totals manually).
4. Flip flag in production. Let it run for at least 24 hours.

**Phase 2 — API (low risk):**
1. Deploy API server with new `/v1/leaderboard` and `/v1/traders/:wallet` endpoints. Existing endpoints unaffected.
2. Test with curl. Verify response shape, pagination, cache TTL.
3. Run a small load test on `/v1/leaderboard` — 100 req/s should return p95 < 100ms thanks to the cache.

**Phase 3 — Mobile app:**
1. Build the Leaderboard tab and Trader Detail page.
2. Replace the Markets tab in the nav.
3. Ship to TestFlight / Play Internal first. Eat the dogfood for a few days.
4. Promote to production.

**Phase 4 — Follow / Following filter:**
1. Add `Following` chip to feed filters.
2. Add follow button on trader detail.
3. Persist in Hive (and optionally sync to server later).

You can ship phases 1–3 independently. Don't try to do everything at once — each phase has a clean cutoff where you can pause and verify.

---

## 9. What not to do

A few traps to avoid when your coding agent gets ambitious:

- **Don't add a TTL to `trader_daily_stats`.** It's the source of truth for historical leaderboards. Even 2 years of data is small.
- **Don't compute the leaderboard on every request.** Always go through the cache. Mongo aggregations are fine for a once-a-minute cache refresh, not for 100 concurrent requests.
- **Don't move whale ingestion into `trade_events`.** Keep the two pipelines separate. Whales need rich enrichment, the live feed depends on `trades`. Don't merge them "for cleanliness" — you'll regret the coupling.
- **Don't use Polymarket profile images in the leaderboard.** They're stored on Polymarket's S3 and served with non-trivial latency. Use the gradient avatar generator. Only fetch profile images on the trader detail screen, where one-image fetch is acceptable.
- **Don't show "real-time" rank changes.** No "↑3 ranks since yesterday" arrows in v1. They imply more freshness than the data actually has and add UI complexity.
- **Don't build category-specific leaderboards in v1.** "Top trader in Politics this month" is interesting, but it doubles the data pipeline and the screens. Ship the simple case first.

---

## 10. v1 launch checklist

- [ ] `trade_events` accumulating new docs every 30 seconds.
- [ ] `trader_daily_stats` updates every 5 minutes; current and previous day docs are correct.
- [ ] Existing whale pipeline (the `trades` collection) unaffected — same insert rate as before.
- [ ] `GET /v1/leaderboard?window=7d` returns a sorted list with at least 50 entries.
- [ ] `GET /v1/traders/:wallet` returns stats for at least 5 manually-tested traders.
- [ ] Leaderboard screen matches the visual spec.
- [ ] Trader detail screen shows recent whales correctly.
- [ ] Follow button persists to Hive and survives app restart.
- [ ] `Following` filter on the feed only shows whales from followed traders.
- [ ] Mobile app's bottom nav shows Feed / Leaderboard / Alerts / Profile (no Markets).

When all boxes are ticked, the leaderboard is live.
