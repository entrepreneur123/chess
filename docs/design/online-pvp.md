# Online PvP: feasibility and cost (2026-11-08)

Owner question: can real users be matched against each other, and what does it cost? Prices below
were read on 2026-11-08 from the vendors' official pricing pages (Supabase, Cloudflare); store fees
come from third-party summaries and must be re-checked on Apple's / Google's own pages before
budgeting. Traffic numbers are the lead's estimates from the game's own shape, not measurements.

## 1. Verdict

Feasible. The game is turn based (one small message per move, ~40 moves per match), which is the
cheapest kind of realtime game to run: no 60 Hz netcode, no dedicated game servers. The engine is
pure TypeScript with no DOM, so the SAME rules code can run on a server and decide every move
(server-authoritative), which is what makes ranked play cheat-proof.

What is missing today (all client-side):
- accounts (the profile lives in localStorage and can be edited by the player);
- a server copy of rating, currencies and owned characters (ranked PvP is meaningless while a
  player can give himself 3성 everything);
- matchmaking, the match room and the turn clock on the server.

The real risk is not cost but **liquidity**: with few players online a queue can sit empty. The
standard answer is a queue that waits ~10-20 s for a human, then offers a match against the AI
(labelled "AI", as today).

## 2. Recommended architecture (Supabase: one vendor, already a connector here)

| Piece | Supabase feature | Notes |
| --- | --- | --- |
| Accounts | Auth (guest / anonymous sign-in first, link Google / Apple later) | 100,000 MAU included on Pro |
| Server profile | Postgres tables + row-level security | rating, currencies, owned grades, formation |
| Matchmaking | a `queue` table + an Edge Function that pairs by rating band (±60 ranked) | falls back to the AI after a wait |
| Match room | Realtime channel per match (broadcast) | clients only *receive* state |
| Move validation | Edge Function running `src/engine` (Deno can import the TS engine) | 1 invocation per move: load state, `isLegalMove`, `applyMove`, save, broadcast |
| Turn clock (45 / 40 / 20 s) | deadline stored with the state; checked on every call, plus a "claim timeout" call from the waiting player | `GameController` already has the timed mode, `RESIGN_UNLOCK_PLY` gate too |
| Settlement | the same Edge Function writes rating / rewards at the end | the client can no longer award itself |

Client side, `GameController` gets a third port next to "bot" and "local": a remote opponent whose
moves arrive over the channel. `GameParams.online` already switches on the clock and the resign
lock.

Alternative: **Cloudflare Workers + Durable Objects** (one object per match room, WebSockets with
hibernation). Cheaper at large scale, but accounts / database / auth must be built or bought
separately (D1, or Supabase anyway), so it is more engineering for a small game today.

## 3. Traffic model (estimates)

- One match ≈ 40 plies (cap 58). Per ply: one Edge Function call + one broadcast received by 2
  clients. Plus ~20 messages for queue, join, ready, result.
- Supabase Realtime messages per match ≈ 40 × 2 + 20 ≈ **100-150**.
- Edge Function invocations per match ≈ **40-60**.
- One online player = one Realtime connection.

## 4. Supabase prices (official page, 2026-11-08)

| | Free | Pro |
| --- | --- | --- |
| Base | $0 | from $25 / month (includes $10 compute credit) |
| Realtime peak connections | 200 | 500, then $10 per 1,000 |
| Realtime messages | 2 M / month | 5 M, then $2.50 per million |
| Edge Function invocations | 500 K / month | 2 M, then $2 per million |
| Monthly active users | 50,000 | 100,000, then $0.00325 per MAU |
| Database | 500 MB | 8 GB disk, then $0.125 per GB |
| Egress | 5 GB | 250 GB, then $0.09 per GB |

## 5. Monthly cost by stage (Supabase, estimates)

