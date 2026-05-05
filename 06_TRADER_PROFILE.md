# Polymarket Whale Watcher — Trader Profile Feature

This is an addendum to the existing system. It adds **Trader Profile pages** — when a user taps any trader's name (in the feed, in the leaderboard, anywhere) they're taken to a dedicated profile screen showing that trader's avatar, stats, recent whales, and a follow button.

This doc assumes the **Leaderboard feature** (`05_LEADERBOARD.md`) is already specified or implemented. The trader profile shares a lot of infrastructure with the leaderboard — same data sources, same domain models. If you're building both, build them together.

This is a build spec for a coding agent. Follow steps in order.

---

## 1. What this adds

A new screen reachable from anywhere a trader's name or wallet appears:

- **From the Feed**: tap the trader name on a whale card → trader profile.
- **From the Leaderboard**: tap any row → trader profile.
- **From a Trade Detail page**: tap the trader card → trader profile.
- **Via direct URL** (deep link / push notification target): `/trader/:wallet`.

The profile shows:
- Avatar (real Polymarket profile image if present, else gradient).
- Pseudonym + shortened wallet address (copyable).
- A "rank badge" if the trader is in the top 100 of any leaderboard window.
- Three stat cards: 7-day volume, 30-day volume, 365-day volume.
- A 30-day daily-volume sparkline chart.
- The trader's most recent whale trades (5–10).
- A primary "Follow trader" button.
- A share button.

This is intentionally a **read-only character page**, like a Twitter profile minus the tweets. No comments, no DMs, no portfolio holdings (Polymarket doesn't give us reliable PnL, so we don't fake it).

---

## 2. Why this is its own doc

The Leaderboard doc (`05_LEADERBOARD.md`) already specifies a "Trader Detail" page in §7.4. So why a separate doc?

Two reasons:

1. **The trader profile is reachable from many entry points, not just the leaderboard.** That changes how it's built: it's not a leaderboard sub-screen, it's a first-class destination in the routing tree. Worth treating as its own feature so the agent doesn't bury it inside `features/leaderboard/`.

2. **It introduces a new piece of infrastructure: the follow system.** Following traders is a small but real cross-cutting concern that touches the API server (new endpoints), Mongo (new collection), and the mobile app (Hive storage + new feed filter). This deserves its own architectural treatment.

If `05_LEADERBOARD.md` and this doc seem to overlap on the trader detail screen — they do. **This doc is the source of truth for the trader profile.** The leaderboard doc's §7.4 should be treated as a stub that this doc replaces.

---

## 3. What changes in each service (overview)

| Service | Change | Risk to existing system |
|---|---|---|
| **Watcher** | None. | Zero. |
| **API server** | Beef up `/v1/traders/:wallet` with full profile data. Add `/v1/users/me/follows` endpoints (POST, DELETE, GET). | Low — new endpoints, no schema changes to existing collections. |
| **API server** | Add `trader_follows` collection. | Low — new collection, indexed, no joins to anything fragile. |
| **Mobile app** | New `trader_profile` feature folder. New routing entry. New "Following" filter chip on the feed. | Low — additive. |

The watcher doesn't need any changes. Trader profile data is already being collected (via `trader_daily_stats` from the leaderboard pipeline, plus `trades` for recent whales, plus `pseudonym`/`profileImage` from Polymarket on every trade).

---

## 4. Data model

### 4.1 Reusing existing collections

The trader profile reads from collections that already exist:

| Collection | Used for |
|---|---|
| `trader_daily_stats` | 7d/30d/365d volume aggregates, sparkline data |
| `trades` | Recent whale trades for the "Recent Whales" section |
| `trade_events` (lighter) | If you want to show non-whale activity counts (optional) |

**No schema changes** to any of these.

### 4.2 New collection: `trader_follows`

One document per (user, followed-trader) edge:

