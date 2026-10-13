/**
 * Shared server code for the arcade's online layer (see docs/ONLINE.md).
 *
 * Storage is Netlify Blobs, which has last-write-wins semantics and no transactions, so the
 * design never keeps a shared read-modify-write counter: every mutable key has exactly one
 * writer (a browser session or a player), and every aggregate – online counts, player counts,
 * top lists – is derived by listing keys and can be rebuilt at any time.
 *
 * The first half of this file is pure logic (validation, presence buckets, ranking) so it can be
 * unit-tested without a Blobs backend (`scripts/api-smoke.mjs` imports it directly).
 */
import { getStore, type Store } from '@netlify/blobs'
import type { Context } from '@netlify/functions'

/* ------------------------------------------------------------------------------------------ */
/* Constants & validation                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** Keep in sync with `src/games.ts` – the server keeps its own copy because it is the trust boundary. */
export const GAME_SLUGS = [
  'ticket-slash',
  'network-connect',
  'access-crossing',
  'signal-command',
  'bug-breaker',
  'uptime-keeper',
] as const
export type GameSlug = (typeof GAME_SLUGS)[number]
export type PresenceGame = GameSlug | 'hub'
export const PRESENCE_GAMES: readonly PresenceGame[] = [...GAME_SLUGS, 'hub']

export const BUCKET_MS = 30_000
export const MAX_SCORE = 5_000_000
export const SCORE_THROTTLE_MS = 3_000
/** Entries kept in the cached top list of each game. */
export const TOP_SIZE = 100
/** Age after which a cached aggregate in `arcade-cache` is rebuilt. */
export const CACHE_TTL_MS = 60_000
/** Player counts are additionally memoised per warm function instance. */
export const MEMORY_TTL_MS = 15_000
export const MAX_BODY_BYTES = 1024
/** Upper bound for opportunistic presence clean-up per invocation. */
export const MAX_CLEANUP_DELETES = 200

const ID_RE = /^[a-z0-9-]{8,64}$/

export const isGameSlug = (v: unknown): v is GameSlug =>
  typeof v === 'string' && (GAME_SLUGS as readonly string[]).includes(v)
export const isPresenceGame = (v: unknown): v is PresenceGame => v === 'hub' || isGameSlug(v)
export const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v)

/** A finite integer in [0, MAX_SCORE], or null. Strings and fractions are rejected, not coerced. */
export function parseScore(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_SCORE ? v : null
}

/** Integer query parameter clamped to [min, max]; missing or garbage → fallback. */
export function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback
}

/* ------------------------------------------------------------------------------------------ */
/* Player names                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export type NameCheck = { ok: true; name: string } | { ok: false; error: 'invalid-name' | 'blocked-name'; message: string }

const NAME_CHARS = /^[\p{L}0-9 ._-]+$/u
const HAS_LETTER_OR_DIGIT = /[\p{L}0-9]/u

/**
 * Slurs and strong profanity in English and Finnish, matched as substrings of the normalised
 * name. ROT13-encoded so the source does not read like a list of slurs. Kept deliberately small
 * and free of short fragments that hit ordinary names (e.g. "Nazir", "Fukuda", "Pornainen");
 * anything that slips through can be removed under Data & Storage → Blobs → arcade-scores.
 */
const BLOCKLIST = [
  // English
  'shpx', 'fuvg', 'phag', 'ovgpu', 'juber', 'fyhg', 'avttre', 'avttn', 'snttbg', 'ergneq', 'nffubyr',
  'qvpxurnq', 'jnaxre', 'gjng', 'genaal', 'uvgyre', 'fvrturvy', 'crqbcuvyr', 'cnrqbcuvyr',
  // Finnish (diacritics stripped: ä → a)
  'ivggh', 'ivgha', 'cnfxn', 'xhfvcnn', 'xlecn', 'uhben', 'yhgxn', 'zhyxxh', 'ehaxxnev', 'ahffv', 'cvyyh',
  'arrxrev', 'arxeh', 'elffn', 'uvaggv', 'wnyxrrawnnalg', 'enggvcnn', 'zhgnxhbab', 'nuynzv', 'crqbsvvyv',
].map((w) => w.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 84) % 26) + 97)))

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' }

/** Lower-case, strip diacritics, drop spaces and `-_.`, undo common digit-for-letter swaps. */
export function blocklistKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\s._-]/gu, '')
    .replace(/[0-9]/g, (d) => LEET[d] ?? d)
}

