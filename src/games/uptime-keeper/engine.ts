/**
 * Uptime Keeper – game engine (plain TypeScript, no React).
 *
 * The rules live in sim.ts (pure, headless-testable). This file owns
 * everything around them: input (keyboard, tap-to-move with A*, virtual
 * joystick), the technician's movement and reach, the camera, effects and
 * sounds for simulation events, level flow + persistence, and the HUD
 * view-model that React renders.
 */
import { fitCanvas, observeResize, pointerPos, startLoop } from '../../shared/canvas'
import { burst, updateFloatTexts, updateParticles, type FloatText, type Particle } from '../../shared/draw'
import { clamp, damp } from '../../shared/math'
import { sfx, type SfxName } from '../../shared/sfx'
import { getBest, loadJSON, saveJSON, submitBest } from '../../shared/storage'
import { COLORS } from './glyphs'
import { actionViews, alertView, detailForAlert, detailForTarget, idleActions, nominalDetail } from './hudtext'
import { SLA_FAIL, SLA_PASS, getLevel, levelIntro, levelTitle } from './levels'
import { BODY_HX, BODY_HY, accessCell, blocked, clearLine, findPath, nearestWalkable, smoothPath } from './pathfind'
import { boxOf, buildPipes, buildStatic, drawMiniMap, drawScene, miniMapTransform, type Fx, type PipeCache, type Scene, type StaticLayer, type StickView } from './render'
import {
  MAX_UPGRADE,
  WARN_TEMP,
  alertFor,
  anyCritical,
  canCool,
  cancelRepair,
  cheapestUpgrade,
  createWorld,
  doCool,
  doUpgrade,
  freshCarry,
  levelDone,
  powerRatio,
  repairKindFor,
  spawnFault,
  starsFor,
  startRepair,
  stepWorld,
  targetName,
  upgradeFor,
  uptimeOf,
} from './sim'
import type { ActionKind, Alert, AlertType, Banner, Carry, Dir, HudState, Layout, Phase, Pt, SimEvent, World } from './types'

export const SLUG = 'uptime-keeper'
const SAVE_KEY = `${SLUG}:save`
const PREFS_KEY = `${SLUG}:prefs`
const UPTIME_KEY = `${SLUG}:uptime`

/** Tiles per second. */
const SPEED = 4.5
/** How close (tile units, from the feet to the footprint) counts as "next to". */
const REACH = 0.62
const MOVE_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'])

export interface EngineCallbacks {
  onHud: (hud: HudState) => void
  onPhase: (phase: Phase) => void
}

interface SaveData {
  level: number
  carry: Carry
}

function loadSave(): SaveData | null {
  const raw = loadJSON<Partial<SaveData> | null>(SAVE_KEY, null)
  if (!raw || typeof raw.level !== 'number' || !raw.carry || !raw.carry.upgrades) return null
  const up = raw.carry.upgrades
  const lv = (v: unknown) => clamp(Math.floor(Number(v) || 1), 1, MAX_UPGRADE)
  const servers: Record<string, number> = {}
  for (const [id, v] of Object.entries(raw.carry.servers ?? {})) servers[id] = lv(v)
  return {
    level: clamp(Math.floor(raw.level), 1, 999),
    carry: {
      upgrades: { cooling: lv(up.cooling), network: lv(up.network), spares: clamp(Math.floor(Number(up.spares) || 0), 0, 9) },
      servers,
      credits: Math.max(0, Math.floor(Number(raw.carry.credits) || 0)),
      score: Math.max(0, Math.floor(Number(raw.carry.score) || 0)),
    },
  }
}

const cloneCarry = (c: Carry): Carry => ({ upgrades: { ...c.upgrades }, servers: { ...c.servers }, credits: c.credits, score: c.score })

export function layoutFor(w: number, h: number): Layout {
  if (w < 720 && h >= w) return 'portrait'
  if (h < 520) return 'landscape'
  return 'desktop'
}

/** Screen area the HUD leaves free – mirrors the panel sizes in uptime-keeper.css. */
function insetsFor(layout: Layout, W: number) {
  if (layout === 'portrait') return { l: 0, t: 152, r: 0, b: 178 }
  if (layout === 'landscape') return { l: 178, t: 52, r: 8, b: 88 }
  return { l: W < 1000 ? 242 : 286, t: 120, r: 12, b: 138 }
}

export function initialHud(): HudState {
  const save = loadSave()
  return {
    layout: typeof window === 'undefined' ? 'desktop' : layoutFor(window.innerWidth, window.innerHeight),
    touch: false,
    level: 1,
    levelTitle: levelTitle(1),
    score: 0,
    credits: 0,
    uptime: '100.000',
    uptimeTone: 'ok',
    uptimeSegs: 8,
    uptimeDrop: false,
    timeLeft: getLevel(1).duration,
    progress: 0,
    cooling: 100,
    power: 0,
    network: 100,
    alerts: [],
    detail: nominalDetail(false),
    actions: idleActions(false),
    repairPct: -1,
    spares: 0,
    banner: null,
    tip: null,
    critical: false,
    upgrades: { cooling: 1, network: 1 },
    clear: null,
    over: null,
    best: getBest(SLUG),
    savedLevel: save ? save.level : 1,
    joystick: loadJSON<{ joystick?: boolean }>(PREFS_KEY, {}).joystick !== false,
    scrolling: false,
  }
}

interface HookApi {
  state: () => unknown
  moveTo: (targetId: string) => boolean
  act: (action: ActionKind | 'smart') => boolean
  spawn: (type: AlertType, targetId?: string, value?: number) => boolean
  setLevel: (n: number) => void
  /** Screen position of a target's front face (for taps in the scenario). */
  screenPos: (targetId: string) => Pt | null
  /** Fast-forwards the simulation. */
  skip: (seconds: number) => void
  /** Jumps to the end of the shift. */
  finish: () => void
  /** Average milliseconds to draw and rasterise one canvas frame over `n` frames. */
  bench: (n: number) => number
}