```typescript
{
  _id: ObjectId;
  userId: string;           // FK → users._id (e.g. "anon_<uuid>")
  proxyWallet: string;      // lowercase
  createdAt: Date;
}
```

**Indexes:**
```typescript
await traderFollows.createIndexes([
  { key: { userId: 1, proxyWallet: 1 }, unique: true, name: 'idx_follows_user_wallet' },
  { key: { userId: 1, createdAt: -1 }, name: 'idx_follows_user_recent' },
  { key: { proxyWallet: 1 }, name: 'idx_follows_wallet' },   // for "N people follow this trader"
]);
```

The unique index prevents double-follows. The composite `userId + createdAt` index supports listing a user's follows ordered by when they followed (most recent first). The `proxyWallet`-only index supports counting followers per trader if you ever want that.

**No TTL.** Follows persist until the user unfollows. If you want to clean up after a user goes inactive for 6+ months, do that as a separate cleanup job tied to `users.lastSeenAt`.

### 4.3 What we explicitly don't store

- **Follower notifications** ("X is now following you") — not a thing in this app. Traders don't have accounts here.
- **Follow counts on the trader profile** — for v1, don't show "47 people follow this trader." It introduces social pressure dynamics that aren't aligned with the app's purpose. Maybe later.
- **Trader-blocked-by-user** — out of scope.
- **Curated trader lists** — out of scope.

Keep it small.

---

## 5. API server changes

### 5.1 Replace `GET /v1/traders/:wallet`

The doc 03 spec for this endpoint was a stub. Here's the real shape:

```
GET /v1/traders/:wallet
```

Auth: optional. If a JWT is present, the response includes `isFollowing`. If not, that field is omitted.

Response 200:
```json
{
  "proxyWallet": "0xa3f2bd9f...",
  "shortAddress": "0xa3f2..bd9f",
  "pseudonym": "whaleking",
  "displayName": null,
  "profileImage": "https://polymarket-upload.s3.us-east-2.amazonaws.com/...",
  "bio": null,
  "firstSeen": 1735689600,
  "rankBadge": {
    "window": "7d",
    "rank": 1
  },
  "stats": {
    "7d":   { "volume": 2847392.0, "tradeCount": 312, "whaleCount": 47, "buyVolume": 1820000, "sellVolume": 1027392 },
    "30d":  { "volume": 8234155.0, "tradeCount": 1090, "whaleCount": 142, "buyVolume": 5100000, "sellVolume": 3134155 },
    "365d": { "volume": 24891003.0, "tradeCount": 4203, "whaleCount": 521, "buyVolume": 14000000, "sellVolume": 10891003 }
  },
  "dailyVolume": [
    { "date": "2026-04-01", "volume": 142000 },
    { "date": "2026-04-02", "volume": 89000 },
    /* ...28 more entries... */
  ],
  "recentWhales": [
    { /* WhaleDto, full shape */ },
    /* ...up to 10... */
  ],
  "isFollowing": false
}
```

Response 404 if the wallet has never appeared in any trade in your DB. The mobile app should handle this with a "Trader not found" empty state — it's rare but possible if someone shares a deep link to a trader you've never seen.

**Implementation:**

```typescript
// db/repos/traders_repo.ts (new or expanded)
async function getTraderProfile(
  proxyWallet: string,
  currentUserId: string | null
): Promise<TraderProfile | null> {
  const wallet = proxyWallet.toLowerCase();

  // Parallelize all reads
  const [stats7d, stats30d, stats365d, dailyVolume, recentWhales, latestTrade, isFollowing, rankBadge] =
    await Promise.all([
      aggregateStatsForWindow(wallet, 7),
      aggregateStatsForWindow(wallet, 30),
      aggregateStatsForWindow(wallet, 365),
      getDailyVolume(wallet, 30),
      getRecentWhales(wallet, 10),
      getLatestTradeForWallet(wallet),  // for pseudonym, profileImage
      currentUserId ? isUserFollowing(currentUserId, wallet) : Promise.resolve(undefined),
      getRankBadge(wallet),
    ]);

  if (!latestTrade) return null;  // unknown trader

  return {
    proxyWallet: wallet,
    shortAddress: shortAddr(wallet),
    pseudonym: latestTrade.trader?.pseudonym ?? null,
    displayName: latestTrade.trader?.displayName ?? null,
    profileImage: latestTrade.trader?.profileImage ?? null,
    bio: null,  // Polymarket has bios but they're often empty/stale; skip for v1
    firstSeen: await getFirstSeenTimestamp(wallet),
    rankBadge,
    stats: { '7d': stats7d, '30d': stats30d, '365d': stats365d },
    dailyVolume,
    recentWhales,
    isFollowing,
  };
}
```