export const isBlockedName = (name: string): boolean => {
  const key = blocklistKey(name)
  return BLOCKLIST.some((word) => key.includes(word))
}

/** Trim, collapse whitespace, then 2–16 letters (any language), digits, spaces, `-`, `_`, `.`. */
export function checkName(raw: unknown): NameCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid-name', message: 'Please enter a name.' }
  const name = raw.normalize('NFC').replace(/\s+/gu, ' ').trim()
  const length = [...name].length
  if (length < 2 || length > 16) return { ok: false, error: 'invalid-name', message: 'Names are 2–16 characters long.' }
  if (!NAME_CHARS.test(name) || !HAS_LETTER_OR_DIGIT.test(name)) {
    return { ok: false, error: 'invalid-name', message: 'Use letters, digits, spaces and - _ . only.' }
  }
  if (isBlockedName(name)) {
    return { ok: false, error: 'blocked-name', message: 'That name is not allowed on the leaderboard – please pick another one.' }
  }
  return { ok: true, name }
}

/* ------------------------------------------------------------------------------------------ */
/* Presence buckets                                                                             */
/* ------------------------------------------------------------------------------------------ */

export const bucketOf = (ms: number): number => Math.floor(ms / BUCKET_MS)
export const presenceKey = (bucket: number, game: PresenceGame, sessionId: string): string =>
  `${bucket}/${game}/${sessionId}`

export interface PresenceEntry {
  bucket: number
  game: PresenceGame
  sessionId: string
}

export function parsePresenceKey(key: string): PresenceEntry | null {
  const parts = key.split('/')
  if (parts.length !== 3) return null
  const bucket = Number(parts[0])
  const [, game, sessionId] = parts
  if (!Number.isSafeInteger(bucket) || !isPresenceGame(game) || !isId(sessionId)) return null
  return { bucket, game, sessionId }
}

export const zeroCounts = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>

/** Within one bucket a session that switched routes can briefly have two keys: prefer a game over the hub. */
function isNewer(a: PresenceEntry, b: PresenceEntry): boolean {
  if (a.bucket !== b.bucket) return a.bucket > b.bucket
  if ((a.game === 'hub') !== (b.game === 'hub')) return b.game === 'hub'
  return a.game < b.game
}

/**
 * Online sessions from presence keys. A session is online when it has a key in the current or
 * the previous bucket (the next bucket is tolerated for clock skew between instances). Each
 * session counts once, for the game of its newest key.
 */
export function summarizePresence(
  keys: Iterable<string>,
  current: number,
): { online: number; onlineByGame: Record<PresenceGame, number> } {
  const latest = new Map<string, PresenceEntry>()
  for (const key of keys) {
    const entry = parsePresenceKey(key)
    if (!entry || entry.bucket < current - 1 || entry.bucket > current + 1) continue
    const seen = latest.get(entry.sessionId)
    if (!seen || isNewer(entry, seen)) latest.set(entry.sessionId, entry)
  }
  const onlineByGame = zeroCounts(PRESENCE_GAMES)
  for (const entry of latest.values()) onlineByGame[entry.game]++
  return { online: latest.size, onlineByGame }
}

/** Keys from buckets older than `current - 2` (and unparseable keys), at most `max` of them. */
export function staleKeys(keys: Iterable<string>, current: number, max = MAX_CLEANUP_DELETES): string[] {
  const out: string[] = []
  for (const key of keys) {
    if (out.length >= max) break
    const slash = key.indexOf('/')
    const bucket = slash > 0 ? Number(key.slice(0, slash)) : NaN
    if (!Number.isSafeInteger(bucket) || bucket < current - 2) out.push(key)
  }
  return out
}

/* ------------------------------------------------------------------------------------------ */
/* Scores & ranking                                                                             */
/* ------------------------------------------------------------------------------------------ */

/**
 * `arcade-scores/<game>/<playerId>` – one row per player and game, written only by that player.
 * `ts` is the time of the last accepted submission (used by the throttle); `at` is when `score`
 * – the best – was set, which is what the leaderboard shows and what breaks ties.
 */
export interface ScoreRow {
  name: string
  score: number
  ts: number
  plays: number
  at: number
}

