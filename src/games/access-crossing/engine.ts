/**
 * Hansab – Access Crossing v2: the runner engine (no React).
 *
 * World model: the player never moves along the track on screen – `dist` (track distance on the
 * current floor) grows with the running speed and every entity is drawn at depth `z = d − dist`.
 * The player only steers: lane (−1 / 0 / 1), jump and slide. The spawner keeps the corridor
 * filled ~70 units ahead; this file runs the player, collisions, the access events (gate rows,
 * PIN rows, reception, camera zones, elevator) and all feedback.
 */
import { fitCanvas, observeResize, pointerPos, startLoop } from '../../shared/canvas'
import { burst, drawFloatTexts, drawParticles, updateFloatTexts, updateParticles, type FloatText, type Particle } from '../../shared/draw'
import { clamp, damp, easeInCubic, easeOutCubic, lerp } from '../../shared/math'
import { seededRng } from '../../shared/rng'
import { sfx, type SfxName } from '../../shared/sfx'
import { getBest, loadJSON, saveJSON, submitBest } from '../../shared/storage'
import * as R from './render'
import { NAMED_FLOORS, Spawner, WALK_TRIGGER_Z, auditSpawner, barrierCovers, type EventType, type SpawnContext } from './spawner'
import { BADGE_INFO, BADGE_ORDER, ELEVATOR_INFO, LANE_W, PLAYER_H, PLAYER_SLIDE_H, themeForFloor, type Badge, type Dir, type Entity, type Visitor } from './types'
import { makeVisitor, visitorIsValid } from './visitors'

export const SLUG = 'access-crossing'
export const MAX_HEARTS = 3
export { NAMED_FLOORS }

/* ---------- tuning ---------------------------------------------------------------------- */

const BASE_SPEED = 9
/** +0.35 units/s every 10 s of running. */
const SPEED_RAMP = 0.035
const SPEED_PER_FLOOR = 1.5
const MAX_SPEED = 22
const LANE_DUR = 0.12
/** A jump covers the same track distance at every speed (650 ms at the base speed). */
const JUMP_DIST = BASE_SPEED * 0.65
const JUMP_H = 1.1
/** …but never gets shorter than this, so it stays readable at top speed. */
const MIN_JUMP_DUR = 0.36
const FAST_FALL = 9
const SLIDE_DUR = 0.6
const SWIPE_PX = 24
const INVULN = 2
const STUMBLE_DUR = 1
const STUMBLE_FACTOR = 0.6
const MAGNET_DUR = 10
/** After a popup the run eases back in instead of snapping to full speed. */
const RESUME_EASE = 0.5
const DEAD_TIME = 0.9
/** Camera: distance behind the player, and how much it follows the player sideways. */
const CAM_D = 8.5
const CAM_FOLLOW = 0.5
/** Vanishing point height: high up, so most of the screen is floor rushing at the camera. */
const HORIZON_FRAC = 0.32
/** Landing squash and the zoom "kick" on speed-ups / open gates, in seconds. */
const LAND_DUR = 0.22
const KICK_DUR = 0.35
/** The badge card takes this long to fly from the pickup into the HUD. */
const BADGE_FLY_DUR = 0.65
const HINT_KEY = `${SLUG}:hintSeen`

export type Phase = 'start' | 'playing' | 'paused' | 'over'
export type ToastKind = 'ok' | 'deny' | 'info' | 'coin'

export interface Toast {
  id: number
  text: string
  kind: ToastKind
}

export interface HudState {
  /** Only guaranteed fresh on phase changes – the live number goes through `onScore`. */
  score: number
  coins: number
  hearts: number
  floor: number
  badges: Badge[]
  pinNote: string | null
  best: number
  toast: Toast | null
  /** Escort shield held. */
  shield: boolean
  /** Whole seconds of coin magnet left (0 = off). */
  magnet: number
  /** Show the swipe hint (first run only). */
  hint: boolean
}

export type Popup =
  | { kind: 'pin'; code: string; triesLeft: number; attempt: number; demo: boolean }
  | { kind: 'visitor'; visitor: Visitor; demo: boolean }

export interface EngineCallbacks {
  onHud: (h: HudState) => void
  onPhase: (p: Phase) => void
  onPopup: (p: Popup | null) => void
  /** Called whenever the integer score changes; write it straight to the DOM (no React render). */
  onScore: (score: number) => void
}

interface DevEvent {
  type: string
  z: number
  lane: number
  dodge: string
  /** Lanes that are safe / open for this event right now. */
  open?: number[]
  code?: string
}

interface DevState {
  phase: Phase
  popup: string | null
  speed: number
  lane: number
  floor: number
  hearts: number
  badges: Badge[]
  score: number
  coins: number
  dist: number
  pinNote: string | null
  jumping: boolean
  sliding: boolean
  invulnerable: boolean
  stumbling: boolean
  shield: boolean
  magnet: number
  /** Whether the visitor in the open popup should be let in (null = no visitor popup). */
  visitorValid: boolean | null
  nextEvents: DevEvent[]
}

export interface DevHook {
  state: () => DevState
  openVisitorPopup: () => void
  openPinPopup: () => void
  /** Clears the corridor ahead and puts one event of the given type ~30 units in front of the player. */
  skipTo: (type: EventType) => boolean
  /** Runs the spawner self-check; returns the list of fairness violations (empty = fine). */
  audit: (runs?: number) => string[]
}

declare global {
  interface Window {
    __accessCrossing?: DevHook
  }
}

export const initialHud: HudState = {
  score: 0,
  coins: 0,
  hearts: MAX_HEARTS,
  floor: 1,
  badges: ['EMPLOYEE'],
  pinNote: null,
  best: 0,
  toast: null,
  shield: false,
  magnet: 0,
  hint: false,
}

export function floorLabel(floor: number): string {
  return floor <= NAMED_FLOORS ? `FLOOR ${floor}/${NAMED_FLOORS}` : `FLOOR ${floor}`
}

const CRASH_TEXT: Record<string, string> = {
  person: 'Bumped into a colleague!',
  guard: 'Ran straight into security!',
  robot: 'Tripped over the cleaning robot!',
  cart: 'Crashed into the mail cart!',
  trolley: 'Crashed into the luggage trolley!',
  barrier: 'Hit the boom barrier – slide under it!',
  wetsign: 'Slipped on the wet floor!',
  planter: 'Tripped over the planter!',
  glass: 'Ran into the glass partition!',
}

const EVENT_KINDS = new Set<string>(['gate', 'pin', 'reception', 'elevator', 'camera', 'badge', 'note', 'magnet', 'shield'])

export class Engine {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly cb: EngineCallbacks
  private width = 1
  private height = 1

  private phase: Phase = 'start'
  private seed = 1
  private floor = 1
  private readonly inventory = new Set<Badge>(['EMPLOYEE'])
  private pinNote: string | null = null
  private hearts = MAX_HEARTS
  private coins = 0
  /** Score from elevators and pickups; the rest of the score is the distance run. */
  private bonus = 0
  private totalDist = 0
  private score = 0
  private best = getBest(SLUG)