declare global {
  interface Window {
    __uptimeKeeper?: HookApi
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export class Engine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cb: EngineCallbacks
  private disposers: (() => void)[] = []
  private destroyed = false

  private W = 1
  private H = 1
  private dpr = 1
  private layout: Layout = 'desktop'
  private touch = false
  /** A real finger has touched the canvas – keep the touch UI even in the desktop layout. */
  private sawTouch = false
  private T = 48
  private safe = { l: 286, t: 120, r: 12, b: 138 }
  private cam = { x: 0, y: 0 }
  private camSnap = true
  private scrolling = false
  private staticLayer: StaticLayer | null = null
  private pipes: PipeCache | null = null
  private staticKey = ''
  private mapCanvas: HTMLCanvasElement | null = null
  private mapTick = 0

  phase: Phase = 'start'
  private levelN = 1
  /** What the player had when the current level started (used by retry). */
  private carry: Carry = freshCarry()
  private nextCarry: Carry | null = null
  private world: World
  private best = getBest(SLUG)
  private savedLevel = 1

  private player = { x: 0, y: 0, dir: 'down' as Dir, walk: 0, moving: false }
  private actKind: ActionKind | null = null
  private actTimer = 0
  private keys = new Set<string>()
  private path: Pt[] = []
  private pathGoal: string | null = null
  private stuck = 0
  private targetId: string | null = null
  private selectedId: string | null = null
  private tap: { x: number; y: number; t: number } | null = null

  private joystickOn = true
  private stick = { x: 60, y: 300, r: 46, dx: 0, dy: 0, active: false, pointerId: -1 }

  private t = 0
  private fx: Fx[] = []
  private particles: Particle[] = []
  private floats: FloatText[] = []
  private shake = 0
  private ambient = 0
  private sparkT = 0
  private soundAt: Partial<Record<SfxName, number>> = {}

  private banner: Banner | null = null
  private bannerT = 0
  private bannerSeq = 0
  private hint: string | null = null
  private hintT = 0
  private clear: HudState['clear'] = null
  private over: HudState['over'] = null
  private hudT = 0
  private hudForce = true
  private hudSig = ''

  private scene: Scene

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas
    this.cb = cb
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas not supported')
    this.ctx = ctx
    const save = loadSave()
    this.savedLevel = save ? save.level : 1
    this.joystickOn = loadJSON<{ joystick?: boolean }>(PREFS_KEY, {}).joystick !== false
    this.world = createWorld(getLevel(1), freshCarry(), Math.random)
    this.placePlayer()
    this.scene = {
      W: 1,
      H: 1,
      T: this.T,
      camX: 0,
      camY: 0,
      shakeX: 0,
      shakeY: 0,
      time: 0,
      world: this.world,
      staticLayer: null,
      pipes: null,
      player: { x: 0, y: 0, dir: 'down', walk: 0, moving: false, act: null, repair: -1 },
      targetId: null,
      selectedId: null,
      guideId: null,
      path: this.path,
      tap: null,
      fx: this.fx,
      particles: this.particles,
      floats: this.floats,
      safe: this.safe,
      scrolling: false,
      stick: null,
      live: false,
    }

    this.disposers.push(observeResize(canvas, () => this.resize()))
    this.disposers.push(
      startLoop(
        (dt) => this.update(dt),
        () => this.render(),
      ),
    )
    const onDown = (e: PointerEvent) => this.onPointerDown(e)
    const onMove = (e: PointerEvent) => this.onPointerMove(e)
    const onUp = (e: PointerEvent) => this.onPointerUp(e)
    const onKeyDown = (e: KeyboardEvent) => this.onKeyDown(e)
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase())
    const onBlur = () => this.releaseInput()
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    this.disposers.push(() => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    })

    if (import.meta.env.DEV) this.installHook()
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const d of this.disposers) d()
    this.disposers = []
    this.mapCanvas = null
  }

  /* ---------------------------------------------------------------- */
  /* public API used by the React component                            */
  /* ---------------------------------------------------------------- */

  /** Starts a run: `continue` resumes the saved level with its upgrades, `new` starts over. */
  start(mode: 'new' | 'continue' = 'new') {
    const save = mode === 'continue' ? loadSave() : null
    if (save) this.loadLevel(save.level, save.carry)
    else {
      saveJSON(SAVE_KEY, { level: 1, carry: freshCarry() } satisfies SaveData)
      this.savedLevel = 1
      this.loadLevel(1, freshCarry())
    }
    this.setPhase('playing')
  }

  nextLevel() {
    if (this.phase !== 'clear') return
    if (this.nextCarry) this.loadLevel(this.levelN + 1, this.nextCarry)
    else this.loadLevel(this.levelN, this.carry)
    this.setPhase('playing')
  }

  /** Replays the current level with what the player had when it started. */
  retryLevel() {
    this.loadLevel(this.levelN, this.carry)
    this.setPhase('playing')
  }

  togglePause() {
    if (this.phase === 'playing') {
      this.releaseInput()
      this.setPhase('paused')
    } else if (this.phase === 'paused') this.setPhase('playing')
  }

  resume() {
    if (this.phase === 'paused') this.setPhase('playing')
  }

  setJoystick(on: boolean) {
    this.joystickOn = on
    saveJSON(PREFS_KEY, { joystick: on })
    this.hudForce = true
  }

  /** The mini-map lives in the HUD; the engine draws into it. */
  attachMap(el: HTMLCanvasElement | null) {
    this.mapCanvas = el
  }

  /** Tap on the mini-map: walk to that spot (fx, fy are 0–1 inside the map canvas). */
  mapTap(fx: number, fy: number) {
    if (this.phase !== 'playing' || !this.mapCanvas) return
    const mw = this.mapCanvas.clientWidth
    const mh = this.mapCanvas.clientHeight
    const tr = miniMapTransform(this.world.hall, mw, mh)
    this.goTo((fx * mw - tr.ox) / tr.sc, (fy * mh - tr.oy) / tr.sc)
  }

  /** Objective row / chip: highlight the target, and walk there when asked to. */
  selectAlert(alertId: number, walk: boolean) {
    if (this.phase !== 'playing') return
    const a = this.world.alerts.find((x) => x.id === alertId)
    if (!a) return
    this.selectedId = a.targetId
    if (walk) this.walkTo(a.targetId)
    this.playSound('tap', 0)
    this.hudForce = true
  }

  act(kind: ActionKind): boolean {
    if (this.phase !== 'playing') return false
    const w = this.world
    const id = this.targetId
    const view = actionViews(w, id)[kind]
    if (!id || !view.enabled) {
      this.deny(view.hint)
      return false
    }
    this.face(id)
    this.path.length = 0
    this.pathGoal = null
    if (kind === 'cool') doCool(w, id)
    else if (kind === 'repair') {
      if (!startRepair(w, id)) return false
      this.playSound('click', 0)
    } else if (!doUpgrade(w, id)) return false
    this.actKind = kind
    this.actTimer = 0.5
    this.hudForce = true
    return true
  }

  /** E / Space: whatever makes sense at the current target. */
  smartAct(): boolean {
    const w = this.world
    const id = this.targetId
    if (!id) {
      this.deny(this.touch ? 'Tap a rack to walk there first' : 'Stand next to a rack or a unit first')
      return false
    }
    if (repairKindFor(w, id).kind) return this.act('repair')
    const r = w.rackById.get(id)
    const cool = canCool(w, id).ok
    if (r && cool && (r.temp >= 60 || r.hotspotTarget > 0 || r.down || !!alertFor(w, id, 'heat'))) return this.act('cool')
    if (upgradeFor(w, id)?.ok) return this.act('upgrade')
    if (cool) return this.act('cool')
    this.deny(`Nothing to do at ${targetName(w, id)} right now`)
    return false
  }

  /* ---------------------------------------------------------------- */
  /* level flow                                                        */
  /* ---------------------------------------------------------------- */

  private loadLevel(n: number, carry: Carry) {
    this.levelN = n
    this.carry = cloneCarry(carry)
    this.nextCarry = null
    this.world = createWorld(getLevel(n), carry, Math.random)
    this.placePlayer()
    this.path.length = 0
    this.pathGoal = null
    this.targetId = null
    this.selectedId = null
    this.tap = null
    this.actKind = null
    this.fx.length = 0
    this.particles.length = 0
    this.floats.length = 0
    this.banner = null
    this.hint = null
    this.clear = null
    this.over = null
    this.shake = 0
    this.releaseInput()
    this.staticKey = ''
    this.relayout()
    this.hudForce = true
  }

  private placePlayer() {
    const s = this.world.hall.start
    this.player.x = s.x
    this.player.y = s.y
    this.player.dir = 'down'
    this.player.moving = false
  }

  private setPhase(p: Phase) {
    this.phase = p
    this.hudForce = true
    this.cb.onPhase(p)
  }

  private finishLevel() {
    const w = this.world
    const uptime = uptimeOf(w)
    const stars = starsFor(uptime)
    const passed = stars > 0
    const bonus = stars * 100
    if (passed) {
      w.credits += bonus
      w.score += bonus
    }
    const score = Math.floor(w.score)
    this.best = submitBest(SLUG, score)
    const bests = loadJSON<Record<string, number>>(UPTIME_KEY, {})
    const prev = Number(bests[String(this.levelN)]) || 0
    const isBest = passed && uptime > prev
    if (isBest) {
      bests[String(this.levelN)] = uptime
      saveJSON(UPTIME_KEY, bests)
    }
    if (passed) {
      this.nextCarry = this.currentCarry()
      this.savedLevel = this.levelN + 1
      saveJSON(SAVE_KEY, { level: this.savedLevel, carry: this.nextCarry } satisfies SaveData)
    }
    const next = passed ? this.levelN + 1 : this.levelN
    this.clear = {
      level: this.levelN,
      title: levelTitle(this.levelN),
      uptime: uptime.toFixed(3),
      stars,
      passed,
      score,
      credits: Math.floor(w.credits),
      bonus,
      resolved: w.resolved,
      shutdowns: w.shutdowns,
      autoCools: w.autoCools,
      nextLevel: next,
      nextTitle: levelTitle(next),
      nextIntro: levelIntro(next),
      bestUptime: Math.max(prev, passed ? uptime : 0).toFixed(3),
      isBest,
    }
    this.releaseInput()
    sfx.play(passed ? 'win' : 'lose')
    this.setPhase('clear')
  }

  /** Everything the player takes along to the next hall. */
  private currentCarry(): Carry {
    const w = this.world
    const servers = { ...this.carry.servers }
    for (const r of w.racks) if (r.serverLevel > 1) servers[r.id] = r.serverLevel
    return { upgrades: { ...w.upgrades }, servers, credits: Math.floor(w.credits), score: Math.floor(w.score) }
  }

  private gameOver(reason: string) {
    const w = this.world
    const score = Math.floor(w.score)
    const prevBest = this.best
    this.best = submitBest(SLUG, score)
    this.over = { reason, uptime: uptimeOf(w).toFixed(3), score, level: this.levelN, best: this.best, isBest: score > prevBest && score > 0 }
    this.releaseInput()
    this.shake = 12
    sfx.play('lose')
    this.setPhase('over')
  }

  /* ---------------------------------------------------------------- */
  /* layout + camera                                                   */
  /* ---------------------------------------------------------------- */

  private resize() {
    const size = fitCanvas(this.canvas)
    this.W = size.width
    this.H = size.height
    this.dpr = size.dpr
    this.layout = layoutFor(this.W, this.H)
    this.touch = this.sawTouch || this.layout !== 'desktop' || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
    this.relayout()
    this.hudForce = true
  }

  private relayout() {
    const hall = this.world.hall
    const safe = insetsFor(this.layout, this.W)
    this.safe.l = safe.l
    this.safe.t = safe.t
    this.safe.r = safe.r
    this.safe.b = safe.b
    const sw = Math.max(80, this.W - safe.l - safe.r)
    const sh = Math.max(80, this.H - safe.t - safe.b)
    const fitW = sw / hall.cols
    const fitH = sh / hall.rows
    const fit = Math.floor(Math.min(fitW, fitH))
    const z = this.layout === 'desktop' ? { lo: 40, hi: 76, base: 48, cap: 48 } : this.layout === 'portrait' ? { lo: 38, hi: 48, base: 40, cap: 48 } : { lo: 32, hi: 44, base: 36, cap: 40 }
    // A hall that fits is zoomed to fill the free area. One that cannot fit scrolls with the
    // technician: then use the comfortable base tile, or more if that fills the short side.
    this.T = fit >= z.lo ? Math.min(fit, z.hi) : clamp(Math.floor(Math.max(fitW, fitH)), z.base, z.cap)
    this.scrolling = hall.cols * this.T > sw + 1 || hall.rows * this.T > sh + 1
    const key = `${this.levelN}:${hall.cols}x${hall.rows}:${this.T}:${this.dpr}`
    if (key !== this.staticKey) {
      this.staticKey = key
      this.pipes = buildPipes(hall, this.T)
      this.staticLayer = buildStatic(hall, this.pipes, this.T, this.dpr)
      // effects are stored in pixels of the old tile size
      this.fx.length = 0
      this.particles.length = 0
      this.floats.length = 0
    }
    if (this.layout === 'landscape') {
      this.stick.r = 44
      this.stick.x = 16 + this.stick.r
      this.stick.y = this.H - 14 - this.stick.r
    } else {
      this.stick.r = 46
      this.stick.x = 18 + this.stick.r
      this.stick.y = this.H - safe.b - 14 - this.stick.r
    }
    this.camSnap = true
  }

  private updateCamera(dt: number) {
    const hall = this.world.hall
    const T = this.T
    const s = this.safe
    const sw = this.W - s.l - s.r
    const sh = this.H - s.t - s.b
    const hw = hall.cols * T
    const hh = hall.rows * T
    const margin = T * 0.35
    const tx = hw <= sw + 1 ? -(s.l + (sw - hw) / 2) : clamp(this.player.x * T - (s.l + sw / 2), -s.l - margin, hw - (this.W - s.r) + margin)
    const ty = hh <= sh + 1 ? -(s.t + (sh - hh) / 2) : clamp((this.player.y - 0.4) * T - (s.t + sh / 2), -s.t - margin, hh - (this.H - s.b) + margin)
    if (this.camSnap) {
      this.cam.x = tx
      this.cam.y = ty
      this.camSnap = false
    } else {
      this.cam.x = damp(this.cam.x, tx, 6, dt)
      this.cam.y = damp(this.cam.y, ty, 6, dt)
    }
  }

  /* ---------------------------------------------------------------- */
  /* input                                                             */
  /* ---------------------------------------------------------------- */

  private releaseInput() {
    this.keys.clear()
    this.stick.active = false
    this.stick.dx = 0
    this.stick.dy = 0
    this.stick.pointerId = -1
  }

  private stickVisible() {
    return this.touch && this.joystickOn && this.phase === 'playing'
  }

  private onPointerDown(e: PointerEvent) {
    if (this.phase !== 'playing') return
    sfx.unlock()
    if (e.pointerType === 'touch' && !this.touch) {
      this.sawTouch = true
      this.touch = true
      this.hudForce = true
    }
    const p = pointerPos(this.canvas, e)
    if (this.stickVisible() && !this.stick.active && Math.hypot(p.x - this.stick.x, p.y - this.stick.y) <= this.stick.r * 1.45) {
      this.stick.active = true
      this.stick.pointerId = e.pointerId
      try {
        this.canvas.setPointerCapture(e.pointerId)
      } catch {
        /* synthetic pointers cannot be captured – the stick still works while the finger stays on the canvas */
      }
      this.moveStick(p)
      return
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return
    this.goTo((p.x + this.cam.x) / this.T, (p.y + this.cam.y) / this.T)
  }

  private onPointerMove(e: PointerEvent) {
    if (this.stick.active && e.pointerId === this.stick.pointerId) this.moveStick(pointerPos(this.canvas, e))
  }

  private onPointerUp(e: PointerEvent) {
    if (this.stick.active && e.pointerId === this.stick.pointerId) {
      this.stick.active = false
      this.stick.dx = 0
      this.stick.dy = 0
      this.stick.pointerId = -1
    }
  }

  private moveStick(p: Pt) {
    let dx = (p.x - this.stick.x) / (this.stick.r * 0.62)
    let dy = (p.y - this.stick.y) / (this.stick.r * 0.62)
    const d = Math.hypot(dx, dy)
    if (d > 1) {
      dx /= d
      dy /= d
    }
    this.stick.dx = dx
    this.stick.dy = dy
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (this.phase === 'paused') {
      if ((k === 'escape' || k === 'p') && !e.repeat) this.togglePause()
      return
    }
    if (this.phase !== 'playing') return
    if (MOVE_KEYS.has(k)) {
      this.keys.add(k)
      e.preventDefault()
      return
    }
    if (k === ' ' || k === 'enter') e.preventDefault()
    if (e.repeat) return
    sfx.unlock()
    if (k === '1') this.act('cool')
    else if (k === '2') this.act('repair')
    else if (k === '3') this.act('upgrade')
    else if (k === 'e' || k === ' ' || k === 'enter') this.smartAct()
    else if (k === 'escape' || k === 'p') this.togglePause()
    else if (k === 'r') this.retryLevel()
  }

  /* ---------------------------------------------------------------- */
  /* movement                                                          */
  /* ---------------------------------------------------------------- */

  /** Sprite under a point in tile space (front-most wins). */
  private hitTest(x: number, y: number): string | null {
    const w = this.world
    let best: string | null = null
    let bestBase = -Infinity
    const consider = (id: string) => {
      const b = boxOf(w, id)
      if (!b) return
      // the floating badge above a target is part of its tap area
      const top = alertFor(w, id) ? b.y - 0.75 : b.y
      if (x >= b.x && x <= b.x + b.w && y >= top && y <= b.y + b.h && b.base > bestBase) {
        best = id
        bestBase = b.base
      }
    }
    for (const r of w.racks) consider(r.id)
    for (const s of w.stations) consider(s.id)
    return best
  }

  /** Tap / click / map tap at a point in tile space. */
  private goTo(x: number, y: number) {
    const hall = this.world.hall
    const id = this.hitTest(x, y)
    if (id) {
      this.selectedId = id
      this.walkTo(id)
      this.tap = null
      this.playSound('tap', 0)
      this.hudForce = true
      return
    }
    const cx = clamp(Math.floor(x), 0, hall.cols - 1)
    const cy = clamp(Math.floor(y), 0, hall.rows - 1)
    const cell = nearestWalkable(hall, cx, cy)
    if (!cell) return
    const from = { x: Math.floor(this.player.x), y: Math.floor(this.player.y) }
    const cells = findPath(hall, from, cell)
    if (!cells) return
    const pts = smoothPath(hall, this.player, cells)
    // finish on the exact spot when the tap itself is standable
    if (cell.x === cx && cell.y === cy && !blocked(hall, x, y)) {
      const prev = pts.length > 1 ? pts[pts.length - 2] : this.player
      if (clearLine(hall, prev, { x, y })) {
        if (pts.length) pts[pts.length - 1] = { x, y }
        else pts.push({ x, y })
      }
    }
    this.setPath(pts, null)
    const end = pts.length ? pts[pts.length - 1] : { x: cell.x + 0.5, y: cell.y + 0.5 }
    this.tap = { x: end.x, y: end.y, t: 0 }
    if (this.selectedId && !alertFor(this.world, this.selectedId)) this.selectedId = null
    this.hudForce = true
  }

  private setPath(pts: Pt[], goal: string | null) {
    this.path.length = 0
    for (const p of pts) this.path.push(p)
    this.pathGoal = goal
    this.stuck = 0
  }

  /** Walks next to a rack or unit (A* to the best free cell beside it). */
  walkTo(id: string): boolean {
    const w = this.world
    const hall = w.hall
    const r = w.rackById.get(id)
    const s = w.stationById.get(id)
    const foot = r ? { cx: r.cx, cy: r.cy, w: 1, h: 1 } : s
    if (!foot) return false
    if (this.reachDist(foot) <= REACH) {
      this.path.length = 0
      this.pathGoal = null
      this.face(id)
      return true
    }
    const cell = accessCell(hall, foot.cx, foot.cy, foot.w, foot.h, this.player, s ? s.facing : 'down')
    if (!cell) return false
    const cells = findPath(hall, { x: Math.floor(this.player.x), y: Math.floor(this.player.y) }, cell)
    if (!cells) return false
    this.setPath(smoothPath(hall, this.player, cells), id)
    return true
  }

  private reachDist(f: { cx: number; cy: number; w: number; h: number }) {
    const dx = Math.max(f.cx - this.player.x, 0, this.player.x - (f.cx + f.w))
    const dy = Math.max(f.cy - this.player.y, 0, this.player.y - (f.cy + f.h))
    return Math.hypot(dx, dy)
  }

  private face(id: string) {
    const b = boxOf(this.world, id)
    if (!b) return
    const dx = b.fx - this.player.x
    const dy = b.base - 0.5 - this.player.y
    this.player.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
  }

  /** Axis-separated move with a little corner assist so the technician slides around cabinet edges. */
  private tryMove(dx: number, dy: number) {
    const hall = this.world.hall
    const p = this.player
    if (dx !== 0) {
      if (!blocked(hall, p.x + dx, p.y)) p.x += dx
      else if (dy === 0) {
        const nudge = Math.abs(dx)
        if (!blocked(hall, p.x + dx, p.y - BODY_HY * 2.2) && !blocked(hall, p.x, p.y - nudge)) p.y -= nudge
        else if (!blocked(hall, p.x + dx, p.y + BODY_HY * 2.2) && !blocked(hall, p.x, p.y + nudge)) p.y += nudge
      }
    }
    if (dy !== 0) {
      if (!blocked(hall, p.x, p.y + dy)) p.y += dy
      else if (dx === 0) {
        const nudge = Math.abs(dy)
        if (!blocked(hall, p.x - BODY_HX * 1.6, p.y + dy) && !blocked(hall, p.x - nudge, p.y)) p.x -= nudge
        else if (!blocked(hall, p.x + BODY_HX * 1.6, p.y + dy) && !blocked(hall, p.x + nudge, p.y)) p.x += nudge
      }
    }
  }

  private updatePlayer(dt: number) {
    const p = this.player
    let ix = 0
    let iy = 0
    const k = this.keys
    if (k.has('arrowleft') || k.has('a')) ix -= 1
    if (k.has('arrowright') || k.has('d')) ix += 1
    if (k.has('arrowup') || k.has('w')) iy -= 1
    if (k.has('arrowdown') || k.has('s')) iy += 1
    let speed = SPEED
    if (ix === 0 && iy === 0 && this.stick.active) {
      const d = Math.hypot(this.stick.dx, this.stick.dy)
      if (d > 0.22) {
        ix = this.stick.dx
        iy = this.stick.dy
        speed = SPEED * clamp(d, 0.45, 1)
      }
    }
    const ox = p.x
    const oy = p.y
    let vx = 0
    let vy = 0
    if (ix !== 0 || iy !== 0) {
      // manual control always wins over a tapped route
      this.path.length = 0
      this.pathGoal = null
      const d = Math.hypot(ix, iy)
      vx = (ix / d) * speed
      vy = (iy / d) * speed
      this.tryMove(vx * dt, vy * dt)
    } else if (this.path.length) {
      const wp = this.path[0]
      const dx = wp.x - p.x
      const dy = wp.y - p.y
      const d = Math.hypot(dx, dy)
      const step = SPEED * dt
      if (d <= step) {
        this.tryMove(dx, dy)
        this.path.shift()
      } else {
        vx = (dx / d) * SPEED
        vy = (dy / d) * SPEED
        this.tryMove(vx * dt, vy * dt)
      }
      if (!this.path.length && this.pathGoal) {
        this.face(this.pathGoal)
        this.pathGoal = null
      }
    }
    const moved = Math.hypot(p.x - ox, p.y - oy)
    p.moving = moved > 0.0005
    if (p.moving) {
      p.walk += dt * 13
      if (Math.abs(vx) > Math.abs(vy) * 1.15) p.dir = vx > 0 ? 'right' : 'left'
      else if (Math.abs(vy) > Math.abs(vx) * 1.15) p.dir = vy > 0 ? 'down' : 'up'
      this.stuck = 0
    } else if (this.path.length) {
      // a route can only stall on a corner the smoothing misjudged – drop it instead of jittering
      this.stuck += dt
      if (this.stuck > 0.35) {
        this.path.length = 0
        this.pathGoal = null
      }
    }
  }

  /** Picks the rack / unit the technician is standing next to. */
  private updateTarget() {
    const w = this.world
    let best: string | null = null
    let bestScore = Infinity
    const consider = (id: string, f: { cx: number; cy: number; w: number; h: number }) => {
      const d = this.reachDist(f)
      if (d > REACH) return
      const a = alertFor(w, id)
      const score = d - (a ? (a.type === 'upgrade' ? 0.12 : 0.3) : 0) - (id === this.selectedId ? 0.2 : 0) - (id === this.targetId ? 0.05 : 0)
      if (score < bestScore) {
        bestScore = score
        best = id
      }
    }
    for (const r of w.racks) consider(r.id, { cx: r.cx, cy: r.cy, w: 1, h: 1 })
    for (const s of w.stations) consider(s.id, s)
    if (best !== this.targetId) {
      this.targetId = best
      this.hudForce = true
    }
    // a repair only continues while the technician stays at the job
    const rep = w.repair
    if (rep) {
      const r = w.rackById.get(rep.targetId)
      const f = r ? { cx: r.cx, cy: r.cy, w: 1, h: 1 } : w.stationById.get(rep.targetId)
      if (!f || this.reachDist(f) > REACH + 0.2) {
        cancelRepair(w)
        this.float(rep.targetId, 'REPAIR INTERRUPTED', '#ff8a92', 16)
        this.playSound('denied', 0.3)
        this.hudForce = true
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* feedback                                                          */
  /* ---------------------------------------------------------------- */

  private playSound(name: SfxName, minGap: number) {
    const last = this.soundAt[name] ?? -99
    if (this.t - last < minGap) return
    this.soundAt[name] = this.t
    sfx.play(name)
  }

  private deny(why: string) {
    this.hint = why
    this.hintT = 2.4
    this.playSound('denied', 0.35)
    this.hudForce = true
  }

  private showBanner(text: string, sub: string, tone: Banner['tone']) {
    this.banner = { id: ++this.bannerSeq, text, sub, tone }
    this.bannerT = 3.4
    this.hudForce = true
  }

  private float(id: string, text: string, color: string, size = 20) {
    const b = boxOf(this.world, id)
    if (!b) return
    const T = this.T
    // stack texts that appear on the same target in the same moment
    let n = 0
    for (const f of this.floats) if (Math.abs(f.x - b.ax * T) < 2 && f.maxLife - f.life < 0.25) n++
    this.floats.push({ x: b.ax * T, y: (b.ay - 0.2) * T - n * (size + 2), text, color, life: 1.3, maxLife: 1.3, size })
    if (this.floats.length > 24) this.floats.shift()
  }

  private pushFx(f: Fx) {
    if (this.fx.length > 240) this.fx.shift()
    this.fx.push(f)
  }

  private mist(id: string, count: number) {
    const b = boxOf(this.world, id)
    if (!b) return
    const T = this.T
    for (let i = 0; i < count; i++) {
      const life = rand(0.6, 1.3)
      this.pushFx({ kind: 'mist', x: (b.fx + rand(-0.5, 0.5)) * T, y: (b.fy + rand(-0.8, 0.5)) * T, vx: rand(-18, 18), vy: rand(-34, -6), life, max: life, size: T * rand(0.1, 0.22), color: '#d7f3ff' })
    }
    this.pushFx({ kind: 'ring', x: b.fx * T, y: b.fy * T, vx: 0, vy: 0, life: 0.5, max: 0.5, size: T * 0.28, color: COLORS.cooling })
  }

  private sparks(id: string, count: number, colors: string[]) {
    const b = boxOf(this.world, id)
    if (!b) return
    const T = this.T
    if (this.particles.length > 160) this.particles.splice(0, this.particles.length - 160)
    burst(this.particles, (b.fx + rand(-0.25, 0.25)) * T, (b.fy + rand(-0.2, 0.2)) * T, count, colors, { speed: T * 3.4, life: 0.45, size: T * 0.09, gravity: T * 12, shape: 'spark' })
  }

  private chevrons(id: string, color: string) {
    const b = boxOf(this.world, id)
    if (!b) return
    const T = this.T
    for (let i = 0; i < 9; i++) {
      const life = rand(0.7, 1.1)
      this.pushFx({ kind: 'chev', x: (b.fx + rand(-0.4, 0.4)) * T, y: (b.fy + 0.4 + i * 0.12) * T, vx: 0, vy: -T * rand(1.4, 2.2), life, max: life, size: T * rand(0.1, 0.16), color })
    }
    this.pushFx({ kind: 'ring', x: b.fx * T, y: b.fy * T, vx: 0, vy: 0, life: 0.55, max: 0.55, size: T * 0.3, color })
  }

  private smoke(id: string, count: number) {
    const b = boxOf(this.world, id)
    if (!b) return
    const T = this.T
    for (let i = 0; i < count; i++) {
      const life = rand(0.8, 1.5)
      this.pushFx({ kind: 'smoke', x: (b.ax + rand(-0.3, 0.3)) * T, y: (b.ay + 0.1) * T, vx: rand(-10, 10), vy: -T * rand(0.5, 1), life, max: life, size: T * rand(0.1, 0.18), color: '#2b2f38' })
    }
  }

  private onEvent(e: SimEvent) {
    const w = this.world
    switch (e.kind) {
      case 'alert':
        if (e.alert.type === 'upgrade') this.playSound('pop', 1)
        else this.playSound('alarm', 0.8)
        break
      case 'resolved':
        if (e.credits > 0) {
          this.float(e.targetId, `+${e.credits}`, '#ffe45c', 22)
          this.playSound('good', 0.1)
        }
        if (this.selectedId === e.targetId && !alertFor(w, e.targetId)) this.selectedId = null
        break
      case 'shutdown': {
        if (e.reason === 'power') break // one banner for the whole zone comes with the battery event
        const r = w.rackById.get(e.rackId)
        this.showBanner('SERVICE DOWN', `${r?.name ?? 'Rack'} ${e.reason === 'heat' ? 'hit 100 °C and shut down' : 'lost both power supplies'}`, 'alert')
        this.smoke(e.rackId, 8)
        this.sparks(e.rackId, 16, ['#ff2d3a', '#ffb020', '#ffffff'])
        this.shake = 9
        this.playSound('explode', 0.2)
        break
      }
      case 'battery': {
        const st = w.stationById.get(e.stationId)
        this.showBanner('SERVICE DOWN', `${st?.name ?? 'PDU'} battery empty – ${e.racks} racks are dark`, 'alert')
        this.sparks(e.stationId, 18, ['#ffb020', '#ff2d3a', '#ffffff'])
        this.shake = 11
        this.playSound('explode', 0.2)
        break
      }
      case 'reboot': {
        const b = boxOf(w, e.rackId)
        if (b) this.pushFx({ kind: 'ring', x: b.fx * this.T, y: b.fy * this.T, vx: 0, vy: 0, life: 0.5, max: 0.5, size: this.T * 0.3, color: COLORS.ok })
        this.playSound('connect', 0.2)
        break
      }
      case 'autocool':
        // the mist itself comes with the 'cool' event of the same tick
        this.float(e.rackId, 'AUTO-COOL', '#8fe6ff', 15)
        this.playSound('whoosh', 0.4)
        break
      case 'cool':
        this.mist(e.rackId, e.weak ? 6 : 16)
        if (this.targetId === e.rackId) {
          this.float(e.rackId, e.weak ? '−8 °C' : '−30 °C', '#8fe6ff', 20)
          this.playSound('whoosh', 0)
          if (e.weak) this.deny('Cooling pool is empty – that was only a weak COOL')
        }
        break
      case 'repairDone':
        this.sparks(e.targetId, 14, ['#ffd23f', '#ffffff', '#ffb020'])
        this.float(e.targetId, e.repairKind === 'reboot' ? 'REBOOTED' : 'FIXED', '#b9ffcf', 17)
        this.playSound('repair', 0)
        break
      case 'swap':
        this.sparks(e.stationId, 12, ['#39ff7a', '#ffffff'])
        this.float(e.stationId, 'SPARE SWAPPED', '#b9ffcf', 17)
        this.playSound('connect', 0)
        break
      case 'upgrade': {
        this.chevrons(e.targetId, COLORS.upgrade)
        const name = e.upgrade === 'server' ? 'SERVER' : e.upgrade === 'cooling' ? 'COOLING' : 'NETWORK'
        this.float(e.targetId, `${name} Lv${e.level}`, '#b9ffcf', 19)
        this.showBanner(
          `${name} LEVEL ${e.level}`,
          e.upgrade === 'server' ? '+50 % score from this rack – it runs 35 % hotter' : e.upgrade === 'cooling' ? 'Racks heat 20 % slower · cooling pool +25 %' : 'Fewer network faults · faster repair · +1 spare switch',
          'ok',
        )
        this.playSound('coin', 0)
        break
      }
      case 'credits':
        this.float(e.targetId, `+${e.amount} ${e.label}`, '#ffe45c', 16)
        this.playSound('coin', 0.1)
        break
      case 'breach':
        this.gameOver(e.reason)
        break
    }
    this.hudForce = true
  }

  /** Idle motion: frost drifting off the cooling units, smoke from dead racks, sparks while repairing. */
  private ambientFx(dt: number) {
    const w = this.world
    const T = this.T
    this.ambient -= dt
    if (this.ambient <= 0) {
      this.ambient = 0.16
      for (const s of w.stations) {
        if (s.kind !== 'crac') continue
        const dir = s.facing === 'right' ? 1 : -1
        const life = rand(0.9, 1.5)
        this.pushFx({ kind: 'mist', x: (s.cx + 0.5 + dir * 0.5) * T, y: (s.cy + rand(1.2, 1.9)) * T, vx: dir * T * rand(0.5, 1.1), vy: -T * rand(0.05, 0.3), life, max: life, size: T * rand(0.06, 0.12), color: '#bfeaff' })
      }
      for (const r of w.racks) {
        if (r.down && Math.random() < 0.4) this.smoke(r.id, 1)
        else if (r.boost > 0 && Math.random() < 0.5) {
          const life = rand(0.5, 0.9)
          this.pushFx({ kind: 'mist', x: (r.cx + rand(0.1, 0.9)) * T, y: (r.cy + rand(0, 0.9)) * T, vx: rand(-8, 8), vy: -T * rand(0.3, 0.7), life, max: life, size: T * rand(0.05, 0.1), color: '#d7f3ff' })
        }
      }
    }
    if (w.repair) {
      this.sparkT -= dt
      if (this.sparkT <= 0) {
        this.sparkT = 0.14
        this.sparks(w.repair.targetId, 3, ['#ffd23f', '#ffffff'])
        this.playSound('tap', 0.42)
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* frame                                                             */
  /* ---------------------------------------------------------------- */

  private update(dt: number) {
    this.t += dt
    if (this.phase === 'playing') {
      this.updatePlayer(dt)
      stepWorld(this.world, dt)
      this.updateTarget()
      const events = this.world.events
      if (events.length) {
        // handlers may end the level, so work on a copy of the queue
        const batch = events.splice(0, events.length)
        for (const e of batch) this.onEvent(e)
      }
      if (this.phase === 'playing') {
        this.ambientFx(dt)
        if (levelDone(this.world)) this.finishLevel()
      }
      // the reaching pose lasts for a short beat, or for as long as a repair runs
      if (this.actTimer > 0) this.actTimer -= dt
      if (this.world.repair) this.actKind = 'repair'
      else if (this.actTimer <= 0) this.actKind = null
    }
    if (this.phase !== 'paused') {
      // effects keep settling behind the overlays
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i]
        f.life -= dt
        if (f.life <= 0) {
          this.fx.splice(i, 1)
          continue
        }
        f.x += f.vx * dt
        f.y += f.vy * dt
      }
      updateParticles(this.particles, dt)
      updateFloatTexts(this.floats, dt)
      if (this.tap) {
        this.tap.t += dt
        if (this.tap.t > 0.45) this.tap = null
      }
      this.shake = Math.max(0, this.shake - 30 * dt)
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt
      if (this.bannerT <= 0) {
        this.banner = null
        this.hudForce = true
      }
    }
    if (this.hintT > 0) {
      this.hintT -= dt
      if (this.hintT <= 0) {
        this.hint = null
        this.hudForce = true
      }
    }
    this.updateCamera(dt)
    this.hudT -= dt
    if (this.hudForce || this.hudT <= 0) {
      this.hudT = 0.2
      this.hudForce = false
      this.emitHud()
    }
  }

  private tutorialAlert(): Alert | undefined {
    return this.world.alerts.find((a) => a.tutorial)
  }

  private tipText(): string | null {
    if (this.hint) return this.hint
    const w = this.world
    if (w.tutorialStep === 1) {
      return this.touch ? 'Rack 03 is heating up – tap it to walk there, then press COOL.' : 'Rack 03 is heating up – walk there with WASD / arrow keys and press COOL [1].'
    }
    if (w.tutorialStep === 3) {
      const a = this.tutorialAlert()
      const name = a ? targetName(w, a.targetId) : 'the rack'
      return this.touch ? `A fan failed in ${name} – tap it, press REPAIR and stay until the ring is full.` : `A fan failed in ${name} – stand next to it and press REPAIR [2] until the ring is full.`
    }
    if (w.tutorialStep === 4) return `You are on your own now – keep UPTIME at 100 %. Spend credits with UPGRADE${this.touch ? '' : ' [3]'}.`
    return null
  }

  private emitHud() {
    const w = this.world
    const uptime = uptimeOf(w)
    const alerts = w.alerts.map((a) => alertView(w, a, this.selectedId))
    const live = this.phase === 'playing' || this.phase === 'paused'
    // detail card: what is in reach, else the highlighted alert, else the most urgent one
    const here = this.targetId ? alertFor(w, this.targetId) : undefined
    const picked = this.selectedId ? alertFor(w, this.selectedId) : undefined
    const guided = this.tutorialAlert()
    const urgent = w.alerts.find((a) => a.type !== 'upgrade') ?? w.alerts[0]
    const alert = here ?? picked ?? guided
    let detail = alert ? detailForAlert(w, alert, this.touch) : null
    if (!detail && this.targetId) detail = detailForTarget(w, this.targetId, this.touch)
    if (!detail && urgent) detail = detailForAlert(w, urgent, this.touch)
    if (!detail) detail = nominalDetail(this.touch)
    const rep = w.repair
    const hud: HudState = {
      layout: this.layout,
      touch: this.touch,
      level: this.levelN,
      levelTitle: w.level.title,
      score: Math.floor(w.score),
      credits: Math.floor(w.credits),
      uptime: uptime.toFixed(3),
      uptimeTone: uptime >= 99.9 ? 'ok' : uptime >= SLA_PASS ? 'warn' : 'bad',
      uptimeSegs: clamp(Math.ceil((uptime - 99) * 8 - 1e-6), uptime > SLA_FAIL ? 1 : 0, 8),
      uptimeDrop: live && w.penaltyRate > 0,
      timeLeft: Math.max(0, Math.ceil(w.level.duration - w.time)),
      progress: Math.round(clamp(w.time / w.level.duration, 0, 1) * 100),
      cooling: Math.round((w.coolPool / w.coolMax) * 100),
      power: Math.round(clamp(powerRatio(w), 0, 1) * 100),
      network: Math.round(w.network),
      alerts,
      detail,
      actions: actionViews(w, live ? this.targetId : null),
      repairPct: rep ? Math.round((rep.t / rep.duration) * 20) * 5 : -1,
      spares: w.upgrades.spares,
      banner: live ? this.banner : null,
      tip: this.phase === 'playing' ? this.tipText() : null,
      critical: this.phase === 'playing' && anyCritical(w),
      upgrades: { cooling: w.upgrades.cooling, network: w.upgrades.network },
      clear: this.clear,
      over: this.over,
      best: this.best,
      savedLevel: this.savedLevel,
      joystick: this.joystickOn,
      scrolling: this.scrolling,
    }
    const sig = JSON.stringify(hud)
    if (sig === this.hudSig) return
    this.hudSig = sig
    this.cb.onHud(hud)
  }

  private render() {
    const s = this.scene
    const w = this.world
    const live = this.phase === 'playing' || this.phase === 'paused'
    s.W = this.W
    s.H = this.H
    s.T = this.T
    // snap the camera to device pixels so the cached floor never shimmers
    s.camX = Math.round(this.cam.x * this.dpr) / this.dpr
    s.camY = Math.round(this.cam.y * this.dpr) / this.dpr
    s.shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0
    s.shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0
    s.time = this.t
    s.world = w
    s.staticLayer = this.staticLayer
    s.pipes = this.pipes
    const p = s.player
    p.x = this.player.x
    p.y = this.player.y
    p.dir = this.player.dir
    p.walk = this.player.walk
    p.moving = this.player.moving && this.phase === 'playing'
    p.act = live ? this.actKind : null
    p.repair = live && w.repair ? w.repair.t / w.repair.duration : -1
    s.targetId = live ? this.targetId : null
    s.selectedId = live ? this.selectedId : null
    s.guideId = live ? (this.tutorialAlert()?.targetId ?? null) : null
    s.tap = this.tap
    s.scrolling = this.scrolling
    s.live = live
    let stick: StickView | null = null
    if (this.stickVisible()) stick = this.stick
    s.stick = stick
    drawScene(this.ctx, s)

    // the mini-map is tiny – a few redraws per second are plenty
    if (this.mapCanvas && ++this.mapTick % 4 === 0) {
      const el = this.mapCanvas
      const mw = el.clientWidth
      const mh = el.clientHeight
      if (mw > 0 && mh > 0) {
        const bw = Math.round(mw * this.dpr)
        const bh = Math.round(mh * this.dpr)
        if (el.width !== bw || el.height !== bh) {
          el.width = bw
          el.height = bh
        }
        const mctx = el.getContext('2d')
        if (mctx) {
          mctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
          drawMiniMap(mctx, mw, mh, s)
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* dev hooks (scenario script + manual testing)                      */
  /* ---------------------------------------------------------------- */

  private installHook() {
    const hook: HookApi = {
      state: () => {
        const w = this.world
        return {
          phase: this.phase,
          level: this.levelN,
          time: w.time,
          uptime: uptimeOf(w),
          score: Math.floor(w.score),
          credits: Math.floor(w.credits),
          alerts: w.alerts.map((a) => {
            const r = w.rackById.get(a.targetId)
            const st = w.stationById.get(a.targetId)
            return { id: a.id, type: a.type, target: a.targetId, value: r ? Math.round(r.temp) : st ? Math.round(st.battery) : 0 }
          }),
          player: { x: this.player.x, y: this.player.y, blocked: blocked(w.hall, this.player.x, this.player.y) },
          meters: { cooling: Math.round((w.coolPool / w.coolMax) * 100), power: Math.round(powerRatio(w) * 100), network: Math.round(w.network) },
          targetId: this.targetId,
          walking: this.path.length > 0,
          repair: w.repair ? w.repair.t / w.repair.duration : null,
          tutorialStep: w.tutorialStep,
          camera: { x: this.cam.x, y: this.cam.y, tile: this.T, scrolling: this.scrolling },
          upgrades: { ...w.upgrades },
          racks: w.racks.map((r) => ({ id: r.id, temp: Math.round(r.temp), down: r.down, level: r.serverLevel })),
          stations: w.stations.map((s) => ({ id: s.id, kind: s.kind, fault: s.fault })),
        }
      },
      moveTo: (id) => this.phase === 'playing' && this.walkTo(id),
      act: (action) => (action === 'smart' ? this.smartAct() : this.act(action)),
      spawn: (type, targetId, value) => {
        if (this.phase !== 'playing') return false
        const w = this.world
        if (type === 'upgrade') {
          // the objective appears by itself once the wallet covers the next upgrade
          const up = cheapestUpgrade(w)
          if (!up) return false
          w.tutorialStep = Math.max(w.tutorialStep, 5)
          w.credits = Math.max(w.credits, up.cost)
          return true
        }
        if (type === 'down') {
          const r = targetId ? w.rackById.get(targetId) : w.racks.find((x) => !x.down)
          if (!r) return false
          spawnFault(w, 'heat', r.id)
          r.temp = Math.max(r.temp, 100.5)
          return true
        }
        const ok = spawnFault(w, type, targetId)
        if (ok && type === 'heat') {
          // skip the silent warm-up so the alert shows at once
          const r = targetId ? w.rackById.get(targetId) : w.racks.find((x) => x.hotspotTarget > 0 && !alertFor(w, x.id))
          if (r) {
            r.hotspot = 1
            r.temp = Math.max(r.temp, value ?? WARN_TEMP + 4)
          }
        }
        return ok
      },
      setLevel: (n) => {
        // jump as if the current hall had just been cleared: upgrades and credits come along
        this.loadLevel(Math.max(1, Math.floor(n)), this.currentCarry())
        // no scripted opening when a level is loaded for inspection
        this.world.tutorialStep = 5
        this.world.spawnsEnabled = true
        this.world.nextSpawn = this.world.time + 6
        this.setPhase('playing')
      },
      screenPos: (id) => {
        const b = boxOf(this.world, id)
        if (!b) return null
        const r = this.canvas.getBoundingClientRect()
        return { x: r.left + b.fx * this.T - this.cam.x, y: r.top + b.fy * this.T - this.cam.y }
      },
      skip: (seconds) => {
        if (this.phase !== 'playing') return
        const w = this.world
        for (let t = 0; t < seconds && !w.breached && !levelDone(w); t += 0.05) stepWorld(w, 0.05)
      },
      finish: () => {
        if (this.phase !== 'playing') return
        this.world.time = Math.max(this.world.time, this.world.level.duration - 0.05)
      },
      bench: (n) => {
        const t0 = performance.now()
        for (let i = 0; i < n; i++) {
          this.t += 1 / 60
          this.render()
          // reading a pixel forces the rasteriser to finish the frame
          this.ctx.getImageData(0, 0, 1, 1)
        }
        return (performance.now() - t0) / n
      },
    }
    window.__uptimeKeeper = hook
    this.disposers.push(() => {
      if (window.__uptimeKeeper === hook) delete window.__uptimeKeeper
    })
  }
}
