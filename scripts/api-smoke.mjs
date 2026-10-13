#!/usr/bin/env node
/**
 * Smoke test for the arcade's online API (docs/ONLINE.md).
 *
 *   npx netlify dev                              # site + functions + local Blobs sandbox on :8888
 *   node scripts/api-smoke.mjs [baseUrl]         # default http://localhost:8888
 *
 * 1. Unit-tests the pure helpers of netlify/lib/arcade.ts (validation, names, presence buckets,
 *    ranking) – Node 22 strips the TypeScript types itself.
 * 2. Exercises every endpoint. Each run uses fresh random players and sessions and checks counts
 *    relative to what the API reported at the start, so it can be re-run against the same store.
 *    Never point it at production: it writes test players and scores.
 *
 * Exits with code 1 if any check fails.
 */
import { randomUUID } from 'node:crypto'
import * as A from '../netlify/lib/arcade.ts'

const base = (process.argv[2] ?? 'http://localhost:8888').replace(/\/$/, '')
let passed = 0
const failures = []

function check(ok, label, detail) {
  if (ok) {
    passed++
    console.log(`  ok    ${label}`)
  } else {
    failures.push(label)
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `\n        ${JSON.stringify(detail)}`}`)
  }
}
const section = (title) => console.log(`\n${title}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------------------------------ */
/* 1. pure helpers                                                                              */
/* ------------------------------------------------------------------------------------------ */

section('unit · validation')
check(A.isId('abcd-123') && A.isId(randomUUID()), 'ids: 8–64 chars of a-z 0-9 -')
check(!A.isId('abc') && !A.isId('ABCDEFGH') && !A.isId('a'.repeat(65)) && !A.isId('abcd_123') && !A.isId(12345678), 'ids: too short / upper case / too long / underscore / number rejected')
check(A.parseScore(0) === 0 && A.parseScore(A.MAX_SCORE) === A.MAX_SCORE, 'score: 0 and 5,000,000 accepted')
check(
  [-1, A.MAX_SCORE + 1, 1.5, '100', NaN, Infinity, null, undefined].every((v) => A.parseScore(v) === null),
  'score: negative, too big, fraction, string, NaN, Infinity, null rejected',
)
check(
  A.clampInt('500', 1, 100, 50) === 100 && A.clampInt('x', 1, 100, 50) === 50 && A.clampInt(null, 1, 10, 5) === 5 && A.clampInt('0', 1, 10, 5) === 1,
  'clampInt: clamps and falls back',
)
check(A.isPresenceGame('hub') && !A.isGameSlug('hub') && A.GAME_SLUGS.length === 6, 'hub is a presence game, not a leaderboard game')

section('unit · names')
const nameOk = (raw, expected) => {
  const r = A.checkName(raw)
  check(r.ok && r.name === expected, `name ${JSON.stringify(raw)} → ${JSON.stringify(expected)}`, r)
}
const nameBad = (raw, error) => {
  const r = A.checkName(raw)
  check(!r.ok && r.error === error && r.message.length > 10, `name ${JSON.stringify(raw)} rejected (${error})`, r)
}
nameOk('  Claus \t  Laikku ', 'Claus Laikku')
nameOk('Äijä_99', 'Äijä_99')
nameOk('Łukasz.K-1', 'Łukasz.K-1')
nameOk('李小龍', '李小龍')
nameOk('Jose\u0301', 'Jos\u00e9') // decomposed accent → NFC
nameBad('A', 'invalid-name')
nameBad('x'.repeat(17), 'invalid-name')
nameBad('<script>', 'invalid-name')
nameBad('...', 'invalid-name')
nameBad('Bob 🙂', 'invalid-name')
nameBad('zero​width', 'invalid-name')
nameBad(42, 'invalid-name')
nameBad('Vittu', 'blocked-name')
nameBad('f.u.c.k-er', 'blocked-name')
nameBad('Sh1t Head', 'blocked-name')
nameBad('kusipää', 'blocked-name')
check(['Nazir', 'Fukuda', 'Pornainen', 'Scott', 'Dickens', 'Hancock', 'Assi', 'Therese'].every((n) => !A.isBlockedName(n)), 'blocklist leaves ordinary names alone')

section('unit · presence buckets')
const cur = A.bucketOf(Date.UTC(2026, 9, 13, 12, 0, 15))
check(A.bucketOf(cur * A.BUCKET_MS) === cur && A.bucketOf(cur * A.BUCKET_MS - 1) === cur - 1, 'bucket = floor(now / 30 s)')
const sid = (n) => `sess-${String(n).padStart(4, '0')}`
const keys = [
  `${cur}/ticket-slash/${sid(1)}`, // current bucket
  `${cur - 1}/hub/${sid(2)}`, // previous bucket → still online
  `${cur - 2}/bug-breaker/${sid(3)}`, // two buckets old → offline
  `${cur - 1}/hub/${sid(4)}`, // moved hub → game: the newest bucket wins
  `${cur}/network-connect/${sid(4)}`,
  `${cur}/hub/${sid(5)}`, // two keys in one bucket: the game beats the hub
  `${cur}/signal-command/${sid(5)}`,
  `${cur}/minecraft/${sid(6)}`, // ignored: unknown game, bad session id, garbage
  `${cur}/hub/BAD`,
  'garbage',
]
const now = A.summarizePresence(keys, cur)
check(now.online === 4, `online = sessions 1, 2, 4, 5 (got ${now.online})`)
check(
  now.onlineByGame['ticket-slash'] === 1 &&
    now.onlineByGame.hub === 1 &&
    now.onlineByGame['network-connect'] === 1 &&
    now.onlineByGame['signal-command'] === 1 &&
    now.onlineByGame['bug-breaker'] === 0,
  'per-game counts deduped by session',
  now.onlineByGame,
)
check(A.summarizePresence(keys, cur + 1).online === 3, '30 s later only sessions with a key in the (now) previous bucket remain')
check(A.summarizePresence(keys, cur + 2).online === 0, '60 s later everybody has expired')
const stale = A.staleKeys([...keys, `${cur - 3}/hub/${sid(7)}`, `${cur - 900}/hub/${sid(8)}`], cur)
check(
  stale.includes(`${cur - 3}/hub/${sid(7)}`) &&
    stale.includes(`${cur - 900}/hub/${sid(8)}`) &&
    stale.includes('garbage') &&
    !stale.includes(`${cur - 2}/bug-breaker/${sid(3)}`) &&
    !stale.includes(`${cur}/ticket-slash/${sid(1)}`),
  'clean-up targets buckets older than current - 2 (and garbage keys)',
  stale,
)
check(A.staleKeys(Array.from({ length: 500 }, (_, i) => `${cur - 10}/hub/${sid(i)}`), cur).length === 200, 'clean-up is capped at 200 deletes per call')

section('unit · ranking')
const row = (id, score, at) => ({ id, name: id, score, at })
let top = A.buildTopList([row('pa', 100, 5), row('pb', 300, 9), row('pc', 300, 3), row('pd', 50, 1)], 1000)
check(top.entries.map((r) => r.id).join() === 'pc,pb,pa,pd', 'sorted by score; a tie goes to whoever got there first')
top = A.placeRow(top, row('pd', 400, 20), 50)
check(top.entries[0].id === 'pd' && top.total === 4, 'an improved row moves up, total unchanged')
top = A.placeRow(top, row('pe', 10, 30), null)
check(top.total === 5 && A.rankOf(top, 'pe', 10) === 5, 'a new player is added at the right rank')
const many = Array.from({ length: 150 }, (_, i) => row(`p${String(i).padStart(3, '0')}`, 1000 - i, i))
let big = A.buildTopList(many, 0)
check(big.entries.length === A.TOP_SIZE && big.tail.length === 50 && big.total === 150, 'top list keeps 100 rows, the rest as tail scores')
check(A.rankOf(big, 'p120', 880) === 121, 'ranks beyond the top list come from the tail scores')
big = A.placeRow(big, row('p149', 2000, 999), 851)
check(big.entries[0].id === 'p149' && big.entries.length === 100 && big.tail.length === 50 && big.total === 150, 'a tail player jumps to #1 and #100 drops into the tail')
// a rebuild that listed rows at t=100 s keeps scores merged into the cache meanwhile (at ≥ t − 5 s)
// but drops old rows that are gone from arcade-scores (moderation)
const snapshot = A.buildTopList([row('pa', 100, 10_000), row('pb', 50, 10_000)], 100_000)
const cachedNow = A.buildTopList([row('pa', 100, 10_000), row('pz', 70, 10_000), row('pn', 80, 100_500), row('pb', 90, 100_200)], 0)
const carried = A.carryLateRows(snapshot, cachedNow, 95_000)
check(
  carried.entries.map((r) => `${r.id}:${r.score}`).join() === 'pa:100,pb:90,pn:80' && carried.total === 3 && carried.builtAt === 100_000,
  'rebuild keeps rows merged during it, drops deleted ones',
  carried.entries,
)
const shown = A.toEntries(big.entries, 3, 'p149')
check(shown.length === 3 && shown[0].you === true && shown[1].you === undefined && !('id' in shown[0]), 'entries mark the viewer and never carry ids')

/* ------------------------------------------------------------------------------------------ */
/* 2. endpoints                                                                                 */
/* ------------------------------------------------------------------------------------------ */

async function api(method, path, body, rawBody) {
  const init = { method, headers: {} }
  if (rawBody !== undefined || body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = rawBody ?? JSON.stringify(body)
  }
  const res = await fetch(base + path, init)
  const json = (res.headers.get('content-type') ?? '').includes('application/json')
  return { status: res.status, json, data: json ? await res.json() : await res.text(), headers: res.headers }
}
const post = (path, body, rawBody) => api('POST', path, body, rawBody)
const get = (path) => api('GET', path)
const tag = String(Math.floor(1000 + Math.random() * 9000))
const P = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID() }
const S = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID() }
const NAME = { a: `Smoke ${tag} A`, b: `Smoke ${tag} B`, c: `Smoke ${tag} C`, x: `Renamed ${tag}` }
const leaks = (data) => Object.values(P).some((p) => JSON.stringify(data).includes(p))

