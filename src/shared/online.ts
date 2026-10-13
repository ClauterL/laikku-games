/**
 * Client side of the arcade's online layer (docs/ONLINE.md): player identity, presence
 * heartbeat, live stats, leaderboard calls and score reporting.
 *
 * Everything here fails quietly. The API only exists on Netlify (or under `netlify dev`); on
 * `vite dev`, `vite preview`, GitHub Pages or without network every call resolves to an
 * "offline" result, the store's status becomes 'offline' and the UI shows its quiet offline
 * state. After a failure nothing is requested for 60 s (doubling up to 10 min while the API
 * keeps failing), so a missing API costs a few requests per hour – never a console storm.
 */
import { useSyncExternalStore } from 'react'
import { GAMES } from '../games'
import { loadJSON, saveJSON } from './storage'

/* ---------- types ---------------------------------------------------------------------- */

export type OnlineStatus = 'unknown' | 'online' | 'offline'

export interface Stats {
  online: number
  /** Per game slug plus `hub`. */
  onlineByGame: Record<string, number>
  players: number
  playersByGame: Record<string, number>
  updatedAt: number
}

export interface Entry {
  rank: number
  name: string
  score: number
  /** When the score was set (ms since epoch). */
  ts: number
  you?: boolean
}

export interface Board {
  game: string
  entries: Entry[]
  total: number
  you?: Entry
}

export interface Boards {
  boards: Record<string, { entries: Entry[]; total: number }>
}

export interface ScoreResult {
  game: string
  rank: number
  total: number
  best: number
  improved: boolean
  entries: Entry[]
}

/**
 * `offline` – the API is not there (the UI shows its offline state). Otherwise the request failed
 * on its own: refused by the API (`status` 4xx) or a one-off timeout / network error (`status` 0).
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; offline: boolean; status: number; error?: string; message?: string }

/** `submitBest()` in storage.ts dispatches this – storage.ts must not import this module. */
export interface ScoreEventDetail {
  game: string
  score: number
}

declare global {
  interface WindowEventMap {
    'havaida:score': CustomEvent<ScoreEventDetail>
  }
}

export const MAX_SCORE = 5_000_000
const SLUGS = new Set(GAMES.map((g) => g.slug))

/* ---------- state store (status, live stats, player name) -------------------------------- */

export interface OnlineState {
  status: OnlineStatus
  stats: Stats | null
  name: string
}

let state: OnlineState = { status: 'unknown', stats: null, name: readStoredName() }
const listeners = new Set<() => void>()

function update(patch: Partial<OnlineState>): void {
  const next = { ...state, ...patch }
  if (next.status === state.status && next.stats === state.stats && next.name === state.name) return
  state = next
  for (const fn of listeners) fn()
}

export function subscribeOnline(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const getOnlineState = (): OnlineState => state

/** Live `{ status, stats, name }` for React components. */
export function useOnline(): OnlineState {
  return useSyncExternalStore(subscribeOnline, getOnlineState, getOnlineState)
}

function publishStats(data: unknown): void {
  const s = data as Partial<Stats> | null
  if (s && typeof s.online === 'number' && typeof s.players === 'number' && s.onlineByGame && s.playersByGame) {
    update({ stats: s as Stats })
  }
}

/* ---------- identity --------------------------------------------------------------------- */

const ID_RE = /^[a-z0-9-]{8,64}$/

function newId(): string {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* insecure context (http on a LAN address) – fall through */
  }
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

let playerId = ''
/** Anonymous, persistent per browser (localStorage). Never shown to other players. */
export function getPlayerId(): string {
  if (!playerId) {
    const stored = loadJSON<unknown>('online:player', '')
    playerId = typeof stored === 'string' && ID_RE.test(stored) ? stored : newId()
    if (playerId !== stored) saveJSON('online:player', playerId)
  }
  return playerId
}

const SESSION_KEY = 'havaida-games:online:session'
let sessionId = ''
/** One per tab: sessionStorage survives reloads, so a reload is not counted as a second visitor. */
function getSessionId(): string {
  if (!sessionId) {
    try {
      sessionId = sessionStorage.getItem(SESSION_KEY) ?? ''
    } catch {
      /* storage blocked */
    }
    if (!ID_RE.test(sessionId)) {
      sessionId = newId()
      try {
        sessionStorage.setItem(SESSION_KEY, sessionId)
      } catch {
        /* keep it in memory */
      }
    }
  }
  return sessionId
}

/* ---------- names ------------------------------------------------------------------------ */

export type NameCheck = { ok: true; name: string } | { ok: false; message: string }

const NAME_CHARS = /^[\p{L}0-9 ._-]+$/u
const HAS_LETTER_OR_DIGIT = /[\p{L}0-9]/u

/** Same rules as the server (minus the blocklist, which only lives on the server). */
export function checkName(raw: string): NameCheck {
  const name = raw.normalize('NFC').replace(/\s+/gu, ' ').trim()
  const length = [...name].length
  if (length < 2 || length > 16) return { ok: false, message: 'Names are 2–16 characters long.' }
  if (!NAME_CHARS.test(name) || !HAS_LETTER_OR_DIGIT.test(name)) {
    return { ok: false, message: 'Use letters, digits, spaces and - _ . only.' }
  }
  return { ok: true, name }
}

function readStoredName(): string {
  const stored = loadJSON<unknown>('online:name', '')
  return typeof stored === 'string' && checkName(stored).ok ? stored : ''
}

function storeName(name: string): void {
  saveJSON('online:name', name)
  update({ name })
}

/* ---------- fetch wrapper ---------------------------------------------------------------- */

const API = '/api'
const TIMEOUT_MS = 6_000
const BACKOFF_MS = 60_000
const BACKOFF_MAX_MS = 10 * 60_000
/** Timeouts (and, once online, network errors) only count as "offline" after this long without a success. */
const GRACE_MS = 20_000
/** Answers that prove the API exists even though it refused this particular request. */
const REFUSALS = new Set([400, 409, 413, 429])
const OFFLINE = { ok: false, offline: true, status: 0 } as const
const UNAVAILABLE = { ok: false, offline: false, status: 0, error: 'unavailable' } as const

let offlineUntil = 0
let failures = 0
let troubleSince = 0
/**
 * In development the first contact (and every retry after a failure) is a GET: the plain Vite
 * dev server answers it with index.html – silently, which reads as offline – whereas a POST
 * would print a 404 in the console. Production builds go straight to the heartbeat POST.
 */
let verified = !import.meta.env.DEV

function markOffline(): void {
  if (Date.now() >= offlineUntil) {
    failures++
    offlineUntil = Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_MS * 2 ** (failures - 1))
  }
  troubleSince = 0
  if (import.meta.env.DEV) verified = false
  update({ status: 'offline' })
}