/** A row of the cached top list (server side only – ids never leave the server). */
export interface TopRow {
  id: string
  name: string
  score: number
  at: number
}

/**
 * `arcade-cache/top/<game>`: the best TOP_SIZE rows plus the scores of everybody else (sorted,
 * descending) so ranks beyond the top list can still be computed without reading every row.
 */
export interface TopList {
  builtAt: number
  total: number
  entries: TopRow[]
  tail: number[]
}

/** Public leaderboard row. */
export interface Entry {
  rank: number
  name: string
  score: number
  ts: number
  you?: true
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function parseScoreRow(v: unknown): ScoreRow | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.name !== 'string' || parseScore(r.score) === null || !isFiniteNumber(r.ts)) return null
  const plays = isFiniteNumber(r.plays) ? r.plays : 1
  const at = isFiniteNumber(r.at) ? r.at : r.ts
  return { name: r.name, score: r.score as number, ts: r.ts, plays, at }
}

export function parseTopList(v: unknown): TopList | null {
  if (!v || typeof v !== 'object') return null
  const t = v as Record<string, unknown>
  if (!isFiniteNumber(t.builtAt) || !isFiniteNumber(t.total) || !Array.isArray(t.entries) || !Array.isArray(t.tail)) return null
  return t as unknown as TopList
}

/** Higher score first; on a tie whoever got there first; then id for a stable order. */
export function compareRows(a: TopRow, b: TopRow): number {
  return b.score - a.score || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Number of values strictly greater than `score` in a descending array (binary search). */
export function countGreater(desc: readonly number[], score: number): number {
  let lo = 0
  let hi = desc.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (desc[mid] > score) lo = mid + 1
    else hi = mid
  }
  return lo
}

function insertDesc(desc: number[], score: number): void {
  desc.splice(countGreater(desc, score), 0, score)
}

function removeOneDesc(desc: number[], score: number): void {
  const i = countGreater(desc, score)
  if (desc[i] === score) desc.splice(i, 1)
}

export function buildTopList(rows: TopRow[], builtAt: number): TopList {
  const sorted = rows.slice().sort(compareRows)
  return {
    builtAt,
    total: sorted.length,
    entries: sorted.slice(0, TOP_SIZE),
    tail: sorted.slice(TOP_SIZE).map((r) => r.score),
  }
}

/**
 * Puts a player's current row into a top list (returns a new list). `previousScore` is the score
 * the list may already hold for that player outside the top entries (null for a new player).
 */
export function placeRow(top: TopList, row: TopRow, previousScore: number | null): TopList {
  const entries = top.entries.filter((e) => e.id !== row.id)
  const tail = top.tail.slice()
  if (entries.length === top.entries.length && previousScore !== null) removeOneDesc(tail, previousScore)
  entries.push(row)
  entries.sort(compareRows)
  while (entries.length > TOP_SIZE) insertDesc(tail, (entries.pop() as TopRow).score)
  return { builtAt: top.builtAt, total: entries.length + tail.length, entries, tail }
}

/**
 * A rebuild reads score rows over a few hundred milliseconds; rows merged into the cache meanwhile
 * (set at or after `since`) are carried over into the new snapshot instead of being dropped.
 */
export function carryLateRows(snapshot: TopList, cached: TopList, since: number): TopList {
  let out = snapshot
  for (const row of cached.entries) {
    if (row.at < since) continue
    const known = out.entries.find((e) => e.id === row.id)
    if (known && known.score >= row.score) continue
    out = placeRow(out, row, null)
  }
  return out
}

/** Would this row be part of the top entries? */
export const qualifiesForTop = (top: TopList, row: TopRow): boolean =>
  top.entries.length < TOP_SIZE || compareRows(row, top.entries[top.entries.length - 1]) < 0

/** 1-based rank; beyond the top list ties share the better rank. */
export function rankOf(top: TopList, id: string, score: number): number {
  const i = top.entries.findIndex((e) => e.id === id)
  return i >= 0 ? i + 1 : top.entries.length + 1 + countGreater(top.tail, score)
}

export function toEntries(rows: readonly TopRow[], limit: number, playerId: string | null): Entry[] {
  return rows.slice(0, limit).map((r, i) => {
    const entry: Entry = { rank: i + 1, name: r.name, score: r.score, ts: r.at }
    if (playerId !== null && r.id === playerId) entry.you = true
    return entry
  })
}