**Helper queries:**

```typescript
async function aggregateStatsForWindow(wallet: string, days: number): Promise<TraderStats> {
  const startDate = nDaysAgoUtc(days);
  const result = await traderDailyStats.aggregate([
    { $match: { proxyWallet: wallet, date: { $gte: startDate } } },
    {
      $group: {
        _id: null,
        volume:     { $sum: '$volume' },
        tradeCount: { $sum: '$tradeCount' },
        whaleCount: { $sum: '$whaleCount' },
        buyVolume:  { $sum: '$buyVolume' },
        sellVolume: { $sum: '$sellVolume' },
      }
    },
  ]).toArray();
  return result[0] ?? { volume: 0, tradeCount: 0, whaleCount: 0, buyVolume: 0, sellVolume: 0 };
}

async function getDailyVolume(wallet: string, days: number) {
  const startDate = nDaysAgoUtc(days);
  return traderDailyStats
    .find({ proxyWallet: wallet, date: { $gte: startDate } })
    .project({ date: 1, volume: 1, _id: 0 })
    .sort({ date: 1 })
    .toArray();
}

async function getRecentWhales(wallet: string, limit: number) {
  return trades
    .find({ 'trader.proxyWallet': wallet })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray()
    .then(docs => docs.map(toWhaleDto));
}

async function getLatestTradeForWallet(wallet: string) {
  // Used to fetch the most recent pseudonym/profileImage/displayName
  return trades.findOne(
    { 'trader.proxyWallet': wallet },
    { sort: { timestamp: -1 } }
  );
}

async function getRankBadge(wallet: string): Promise<{ window: string; rank: number } | null> {
  // Check leaderboard cache (hot path - already computed every minute)
  for (const window of ['7d', '30d', '365d'] as const) {
    const cached = leaderboardCache.get(window);
    if (!cached) continue;
    const idx = cached.data.findIndex(t => t.proxyWallet === wallet);
    if (idx !== -1 && idx < 100) {
      return { window, rank: idx + 1 };
    }
  }
  return null;
}
```

**Caching:** wrap the entire `getTraderProfile` in a 30-second per-wallet cache. Most users will tap the same trader multiple times (going back and forth from feed → profile → feed). 30 seconds is short enough that stats stay fresh.

```typescript
const traderProfileCache = new LRUCache<string, { data: TraderProfile; expiresAt: number }>({ max: 1000 });

async function getCachedTraderProfile(wallet: string, userId: string | null) {
  const cacheKey = `${wallet}:${userId ?? 'anon'}`;
  const cached = traderProfileCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const data = await getTraderProfile(wallet, userId);
  if (data) {
    traderProfileCache.set(cacheKey, { data, expiresAt: Date.now() + 30_000 });
  }
  return data;
}
```

Note the cache key includes the userId — because `isFollowing` differs per user. Two users hitting the same trader profile get separately cached results. That's fine, the LRU max=1000 absorbs it.

### 5.2 New endpoints: follow management

#### `POST /v1/users/me/follows`

Auth: required (JWT).

```json
// request
{ "proxyWallet": "0xa3f2..." }
// response 204
```

