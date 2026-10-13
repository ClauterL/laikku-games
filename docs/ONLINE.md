# Online features – leaderboard, players online, players total

The arcade is deployed on Netlify (project `havaida-games`, https://havaida-games.netlify.app,
continuous deployment from GitHub `ClauterL/laikku-games`, branch `main`). This document
specifies the online layer that turns the six single-player games into a shared arcade:

1. **Leaderboard** – every player's best score per game, visible to everyone, with player names.
2. **Players online now** – how many people are playing at this moment (total and per game).
3. **Players total** – how many different people have ever played (total and per game).

Everything must degrade gracefully: on `vite dev`, `vite preview`, GitHub Pages or with the
network down, the games work exactly as before and the online UI shows a quiet "offline"
state – **never** a console error storm, never a broken layout.

## Backend – Netlify Functions (v2, `.mts`) + Netlify Blobs

No database: Netlify Blobs is enough because the design has **no shared read-modify-write
counters**. Every mutable key has exactly one writer, and every aggregate (counts, top lists)
is derived by listing keys and is safely rebuildable.

### Stores (site-wide `getStore({ name, consistency: 'strong' })`)

| store | key | value | writer |
| --- | --- | --- | --- |
| `arcade-presence` | `<bucket>/<game>/<sessionId>` | `"1"` | that session's heartbeat |
| `arcade-players` | `all/<playerId>` and `game/<game>/<playerId>` | `{ firstSeen }` (`onlyIfNew: true`) | first heartbeat of that player in that game |
| `arcade-scores` | `<game>/<playerId>` | `{ name, score, ts, plays }` | only that player (their best per game) |
| `arcade-cache` | `top/<game>`, `players` | derived aggregates `{ builtAt, … }` | rebuildable cache, last write wins |

- `bucket = Math.floor(Date.now() / 30_000)`. A session is **online** when it has a key in the
  current or previous bucket. `game` is one of the six game slugs or `hub`.
  Dedupe by `sessionId` (keep the game from the newest bucket). Clean up keys from buckets older
  than `current - 2` opportunistically (`context.waitUntil`, max ~200 deletes per call).
- Player counts = number of keys under `all/` and under `game/<slug>/`. Cache them in
  `arcade-cache/players` for 60 s (and in module memory for 15 s).
- Leaderboard top list per game: `arcade-cache/top/<game>` = top 100 entries. Rebuilt from
  `arcade-scores` (list prefix `<game>/`, read entries with bounded concurrency ~16) when older
  than 60 s or missing; after a successful score POST the cache is merged in place
  (replace the player's row, sort, slice) so the submitter sees the new rank immediately.
- Treat everything from the client as untrusted: validate `game` against the six slugs (+ `hub`
  for presence), `playerId`/`sessionId` against `^[a-z0-9-]{8,64}$`, `score` as a finite integer
  `0 ≤ score ≤ 5_000_000`, names (below). Ignore/400 invalid input. Per-player throttle: reject a
  score POST for the same game within 3 s of the previous one (`ts` in the entry). No IPs are
  stored.
- Names: trim, collapse whitespace, 2–16 characters of letters (any language, `\p{L}`), digits,
  space, `-`, `_`, `.`; reject (400 with a friendly message) names containing entries of a small
  blocklist of slurs/profanity in English and Finnish (case-insensitive, spaces and `-_.`
  removed before matching).

### Endpoints (`netlify/functions/*.mts`, each with `export const config = { path }`)

| method & path | body / query | response |
| --- | --- | --- |
| `POST /api/presence` | `{ sessionId, playerId, game }` | `Stats` |
| `GET /api/stats` | – | `Stats` |
| `GET /api/leaderboard` | `?game=<slug>&limit=50&player=<playerId>` | `{ game, entries: Entry[], total, you?: Entry }` |
| `GET /api/leaderboard` | no `game` → `?limit=5` | `{ boards: Record<slug, { entries, total }> }` |
| `POST /api/score` | `{ playerId, name, game, score }` | `{ game, rank, total, best, improved, entries: top 10 }` |
| `POST /api/name` | `{ playerId, name }` | `{ name, updated }` – renames all of the player's score rows |

`Stats = { online, onlineByGame: Record<game, number>, players, playersByGame: Record<slug, number>, updatedAt }`
`Entry = { rank, name, score, ts, you? }` (never expose other players' ids).

Shared code lives outside the functions folder in `netlify/lib/arcade.ts` (imported as
`'../lib/arcade'`), type-checked by `tsconfig.functions.json` (`npm run check` runs both
projects). `netlify.toml` sets `build.command = "npm run build"`, `publish = "dist"`,
`functions.directory = "netlify/functions"`, and long-lived cache headers for `/assets/*`.

## Client

- `src/shared/online.ts` – player id (localStorage, `crypto.randomUUID`), session id (per tab),
  player name (localStorage), `fetch` wrapper with a 6 s timeout that treats non-JSON / non-2xx
  responses as "offline" and backs off for 60 s; presence heartbeat every 30 s while the tab is
  visible (immediately on route change, paused when hidden); a tiny pub/sub for `Stats`;
  `reportScore(game, score)` (debounced ~1.5 s per game, keeps the max); `submitScore`,
  `fetchLeaderboard`, `fetchStats`, `setPlayerName`.
- `src/shared/storage.ts` – `submitBest()` additionally dispatches
  `window.dispatchEvent(new CustomEvent('havaida:score', { detail: { game, score } }))`
  (no import of `online.ts` – avoids a cycle). Every game already calls `submitBest` when a run
  or level ends, so no game file needs to change.
- `src/shared/ScoreToast.tsx` – mounted once in `App`. On a reported score it shows a compact
  card at the top centre (above game overlays, safe-area aware, never wider than the screen):
  if the player has no name yet → "Save 12,450 to the leaderboard" + name input + Save / Skip;
  otherwise it submits and shows "#3 of 41 · Ticket Slash · 12,450 · New best!" with a
  "Leaderboard →" link (`#/leaderboard/<slug>`). Auto-hides after ~6 s unless focused/hovered.
- `src/shared/PresenceTracker.tsx` – mounted in `App`, reads the route (`useLocation`) and keeps
  the heartbeat running with the current game slug or `hub`.
- Hub (`src/hub/`): a live counter strip under the title ("● 3 playing now · 128 players so
  far"), a small "● 2 playing · 41 played" line on every game card, and a **Leaderboard**
  section: game tabs, top 50 rows (rank, name, score, relative time), the viewer's own row
  highlighted (and appended with its rank when outside the list), a "Playing as <name> ✎"
  editor, and an offline note when the API is unavailable ("Leaderboard and live counters work
  on the live site"). Route `/leaderboard/:game?` renders the hub, selects the tab and scrolls
  the section into view.
- Visual style follows the hub (dark navy, glass cards, Baloo 2 / Nunito); counters use a small
  pulsing green dot. Must look right at 390 px and 1280 px wide.

## Local testing

`npx netlify dev` (Netlify CLI) runs Vite and the functions with a sandboxed local Blobs store;
`npm run dev` alone shows the offline state. Moderation: entries can be removed in the Netlify UI
under **Data & Storage → Blobs → arcade-scores** (the top-list cache rebuilds within a minute).