/* ------------------------------------------------------------------------------------------ */
/* HTTP helpers                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
}

export const fail = (status: number, error: string, message: string, headers?: Record<string, string>): Response =>
  json({ error, message }, status, headers)

export type BodyResult = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }

/** Reads a small JSON object body; anything else is a 400, anything bigger than 1 KB a 413. */
export async function readBody(req: Request): Promise<BodyResult> {
  const tooLarge = (): BodyResult => ({ ok: false, response: fail(413, 'too-large', 'Request body too large.') })
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return tooLarge()
  let bytes: ArrayBuffer
  try {
    bytes = await req.arrayBuffer()
  } catch {
    return { ok: false, response: fail(400, 'invalid-body', 'Could not read the request body.') }
  }
  if (bytes.byteLength > MAX_BODY_BYTES) return tooLarge()
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (body && typeof body === 'object' && !Array.isArray(body)) return { ok: true, body: body as Record<string, unknown> }
  } catch {
    /* fall through */
  }
  return { ok: false, response: fail(400, 'invalid-json', 'Expected a JSON object.') }
}

/** Runs a handler; storage outages become a JSON 503 (the client then shows its offline state). */
export async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (err) {
    console.error('[arcade]', err)
    return fail(503, 'unavailable', 'The arcade server is unavailable right now.')
  }
}

/** `context.waitUntil` with a safety net – background work must never reject unhandled. */
export function later(context: Context, work: Promise<unknown>): void {
  const settled = work.catch((err: unknown) => console.error('[arcade] background task failed', err))
  if (typeof context.waitUntil === 'function') context.waitUntil(settled)
}

/** Maps with at most `limit` promises in flight. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/* ------------------------------------------------------------------------------------------ */
/* Stores                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const STORE_NAMES = {
  presence: 'arcade-presence',
  players: 'arcade-players',
  scores: 'arcade-scores',
  cache: 'arcade-cache',
} as const

/** Site-wide store. Opened per request: the Blobs environment is injected per invocation. */
export const store = (name: keyof typeof STORE_NAMES): Store =>
  getStore({ name: STORE_NAMES[name], consistency: 'strong' })

const listKeys = async (s: Store, prefix?: string): Promise<string[]> =>
  (await s.list(prefix === undefined ? undefined : { prefix })).blobs.map((b) => b.key)

/**
 * Compare-and-swap on a derived entry of `arcade-cache`: `next` computes the new value from the
 * stored one (null when missing or unreadable) or returns undefined to leave it alone. The write
 * is conditional on the ETag that was read, so two functions updating the same entry at once
 * retry instead of silently dropping each other's change. Returns what is stored afterwards
 * (null if the entry is missing, or if it stayed contended through every attempt).
 */
async function updateCache<T>(key: string, parse: (v: unknown) => T | null, next: (current: T | null) => T | undefined): Promise<T | null> {
  const cache = store('cache')
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await cache.getWithMetadata(key, { type: 'json' })
    const current = found ? parse(found.data) : null
    const value = next(current)
    if (value === undefined) return current
    const write = found
      ? await cache.setJSON(key, value, { onlyIfMatch: found.etag })
      : await cache.setJSON(key, value, { onlyIfNew: true })
    if (write.modified) return value
  }
  return null
}

/* ------------------------------------------------------------------------------------------ */
/* Players                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export interface PlayerCounts {
  players: number
  playersByGame: Record<GameSlug, number>
}

let playerMemo: { at: number; value: PlayerCounts } | null = null
let playerRebuild: Promise<PlayerCounts> | null = null
/** `<game>/<playerId>` pairs this warm instance already registered – saves two writes per heartbeat. */
const registered = new Set<string>()

/**
 * Writes `all/<playerId>` and `game/<game>/<playerId>` once (onlyIfNew). Hub visits do not make
 * somebody a player. Returns true when either key was new.
 */
export async function registerPlayer(playerId: string, game: GameSlug): Promise<boolean> {
  const memo = `${game}/${playerId}`
  if (registered.has(memo)) return false
  const players = store('players')
  const value = { firstSeen: Date.now() }
  const [all, perGame] = await Promise.all([
    players.setJSON(`all/${playerId}`, value, { onlyIfNew: true }),
    players.setJSON(`game/${game}/${playerId}`, value, { onlyIfNew: true }),
  ])
  if (registered.size > 10_000) registered.clear()
  registered.add(memo)
  return all.modified || perGame.modified
}