Implementation:
```typescript
fastify.post('/me/follows', { preHandler: authMiddleware }, async (request, reply) => {
  const userId = request.user.sub;
  const { proxyWallet } = followBodySchema.parse(request.body);
  const wallet = proxyWallet.toLowerCase();

  // Verify the wallet has been seen at least once (don't let users follow random strings)
  const exists = await trades.countDocuments({ 'trader.proxyWallet': wallet }, { limit: 1 });
  if (!exists) return reply.status(404).send({ error: 'trader not found' });

  await traderFollows.updateOne(
    { userId, proxyWallet: wallet },
    { $setOnInsert: { userId, proxyWallet: wallet, createdAt: new Date() } },
    { upsert: true }
  );

  // Bust the trader profile cache for this user so isFollowing flips
  traderProfileCache.delete(`${wallet}:${userId}`);

  return reply.status(204).send();
});
```

#### `DELETE /v1/users/me/follows/:wallet`

Auth: required.

```
DELETE /v1/users/me/follows/0xa3f2...
→ 204
```

```typescript
fastify.delete('/me/follows/:wallet', { preHandler: authMiddleware }, async (request, reply) => {
  const userId = request.user.sub;
  const wallet = (request.params.wallet as string).toLowerCase();

  await traderFollows.deleteOne({ userId, proxyWallet: wallet });
  traderProfileCache.delete(`${wallet}:${userId}`);

  return reply.status(204).send();
});
```

#### `GET /v1/users/me/follows`

Auth: required. Returns the list of traders the user follows.

```json
{
  "items": [
    {
      "proxyWallet": "0xa3f2...",
      "pseudonym": "whaleking",
      "profileImage": "...",
      "vol7d": 2847392,
      "followedAt": 1735689600
    }
  ]
}
```

```typescript
fastify.get('/me/follows', { preHandler: authMiddleware }, async (request, reply) => {
  const userId = request.user.sub;

  const follows = await traderFollows
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();

  if (follows.length === 0) return reply.send({ items: [] });

  const wallets = follows.map(f => f.proxyWallet);

  // Pull pseudonyms + profile images from latest trade per wallet
  const profiles = await trades.aggregate([
    { $match: { 'trader.proxyWallet': { $in: wallets } } },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$trader.proxyWallet',
        pseudonym: { $first: '$trader.pseudonym' },
        profileImage: { $first: '$trader.profileImage' },
      }
    },
  ]).toArray();
  const profileByWallet = new Map(profiles.map(p => [p._id, p]));

  // Pull 7d volume per wallet from cache or aggregation
  const startDate = nDaysAgoUtc(7);
  const vols = await traderDailyStats.aggregate([
    { $match: { proxyWallet: { $in: wallets }, date: { $gte: startDate } } },
    { $group: { _id: '$proxyWallet', vol7d: { $sum: '$volume' } } },
  ]).toArray();
  const volByWallet = new Map(vols.map(v => [v._id, v.vol7d]));

  return reply.send({
    items: follows.map(f => ({
      proxyWallet: f.proxyWallet,
      pseudonym: profileByWallet.get(f.proxyWallet)?.pseudonym ?? null,
      profileImage: profileByWallet.get(f.proxyWallet)?.profileImage ?? null,
      vol7d: volByWallet.get(f.proxyWallet) ?? 0,
      followedAt: Math.floor(f.createdAt.getTime() / 1000),
    })),
  });
});
```

### 5.3 Modify `GET /v1/whales` to support `following=true`

When the user has the "Following" filter chip selected on the feed, the request looks like:

```
GET /v1/whales?following=true&limit=50
```

The API server:
1. Looks up the user's follows.
2. Filters whales to only those whose `trader.proxyWallet` matches a followed wallet.