| Stage | Peak online | Matches / month | Bill |
| --- | --- | --- | --- |
| Development / closed test | < 200 | < 10,000 | **$0** (Free; limits: 200 connections, 2 M messages, 500 K calls) |
| Launch | ≤ 500 | ≈ 30,000-40,000 | **$25** (inside Pro's quotas: 5 M messages ÷ ~150 ≈ 33 K matches; 2 M calls ÷ ~50 ≈ 40 K) |
| Growing | ~3,000 | ~300,000 | ≈ **$25 + $30 (connections) + ~$100 (≈ 40 M extra messages) + ~$26 (≈ 13 M extra calls) ≈ $180** |
| Large | ~10,000 | ~1,000,000 | ≈ $25 + $100 + ~$360 + ~$96 ≈ **$580** |

At the large stage monthly active users may also pass Pro's 100,000 ($0.00325 per extra MAU:
+$325 per extra 100,000). The message bill dominates the rest; it can be cut a lot by sending only moves (not full states) and by the
Cloudflare room alternative below.

Cloudflare Durable Objects for the match rooms (official page): Workers Paid minimum $5 / month,
1 M requests + 400,000 GB-s included ($0.15 per extra million requests, $12.50 per extra million
GB-s), incoming WebSocket messages billed 20:1, no duration billed while hibernating. At ~4 billed
requests per match the included million covers roughly 250,000 matches, so rooms stay near $5-10 /
month even at the "growing" stage; accounts and the database would still cost Supabase's $25.

## 6. One-off and other costs

- Store accounts (third-party figures, re-check): Google Play $25 once; Apple Developer $99 / year.
- Current web hosting (Vercel) does not change.
- Engineering is the real cost: accounts + server profile migration, matchmaking, server move
  validation, reconnect / abandon handling, and a first anti-cheat pass. The lead's estimate for an
  MVP is several weeks of focused work; not measured.

## 7. Open decisions for the owner

1. Sign-in: guest first (fastest) or Google / Apple from day one.
2. Empty queue: offer the AI after N seconds (recommended), or wait.
3. Whether the existing local progress migrates to the server account (one-time upload, trusted
   once) or ranked starts fresh.
4. Disconnects: how long a dropped player has to come back before forfeiting (e.g. 30 s).

## 8. At global scale: what large games do (added 2026-11-08)

Sources checked 2026-11-08: AWS's Supercell case studies; Heroic Labs' Nakama docs; vendor
comparisons (treated as opinion).

- **The client does not depend on Vercel.** In the store app (Capacitor) the game files ship inside
  the app; Vercel only hosts the web version and the static assets (a CDN, fine at any scale).
- **Large studios run their own game servers on a big cloud.** Supercell (Clash Royale, Brawl
  Stars) runs its in-house backend (Java, some Rust) on AWS: EC2 auto scaling, Aurora (Postgres /
  MySQL), CloudFront; AWS reports ~200 M monthly players on it.
- **Supabase is Postgres underneath** (open source, self-hostable): the data is not locked in, it
  can move to Aurora / Cloud SQL / our own Postgres later.
- **Game-server frameworks big and small studios use:** Nakama (Heroic Labs, open source,
  self-host or Heroic Cloud; its TypeScript runtime runs authoritative match handlers, so our
  pure-TS engine can run inside it), PlayFab (Microsoft, managed live-ops), Photon (realtime
  networking only, needs a backend beside it), GameLift (dedicated servers for realtime action
  games; overkill for a turn-based game).
- **Recommended path:** keep all match logic in our own TS server code (the engine already is), so
  the host can change without a rewrite:
  1. launch: Supabase (accounts, Postgres, realtime) or Nakama, cheapest to ship;
  2. growth: our own Node/TS match service (or self-hosted Nakama) on AWS or GCP with managed
     Postgres, the same shape as the big studios, with monitoring and on-call.
  A turn-based game puts little load on servers; the real cost of "our own" is operations
  (monitoring, security, deploys, incidents), not hardware.