section(`api · ${base}`)
let first
try {
  first = await get('/api/stats')
} catch (err) {
  console.log(`  cannot reach ${base}: ${err.message}\n  start it with: npx netlify dev`)
  process.exit(1)
}
if (!first.json) {
  console.log(`  ${base}/api/stats did not answer with JSON (status ${first.status}) – is this \`netlify dev\`?`)
  process.exit(1)
}
check(first.status === 200 && typeof first.data.online === 'number' && typeof first.data.players === 'number' && typeof first.data.updatedAt === 'number', 'GET /api/stats → Stats')
check(Object.keys(first.data.onlineByGame).sort().join() === [...A.PRESENCE_GAMES].sort().join(), 'onlineByGame: six games + hub')
check(Object.keys(first.data.playersByGame).sort().join() === [...A.GAME_SLUGS].sort().join(), 'playersByGame: six games')
check(first.headers.get('cache-control') === 'no-store', 'responses are not cached')

section('api · presence')
// keep every heartbeat of this section inside one 30 s bucket, so sessions left over from an
// earlier run cannot expire half-way and skew the deltas
const left = A.BUCKET_MS - (Date.now() % A.BUCKET_MS)
if (left < 8000) {
  console.log(`  (waiting ${Math.ceil(left / 1000)} s for a fresh bucket)`)
  await sleep(left + 300)
}
const beat = (s, p, game) => post('/api/presence', { sessionId: s, playerId: p, game })
const h0 = await beat(S.a, P.a, 'hub')
check(h0.status === 200 && h0.data.onlineByGame.hub >= 1, 'hub heartbeat → Stats')
const b0 = h0.data
await beat(S.b, P.b, 'ticket-slash')
await beat(S.c, P.c, 'ticket-slash')
const h1 = await beat(S.d, P.a, 'bug-breaker')
const d = (k) => h1.data.onlineByGame[k] - b0.onlineByGame[k]
check(h1.data.online - b0.online === 3, `three more sessions online (${b0.online} → ${h1.data.online})`)
check(d('ticket-slash') === 2 && d('bug-breaker') === 1 && d('hub') === 0, 'online per game: ticket-slash +2, bug-breaker +1, hub +0', h1.data.onlineByGame)
// +3, not +2: player A's earlier hub visit did not register A – only opening a game does
check(h1.data.players - b0.players === 3, `players so far +3 – a hub visit alone does not count (${b0.players} → ${h1.data.players})`)
check(
  h1.data.playersByGame['ticket-slash'] - b0.playersByGame['ticket-slash'] === 2 &&
    h1.data.playersByGame['bug-breaker'] - b0.playersByGame['bug-breaker'] === 1 &&
    h1.data.playersByGame['network-connect'] === b0.playersByGame['network-connect'],
  'players per game: ticket-slash +2, bug-breaker +1',
)
const h2 = await beat(S.b, P.b, 'network-connect')
check(
  h2.data.online === h1.data.online &&
    h2.data.onlineByGame['ticket-slash'] === h1.data.onlineByGame['ticket-slash'] - 1 &&
    h2.data.onlineByGame['network-connect'] === h1.data.onlineByGame['network-connect'] + 1,
  'a session that switches games is counted once, for its new game',
)
check(h2.data.players === h1.data.players && h2.data.playersByGame['network-connect'] === h1.data.playersByGame['network-connect'] + 1, 'a known player in a new game: +1 for that game, total unchanged')
const h3 = await beat(S.b, P.b, 'network-connect')
check(h3.status === 200 && h3.data.online === h2.data.online && h3.data.players === h2.data.players, 'repeated heartbeats change nothing')