  /* run state */
  private dist = 0
  private runTime = 0
  private baseSpeed = BASE_SPEED
  private speed = BASE_SPEED
  private stumble = 0
  private invuln = 0
  /** Seconds left of the gentle speed ramp after a popup / pause. */
  private easeIn = 0
  private shield = false
  private magnet = 0
  /** > 0 while the fall-over animation of the last heart plays. */
  private dead = 0

  /* player */
  private lane = 0
  private laneFrom = 0
  private laneT = 1
  private laneX = 0
  /** Signed timer of the "no lane there" nudge at the corridor edge. */
  private edge = 0
  private jumpT = -1
  private fastFall = false
  private y = 0
  private slideT = 0
  private slideAge = 0
  private queued: Dir | null = null
  private runPhase = 0
  private playerZ = 0
  private transAlpha = 1

  private readonly entities: Entity[] = []
  private readonly spawner = new Spawner()
  private readonly spawnCtx: SpawnContext
  private coinSoundT = 0

  /* events */
  private popup: Popup | null = null
  private popupRow: Entity | null = null
  private trans: { t: number; e: Entity } | null = null
  private fade = 0
  private bannerT = 0
  private readonly bannerDur = 2.6
  private bannerText = ''
  private bannerSub = ''

  /* feedback */
  private toasts: Toast[] = []
  private toastT = 0
  private toastId = 0
  private readonly particles: Particle[] = []
  private readonly floats: FloatText[] = []
  private shake = 0
  private flash = 0
  private flashColor = '#e63946'
  /** Zoom kick (seconds left) and landing squash (seconds left). */
  private kick = 0
  private landT = 0
  /** Dust puffs while sliding are rationed by this timer. */
  private dustT = 0
  /** Which 10-second speed step we are on – a new step gives a little zoom kick. */
  private speedStep = 0
  /** Badge card flying from the pickup into the HUD (the HUD card appears when it lands). */
  private badgeFly: { badge: Badge; t: number; x0: number; y0: number } | null = null
  private hint = false
  private hintT = 0
  private hintInputs = 0

  private time = 0
  private lastHud: HudState | null = null
  private lastScore = -1
  private pointer: { id: number; x: number; y: number; done: boolean } | null = null
  private readonly disposers: (() => void)[] = []
  private readonly devHook: DevHook

  /* render scratch – created once, mutated every frame */
  private readonly view: R.View
  private readonly pv: R.PlayerView
  private readonly rowCtx: { held: ReadonlySet<Badge>; hasNote: boolean }
  private readonly scene: R.SceneInput
  private readonly tmp: R.P = { x: 0, y: 0, s: 0 }

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas
    this.cb = cb
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas not supported')
    this.ctx = ctx
    this.view = { width: 1, height: 1, cx: 0, horizon: 0, camX: 0, camH: 3, camD: CAM_D, f: 700, s0: 100, time: 0, theme: themeForFloor(1) }
    this.pv = { laneX: 0, y: 0, z: 0, slide: 0, jumping: false, run: 0, alpha: 1, fall: 0, shield: false, magnet: false, lean: 0, squash: 0, stumble: 0, pace: 0 }
    this.rowCtx = { held: this.inventory, hasNote: false }
    this.scene = { entities: this.entities, dist: 0, player: this.pv, rows: this.rowCtx, showPlayer: true }
    this.spawnCtx = { dist: 0, speed: BASE_SPEED, inventory: this.inventory, floor: 1 }
    this.seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0
    this.setupAttract()