function markOnline(): void {
  failures = 0
  offlineUntil = 0
  troubleSince = 0
  update({ status: 'online' })
}

/**
 * No answer at all. One slow moment – a cold function, a burst of parallel requests, a dev server
 * still busy serving modules – must not switch the whole online layer off for a minute: a timeout
 * (or any failure once the API has answered) only counts as offline when it persists for GRACE_MS
 * without a success. Wrong answers (HTML, 404, 5xx) are different: offline straight away.
 */
function noAnswer<T>(timedOut: boolean): ApiResult<T> {
  const now = Date.now()
  if (state.status === 'online' || (state.status === 'unknown' && timedOut)) {
    troubleSince ||= now
    if (now - troubleSince < GRACE_MS) return UNAVAILABLE
  }
  markOffline()
  return OFFLINE
}

async function call<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  if (Date.now() < offlineUntil) return OFFLINE
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, TIMEOUT_MS)
  try {
    const init: RequestInit =
      body === undefined
        ? { cache: 'no-store', signal: ctrl.signal }
        : {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          }
    let res: Response
    let data: unknown
    try {
      res = await fetch(API + path, init)
      // Dev servers and static hosts answer unknown paths with index.html or an HTML 404 page.
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
        markOffline()
        return OFFLINE
      }
      data = await res.json()
    } catch {
      return noAnswer<T>(timedOut)
    }
    if (res.ok) {
      markOnline()
      return { ok: true, data: data as T }
    }
    if (!REFUSALS.has(res.status)) {
      markOffline()
      return OFFLINE
    }
    markOnline()
    const d = (data ?? {}) as { error?: unknown; message?: unknown }
    return {
      ok: false,
      offline: false,
      status: res.status,
      error: typeof d.error === 'string' ? d.error : undefined,
      message: typeof d.message === 'string' ? d.message : undefined,
    }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------- presence heartbeat ----------------------------------------------------------- */

const HEARTBEAT_MS = 30_000
/** After a request that got no answer (see noAnswer) the heartbeat tries again sooner. */
const RETRY_MS = 5_000
const MIN_GAP_MS = 2_000

let presenceGame = 'hub'
let users = 0
let beatTimer: ReturnType<typeof setTimeout> | undefined
let inflight = false
let lastBeat = 0

function schedule(ms: number): void {
  clearTimeout(beatTimer)
  beatTimer = setTimeout(() => void beat(), Math.max(0, ms))
}

async function beat(): Promise<void> {
  if (users === 0 || document.hidden || inflight) return
  const now = Date.now()
  if (now < offlineUntil) return schedule(offlineUntil - now + 500)
  if (now - lastBeat < MIN_GAP_MS) return schedule(lastBeat + MIN_GAP_MS - now)
  inflight = true
  lastBeat = now
  const game = presenceGame
  let res: ApiResult<Stats> = UNAVAILABLE
  try {
    if (!verified) {
      res = await call<Stats>('/stats')
      if (res.ok) {
        verified = true
        publishStats(res.data)
      }
    }
    if (verified) {
      res = await call<Stats>('/presence', { sessionId: getSessionId(), playerId: getPlayerId(), game })
      if (res.ok) publishStats(res.data)
    }
  } finally {
    inflight = false
  }
  if (users === 0 || document.hidden) return
  if (game !== presenceGame) return schedule(0)
  if (res.ok || res.status >= 400) schedule(HEARTBEAT_MS)
  else schedule(res.offline ? offlineUntil - Date.now() + 500 : RETRY_MS)
}