const bad = async (label, res, status, error) => {
  check(res.status === status && res.json && (error === undefined || res.data.error === error), `${label} → ${status}${error ? ` ${error}` : ''}`, res.json ? res.data : res.status)
}
await bad('presence without sessionId', await post('/api/presence', { playerId: P.a, game: 'hub' }), 400, 'invalid-session')
await bad('presence with a short sessionId', await post('/api/presence', { sessionId: 'short', playerId: P.a, game: 'hub' }), 400, 'invalid-session')
await bad('presence with an upper-case playerId', await post('/api/presence', { sessionId: S.a, playerId: P.a.toUpperCase(), game: 'hub' }), 400, 'invalid-player')
await bad('presence for an unknown game', await post('/api/presence', { sessionId: S.a, playerId: P.a, game: 'minecraft' }), 400, 'invalid-game')
await bad('presence with a broken JSON body', await post('/api/presence', undefined, '{"sessionId":'), 400, 'invalid-json')
await bad('presence with a JSON array', await post('/api/presence', [S.a, P.a, 'hub']), 400, 'invalid-json')
await bad('presence with a 2 KB body', await post('/api/presence', { sessionId: S.a, playerId: P.a, game: 'hub', pad: 'x'.repeat(2048) }), 413, 'too-large')
const wrongMethod = await get('/api/presence')
check(!(wrongMethod.status === 200 && wrongMethod.json), `GET /api/presence is not served by the function (${wrongMethod.status})`)