```typescript
// Inside the existing /v1/whales handler:
if (q.following === 'true') {
  if (!request.user) return reply.status(401).send({ error: 'auth required for following filter' });
  const followedWallets = await traderFollows
    .find({ userId: request.user.sub })
    .project({ proxyWallet: 1, _id: 0 })
    .toArray()
    .then(rows => rows.map(r => r.proxyWallet));
  if (followedWallets.length === 0) {
    return reply.send({ items: [], nextCursor: null });
  }
  filter.traderWallets = followedWallets;
}
```

And in the whales repo:
```typescript
if (filter.traderWallets) {
  q['trader.proxyWallet'] = { $in: filter.traderWallets };
}
```

Cap the followed wallets list at 500 in case someone follows more than that — the `$in` query gets slow above ~1000 entries. If you ever hit that, the right fix is to denormalize a `followedBy` array onto each whale doc, but that's a v2 problem.

### 5.4 WebSocket: filter pushed whales by following

Same logic for the `/v1/whales/stream` WebSocket. When a client sends:

```json
{ "type": "subscribe", "filter": { "following": true } }
```

The server resolves the user's follow list once per subscribe, stores it in the connection's filter state, and only broadcasts whales from those wallets. When the user follows/unfollows, the client should re-send a subscribe message to refresh.

### 5.5 Rate limits