async function countPlayers(): Promise<PlayerCounts> {
  const listedAt = Date.now()
  const counts: PlayerCounts = { players: 0, playersByGame: zeroCounts(GAME_SLUGS) }
  for (const key of await listKeys(store('players'))) {
    const [kind, game] = key.split('/')
    if (kind === 'all') counts.players++
    else if (kind === 'game' && isGameSlug(game)) counts.playersByGame[game]++
  }
  // whichever rebuild listed last wins – a slow rebuild must not overwrite a fresher count
  const snapshot = { builtAt: listedAt, ...counts }
  const stored = (await updateCache('players', parsePlayerCache, (current) => (current && current.builtAt >= listedAt ? undefined : snapshot))) ?? snapshot
  const value: PlayerCounts = { players: stored.players, playersByGame: stored.playersByGame }
  playerMemo = { at: Date.now(), value }
  return value
}

/** `fresh` rebuilds must start after the caller's write, so they never join one already running. */
function rebuildPlayerCounts(fresh = false): Promise<PlayerCounts> {
  if (fresh) return countPlayers()
  playerRebuild ??= countPlayers().finally(() => {
    playerRebuild = null
  })
  return playerRebuild
}

type PlayerCache = PlayerCounts & { builtAt: number }

function parsePlayerCache(v: unknown): PlayerCache | null {
  if (!v || typeof v !== 'object') return null
  const c = v as Record<string, unknown>
  if (!isFiniteNumber(c.builtAt) || !isFiniteNumber(c.players) || !c.playersByGame || typeof c.playersByGame !== 'object') return null
  const byGame = zeroCounts(GAME_SLUGS)
  for (const slug of GAME_SLUGS) {
    const n = (c.playersByGame as Record<string, unknown>)[slug]
    byGame[slug] = isFiniteNumber(n) ? n : 0
  }
  return { builtAt: c.builtAt, players: c.players, playersByGame: byGame }
}

/**
 * Player counts: module memory (15 s) → `arcade-cache/players` (60 s, served stale while it is
 * rebuilt in the background) → full rebuild by listing `arcade-players`. `fresh` forces the
 * rebuild – used right after a new player was registered so the count includes them.
 */
export async function getPlayerCounts(context: Context, fresh = false): Promise<PlayerCounts> {
  const now = Date.now()
  if (fresh) return rebuildPlayerCounts(true)
  if (playerMemo && now - playerMemo.at < MEMORY_TTL_MS) return playerMemo.value
  const cached = parsePlayerCache(await store('cache').get('players', { type: 'json' }))
  if (!cached) return rebuildPlayerCounts()
  const value: PlayerCounts = { players: cached.players, playersByGame: cached.playersByGame }
  if (now - cached.builtAt > CACHE_TTL_MS) later(context, rebuildPlayerCounts())
  else playerMemo = { at: now, value }
  return value
}

/* ------------------------------------------------------------------------------------------ */
/* Online stats                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export interface Stats extends PlayerCounts {
  online: number
  onlineByGame: Record<PresenceGame, number>
  updatedAt: number
}

let lastCleanup = 0

/** Deletes presence keys of expired buckets, at most once a minute per warm instance. */
async function cleanupPresence(current: number): Promise<void> {
  const presence = store('presence')
  const stale = staleKeys(await listKeys(presence), current)
  await mapLimit(stale, 16, (key) => presence.delete(key))
}

/**
 * Online + player counts. With `self` (a heartbeat that was just written) the session's keys for
 * other games in the current bucket are dropped – it has moved on – and deleted in the background.
 */
export async function computeStats(
  context: Context,
  opts: { self?: PresenceEntry; freshPlayers?: boolean } = {},
): Promise<Stats> {
  const now = Date.now()
  const current = bucketOf(now)
  const presence = store('presence')
  const [keys, players] = await Promise.all([
    Promise.all([listKeys(presence, `${current}/`), listKeys(presence, `${current - 1}/`)]).then(([a, b]) => [...a, ...b]),
    getPlayerCounts(context, opts.freshPlayers),
  ])
  let live = keys
  const self = opts.self
  if (self) {
    const moved = keys.filter((key) => {
      const e = parsePresenceKey(key)
      return e !== null && e.sessionId === self.sessionId && e.bucket === self.bucket && e.game !== self.game
    })
    if (moved.length) {
      live = keys.filter((key) => !moved.includes(key))
      later(context, Promise.all(moved.map((key) => presence.delete(key))))
    }
    if (now - lastCleanup > 60_000) {
      lastCleanup = now
      later(context, cleanupPresence(current))
    }
  }
  return { ...summarizePresence(live, current), ...players, updatedAt: now }
}