section('api · scores')
const score = (p, name, game, value) => post('/api/score', { playerId: p, name, game, score: value })
const s1 = await score(P.a, NAME.a, 'ticket-slash', 1200)
check(s1.status === 200 && s1.data.improved === true && s1.data.best === 1200 && s1.data.rank >= 1 && s1.data.total >= 1, `first score → improved, rank #${s1.data.rank} of ${s1.data.total}`, s1.data)
check(Array.isArray(s1.data.entries) && s1.data.entries.length <= 10 && !leaks(s1.data), 'response carries the top 10, no player ids')
const s2 = await score(P.a, NAME.a, 'ticket-slash', 1500)
check(s2.status === 429 && s2.data.error === 'throttled' && Number(s2.headers.get('retry-after')) >= 1, 'a second score within 3 s → 429 + Retry-After')
await bad('score -1', await score(P.a, NAME.a, 'ticket-slash', -1), 400, 'invalid-score')
await bad('score 12.5', await score(P.a, NAME.a, 'ticket-slash', 12.5), 400, 'invalid-score')
await bad('score 5,000,001', await score(P.a, NAME.a, 'ticket-slash', 5_000_001), 400, 'invalid-score')
await bad('score "100" (string)', await score(P.a, NAME.a, 'ticket-slash', '100'), 400, 'invalid-score')
await bad('score NaN (→ null)', await score(P.a, NAME.a, 'ticket-slash', NaN), 400, 'invalid-score')
await bad('score for the hub', await score(P.a, NAME.a, 'hub', 10), 400, 'invalid-game')
await bad('score with a bad playerId', await score('nope', NAME.a, 'ticket-slash', 10), 400, 'invalid-player')
await bad('score with a 1-letter name', await score(P.a, 'A', 'ticket-slash', 10), 400, 'invalid-name')
await bad('score with an HTML name', await score(P.a, '<b>hi</b>', 'ticket-slash', 10), 400, 'invalid-name')
await bad('score without a name', await score(P.a, undefined, 'ticket-slash', 10), 400, 'invalid-name')
const blocked = await score(P.a, 'Vittu Mitä', 'ticket-slash', 10)
await bad('score with a blocklisted name', blocked, 400, 'blocked-name')
check(typeof blocked.data.message === 'string' && /another/.test(blocked.data.message), `friendly message: "${blocked.data.message}"`)
await bad('score with a 2 KB body', await post('/api/score', { playerId: P.a, name: NAME.a, game: 'ticket-slash', score: 1, pad: 'x'.repeat(2048) }), 413, 'too-large')