    const onDown = (e: PointerEvent) => this.onPointerDown(e)
    const onMove = (e: PointerEvent) => this.onPointerMove(e)
    const onUp = (e: PointerEvent) => this.onPointerUp(e)
    const onKey = (e: KeyboardEvent) => this.onKey(e)
    // Losing focus mid-run would be an unfair crash, so the game pauses itself.
    const onHide = () => {
      if (document.hidden) this.pause()
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onHide)
    this.disposers.push(() => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onHide)
    })
    this.disposers.push(observeResize(canvas, () => this.resize()))
    this.disposers.push(
      startLoop(
        (dt) => this.update(dt),
        () => this.render(),
      ),
    )

    this.devHook = {
      state: () => this.devState(),
      openVisitorPopup: () => this.openDemoVisitor(),
      openPinPopup: () => this.openDemoPin(),
      skipTo: (type) => this.skipTo(type),
      audit: (runs) => auditSpawner(runs),
    }
    window.__accessCrossing = this.devHook
    this.pushHud(true)
  }

  destroy() {
    for (const d of this.disposers.splice(0)) d()
    if (window.__accessCrossing === this.devHook) delete window.__accessCrossing
  }

  /* ---------------------------------------------------------------------------------- */
  /* Public API used by the React component                                              */
  /* ---------------------------------------------------------------------------------- */

  start() {
    if (this.phase === 'playing' || this.phase === 'paused') return
    this.setupRun()
    this.phase = 'playing'
    this.hint = !loadJSON<boolean>(HINT_KEY, false)
    this.hintT = 9
    this.hintInputs = 0
    this.showBanner(floorLabel(1), 'Lobby · run to the gate your badge opens')
    this.cb.onPhase('playing')
    sfx.play('pop')
    this.pushHud(true)
  }

  pause() {
    if (this.phase !== 'playing' || this.popup || this.dead > 0) return
    this.phase = 'paused'
    this.pointer = null
    this.cb.onPhase('paused')
    this.pushHud(true)
  }

  resume() {
    if (this.phase !== 'paused') return
    this.phase = 'playing'
    // ease back in so nobody resumes straight into an obstacle
    this.easeIn = RESUME_EASE
    this.cb.onPhase('playing')
  }

  togglePause() {
    if (this.phase === 'playing') this.pause()
    else if (this.phase === 'paused') this.resume()
  }

  /** Called by the keypad popup. */
  submitPin(code: string): 'ok' | 'wrong' | 'fail' {
    const p = this.popup
    if (!p || p.kind !== 'pin') return 'wrong'
    if (p.demo) {
      if (code === p.code) {
        sfx.play('connect')
        this.closePopup()
        return 'ok'
      }
      sfx.play('bad')
      return 'wrong'
    }
    const row = this.popupRow
    if (!row) {
      this.closePopup()
      return 'fail'
    }
    if (code === row.code) {
      row.done = true
      this.coins += 30
      this.pinNote = null
      this.showToast('PIN accepted · +30 coins', 'ok')
      this.addFloat('+30', '#ffd43b')
      sfx.play('connect')
      this.closePopup()
      return 'ok'
    }
    sfx.play('bad')
    const triesLeft = p.triesLeft - 1
    if (triesLeft <= 0) {
      // Third wrong code: the guard opens the gate, at the price of a heart.
      row.done = true
      this.pinNote = null
      this.closePopup()
      this.loseHeart('Wrong PIN ×3 – the guard lets you through', 'alarm')
      return 'fail'
    }
    this.popup = { kind: 'pin', code: p.code, triesLeft, attempt: p.attempt + 1, demo: false }
    this.cb.onPopup(this.popup)
    return 'wrong'
  }

  /** Called by the visitor popup. */
  decideVisitor(letIn: boolean) {
    const p = this.popup
    if (!p || p.kind !== 'visitor') return
    if (p.demo) {
      this.closePopup()
      return
    }
    const valid = visitorIsValid(p.visitor)
    const row = this.popupRow
    if (row) row.done = true
    this.closePopup()
    if (letIn === valid) {
      this.coins += 50
      const isNew = !this.inventory.has('VISITOR')
      this.inventory.add('VISITOR')
      sfx.play('good')
      this.showToast(isNew ? 'Correct! +50 coins · VISITOR badge' : 'Correct! +50 coins', 'ok')
      this.addFloat('+50', '#ffd43b')
      const pt = this.playerPoint(0.6)
      burst(this.particles, pt.x, pt.y, 18, ['#2f80ff', '#ffffff', '#ffd43b'], { speed: 220, life: 0.7, size: 5 })
    } else {
      this.loseHeart(valid ? 'That visitor was valid!' : 'Invalid visitor let in!', 'bad')
    }
  }

  /** Dismiss a demo popup (dev hook). Live popups must be answered. */
  dismissPopup() {
    if (this.popup?.demo) this.closePopup()
  }

  private closePopup() {
    const wasLive = this.popup !== null && !this.popup.demo
    this.popup = null
    this.popupRow = null
    if (wasLive) this.easeIn = RESUME_EASE
    this.cb.onPopup(null)
  }

  /* ---------------------------------------------------------------------------------- */
  /* Setup                                                                                */
  /* ---------------------------------------------------------------------------------- */

  private resize() {
    const size = fitCanvas(this.canvas)
    this.width = size.width
    this.height = size.height
    const v = this.view
    const w = this.width
    const h = this.height
    v.width = w
    v.height = h
    v.cx = w / 2
    v.horizon = Math.round(h * HORIZON_FRAC)
    // Pixels per world unit at the player: on wide screens the runner is a quarter of the height;
    // on a phone the three lanes at the runner's depth are allowed to overflow the width a little
    // (the camera follows the runner sideways), which keeps him big like the mobile runners.
    const s0 = Math.min(w / (3 * LANE_W * 0.66), h * 0.25)
    const feet = h < 480 ? 0.84 : w < 600 ? 0.85 : 0.8
    // The camera height follows from where the player's feet should sit on screen; it must stay
    // below the ceiling and above the player's head.
    v.camH = clamp(((feet - HORIZON_FRAC) * h) / s0, 1.7, 3.6)
    v.camD = CAM_D
    v.f = s0 * CAM_D
    v.s0 = s0
  }

  private resetPlayer() {
    this.lane = 0
    this.laneFrom = 0
    this.laneT = 1
    this.laneX = 0
    this.edge = 0
    this.jumpT = -1
    this.fastFall = false
    this.y = 0
    this.slideT = 0
    this.slideAge = 0
    this.queued = null
    this.playerZ = 0
    this.transAlpha = 1
    this.view.camX = 0
  }

  /** Title screen: an endless calm corridor the runner jogs through, following the coins. */
  private setupAttract() {
    this.entities.length = 0
    this.dist = 0
    this.floor = 1
    this.view.theme = themeForFloor(1)
    this.resetPlayer()
    this.spawner.startAttract(this.seed)
  }

  private setupRun() {
    this.seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0
    this.floor = 1
    this.inventory.clear()
    this.inventory.add('EMPLOYEE')
    this.pinNote = null
    this.hearts = MAX_HEARTS
    this.coins = 0
    this.bonus = 0
    this.totalDist = 0
    this.score = 0
    this.best = getBest(SLUG)
    this.dist = 0
    this.runTime = 0
    this.baseSpeed = BASE_SPEED
    this.speed = BASE_SPEED
    this.stumble = 0
    this.invuln = 0
    this.easeIn = 0
    this.shield = false
    this.magnet = 0
    this.dead = 0
    this.resetPlayer()
    this.entities.length = 0
    this.particles.length = 0
    this.floats.length = 0
    this.toasts.length = 0
    this.toastT = 0
    this.shake = 0
    this.flash = 0
    this.kick = 0
    this.landT = 0
    this.dustT = 0
    this.speedStep = 0
    this.badgeFly = null
    this.fade = 0
    this.trans = null
    this.popup = null
    this.popupRow = null
    this.view.theme = themeForFloor(1)
    this.spawner.startFloor(this.seed, 1, BASE_SPEED, this.inventory)
    this.fillAhead()
  }

  private fillAhead() {
    const c = this.spawnCtx
    c.dist = this.dist
    c.speed = this.baseSpeed
    c.floor = this.floor
    this.spawner.fill(this.entities, c)
    this.sortEntities()
  }

  /** Insertion sort by track distance (near → far); the list is always nearly sorted. */
  private sortEntities() {
    const a = this.entities
    for (let i = 1; i < a.length; i++) {
      const e = a[i]
      const d = e.d
      let j = i - 1
      while (j >= 0 && a[j].d > d) {
        a[j + 1] = a[j]
        j--
      }
      a[j + 1] = e
    }
  }

  /* ---------------------------------------------------------------------------------- */
  /* Input                                                                                */
  /* ---------------------------------------------------------------------------------- */

  private onPointerDown(e: PointerEvent) {
    sfx.unlock()
    if (this.phase !== 'playing' || this.popup) return
    const p = pointerPos(this.canvas, e)
    this.pointer = { id: e.pointerId, x: p.x, y: p.y, done: false }
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      /* not supported */
    }
  }

  private onPointerMove(e: PointerEvent) {
    const pt = this.pointer
    if (!pt || pt.id !== e.pointerId || pt.done) return
    const p = pointerPos(this.canvas, e)
    const dx = p.x - pt.x
    const dy = p.y - pt.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return
    // one action per swipe: fire as soon as the finger has travelled far enough
    pt.done = true
    if (Math.abs(dx) > Math.abs(dy)) this.input(dx > 0 ? 'right' : 'left')
    else this.input(dy > 0 ? 'down' : 'up')
  }

  private onPointerUp(e: PointerEvent) {
    if (this.pointer && this.pointer.id === e.pointerId) this.pointer = null
  }

  private onKey(e: KeyboardEvent) {
    if (this.popup) return
    const k = e.key
    if (k === 'Escape' || k === 'p' || k === 'P') {
      if (this.phase === 'playing' || this.phase === 'paused') {
        this.togglePause()
        e.preventDefault()
      }
      return
    }
    if (this.phase === 'start' || this.phase === 'over') {
      if (k === 'Enter' || k === ' ') {
        sfx.unlock()
        this.start()
        e.preventDefault()
      }
      return
    }
    let dir: Dir | null = null
    if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') dir = 'up'
    else if (k === 'ArrowDown' || k === 's' || k === 'S') dir = 'down'
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') dir = 'left'
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') dir = 'right'
    if (!dir) return
    e.preventDefault()
    if (e.repeat) return
    sfx.unlock()
    this.input(dir)
  }

  private input(dir: Dir) {
    if (this.phase !== 'playing' || this.popup || this.trans || this.dead > 0) return
    this.hintInputs++
    // Inputs during an action queue one deep.
    if (!this.tryAction(dir)) this.queued = dir
  }

  /** Start the action if its channel (sideways / vertical) is free. */
  private tryAction(dir: Dir): boolean {
    switch (dir) {
      case 'left':
      case 'right': {
        if (this.laneT < 1) return false
        const step = dir === 'left' ? -1 : 1
        if (this.lane + step < -1 || this.lane + step > 1) {
          this.edge = step * 0.16
          return true
        }
        this.startLane(step)
        sfx.play('tap')
        return true
      }
      case 'up':
        if (this.jumpT >= 0) return false
        this.slideT = 0
        this.jumpT = 0
        this.fastFall = false
        sfx.play('launch')
        return true
      case 'down':
        if (this.jumpT >= 0) {
          // swipe down in the air: drop fast and roll straight into a slide
          if (this.fastFall) return false
          this.fastFall = true
          return true
        }
        if (this.slideT > 0) return false
        this.startSlide()
        return true
    }
  }

  private startLane(step: number) {
    this.laneFrom = this.lane
    this.lane += step
    this.laneT = 0
  }

  private startSlide() {
    this.slideT = SLIDE_DUR
    this.slideAge = 0
    sfx.play('whoosh')
  }

  /* ---------------------------------------------------------------------------------- */
  /* Update                                                                               */
  /* ---------------------------------------------------------------------------------- */

  private update(dt: number) {
    this.time += dt
    this.view.time = this.time
    if (this.phase === 'paused') return
    if (this.phase === 'start') this.updateAttract(dt)
    else if (this.phase === 'playing') {
      if (this.popup) {
        /* the run is frozen while a popup is open */
      } else if (this.trans) this.updateTransition(dt)
      else if (this.dead > 0) this.updateDying(dt)
      else this.updateRun(dt)
    }
    updateParticles(this.particles, dt)
    updateFloatTexts(this.floats, dt)
    if (this.toastT > 0) {
      this.toastT -= dt
      if (this.toastT <= 0) {
        this.toasts.shift()
        this.toastT = this.toasts.length ? 1.9 : 0
      }
    }
    if (this.bannerT > 0) this.bannerT -= dt
    if (!this.trans && this.fade > 0) this.fade = Math.max(0, this.fade - dt * 2.2)
    this.shake = Math.max(0, this.shake - dt)
    this.flash = Math.max(0, this.flash - dt * 2.5)
    this.kick = Math.max(0, this.kick - dt / KICK_DUR)
    this.landT = Math.max(0, this.landT - dt)
    if (this.badgeFly) {
      this.badgeFly.t += dt / BADGE_FLY_DUR
      if (this.badgeFly.t >= 1) this.badgeFly = null
    }
    if (this.edge !== 0) {
      const next = this.edge - Math.sign(this.edge) * dt
      this.edge = Math.sign(next) === Math.sign(this.edge) ? next : 0
    }
    this.view.camX = damp(this.view.camX, this.laneX * LANE_W * CAM_FOLLOW, 9, dt)
    this.pushHud(false)
  }

  /** Title screen: the runner jogs the coin trail and takes the open turnstile of every gate row. */
  private updateAttract(dt: number) {
    this.dist += 4.6 * dt
    this.runPhase += dt * 9
    this.fillAhead()
    const list = this.entities
    let n = 0
    let steered = false
    // a gate row ahead takes priority over the coins when picking the lane
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      if (e.kind !== 'gate' || e.done) continue
      const z = e.d - this.dist
      if (z < 0.5 || z > 12) continue
      steered = true
      const okLane = e.gates.findIndex((b) => this.inventory.has(b)) - 1
      if (okLane >= -1 && this.laneT >= 1 && this.lane !== okLane) this.startLane(okLane > this.lane ? 1 : -1)
      break
    }
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      const z = e.d - this.dist
      if (z < -(CAM_D + 2.5)) continue
      if (e.kind === 'coin') {
        // jog along the coin trail
        if (!steered && z > 0.6 && z < 3.4) {
          steered = true
          if (this.laneT >= 1 && e.lane !== this.lane) this.startLane(e.lane > this.lane ? 1 : -1)
        }
        if (Math.abs(z) < 0.5 && Math.abs(e.lane - this.laneX) < 0.5) continue
      } else if (e.kind === 'gate') {
        // the flaps of the lane we are lined up with swing open; never costs a heart here
        const lane = Math.round(this.laneX)
        if (e.done) {
          if (e.anim < 1) e.anim = Math.min(1, e.anim + dt * 5)
        } else if (this.inventory.has(e.gates[lane + 1]) && z < 5.5 && z > 0.5) {
          if (e.hitLane !== lane || e.anim === 0) {
            e.hitLane = lane
            e.anim = Math.max(e.anim, 0.01)
          }
          e.anim = Math.min(1, e.anim + dt * 6)
        } else if (z <= 0.5) {
          e.done = true
          e.hitLane = lane
        }
      }
      list[n++] = e
    }
    list.length = n
    this.updateLane(dt)
  }

  private updateRun(dt: number) {
    this.runTime += dt
    this.baseSpeed = Math.min(MAX_SPEED, BASE_SPEED + SPEED_RAMP * this.runTime + SPEED_PER_FLOOR * (this.floor - 1))
    if (this.stumble > 0) this.stumble -= dt
    if (this.invuln > 0) this.invuln -= dt
    if (this.easeIn > 0) this.easeIn -= dt
    if (this.magnet > 0) this.magnet = Math.max(0, this.magnet - dt)
    if (this.coinSoundT > 0) this.coinSoundT -= dt
    let mult = this.stumble > 0 ? STUMBLE_FACTOR : 1
    if (this.easeIn > 0) mult *= 1 - 0.7 * (this.easeIn / RESUME_EASE)
    this.speed = this.baseSpeed * mult
    const step = this.speed * dt
    this.dist += step
    this.totalDist += step
    this.runPhase += dt * (6 + this.speed * 0.5)
    // every 10 s the pace steps up: a tiny zoom kick sells the acceleration
    const speedStep = Math.floor(this.runTime / 10)
    if (speedStep !== this.speedStep) {
      this.speedStep = speedStep
      if (speedStep > 0) this.kick = Math.max(this.kick, 0.6)
    }

    if (this.queued && this.tryAction(this.queued)) this.queued = null
    this.updateLane(dt)
    if (this.jumpT >= 0) {
      if (this.fastFall) {
        this.y -= FAST_FALL * dt
        if (this.y <= 0) {
          this.y = 0
          this.jumpT = -1
          this.fastFall = false
          this.landT = LAND_DUR
          this.landDust()
          this.startSlide()
        }
      } else {
        // progress is tied to the distance run, so the arc always spans JUMP_DIST of track
        this.jumpT += Math.min(step / JUMP_DIST, dt / MIN_JUMP_DUR)
        if (this.jumpT >= 1) {
          this.jumpT = -1
          this.y = 0
          this.landT = LAND_DUR
          this.landDust()
        } else this.y = 4 * JUMP_H * this.jumpT * (1 - this.jumpT)
      }
    }
    if (this.slideT > 0) {
      this.slideT -= dt
      this.slideAge += dt
      // dust kicked up by the slide
      this.dustT -= dt
      if (this.dustT <= 0 && this.particles.length < 140) {
        this.dustT = 0.045
        const pt = this.playerPoint(0.05)
        const s = this.view.s0
        burst(this.particles, pt.x + (Math.random() - 0.5) * 0.5 * s, pt.y, 1, ['#ffffff', '#e8e2d6'], { speed: 0.35 * s, life: 0.35, size: 0.07 * s, shape: 'circle', gravity: 0.6 * s })
      }
    }

    this.fillAhead()
    this.processEntities(dt)

    this.score = Math.floor(this.totalDist) + this.bonus
    if (this.hint) {
      this.hintT -= dt
      if (this.hintT <= 0 || this.hintInputs >= 4) {
        this.hint = false
        saveJSON(HINT_KEY, true)
      }
    }
  }

  private updateLane(dt: number) {
    if (this.laneT < 1) {
      this.laneT = Math.min(1, this.laneT + dt / LANE_DUR)
      this.laneX = lerp(this.laneFrom, this.lane, easeOutCubic(this.laneT))
    } else this.laneX = this.lane
  }

  private updateDying(dt: number) {
    this.dead -= dt
    // skid to a halt
    this.dist += this.speed * 0.5 * Math.max(0, this.dead / DEAD_TIME) * dt
    if (this.dead <= 0) {
      this.dead = 0
      this.gameOver()
    }
  }

  /** Does obstacle `e` at depth `z` overlap the player's box (lane × depth × height)? */
  private hitsPlayer(e: Entity, z: number): boolean {
    if (this.invuln > 0) return false
    if (Math.abs(z) > e.depth * 0.4 + 0.18) return false
    if (e.kind === 'barrier') {
      if (!barrierCovers(e.variant, Math.round(this.laneX))) return false
    } else if (Math.abs(e.lane - this.laneX) > 0.55) return false
    const top = this.y + (this.slideT > 0 ? PLAYER_SLIDE_H : PLAYER_H)
    // a jumping player clears low obstacles, a sliding player passes under the boom barrier
    return this.y < e.y1 - 0.12 && top > e.y0 + 0.06
  }

  private processEntities(dt: number) {
    const list = this.entities
    const dist = this.dist
    let n = 0
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      let z = e.d - dist
      // behind the camera: drop (the elevator is the end of the floor and never passes)
      if (z < -(CAM_D + 2.5)) continue
      if (e.hitT > 0) e.hitT -= dt
      switch (e.kind) {
        case 'coin':
          if (z < 9) this.updateCoin(e, z, dt)
          break
        case 'badge':
        case 'note':
        case 'magnet':
        case 'shield':
          if (z < 0.8 && z > -0.8 && Math.abs(e.lane - this.laneX) < 0.6) this.collectPickup(e)
          break
        case 'person':
        case 'guard':
          if (e.walk > 0 && z < WALK_TRIGGER_Z && z > -1) {
            e.d -= e.walk * dt
            z = e.d - dist
          }
          if (this.hitsPlayer(e, z)) this.crashInto(e)
          break
        case 'robot':
        case 'cart':
        case 'trolley':
        case 'barrier':
        case 'wetsign':
        case 'planter':
        case 'glass':
          if (this.hitsPlayer(e, z)) this.crashInto(e)
          break
        case 'gate':
          this.updateGate(e, z, dt)
          break
        case 'pin':
          this.updatePinRow(e, z, dt)
          break
        case 'reception':
          if (!e.done) {
            if (z <= 2.4) this.openVisitor(e)
          } else if (e.anim < 1) e.anim = Math.min(1, e.anim + dt * 4)
          break
        case 'elevator':
          this.updateElevator(e, z, dt)
          break
        case 'camera':
          e.t += dt
          if (!e.done && this.invuln <= 0 && Math.abs(z) < e.depth / 2) {
            const b = R.cameraBeamAt(e, e.t)
            if (b.on && Math.abs(this.laneX - b.center) < R.BEAM_HALF - 0.07) {
              e.done = true
              this.hurt('Spotted by the camera!', 'alarm', '#e63946')
            }
          }
          break
        default:
          break
      }
      if (e.alive) list[n++] = e
    }
    list.length = n
  }

  private updateCoin(e: Entity, z: number, dt: number) {
    const top = this.y + (this.slideT > 0 ? PLAYER_SLIDE_H : PLAYER_H)
    if (this.magnet > 0 && z > -1.5) {
      // the magnet drags coins out of every lane toward the runner
      e.lane = damp(e.lane, this.laneX, 10, dt)
      e.y = damp(e.y, this.y + 0.15, 10, dt)
      if (z < 1 && Math.abs(e.lane - this.laneX) < 0.8) this.collectCoin(e)
    } else if (z < 0.65 && z > -0.65 && Math.abs(e.lane - this.laneX) < 0.56 && e.y + 0.06 < top + 0.2 && e.y + 0.5 > this.y - 0.2) this.collectCoin(e)
  }

  private collectCoin(e: Entity) {
    e.alive = false
    this.coins++
    if (this.coinSoundT <= 0) {
      sfx.play('coin')
      this.coinSoundT = 0.07
    }
    if (this.particles.length < 140) {
      const pt = R.project(this.view, e.lane * LANE_W, e.y + 0.3, 0, this.tmp)
      burst(this.particles, pt.x, pt.y, 4, ['#ffd43b', '#ffffff'], { speed: 130, life: 0.35, size: 4, shape: 'spark', gravity: 200 })
    }
  }

  private collectPickup(e: Entity) {
    e.alive = false
    const pt = this.playerPoint(0.7)
    switch (e.kind) {
      case 'badge': {
        const badge = e.badge ?? 'EMPLOYEE'
        const info = BADGE_INFO[badge]
        const isNew = !this.inventory.has(badge)
        this.inventory.add(badge)
        this.bonus += 25
        sfx.play('combo')
        this.showToast(`${info.name.toUpperCase()} badge collected!`, 'ok')
        this.addFloat('+25', info.color)
        this.flash = 0.5
        this.flashColor = '#ffffff'
        burst(this.particles, pt.x, pt.y, 26, [info.color, '#ffffff', '#ffd43b'], { speed: 260, life: 0.8, size: 6 })
        // the card itself flies into the inventory in the corner (the HUD shows it on arrival)
        if (isNew) this.badgeFly = { badge, t: 0, x0: pt.x, y0: pt.y }
        break
      }
      case 'note':
        this.pinNote = e.code
        sfx.play('pop')
        this.showToast(`PIN note found: ${e.code}`, 'info')
        burst(this.particles, pt.x, pt.y, 10, ['#ffe14d', '#ffffff'], { speed: 180, life: 0.5, size: 5 })
        break
      case 'magnet':
        this.magnet = MAGNET_DUR
        sfx.play('connect')
        this.showToast('Coin magnet · 10 s', 'coin')
        burst(this.particles, pt.x, pt.y, 14, ['#e63946', '#ffffff', '#ffd43b'], { speed: 220, life: 0.6, size: 5 })
        break
      case 'shield':
        this.shield = true
        sfx.play('repair')
        this.showToast('Escort shield · absorbs one crash', 'info')
        burst(this.particles, pt.x, pt.y, 14, ['#2f80ff', '#ffffff'], { speed: 220, life: 0.6, size: 5 })
        break
      default:
        break
    }
  }

  private crashInto(e: Entity) {
    // the obstacle is knocked out of the way
    e.alive = false
    this.hurt(CRASH_TEXT[e.kind] ?? 'Crash!', 'hit', e.kind === 'person' ? e.shirt : '#9aa4b5')
  }

  private updateGate(e: Entity, z: number, dt: number) {
    if (e.done) {
      if (e.anim < 1) e.anim = Math.min(1, e.anim + dt * 5)
      return
    }
    const lane = Math.round(this.laneX)
    const ok = this.inventory.has(e.gates[lane + 1])
    if (z < 5.5 && z > 0.5 && ok) {
      // the flaps of the lane you are lined up with swing open as you approach
      if (e.hitLane !== lane || e.anim === 0) {
        if (e.anim === 0) sfx.play('click')
        e.hitLane = lane
        e.anim = Math.max(e.anim, 0.01)
      }
      e.anim = Math.min(1, e.anim + dt * 6)
    }
    if (z > 0.5) return
    e.done = true
    e.hitLane = lane
    if (ok) {
      // ACCESS GRANTED: green flash, zoom kick, sparks and a floating label
      sfx.play('connect')
      const pt = this.playerPoint(0.5)
      burst(this.particles, pt.x, pt.y, 14, ['#2bb673', '#b6ffd8', '#ffffff'], { speed: 200, life: 0.45, size: 5, shape: 'spark', gravity: 100 })
      this.flash = 0.55
      this.flashColor = '#2bb673'
      this.kick = Math.max(this.kick, 0.8)
      this.addFloat('ACCESS GRANTED', '#7dffb8', 18)
      return
    }
    e.anim = 0
    if (this.invuln > 0) return
    e.hitT = 0.7
    this.hurt(`ACCESS DENIED – ${BADGE_INFO[e.gates[lane + 1]].name} badge needed`, 'denied', '#e63946')
  }

  private updatePinRow(e: Entity, z: number, dt: number) {
    if (e.done) {
      if (e.anim < 1) e.anim = Math.min(1, e.anim + dt * 5)
      return
    }
    if (z > 1.4) return
    if (this.pinNote !== null && this.pinNote === e.code) {
      this.popupRow = e
      this.popup = { kind: 'pin', code: e.code, triesLeft: 3, attempt: 0, demo: false }
      this.cb.onPopup(this.popup)
      sfx.play('click')
      return
    }
    // no (matching) note: you crash into the locked gates and security opens them
    e.done = true
    this.pinNote = null
    if (this.invuln > 0) return
    e.hitT = 0.7
    e.hitLane = Math.round(this.laneX)
    this.hurt('PIN gate – you missed the yellow note!', 'denied', '#e63946')
  }

  private openVisitor(e: Entity) {
    if (!e.visitor) {
      e.done = true
      return
    }
    this.popupRow = e
    this.popup = { kind: 'visitor', visitor: e.visitor, demo: false }
    this.cb.onPopup(this.popup)
    sfx.play('click')
  }

  private updateElevator(e: Entity, z: number, dt: number) {
    if (z < 9 && e.anim < 1) {
      if (e.anim === 0) sfx.play('click')
      e.anim = Math.min(1, e.anim + dt * 3)
    }
    if (e.done || z > 0.9) return
    e.done = true
    // stop right in front of the wall
    this.dist = e.d - 0.9
    let lane = Math.round(this.laneX)
    const req = e.doors[lane + 1]
    if (req !== 'ALL' && !this.inventory.has(req)) {
      e.hitT = 0.7
      e.hitLane = lane
      if (this.invuln <= 0) this.hurt(`ACCESS DENIED – ${BADGE_INFO[req].name} badge needed`, 'denied', '#e63946')
      if (this.dead > 0) return
      // shifted into the nearest door that does open (ALL ACCESS always exists)
      let best = lane
      let bestD = 9
      for (let l = -1; l <= 1; l++) {
        const r = e.doors[l + 1]
        if ((r === 'ALL' || this.inventory.has(r)) && Math.abs(l - lane) < bestD) {
          best = l
          bestD = Math.abs(l - lane)
        }
      }
      this.laneFrom = this.laneX
      this.lane = best
      this.laneT = 0
      lane = best
    }
    this.startTransition(e, lane)
  }

  /* ---------------------------------------------------------------------------------- */
  /* Hearts                                                                               */
  /* ---------------------------------------------------------------------------------- */

  /** A crash: the escort shield absorbs it, otherwise it costs a heart and a stumble. */
  private hurt(text: string, sound: SfxName, color: string) {
    const pt = this.playerPoint(0.5)
    if (this.shield) {
      this.shield = false
      this.invuln = 1.2
      this.shake = Math.max(this.shake, 0.2)
      sfx.play('pop')
      this.showToast('Escort shield used – no heart lost', 'info')
      burst(this.particles, pt.x, pt.y, 18, ['#2f80ff', '#bfe0ff', '#ffffff'], { speed: 260, life: 0.6, size: 6, shape: 'circle' })
      return
    }
    burst(this.particles, pt.x, pt.y, 16, [color, '#ffffff', '#ffd43b'], { speed: 240, life: 0.6, size: 6 })
    this.loseHeart(text, sound)
  }

  private loseHeart(text: string, sound: SfxName) {
    this.hearts--
    this.stumble = STUMBLE_DUR
    this.invuln = INVULN
    this.shake = 0.4
    this.flash = 1
    this.flashColor = '#e63946'
    this.queued = null
    sfx.play(sound)
    this.showToast(`${text} −1 heart`, 'deny')
    if (this.hearts <= 0) {
      this.hearts = 0
      this.dead = DEAD_TIME
      this.jumpT = -1
      this.fastFall = false
      this.y = 0
      this.slideT = 0
    }
  }

  private gameOver() {
    this.phase = 'over'
    this.score = Math.floor(this.totalDist) + this.bonus
    this.best = submitBest(SLUG, this.score)
    this.badgeFly = null
    this.popup = null
    this.cb.onPopup(null)
    sfx.play('lose')
    this.cb.onPhase('over')
    this.pushHud(true)
  }

  /* ---------------------------------------------------------------------------------- */
  /* Floor transition                                                                     */
  /* ---------------------------------------------------------------------------------- */

  private startTransition(e: Entity, lane: number) {
    const info = ELEVATOR_INFO[e.doors[lane + 1]]
    this.bonus += 200 + info.bonus
    this.addFloat(`+${200 + info.bonus}`, '#ffffff')
    if (info.bonus > 0) this.showToast(`+${info.bonus} bonus – ${info.line1} elevator`, 'coin')
    sfx.play('whoosh')
    // confetti from the top of the door frame
    const top = R.project(this.view, lane * LANE_W, 2.4, 0.9, this.tmp)
    burst(this.particles, top.x, top.y, 46, ['#2bb673', '#2f80ff', '#ffd43b', '#ffffff', info.color], { speed: 300, life: 1.2, size: 7, gravity: 500 })
    this.flash = 0.5
    this.flashColor = '#ffffff'
    this.trans = { t: 0, e }
    this.queued = null
    this.jumpT = -1
    this.fastFall = false
    this.y = 0
    this.slideT = 0
    e.anim = 1
  }

  private updateTransition(dt: number) {
    const tr = this.trans
    if (!tr) return
    tr.t += dt
    this.updateLane(dt)
    this.runPhase += dt * 10
    // step into the cabin, doors close, fade to black
    this.playerZ = 0.6 * easeOutCubic(clamp(tr.t / 0.3, 0, 1))
    const close = clamp((tr.t - 0.32) / 0.3, 0, 1)
    tr.e.anim = 1 - close
    this.transAlpha = 1 - close
    this.fade = clamp((tr.t - 0.62) / 0.33, 0, 1)
    if (tr.t >= 1.0) this.nextFloor()
  }

  private nextFloor() {
    this.floor++
    this.trans = null
    this.entities.length = 0
    this.dist = 0
    this.playerZ = 0
    this.transAlpha = 1
    this.fade = 1
    this.stumble = 0
    this.invuln = 1
    this.kick = 1
    const theme = themeForFloor(this.floor)
    this.view.theme = theme
    this.baseSpeed = Math.min(MAX_SPEED, BASE_SPEED + SPEED_RAMP * this.runTime + SPEED_PER_FLOOR * (this.floor - 1))
    this.spawner.startFloor(this.seed, this.floor, this.baseSpeed, this.inventory)
    this.fillAhead()
    this.score = Math.floor(this.totalDist) + this.bonus
    this.showBanner(floorLabel(this.floor), this.floor > NAMED_FLOORS ? 'Endless mode · it only gets faster' : `${theme.name} · badges kept · speed up`)
    sfx.play('win')
    this.pushHud(true)
  }

  /* ---------------------------------------------------------------------------------- */
  /* Feedback helpers                                                                     */
  /* ---------------------------------------------------------------------------------- */

  private playerPoint(h: number): R.P {
    return R.project(this.view, this.laneX * LANE_W, this.y + h, 0, this.tmp)
  }

  private landDust() {
    if (this.particles.length > 120) return
    const pt = this.playerPoint(0.02)
    burst(this.particles, pt.x, pt.y, 5, ['#ffffff', '#dfe6f0'], { speed: 90, life: 0.3, size: 5, shape: 'circle', gravity: -60 })
  }

  private showToast(text: string, kind: ToastKind) {
    if (this.toasts.some((t) => t.text === text)) return
    // a new message replaces whatever was waiting, so the feedback is never seconds late
    if (this.toasts.length >= 2) this.toasts.splice(1)
    this.toasts.push({ id: ++this.toastId, text, kind })
    if (this.toastT <= 0) this.toastT = 1.9
    else if (this.toasts.length > 1) this.toastT = Math.min(this.toastT, 0.5)
  }

  private showBanner(text: string, sub: string) {
    this.bannerText = text
    this.bannerSub = sub
    this.bannerT = this.bannerDur
  }

  private addFloat(text: string, color: string, size = 26) {
    const pt = this.playerPoint(1.35)
    this.floats.push({ x: pt.x, y: pt.y, text, color, life: 1, maxLife: 1, size })
  }

  /** Badges shown in the HUD: everything held, minus the card that is still flying in. */
  private visibleBadges(): Badge[] {
    const fly = this.badgeFly
    return BADGE_ORDER.filter((b) => this.inventory.has(b) && !(fly && fly.badge === b))
  }

  private pushHud(force: boolean) {
    if (this.score !== this.lastScore) {
      this.lastScore = this.score
      this.cb.onScore(this.score)
    }
    const toast = this.toasts[0] ?? null
    const magnet = Math.ceil(this.magnet)
    const last = this.lastHud
    const visibleCount = this.inventory.size - (this.badgeFly ? 1 : 0)
    if (
      !force &&
      last &&
      last.coins === this.coins &&
      last.hearts === this.hearts &&
      last.floor === this.floor &&
      last.badges.length === visibleCount &&
      last.pinNote === this.pinNote &&
      last.best === this.best &&
      last.toast === toast &&
      last.shield === this.shield &&
      last.magnet === magnet &&
      last.hint === this.hint
    )
      return
    const hud: HudState = {
      score: this.score,
      coins: this.coins,
      hearts: this.hearts,
      floor: this.floor,
      badges: this.visibleBadges(),
      pinNote: this.pinNote,
      best: this.best,
      toast,
      shield: this.shield,
      magnet,
      hint: this.hint,
    }
    this.lastHud = hud
    this.cb.onHud(hud)
  }

  /* ---------------------------------------------------------------------------------- */
  /* Dev hooks (used by the screenshot scenario)                                         */
  /* ---------------------------------------------------------------------------------- */

  private openLanes(e: Entity, z: number): number[] | undefined {
    const out: number[] = []
    switch (e.kind) {
      case 'gate':
        for (let l = -1; l <= 1; l++) if (this.inventory.has(e.gates[l + 1])) out.push(l)
        return out
      case 'elevator':
        for (let l = -1; l <= 1; l++) {
          const r = e.doors[l + 1]
          if (r === 'ALL' || this.inventory.has(r)) out.push(l)
        }
        return out
      case 'barrier':
        for (let l = -1; l <= 1; l++) if (!barrierCovers(e.variant, l)) out.push(l)
        return out
      case 'camera': {
        // lanes the beam will not light while the player crosses the zone at the current speed
        const v = Math.max(1, this.speed)
        const t0 = Math.max(0, (z - e.depth / 2) / v)
        const t1 = Math.max(0, (z + e.depth / 2) / v)
        for (let l = -1; l <= 1; l++) {
          let safe = true
          for (let k = 0; k <= 20 && safe; k++) {
            const b = R.cameraBeamAt(e, e.t + t0 + ((t1 - t0) * k) / 20)
            if (b.on && Math.abs(l - b.center) < R.BEAM_HALF + 0.05) safe = false
          }
          if (safe) out.push(l)
        }
        return out
      }
      default:
        return undefined
    }
  }

  private devState(): DevState {
    const nextEvents: DevEvent[] = []
    for (const e of this.entities) {
      if (nextEvents.length >= 14) break
      const z = e.d - this.dist
      if (!e.alive) continue
      // a camera zone stays relevant until its far edge is behind the runner
      if (e.kind === 'camera' ? z + e.depth / 2 < -0.3 : z < -1) continue
      if (e.dodge === 'none' && !EVENT_KINDS.has(e.kind)) continue
      if (e.done && e.kind !== 'camera') continue
      const ev: DevEvent = { type: e.kind, z: Math.round(z * 100) / 100, lane: e.lane, dodge: e.dodge }
      const open = this.openLanes(e, z)
      if (open) ev.open = open
      if (e.code) ev.code = e.code
      nextEvents.push(ev)
    }
    const p = this.popup
    return {
      phase: this.phase,
      popup: p ? p.kind : null,
      speed: Math.round(this.speed * 100) / 100,
      lane: this.lane,
      floor: this.floor,
      hearts: this.hearts,
      badges: BADGE_ORDER.filter((b) => this.inventory.has(b)),
      score: this.score,
      coins: this.coins,
      dist: Math.round(this.dist * 10) / 10,
      pinNote: this.pinNote,
      jumping: this.jumpT >= 0,
      sliding: this.slideT > 0,
      invulnerable: this.invuln > 0,
      stumbling: this.stumble > 0,
      shield: this.shield,
      magnet: Math.ceil(this.magnet),
      visitorValid: p && p.kind === 'visitor' ? visitorIsValid(p.visitor) : null,
      nextEvents,
    }
  }

  private skipTo(type: EventType): boolean {
    if (this.phase !== 'playing' || this.popup || this.trans || this.dead > 0) return false
    const c = this.spawnCtx
    c.dist = this.dist
    c.speed = this.baseSpeed
    c.floor = this.floor
    this.spawner.forceEvent(type, this.entities, c)
    this.sortEntities()
    return true
  }

  private openDemoVisitor() {
    if (this.popup) return
    this.popup = { kind: 'visitor', visitor: makeVisitor(seededRng((this.seed ^ Math.floor(this.time * 1000)) >>> 0)), demo: true }
    this.cb.onPopup(this.popup)
  }

  private openDemoPin() {
    if (this.popup) return
    this.popup = { kind: 'pin', code: '4821', triesLeft: 3, attempt: 0, demo: true }
    this.cb.onPopup(this.popup)
  }

  /* ---------------------------------------------------------------------------------- */
  /* Render                                                                               */
  /* ---------------------------------------------------------------------------------- */

  private render() {
    const { ctx, width, height, view } = this
    const pv = this.pv
    const sliding = this.slideT > 0
    pv.laneX = this.laneX + (this.edge !== 0 ? Math.sign(this.edge) * 0.22 * Math.sin((Math.abs(this.edge) / 0.16) * Math.PI) : 0)
    pv.y = this.y
    pv.z = this.playerZ
    pv.slide = sliding ? clamp(Math.min(this.slideAge / 0.07, this.slideT / 0.1), 0, 1) : 0
    pv.jumping = this.jumpT >= 0
    pv.run = this.runPhase
    const blink = this.invuln > 0 && this.dead <= 0 && this.phase !== 'over' && Math.floor(this.time * 14) % 2 === 0
    pv.alpha = (blink ? 0.35 : 1) * this.transAlpha
    pv.fall = this.phase === 'over' ? 1 : this.dead > 0 ? 1 - this.dead / DEAD_TIME : 0
    pv.shield = this.shield
    pv.magnet = this.magnet > 0
    pv.lean = (this.laneT < 1 ? Math.sign(this.lane - this.laneFrom) * Math.sin(this.laneT * Math.PI) : 0) + (this.stumble > 0 ? 0.5 * Math.sin(this.time * 22) * this.stumble : 0)
    pv.squash = this.landT > 0 ? Math.sin((this.landT / LAND_DUR) * Math.PI) : 0
    pv.stumble = this.phase === 'playing' && this.dead <= 0 ? clamp(this.stumble / STUMBLE_DUR, 0, 1) : 0
    pv.pace = this.phase === 'playing' ? clamp((this.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1) : 0
    this.rowCtx.hasNote = this.pinNote !== null
    this.scene.dist = this.dist
    this.scene.showPlayer = this.transAlpha > 0.02

    ctx.save()
    ctx.fillStyle = view.theme.fog
    ctx.fillRect(0, 0, width, height)
    // camera: zoom kick about a point between the vanishing point and the runner, crash shake,
    // and a gentle bob synced to the footsteps while running on the ground
    const running = this.phase === 'playing' && !this.popup && !this.trans && this.dead <= 0
    if (this.kick > 0) {
      const zoom = 1 + 0.045 * Math.sin(this.kick * Math.PI * 0.5)
      const zy = view.horizon + (height * 0.8 - view.horizon) * 0.55
      ctx.translate(view.cx, zy)
      ctx.scale(zoom, zoom)
      ctx.translate(-view.cx, -zy)
    }
    let dx = 0
    let dy = 0
    if (this.shake > 0) {
      const a = this.shake * 14
      dx += (Math.random() - 0.5) * a
      dy += (Math.random() - 0.5) * a
    }
    if ((running || this.phase === 'start') && this.jumpT < 0 && this.slideT <= 0) {
      const amp = 0.012 * view.s0
      dy -= amp * Math.abs(Math.sin(this.runPhase))
      dx += amp * 0.35 * Math.sin(this.runPhase)
    }
    if (dx !== 0 || dy !== 0) ctx.translate(dx, dy)
    R.drawScene(ctx, view, this.scene)
    if (running) R.speedLines(ctx, view, clamp((this.speed - 8) / 12, 0, 1) * 0.85 + 0.5 * this.kick)
    drawParticles(ctx, this.particles)
    drawFloatTexts(ctx, this.floats)
    R.drawVignette(ctx, view)
    const fly = this.badgeFly
    if (fly) {
      // arc from the pickup to the inventory card slot in the bottom-left corner
      const t = easeInCubic(clamp(fly.t, 0, 1))
      const idx = this.visibleBadges().length
      const card = width <= 480 ? 49 : 53
      const tx = (width <= 480 ? 32 : 34) + idx * card + 10
      const ty = height - (height < 500 ? 33 : 40)
      const x = lerp(fly.x0, tx, t)
      const y = lerp(fly.y0, ty, t) - Math.sin(t * Math.PI) * height * 0.12
      R.drawFlyingBadge(ctx, x, y, lerp(0.5 * view.s0, 44, t), fly.badge, 1)
    }
    if (this.fade > 0) {
      ctx.globalAlpha = this.fade
      ctx.fillStyle = '#050b1c'
      ctx.fillRect(-40, -40, width + 80, height + 80)
      ctx.globalAlpha = 1
    }
    if (this.bannerT > 0) R.banner(ctx, width, height, this.bannerText, this.bannerSub, 1 - this.bannerT / this.bannerDur)
    if (this.flash > 0) {
      ctx.globalAlpha = 0.35 * this.flash
      ctx.fillStyle = this.flashColor
      ctx.fillRect(-40, -40, width + 80, height + 80)
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }
}