/* ------------------------------------------------------------------------------------------ */
/* Top lists                                                                                    */
/* ------------------------------------------------------------------------------------------ */

const topRebuilds = new Map<GameSlug, Promise<TopList>>()
/** Tolerated clock difference between function instances when comparing timestamps. */
const CLOCK_SLACK_MS = 5_000

async function buildFromRows(game: GameSlug): Promise<TopList> {
  const listedAt = Date.now()
  const scores = store('scores')
  const keys = await listKeys(scores, `${game}/`)
  const rows = await mapLimit(keys, 16, async (key): Promise<TopRow | null> => {
    const row = parseScoreRow(await scores.get(key, { type: 'json' }))
    const id = key.slice(game.length + 1)
    return row && isId(id) ? { id, name: row.name, score: row.score, at: row.at } : null
  })
  const snapshot = buildTopList(
    rows.filter((r): r is TopRow => r !== null),
    listedAt,
  )
  const stored = await updateCache(`top/${game}`, parseTopList, (current) => {
    if (current && current.builtAt >= listedAt) return undefined // a newer rebuild already landed
    // scores merged while this rebuild was reading rows are kept, deleted (moderated) rows are not
    return current ? carryLateRows(snapshot, current, listedAt - CLOCK_SLACK_MS) : snapshot
  })
  return stored ?? snapshot
}

/**
 * Reads every score row of a game (bounded concurrency) and rewrites `arcade-cache/top/<game>`.
 * Concurrent background rebuilds share one run per instance; `fresh` ones (the caller just wrote
 * a row that must be included) always start a new one.
 */
export function rebuildTopList(game: GameSlug, fresh = false): Promise<TopList> {
  if (fresh) return buildFromRows(game)
  let pending = topRebuilds.get(game)
  if (!pending) {
    pending = buildFromRows(game).finally(() => topRebuilds.delete(game))
    topRebuilds.set(game, pending)
  }
  return pending
}

/**
 * The cached top list; rebuilt synchronously when missing, in the background when older than
 * CACHE_TTL_MS (the stale list is served meanwhile).
 */
export async function getTopList(context: Context, game: GameSlug): Promise<TopList> {
  const cached = parseTopList(await store('cache').get(`top/${game}`, { type: 'json' }))
  if (!cached) return rebuildTopList(game)
  if (Date.now() - cached.builtAt > CACHE_TTL_MS) later(context, rebuildTopList(game))
  return cached
}

/**
 * Puts a freshly saved score into the cached top list and returns the list the response is
 * ranked on. Compare-and-swap, so two players submitting at the same moment never drop each
 * other's rows; without a cached list it is rebuilt from the rows, which include this one.
 */
export async function mergeScore(context: Context, game: GameSlug, row: TopRow, previousScore: number | null): Promise<TopList> {
  const merged = await updateCache(`top/${game}`, parseTopList, (current) => (current ? placeRow(current, row, previousScore) : undefined))
  if (!merged) return rebuildTopList(game, true)
  if (Date.now() - merged.builtAt > CACHE_TTL_MS) later(context, rebuildTopList(game))
  return merged
}

/** After a rename: patch the cached list so the new name shows up before the next rebuild. */
export async function renameInTopList(game: GameSlug, playerId: string, name: string): Promise<void> {
  await updateCache(`top/${game}`, parseTopList, (current) =>
    current && current.entries.some((e) => e.id === playerId && e.name !== name)
      ? { ...current, entries: current.entries.map((e) => (e.id === playerId ? { ...e, name } : e)) }
      : undefined,
  )
}

/** The player's own row as a TopRow, read straight from `arcade-scores` (always current). */
export async function readOwnRow(game: GameSlug, playerId: string): Promise<TopRow | null> {
  const row = parseScoreRow(await store('scores').get(`${game}/${playerId}`, { type: 'json' }))
  return row ? { id: playerId, name: row.name, score: row.score, at: row.at } : null
}