await score(P.b, NAME.b, 'ticket-slash', 5000)
await score(P.c, NAME.c, 'ticket-slash', 300)
await sleep(3100)
const s3 = await score(P.a, NAME.a, 'ticket-slash', 900)
check(s3.status === 200 && s3.data.improved === false && s3.data.best === 1200, 'a worse score → improved: false, best stays 1,200', s3.data)
await sleep(3100)
const s4 = await score(P.a, NAME.a, 'ticket-slash', 2500)
check(s4.status === 200 && s4.data.improved === true && s4.data.best === 2500, 'a better score → improved: true, best 2,500')

// Concurrency. Production Blobs evaluates onlyIfNew / onlyIfMatch atomically; the local sandbox
// of `netlify dev` checks the condition and then writes with awaits in between, so two requests
// landing in the same millisecond can both pass there. Locally a lost race is reported as a note.
const local = /\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(`${base}/`)
const raceCheck = (ok, label, detail) => {
  if (ok || !local) check(ok, label, detail)
  else console.log(`  note  ${label} – lost the race in the local Blobs sandbox (non-atomic conditional writes)`)
}
const race = await Promise.all([score(P.d, `Race ${tag}`, 'signal-command', 40), score(P.d, `Race ${tag}`, 'signal-command', 50)])
const codes = race.map((r) => r.status).sort().join()
raceCheck(codes === '200,429', `two tabs of one player submitting at once → one 200, one 429 (${codes})`)
const D = { e: randomUUID(), f: randomUUID() }
await Promise.all([score(D.e, `Duo ${tag} E`, 'access-crossing', 610), score(D.f, `Duo ${tag} F`, 'access-crossing', 620)])
const duo = await get('/api/leaderboard?game=access-crossing&limit=100')
const duoNames = duo.data.entries.map((e) => e.name)
raceCheck(duoNames.includes(`Duo ${tag} E`) && duoNames.includes(`Duo ${tag} F`), 'two players submitting at once both land in the cached top list')