function onVisibility(): void {
  if (document.hidden) clearTimeout(beatTimer)
  else schedule(0)
}

/** Starts the heartbeat (ref-counted, StrictMode-safe). Returns the matching stop function. */
export function startPresence(): () => void {
  users++
  if (users === 1) {
    document.addEventListener('visibilitychange', onVisibility)
    schedule(0)
  }
  return () => {
    users--
    if (users === 0) {
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(beatTimer)
    }
  }
}

/** Game slug or `hub`. A change sends a heartbeat right away (debounced to absorb redirects). */
export function setPresenceGame(game: string): void {
  if (game === presenceGame) return
  presenceGame = game
  if (users > 0) schedule(250)
}

/* ---------- reads ------------------------------------------------------------------------ */

const CACHE_MS = 20_000
const readCache = new Map<string, { at: number; data: unknown }>()

async function cachedGet<T>(path: string): Promise<ApiResult<T>> {
  const hit = readCache.get(path)
  if (hit && Date.now() - hit.at < CACHE_MS) return { ok: true, data: hit.data as T }
  const res = await call<T>(path)
  if (res.ok) readCache.set(path, { at: Date.now(), data: res.data })
  return res
}

/** Top `limit` of one game plus the viewer's own row (`you`). Cached for 20 s. */
export function fetchLeaderboard(game: string, limit = 50): Promise<ApiResult<Board>> {
  return cachedGet<Board>(`/leaderboard?game=${encodeURIComponent(game)}&limit=${limit}&player=${getPlayerId()}`)
}

/** Top `limit` of every game in one request. Cached for 20 s. */
export function fetchBoards(limit = 5): Promise<ApiResult<Boards>> {
  return cachedGet<Boards>(`/leaderboard?limit=${limit}&player=${getPlayerId()}`)
}

export async function fetchStats(): Promise<ApiResult<Stats>> {
  const res = await call<Stats>('/stats')
  if (res.ok) publishStats(res.data)
  return res
}

/* ---------- writes ----------------------------------------------------------------------- */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Submits a score under `name` (default: the saved name). A name the server accepts is saved. */
export async function submitScore(game: string, score: number, name = state.name): Promise<ApiResult<ScoreResult>> {
  const body = { playerId: getPlayerId(), name, game, score }
  let res = await call<ScoreResult>('/score', body)
  if (!res.ok && res.status === 429) {
    // the server accepts one score per game every 3 s
    await sleep(3_200)
    res = await call<ScoreResult>('/score', body)
  }
  if (res.ok) {
    readCache.clear()
    if (name !== state.name) storeName(name)
  }
  return res
}

/** Validates locally, then renames the player on the server (all of their leaderboard rows). */
export async function setPlayerName(raw: string): Promise<ApiResult<{ name: string; updated: number }>> {
  const checked = checkName(raw)
  if (!checked.ok) return { ok: false, offline: false, status: 400, error: 'invalid-name', message: checked.message }
  const res = await call<{ name: string; updated: number }>('/name', { playerId: getPlayerId(), name: checked.name })
  if (res.ok) {
    readCache.clear()
    storeName(res.data.name)
  }
  return res
}

/* ---------- score reports ---------------------------------------------------------------- */

export interface ReportedScore {
  game: string
  score: number
}

const REPORT_DEBOUNCE_MS = 1_500
const scoreListeners = new Set<(s: ReportedScore) => void>()
const pendingReports = new Map<string, { score: number; timer: ReturnType<typeof setTimeout> }>()

/**
 * Called for every finished run or level. Reports are debounced per game (keeping the highest)
 * because some games call `submitBest` twice in quick succession.
 */
export function reportScore(game: string, score: number): void {
  if (!SLUGS.has(game) || !Number.isFinite(score)) return
  const value = Math.round(score)
  if (value <= 0 || value > MAX_SCORE) return
  const pending = pendingReports.get(game)
  if (pending) clearTimeout(pending.timer)
  const best = Math.max(pending?.score ?? 0, value)
  const timer = setTimeout(() => {
    pendingReports.delete(game)
    for (const fn of scoreListeners) fn({ game, score: best })
  }, REPORT_DEBOUNCE_MS)
  pendingReports.set(game, { score: best, timer })
}

export function onReportedScore(fn: (s: ReportedScore) => void): () => void {
  scoreListeners.add(fn)
  return () => {
    scoreListeners.delete(fn)
  }
}

/** Forwards `havaida:score` window events (dispatched by `submitBest`) to `reportScore`. */
export function listenForScores(): () => void {
  const onScore = (e: CustomEvent<ScoreEventDetail>) => {
    const d = e.detail
    if (d && typeof d.game === 'string' && typeof d.score === 'number') reportScore(d.game, d.score)
  }
  window.addEventListener('havaida:score', onScore)
  return () => window.removeEventListener('havaida:score', onScore)
}