- `GET /v1/traders/:wallet` → 60/min per IP (cached, but still don't want abuse).
- `POST /v1/users/me/follows` → 30/min per user.
- `DELETE /v1/users/me/follows/:wallet` → 30/min per user.
- `GET /v1/users/me/follows` → 60/min per user.

---

## 6. Mobile app changes

### 6.1 New file structure

```
lib/features/trader_profile/
├── data/
│   ├── trader_profile_dto.dart
│   ├── trader_profile_repository.dart
│   └── follows_repository.dart           # Hive + server sync
├── domain/
│   └── trader_profile.dart
└── presentation/
    ├── trader_profile_page.dart          # Main screen
    ├── trader_profile_controller.dart
    └── widgets/
        ├── trader_hero_block.dart        # Avatar + name + rank badge
        ├── trader_stats_grid.dart        # 3-column stat cards
        ├── trader_sparkline.dart         # 30d daily volume chart
        ├── trader_recent_whales.dart     # List of mini whale cards
        └── follow_button.dart            # The primary CTA
```

### 6.2 Routing

In `core/routing/app_router.dart`, add:

```dart
GoRoute(
  path: '/trader/:wallet',
  pageBuilder: (context, state) => MaterialPage(
    fullscreenDialog: false,
    child: TraderProfilePage(wallet: state.pathParameters['wallet']!),
  ),
),
```

This is a **pushed page**, not a tab. Reachable from anywhere via `context.push('/trader/0xabc...')`.

### 6.3 Visual spec

Refer to the mockup. Same dark aesthetic, same color tokens, same type scale. No new design primitives.

**Layout top to bottom:**

1. **Status bar** — system.
2. **Top nav** (height 44pt): back arrow (left, 16pt) + centered "Trader" caption + share icon (right, 14pt).
3. **Hero block**, centered, 18pt below nav:
   - Avatar (64pt circle). Real `profileImage` if present, else gradient generated from wallet bytes (same `avatarGradient()` function from UI doc §6.4).
   - Pseudonym (h2 — 18pt 500, `textPrimary`), 10pt below avatar.
   - Wallet line (caption, `textMuted`): `"0xA3f2..bd9f · copy"` — the "copy" is tappable; tap copies full address to clipboard, fires a brief info toast "Address copied".
   - **Rank badge** (only if user is in top 100 of any leaderboard window): a small pill, 8pt below wallet. `buyTint` bg, `buy` text, 9pt 500 letter-spacing 0.3px. Format: `"RANK #1 · 7D"` for top-3 in any window, `"TOP 100 · 7D"` for ranks 4-100. Pick the *best* window if the trader appears in multiple.
4. **Stats grid** (3 equal-width columns, 6pt gap between, 14pt below hero):
   - Each card: 12pt radius, 10pt padding, surface bg, surfaceBorder.
   - Top: microLabel uppercase ("7D VOL", "30D VOL", "365D VOL").
   - Bottom: `metricSmall` style (14pt 500, `textPrimary`) showing dollar amount.
   - **The "active" card** — the one matching the leaderboard window the user came from (or 7D by default) — gets a green tinted bg (`buyTint`), green border (`rgba(29,158,117,0.25)`), and green value text (`buy`).
5. **Sparkline card**, 14pt below stats:
   - Same surface styling as stats cards.
   - Header row: "30D DAILY VOLUME" microLabel left, delta indicator right ("↗ +18%" in `buy` color if positive, "↘ -12%" in `sell` color if negative). Delta is computed as: (last 7d total volume) vs (the 7d before that) percentage change.
   - Chart: 50pt tall SVG line chart. Use `fl_chart` package's `LineChart`. Single line in `buy` color, 1.5pt stroke. Subtle gradient fill below the line from `buy@30%` to `buy@0%`. No axis labels, no grid, no tooltips on tap (keep it visual-only). Empty days (no trades) drop to 0.
6. **"Recent Whales" section**, 14pt below sparkline:
   - microLabel "RECENT WHALES" (no card, just text), 8pt below.
   - 5 mini whale cards (smaller variant of the feed whale card):
     - Same 12pt radius, surface bg, surfaceBorder.
     - 10pt vertical, 12pt horizontal padding.
     - Top row: side label (BUY/SELL) + time elapsed + dollar amount on the right.
     - Below: market title, single line, ellipsized.
     - Tap → push `/trade/:id`.
7. **Action row** (sticky at bottom of scrollable area, NOT bottom of screen — let it scroll):
   - Primary button (flex 1): `+ Follow trader` / `✓ Following`. Toggle. Same primary button style as Trade Detail screen — `accent` bg, `accentText`, 12pt 500, height 44pt, 10pt radius. When following, swap to a secondary look: `surface` bg, `textPrimary` text, `surfaceBorder` border.
   - Square secondary (44pt × 44pt): share icon. Triggers iOS/Android native share sheet with a deep link URL.

**Loading state**: shimmer the hero block (gray circle + 2 gray bars), shimmer 3 stat cards, shimmer 3 mini whale cards. No spinner. Use the same shimmer config from the feed.

**Error state** (404 from API): centered icon (waves crossed out, 48pt, `textMuted`), text "Trader not found" (h2 textSecondary), subtitle "We haven't seen this address trade yet" (body textMuted), back button as the only action.

### 6.4 Follow button implementation

The follow button writes to **two places**: a local Hive box for instant UI feedback, and the server for cross-device persistence.

```dart
// data/follows_repository.dart
class FollowsRepository {
  final ApiClient _api;
  final Box<String> _box;   // Hive box keyed by wallet address, value = ISO timestamp

  Future<bool> isFollowing(String wallet) async => _box.containsKey(wallet);

  Future<void> follow(String wallet) async {
    // Optimistic local update first
    await _box.put(wallet, DateTime.now().toIso8601String());
    // Then server
    try {
      await _api.post('/v1/users/me/follows', data: { 'proxyWallet': wallet });
    } catch (e) {
      // Roll back local state if server failed
      await _box.delete(wallet);
      rethrow;
    }
  }

  Future<void> unfollow(String wallet) async {
    final timestamp = _box.get(wallet);
    await _box.delete(wallet);
    try {
      await _api.delete('/v1/users/me/follows/$wallet');
    } catch (e) {
      // Roll back
      if (timestamp != null) await _box.put(wallet, timestamp);
      rethrow;
    }
  }

  /// Pull server's follow list and reconcile with local Hive on app launch
  Future<void> syncFromServer() async {
    final response = await _api.get('/v1/users/me/follows');
    final serverFollows = (response.data['items'] as List)
      .map((it) => it['proxyWallet'] as String)
      .toSet();

    // Server is source of truth for cross-device sync
    final localFollows = _box.keys.cast<String>().toSet();
    for (final wallet in localFollows.difference(serverFollows)) {
      // Local has, server doesn't — keep local for now? Or trust server?
      // Decision: trust server. Less surprising for users on multiple devices.
      await _box.delete(wallet);
    }
    for (final wallet in serverFollows.difference(localFollows)) {
      await _box.put(wallet, DateTime.now().toIso8601String());
    }
  }
}
```

The optimistic update pattern is important here — tapping Follow should feel instant. The server roundtrip is hidden.

Run `syncFromServer` once at app launch and pull-to-refresh. Don't sync more aggressively than that.

### 6.5 The "Following" filter chip on the feed

Add to the feed's filter bar (UI doc §5.1):

Position: between the size threshold chips and category chips. So the order becomes:
```
[All] [$50K+] [$100K+] [$250K+] | [Following] | [Politics] [Crypto] [Sports] [Tech] [Culture]
```

The `Following` chip:
- Active state: `buyDeep` bg, `accentText` color (slight differentiation from the white/dark `accent` chips, because following is a personal/special filter).
- Inactive state: same as other chips — `surfaceMuted` bg, `textSecondary`.
- Disabled state (when user follows zero traders): `textMuted` color, lower opacity 0.5, tappable but on tap shows a toast "Follow some traders first" with an action "Browse leaderboard" that pushes `/leaderboard`.

When active, the feed only shows whales from followed traders. The empty state for the filter (no whales from followed traders in the current threshold) is the same as the regular empty state but with text "None of your followed traders have made big moves yet — try lowering the size threshold."

### 6.6 Profile screen integration

In the existing Profile tab (UI doc §5.5), add a new section called "FOLLOWING" with a list view showing:
- Compact rows of followed traders (avatar + pseudonym + 7d volume).
- Tap a row → trader profile.
- Long-press → "Unfollow" confirmation sheet.
- Empty state: "You're not following anyone yet" + button to leaderboard.

This gives users a way to manage their follows without going through the trader profile each time.

### 6.7 Push notifications (no changes for v1)

Don't trigger pushes when followed traders make whale moves yet. That's a feature ("traders you follow just made a $X move") but it adds:
- Server-side notification routing complexity.
- Per-user push rate limit risk.
- New notification types in the data payload.

Save it for v2. The `Following` feed filter is enough for v1.

---

## 7. Edge cases

A few things worth thinking through before the agent runs.

**Trader changes pseudonym.** Polymarket lets users update their pseudonym. The API server reads pseudonym from the *latest trade* for that wallet, so the profile auto-updates over time. No special handling needed.

**Two anonymous users on the same device.** Anonymous user IDs are device-bound (UUID in keychain). If they don't sign in, "user A's follows" and "user B's follows" don't exist — same device, same anonymous ID, same follows. Acceptable for v1.

**Trader's wallet is invalid format.** Validate wallet shape on the API server before any DB query (basic regex `/^0x[0-9a-f]{40}$/`). Return 400 for malformed input, not 404.

**User follows a wallet that's never been seen.** Already handled in §5.2 — the POST `/follows` endpoint checks `trades.countDocuments({...}, {limit:1})` first.

**A user follows hundreds of traders.** The `traderFollows.find({userId})` in `/v1/users/me/follows` should be capped at 500 (already specced). The `following=true` filter on the feed uses `$in` — also capped at 500. If the user has more, the feed silently uses the most recent 500. Edge case; acceptable.

**Profile image URL is broken / 404s.** The Flutter `Image.network` widget should fall back to the gradient avatar on error. Use the `errorBuilder` parameter of `Image.network`:

```dart
Image.network(
  profileImage,
  errorBuilder: (_, __, ___) => Container(
    decoration: BoxDecoration(gradient: avatarGradient(wallet), shape: BoxShape.circle),
  ),
);
```

**Sparkline shows zero traders for the past 30 days.** Show an empty state inside the sparkline card: "Not enough activity in the last 30 days." Don't render an empty/flat chart — looks broken.

---

## 8. Rollout plan

This feature has soft dependencies on the leaderboard's data pipeline. If you build it before the leaderboard, you have to either:
- Compute trader stats on-the-fly from the `trades` collection (slower, less accurate, but works), OR
- Build the watcher's `trade_events` and `trader_daily_stats` collections first.

Recommended order:

**Phase 1 — Foundations (do this with the leaderboard work):**
1. Watcher: `trade_events` poller + daily aggregator (from doc 05).
2. Verify `trader_daily_stats` is populating.

**Phase 2 — API:**
1. Add `trader_follows` collection + indexes.
2. Implement `GET /v1/traders/:wallet` (full version).
3. Implement `POST /DELETE /GET /v1/users/me/follows*`.
4. Add `following=true` filter to `GET /v1/whales` and the WebSocket.
5. Test all endpoints with curl.

**Phase 3 — Mobile:**
1. Build trader profile screen end-to-end with mock data first (no API).
2. Wire up the API.
3. Add the `Following` filter chip on the feed.
4. Add the "Following" section to the Profile tab.
5. Wire deep links from feed and leaderboard rows.

**Phase 4 — Polish:**
1. Test follow/unfollow on flaky network (rollback works correctly).
2. Test deep links from cold app start (`/trader/0xabc...` shared via URL).
3. Test the empty/loading/error states.

You can ship Phase 2 before Phase 3 and the API will just sit unused. Don't ship Phase 3 without Phase 2 — the mobile app will hit dead endpoints.

---

## 9. What not to do

- **Don't show portfolio holdings or PnL.** Polymarket's API gives you trades, not authoritative portfolio state. Computing PnL from trades requires settlement data and is error-prone. Skip it. Showing wrong PnL is much worse than showing no PnL.
- **Don't add a "message trader" feature.** No social features. The whole product premise is "watch, don't interact."
- **Don't show "this trader is up X% this week."** Same reason as PnL — you don't have settled outcomes for open positions.
- **Don't make the Follow button do anything fancy.** Tap, toggles, done. No animation parties, no confirmation modals. Twitter follows are 1-tap; ours should be too.
- **Don't fetch trader profile on every feed card render.** The feed shows the trader pseudonym/wallet inline already — that's enough. Profile fetch only happens when the user taps to navigate.
- **Don't store the user's IP or device fingerprint with the follow.** Just userId + wallet. Less data = less liability.

---

## 10. v1 launch checklist

- [ ] `trader_follows` collection exists with correct indexes.
- [ ] `GET /v1/traders/:wallet` returns full profile data, with all required fields populated.
- [ ] Profile data is cached for 30s per (wallet, userId) pair.
- [ ] Follow / unfollow round-trips work and update the cache correctly.
- [ ] Following filter on `/v1/whales` correctly returns only whales from followed traders.
- [ ] Following filter on the WebSocket correctly streams only matching whales.
- [ ] Mobile trader profile screen matches the mockup pixel-for-pixel.
- [ ] Avatar falls back to gradient on profile image load error.
- [ ] Follow button has optimistic local update + server roundtrip with rollback.
- [ ] "Following" filter chip on the feed works, including empty state.
- [ ] "Following" section in the Profile tab lists followed traders with avatars and 7d volume.
- [ ] Deep link `polywatch://trader/0xabc...` (and HTTPS equivalent) opens the profile from cold start.
- [ ] Tapping any trader name anywhere in the app navigates to `/trader/:wallet`.
- [ ] Long-press on a followed trader in the Profile tab confirms unfollow.
- [ ] All four states (loading / loaded / error / empty) are designed and implemented.

When all boxes are ticked, trader profiles are live.