section('api · leaderboard')
const lb = await get(`/api/leaderboard?game=ticket-slash&limit=100&player=${P.a}`)
check(lb.status === 200 && lb.data.game === 'ticket-slash' && Array.isArray(lb.data.entries) && typeof lb.data.total === 'number', 'GET ?game&limit&player → { game, entries, total, you }')
const ranks = lb.data.entries.map((e) => e.rank)
const scores = lb.data.entries.map((e) => e.score)
check(ranks.every((r, i) => r === i + 1) && scores.every((s, i) => i === 0 || scores[i - 1] >= s), 'entries are ranked 1..n by score')
const idx = (name) => lb.data.entries.findIndex((e) => e.name === name)
check(idx(NAME.b) >= 0 && idx(NAME.b) < idx(NAME.a) && idx(NAME.a) < idx(NAME.c), 'seeded players in order: B 5,000 > A 2,500 > C 300')
check(lb.data.you && lb.data.you.name === NAME.a && lb.data.you.score === 2500 && lb.data.you.you === true, 'you = the viewer’s own row', lb.data.you)
check(lb.data.you.rank === idx(NAME.a) + 1 && lb.data.entries[idx(NAME.a)].you === true, `you.rank (#${lb.data.you.rank}) matches the list and the row is marked`)
check(lb.data.entries.filter((e) => e.you).length === 1, 'exactly one row marked as you')
check(s4.data.rank === lb.data.you.rank, `rank from POST /api/score (#${s4.data.rank}) = leaderboard rank`)
check(!leaks(lb.data) && lb.data.entries.every((e) => Object.keys(e).every((k) => ['rank', 'name', 'score', 'ts', 'you'].includes(k))), 'entries expose only rank, name, score, ts, you')
const lb1 = await get(`/api/leaderboard?game=ticket-slash&limit=1&player=${P.c}`)
check(lb1.data.entries.length === 1 && lb1.data.you && lb1.data.you.rank > 1 && lb1.data.you.name === NAME.c, `limit=1: top row only, you (#${lb1.data.you?.rank}) outside the list`)
const lbAnon = await get('/api/leaderboard?game=ticket-slash')
check(lbAnon.status === 200 && lbAnon.data.you === undefined && lbAnon.data.entries.length <= 50 && lbAnon.data.entries.every((e) => !e.you), 'no player → default limit 50, no you')
const lbBig = await get('/api/leaderboard?game=ticket-slash&limit=9999')
check(lbBig.status === 200 && lbBig.data.entries.length <= A.TOP_SIZE, 'limit is clamped to 100')
const boards = await get(`/api/leaderboard?limit=3&player=${P.b}`)
check(
  boards.status === 200 && Object.keys(boards.data.boards).sort().join() === [...A.GAME_SLUGS].sort().join(),
  'GET ?limit=3 (no game) → { boards } for all six games',
)
check(Object.values(boards.data.boards).every((b) => b.entries.length <= 3 && typeof b.total === 'number'), 'each board: ≤ 3 entries + total')
check(boards.data.boards['ticket-slash'].entries.some((e) => e.you && e.name === NAME.b) || boards.data.boards['ticket-slash'].entries.every((e) => e.score >= 5000), 'boards mark the viewer (B, 5,000) when in the top 3')
await bad('leaderboard for an unknown game', await get('/api/leaderboard?game=minecraft'), 400, 'invalid-game')
await bad('leaderboard with a bad player id', await get('/api/leaderboard?game=ticket-slash&player=X'), 400, 'invalid-player')

section('api · rename')
await sleep(3100)
const bb = await score(P.a, NAME.a, 'bug-breaker', 777)
check(bb.status === 200, 'second game for player A (bug-breaker 777)')
const rn = await post('/api/name', { playerId: P.a, name: `  ${NAME.x}  ` })
check(rn.status === 200 && rn.data.name === NAME.x && rn.data.updated === 2, `rename → { name, updated: 2 }`, rn.data)
const after = await get(`/api/leaderboard?game=ticket-slash&limit=100&player=${P.a}`)
check(after.data.you?.name === NAME.x && after.data.entries.some((e) => e.you && e.name === NAME.x) && !after.data.entries.some((e) => e.name === NAME.a), 'leaderboard shows the new name right away')
const again = await post('/api/name', { playerId: P.a, name: NAME.x })
check(again.status === 200 && again.data.updated === 0, 'same name again → updated: 0')
const fresh = await post('/api/name', { playerId: randomUUID(), name: `Nobody ${tag}` })
check(fresh.status === 200 && fresh.data.updated === 0, 'a player without scores can pick a name → updated: 0')
await bad('rename to a blocklisted name', await post('/api/name', { playerId: P.a, name: 'paska' }), 400, 'blocked-name')
await bad('rename to a 20-letter name', await post('/api/name', { playerId: P.a, name: 'x'.repeat(20) }), 400, 'invalid-name')
await bad('rename with a bad playerId', await post('/api/name', { playerId: 'x', name: 'Valid Name' }), 400, 'invalid-player')

section('api · stats after the run')
const end = await get('/api/stats')
check(end.status === 200 && typeof end.data.online === 'number', `GET /api/stats → online ${end.data.online}, players ${end.data.players}`)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
