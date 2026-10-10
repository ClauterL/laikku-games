/**
 * Ticket Slash – the game. Plain TypeScript, no React.
 *
 * Tickets are launched from behind the desk in Fruit-Ninja arcs. The player
 * grabs one (pointerdown inside its generous bounds) and either flicks it
 * (fast release → straight-line flight into a bin) or drags it over a bin and
 * lets go. Everything is simulated in CSS pixels with dt in seconds.
 */
import { fitCanvas, observeResize, pointerPos, startLoop } from '../../shared/canvas'
import {
  burst,
  drawFloatTexts,
  drawParticles,
  shade,
  updateFloatTexts,
  updateParticles,
  type FloatText,
  type Particle,
} from '../../shared/draw'
import { clamp, damp, easeOutCubic, lerp } from '../../shared/math'
import { rnd } from '../../shared/rng'
import { sfx } from '../../shared/sfx'
import { getBest, submitBest } from '../../shared/storage'
import { BINS, P1_TICKETS, RULES, TICKETS } from './catalogue'
import {
  BIN_GLOW_PAD,
  drawBanner,
  drawBinDynamic,
  drawTicket,
  drawTrail,
  renderBinSprite,
  renderCardSprite,
} from './render'
import { drawBokeh, drawDesk, drawDeskProps, makeDeskGradient, makeVignette, renderBackground } from './scene'
import { INITIAL_HUD, type Bin, type EndStats, type EngineCallbacks, type HudState, type Phase, type Ticket, type TicketDef, type TrailPoint } from './types'

export const SLUG = 'ticket-slash'

interface PointerState {
  id: number
  x: number
  y: number
  down: boolean
  /** Recent samples (performance.now() ms) used for the release velocity. */
  history: TrailPoint[]
  vx: number
  vy: number
}

interface Banner {
  text: string
  color: string
  t: number
  life: number
  size: number
}

interface DebugHook {
  tickets: () => { x: number; y: number; category: string; p1: boolean; state: string }[]
  bins: () => { x: number; y: number; w: number; h: number; category: string }[]
  state: () => { phase: Phase; score: number; lives: number; combo: number; streak: number; time: number; fps: number }
  spawnP1: () => void
}

const TRAIL_LIFE = 0.3
const MAX_PARTICLES = 280

export class Engine {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly cb: EngineCallbacks

  // layout (CSS px)
  private W = 1
  private H = 1
  private dpr = 1
  private compact = false
  private small = false
  private bins: Bin[] = []
  private binGap = 12
  private binsTop = 0
  private deskTop = 0
  private ticketW = 150
  private ticketH = 90
  private gravity: number = RULES.gravity

  // cached drawings
  private bg: HTMLCanvasElement | null = null
  private binSprites: HTMLCanvasElement[] = []
  private cardCache = new Map<string, HTMLCanvasElement>()
  private vignette: CanvasGradient | null = null
  private deskGrad: CanvasGradient | null = null

  // state
  phase: Phase = 'start'
  /** Animation clock in seconds – keeps running on the start screen and while paused. */
  private time = 0
  private elapsed = 0
  private timeLeft: number = RULES.roundSeconds
  private score = 0
  private shownScore = 0
  private streak = 0
  private combo = 1
  private bestCombo = 1
  private lives: number = RULES.lives
  private solved = 0
  private wrong = 0
  private missed = 0
  private tickets: Ticket[] = []
  private nextId = 1
  private spawnTimer = 0.7
  private p1Timer: number = RULES.p1First
  private alarmT = 0
  private lastDef: TicketDef | null = null
  private lastP1: TicketDef | null = null

  // input + effects
  private pointer: PointerState | null = null
  private swipe: TrailPoint[] = []
  private fadingTrails: TrailPoint[][] = []
  private particles: Particle[] = []
  private floats: FloatText[] = []
  private banner: Banner | null = null
  private shake = 0
  private edgeFlash = 0
  private hurtFlash = 0

  private lastHud: HudState = INITIAL_HUD
  private lastHudEmit = -1
  private frames = 0
  private fpsT = 0
  private fps = 0
  private disposers: (() => void)[] = []
  private destroyed = false

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas
    this.cb = cb
    this.ctx = canvas.getContext('2d')!

    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onCancel)
    canvas.addEventListener('lostpointercapture', this.onCancel)
    window.addEventListener('keydown', this.onKey)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.disposers.push(() => {
      canvas.removeEventListener('pointerdown', this.onDown)
      canvas.removeEventListener('pointermove', this.onMove)
      canvas.removeEventListener('pointerup', this.onUp)
      canvas.removeEventListener('pointercancel', this.onCancel)
      canvas.removeEventListener('lostpointercapture', this.onCancel)
      window.removeEventListener('keydown', this.onKey)
      document.removeEventListener('visibilitychange', this.onVisibility)
    })
    this.disposers.push(observeResize(canvas, () => this.resize()))
    this.disposers.push(startLoop((dt) => this.update(dt), () => this.render()))

    // Sprites rendered before the web fonts arrive use the fallback font – redo them once loaded.
    const fonts = document.fonts
    if (fonts?.load) {
      Promise.all([
        fonts.load('800 20px "Baloo 2"'),
        fonts.load('700 12px "Nunito"'),
        fonts.load('900 12px "Nunito"'),
      ])
        .then(() => {
          if (!this.destroyed) this.rebuildSprites()
        })
        .catch(() => {})
    }

    if (import.meta.env.DEV) this.installDebugHook()
  }

  destroy() {
    this.destroyed = true
    for (const d of this.disposers) d()
    this.disposers = []
    const w = window as unknown as { __ticketSlash?: DebugHook & { owner?: Engine } }
    if (w.__ticketSlash?.owner === this) delete w.__ticketSlash
  }

  // ------------------------------------------------------------ public API

  start() {
    if (this.phase === 'playing') return
    this.reset()
    this.phase = 'playing'
    this.cb.onPhase('playing')
    this.emitHud(true)
    sfx.play('launch')
  }

  pause() {
    if (this.phase !== 'playing') return
    this.dropHeld()
    this.pointer = null
    this.phase = 'paused'
    this.cb.onPhase('paused')
  }

  resume() {
    if (this.phase !== 'paused') return
    this.phase = 'playing'
    this.cb.onPhase('playing')
  }

  togglePause() {
    if (this.phase === 'playing') this.pause()
    else if (this.phase === 'paused') this.resume()
  }

  restart() {
    this.phase = 'start'
    this.start()
  }

  // ------------------------------------------------------------ layout

  private resize() {
    const s = fitCanvas(this.canvas)
    this.W = s.width
    this.H = s.height
    this.dpr = s.dpr
    this.layout()
    this.rebuildSprites()
  }

  private layout() {
    const { W, H } = this
    this.compact = W < 560
    this.small = this.compact || H < 520
    // mild up-scaling of cards and bins on large screens
    const big = this.small ? 1 : clamp(Math.min(W / 1280, H / 800), 1, 1.25)
    // shorter screens get a gentler gravity so the arcs stay in the air long enough to grab
    this.gravity = RULES.gravity * clamp(H / 800, 0.6, 1)
    let gap: number
    let pad: number
    let bw: number
    let bh: number
    if (this.compact) {
      gap = 6
      pad = 8
      bw = Math.floor((W - pad * 2 - gap * 5) / 6)
      bh = Math.round(bw * 1.08)
    } else {
      gap = 12
      pad = 16
      bw = Math.min(Math.round(150 * big), Math.floor((W - pad * 2 - gap * 5) / 6))
      bh = Math.min(Math.round(bw * 0.8), Math.round(H * 0.2))
      bw = Math.min(bw, Math.round(bh * 1.5))
    }
    const total = bw * 6 + gap * 5
    const x0 = Math.round((W - total) / 2)
    const by = H - (this.compact ? 10 : 14) - bh
    this.binGap = gap
    this.bins = BINS.map((def, i) => ({
      def,
      x: x0 + i * (bw + gap),
      y: by,
      w: bw,
      h: bh,
      flash: 0,
      flashColor: '#ffffff',
      hover: 0,
    }))
    this.binsTop = by
    this.deskTop = by + Math.round(bh * 0.5)
    this.ticketW = Math.round((this.small ? 118 : 150) * big)
    this.ticketH = Math.round((this.small ? 72 : 90) * big)
    for (const t of this.tickets) {
      const k = t.def.p1 ? 1.15 : 1
      t.w = Math.round(this.ticketW * k)
      t.h = Math.round(this.ticketH * k)
    }
  }

  private rebuildSprites() {
    const { W, H, dpr } = this
    this.bg = renderBackground({ W, H, dpr, compact: this.compact, small: this.small, deskTop: this.deskTop, binsTop: this.binsTop })
    this.binSprites = this.bins.map((b) => renderBinSprite(b, dpr, this.compact))
    this.cardCache.clear()
    this.vignette = makeVignette(this.ctx, W, H)
    this.deskGrad = makeDeskGradient(this.ctx, H, this.deskTop)
  }

  private cardSprite(t: Ticket): HTMLCanvasElement {
    const d = t.def
    const key = `${d.p1 ? 'P' : 'T'}|${d.category}|${d.title}|${d.problem}|${t.w}x${t.h}`
    let s = this.cardCache.get(key)
    if (!s) {
      s = renderCardSprite(d, t.w, t.h, this.small, this.dpr)
      this.cardCache.set(key, s)
    }
    return s
  }

  // ------------------------------------------------------------ round state

  private reset() {
    this.tickets = []
    this.particles = []
    this.floats = []
    this.fadingTrails = []
    this.swipe = []
    this.banner = null
    this.pointer = null
    this.score = 0
    this.shownScore = 0
    this.streak = 0
    this.combo = 1
    this.bestCombo = 1
    this.lives = RULES.lives
    this.solved = 0
    this.wrong = 0
    this.missed = 0
    this.elapsed = 0
    this.timeLeft = RULES.roundSeconds
    this.spawnTimer = 0.7
    this.p1Timer = RULES.p1First
    this.alarmT = 0
    this.shake = 0
    this.edgeFlash = 0
    this.hurtFlash = 0
    for (const b of this.bins) {
      b.flash = 0
      b.hover = 0
    }
  }

  private makeTicket(def: TicketDef): Ticket {
    const k = def.p1 ? 1.15 : 1
    return {
      id: this.nextId++,
      def,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      rot: 0,
      vrot: 0,
      w: Math.round(this.ticketW * k),
      h: Math.round(this.ticketH * k),
      state: 'flying',
      grabDx: 0,
      grabDy: 0,
      lift: 0,
      trail: [],
      timer: RULES.p1Seconds,
      hoverX: 0,
      hoverY: 0,
      riseFromX: 0,
      riseFromY: 0,
      riseT: 0,
      riseDur: 1,
      rising: false,
      arrived: false,
      bob: rnd.range(0, Math.PI * 2),
    }
  }

  /** Top of the HUD-free play area (the HTML chips cover the top of the screen). */
  private hudBottom() {
    return this.compact ? 150 : 110
  }

  private launch() {
    let def = rnd.pick(TICKETS)
    if (def === this.lastDef) def = rnd.pick(TICKETS)
    this.lastDef = def
    const t = this.makeTicket(def)
    const { W, H } = this
    t.x = rnd.range(W * 0.15, W * 0.85)
    t.y = H + t.h
    // apex somewhere in the upper half, below the HUD
    const apexMin = Math.max(H * 0.2, this.hudBottom() + t.h / 2 + 10)
    const apexMax = Math.max(apexMin + 20, H * 0.46)
    const apex = rnd.range(apexMin, apexMax)
    t.vy = -Math.sqrt(2 * this.gravity * (t.y - apex))
    // drift towards the centre so arcs stay on screen
    t.vx = ((W / 2 - t.x) / W) * rnd.range(120, 260) + rnd.range(-70, 70)
    t.rot = rnd.range(-0.35, 0.35)
    t.vrot = rnd.range(-1.1, 1.1)
    this.tickets.push(t)
    sfx.play('whoosh')
  }

  private spawnP1() {
    let def = rnd.pick(P1_TICKETS)
    if (def === this.lastP1) def = rnd.pick(P1_TICKETS)
    this.lastP1 = def
    const t = this.makeTicket(def)
    const { W, H } = this
    t.state = 'p1'
    t.hoverX = rnd.range(W * 0.3, W * 0.7)
    t.hoverY = Math.max(this.hudBottom() + t.h / 2 + 24, H * (this.compact ? 0.38 : 0.34))
    t.x = t.hoverX + rnd.range(-40, 40)
    t.y = H + t.h
    this.startRise(t, 1.0)
    this.tickets.push(t)
    this.alarmT = 1.1
    sfx.play('alarm')
    this.banner = { text: 'P1 CRITICAL!', color: '#ff4d4f', t: 0, life: 1.1, size: this.small ? 30 : 44 }
    this.shake = Math.max(this.shake, 6)
  }

  private startRise(t: Ticket, dur: number) {
    t.riseFromX = t.x
    t.riseFromY = t.y
    t.riseT = 0
    t.riseDur = dur
    t.rising = true
  }

  private p1Alive() {
    return this.tickets.some((t) => t.def.p1)
  }

  private heldTicket(): Ticket | null {
    for (let i = this.tickets.length - 1; i >= 0; i--) if (this.tickets[i].state === 'held') return this.tickets[i]
    return null
  }

  /** Put a held ticket back into play (pause, pointer cancel). */
  private dropHeld() {
    const t = this.heldTicket()
    if (!t) return
    if (t.def.p1) {
      t.state = 'p1'
      this.startRise(t, 0.5)
    } else {
      t.state = 'flying'
      t.vx = 0
      t.vy = 0
    }
  }

  // ------------------------------------------------------------ geometry

  private topEdge(t: Ticket) {
    return t.y - (Math.abs(Math.cos(t.rot)) * t.h) / 2 - (Math.abs(Math.sin(t.rot)) * t.w) / 2
  }

  private bottomEdge(t: Ticket) {
    return t.y + (Math.abs(Math.cos(t.rot)) * t.h) / 2 + (Math.abs(Math.sin(t.rot)) * t.w) / 2
  }

  /** The bin whose catch zone (bin rect extended upward by its height, plus half a gap sideways) contains the point. */
  private binAtPoint(x: number, y: number): Bin | null {
    const g = this.binGap / 2
    for (const b of this.bins) {
      if (x >= b.x - g && x <= b.x + b.w + g && y >= b.y - b.h && y <= b.y + b.h) return b
    }
    return null
  }

  /**
   * Where a flicked ticket lands. Once it is inside the catch band above the
   * bins, the bin is chosen by where its straight path crosses the bin rim –
   * not by the column it happens to be in – so a shallow diagonal flick is not
   * caught by the neighbour of the bin the player aimed at.
   */
  private landingBin(t: Ticket): Bin | null {
    const b0 = this.bins[0]
    if (!b0 || t.y < b0.y - b0.h * 0.6 || t.vy < -100) return null
    const xr = t.vy > 60 ? t.x + ((b0.y + 10 - t.y) * t.vx) / t.vy : t.x
    const g = this.binGap / 2
    for (const b of this.bins) {
      if (xr >= b.x - g && xr <= b.x + b.w + g) return b
    }
    return null
  }

  private hitTicket(t: Ticket, px: number, py: number) {
    const pad = this.small ? 16 : 18
    const dx = px - t.x
    const dy = py - t.y
    const c = Math.cos(-t.rot)
    const s = Math.sin(-t.rot)
    const lx = dx * c - dy * s
    const ly = dx * s + dy * c
    return Math.abs(lx) <= t.w / 2 + pad && Math.abs(ly) <= t.h / 2 + pad
  }

  /** Topmost grabbable ticket under the pointer; a P1 always wins. */
  private ticketAt(px: number, py: number): Ticket | null {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = this.tickets.length - 1; i >= 0; i--) {
        const t = this.tickets[i]
        if (pass === 0 && !t.def.p1) continue
        if (t.state !== 'flying' && t.state !== 'p1') continue
        if (t.y > this.deskTop) continue
        if (this.hitTicket(t, px, py)) return t
      }
    }
    return null
  }

  // ------------------------------------------------------------ input

  private onDown = (e: PointerEvent) => {
    if (this.phase !== 'playing') return
    if (this.pointer?.down) {
      // a second finger is ignored; the same pointer pressing again means its "up" was lost
      if (e.pointerId !== this.pointer.id) return
      this.finishPointer(e.pointerId)
      this.dropHeld()
    }
    sfx.unlock()
    e.preventDefault()
    const p = pointerPos(this.canvas, e)
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      /* not supported */
    }
    const now = performance.now()
    this.pointer = { id: e.pointerId, x: p.x, y: p.y, down: true, history: [{ x: p.x, y: p.y, t: now }], vx: 0, vy: 0 }
    this.swipe = [{ x: p.x, y: p.y, t: this.time }]
    const t = this.ticketAt(p.x, p.y)
    if (t) {
      t.state = 'held'
      t.grabDx = t.x - p.x
      t.grabDy = t.y - p.y
      t.vx = 0
      t.vy = 0
      t.vrot = 0
      t.trail = []
      // draw it on top of everything else
      const i = this.tickets.indexOf(t)
      this.tickets.splice(i, 1)
      this.tickets.push(t)
      sfx.play('tap')
    }
  }

  private onMove = (e: PointerEvent) => {
    const ptr = this.pointer
    if (!ptr || !ptr.down || e.pointerId !== ptr.id) return
    const p = pointerPos(this.canvas, e)
    const now = performance.now()
    ptr.x = p.x
    ptr.y = p.y
    const h = ptr.history
    // Browsers coalesce pointermoves to one per frame; keep the fine-grained samples for the flick velocity.
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    if (coalesced.length > 1) {
      for (const ev of coalesced) {
        const q = pointerPos(this.canvas, ev)
        h.push({ x: q.x, y: q.y, t: now - Math.max(0, e.timeStamp - ev.timeStamp) })
      }
    } else h.push({ x: p.x, y: p.y, t: now })
    while (h.length > 2 && now - h[0].t > 150) h.shift()
    const v = this.estimateVelocity(ptr, now)
    ptr.vx = v.x
    ptr.vy = v.y
    this.swipe.push({ x: p.x, y: p.y, t: this.time })
    if (this.swipe.length > 40) this.swipe.shift()
    if (this.phase !== 'playing') return
    const held = this.heldTicket()
    if (held) {
      held.x = p.x + held.grabDx
      held.y = p.y + held.grabDy
    }
    // sparkles along the blade
    if (this.particles.length < MAX_PARTICLES && Math.hypot(v.x, v.y) > 150) {
      burst(this.particles, p.x, p.y, 1, ['#ffffff', '#bfe0ff', '#7fc0ff'], { speed: 70, life: 0.35, size: 4, gravity: 0, shape: 'spark' })
    }
  }

  private onUp = (e: PointerEvent) => {
    const ptr = this.pointer
    if (!ptr || e.pointerId !== ptr.id) return
    const p = pointerPos(this.canvas, e)
    const now = performance.now()
    ptr.history.push({ x: p.x, y: p.y, t: now })
    const v = this.estimateVelocity(ptr, now)
    this.finishPointer(e.pointerId)
    const held = this.heldTicket()
    if (held && this.phase === 'playing') this.release(held, v, p.x, p.y)
  }

  /** pointercancel / lostpointercapture: let go of whatever is held (no-op after a normal pointerup). */
  private onCancel = (e: PointerEvent) => {
    const ptr = this.pointer
    if (!ptr || e.pointerId !== ptr.id) return
    this.finishPointer(e.pointerId)
    this.dropHeld()
  }

  private finishPointer(id: number) {
    try {
      this.canvas.releasePointerCapture(id)
    } catch {
      /* ignore */
    }
    this.pointer = null
  }

  /**
   * Release velocity in px/s from the recent pointer samples: from the newest
   * sample that is at least 40 ms old (or the oldest we have, ≤ 150 ms) to the
   * latest one. A finger that stopped before lifting therefore reads as slow
   * (drag & drop), while a flick keeps its speed even when the browser
   * delivered only one or two move events for the whole gesture.
   */
  private estimateVelocity(ptr: PointerState, now: number) {
    const h = ptr.history
    if (h.length < 2) return { x: 0, y: 0 }
    const b = h[h.length - 1]
    let a = h[0]
    for (let i = h.length - 2; i >= 0; i--) {
      if (now - h[i].t >= 40) {
        a = h[i]
        break
      }
    }
    // never divide by a sub-frame interval
    const dt = Math.max(16, b.t - a.t) / 1000
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
  }

  private release(t: Ticket, v: { x: number; y: number }, px: number, py: number) {
    const speed = Math.hypot(v.x, v.y)
    if (speed >= RULES.flickMinSpeed) {
      const s = clamp(speed, RULES.flickSpeedMin, RULES.flickSpeedMax)
      t.state = 'flicked'
      t.vx = (v.x / speed) * s
      t.vy = (v.y / speed) * s
      t.vrot = clamp(v.x / 600, -3, 3)
      t.trail = [{ x: t.x, y: t.y, t: this.time }]
      sfx.play('whoosh')
      return
    }
    // slow release: drag & drop onto a bin, otherwise let it go
    const bin = this.binAtPoint(t.x, t.y) ?? this.binAtPoint(px, py)
    if (bin) {
      this.deliver(t, bin)
      return
    }
    if (t.def.p1) {
      t.state = 'p1'
      this.startRise(t, 0.5)
    } else {
      t.state = 'flying'
      t.vx = v.x * 0.6
      t.vy = v.y * 0.6
      t.vrot = rnd.range(-1, 1)
    }
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.repeat) return
    const k = e.key
    if (k === 'Escape' || k === 'p' || k === 'P') {
      if (this.phase === 'playing' || this.phase === 'paused') {
        e.preventDefault()
        this.togglePause()
      }
    } else if (k === 'Enter' || k === ' ') {
      if (this.phase === 'start' || this.phase === 'over') {
        e.preventDefault()
        sfx.unlock()
        this.start()
      } else if (this.phase === 'paused') {
        e.preventDefault()
        this.resume()
      }
    }
  }

  private onVisibility = () => {
    if (document.hidden && this.phase === 'playing') this.pause()
  }

  // ------------------------------------------------------------ outcomes

  /** Floating score / status text, kept inside the viewport so edge bins do not clip it. */
  private floatText(x: number, y: number, text: string, color: string, size: number, life = 1.1) {
    const margin = Math.min(this.W / 2, text.length * size * 0.32 + 8)
    this.floats.push({ x: clamp(x, margin, this.W - margin), y, text, color, life, maxLife: life, size })
  }

  private removeTicket(t: Ticket) {
    const i = this.tickets.indexOf(t)
    if (i >= 0) this.tickets.splice(i, 1)
    if (t.trail.length > 1) this.fadingTrails.push(t.trail)
  }

  private deliver(t: Ticket, bin: Bin) {
    this.removeTicket(t)
    const bx = bin.x + bin.w / 2
    const by = bin.y + 4
    const color = bin.def.color
    if (t.def.category === bin.def.category) {
      this.streak++
      this.combo = Math.min(RULES.comboMax, this.streak)
      this.bestCombo = Math.max(this.bestCombo, this.combo)
      const base = t.def.p1 ? RULES.p1Points : RULES.ticketPoints
      this.score += base * this.combo
      this.solved++
      bin.flash = 1
      bin.flashColor = '#37e36b'
      burst(this.particles, bx, by, t.def.p1 ? 44 : 24, [color, '#ffffff', '#ffd43b', shade(color, 0.5)], {
        speed: t.def.p1 ? 420 : 320,
        life: 0.85,
        size: 7,
      })
      this.floatText(
        bx,
        bin.y - (this.small ? 18 : 26),
        this.combo > 1 ? `+${base} ×${this.combo}` : `+${base}`,
        '#ffd43b',
        t.def.p1 ? 30 : this.small ? 20 : 24,
      )
      if (t.def.p1) {
        if (this.lives < RULES.lives) {
          this.lives++
          this.floatText(bx, bin.y - 56, '+1 LIFE', '#37e36b', 22, 1.3)
        }
        this.banner = { text: 'P1 RESOLVED!', color: '#37e36b', t: 0, life: 1.1, size: this.small ? 30 : 44 }
        this.shake = Math.max(this.shake, 8)
        sfx.play('win')
      } else {
        sfx.play(this.streak % 4 === 0 ? 'combo' : 'good')
      }
    } else {
      this.streak = 0
      this.combo = 1
      this.wrong++
      bin.flash = 1
      bin.flashColor = '#ff4d4f'
      burst(this.particles, bx, by, 16, ['#ff4d4f', '#ffffff', '#c8d2e6'], { speed: 240, life: 0.6, size: 6 })
      this.floatText(bx, bin.y - 26, 'WRONG BIN', '#ff6b6b', this.small ? 18 : 22, 1.0)
      this.shake = Math.max(this.shake, 4)
      sfx.play('bad')
    }
    this.emitHud(true)
  }

  /** A ticket fell behind the desk (MISSED) or a flicked one left the screen (TICKET LOST). */
  private loseTicket(t: Ticket, label: string) {
    this.removeTicket(t)
    this.lives--
    this.streak = 0
    this.combo = 1
    this.missed++
    this.edgeFlash = 1
    this.hurtFlash = 0.7
    const fx = clamp(t.x, 70, this.W - 70)
    const fy = clamp(t.y, this.hudBottom(), this.binsTop - 30)
    this.floatText(fx, fy, label, '#ff6b6b', this.small ? 20 : 26, 1.2)
    burst(this.particles, fx, Math.min(fy, this.deskTop), 12, ['#ff4d4f', '#ffb0b0'], { speed: 200, life: 0.5, size: 5, shape: 'spark', gravity: 0 })
    this.shake = Math.max(this.shake, 5)
    sfx.play('hit')
    this.emitHud(true)
    if (this.lives <= 0) this.endGame('lives')
  }

  private breach(t: Ticket) {
    this.removeTicket(t)
    this.lives--
    this.streak = 0
    this.combo = 1
    this.missed++
    this.banner = { text: 'SLA BREACHED!', color: '#ff4d4f', t: 0, life: 1.5, size: this.small ? 34 : 56 }
    this.shake = Math.max(this.shake, 16)
    this.hurtFlash = 1
    this.edgeFlash = 0.6
    burst(this.particles, t.x, t.y, 40, ['#ff4d4f', '#ff9a3c', '#ffffff', '#7a0b12'], { speed: 460, life: 0.9, size: 8 })
    sfx.play('explode')
    this.emitHud(true)
    if (this.lives <= 0) this.endGame('lives')
  }

  private endGame(reason: EndStats['reason']) {
    if (this.phase !== 'playing') return
    this.phase = 'over'
    this.pointer = null
    this.dropHeld()
    const prevBest = getBest(SLUG)
    const best = submitBest(SLUG, this.score)
    const attempts = this.solved + this.wrong + this.missed
    const stats: EndStats = {
      score: this.score,
      best,
      newBest: this.score > prevBest && this.score > 0,
      solved: this.solved,
      bestCombo: this.bestCombo,
      accuracy: attempts ? Math.round((this.solved / attempts) * 100) : 0,
      reason,
    }
    this.shownScore = this.score
    this.emitHud(true)
    sfx.play(reason === 'time' ? 'win' : 'lose')
    this.cb.onPhase('over')
    this.cb.onOver(stats)
  }

  // ------------------------------------------------------------ update

  private update(dt: number) {
    this.time += dt
    this.frames++
    this.fpsT += dt
    if (this.fpsT >= 1) {
      this.fps = Math.round(this.frames / this.fpsT)
      this.frames = 0
      this.fpsT = 0
    }
    if (this.phase === 'playing') this.updateGame(dt)

    updateParticles(this.particles, dt)
    updateFloatTexts(this.floats, dt)
    const cut = this.time - TRAIL_LIFE
    while (this.swipe.length && this.swipe[0].t < cut) this.swipe.shift()
    for (let i = this.fadingTrails.length - 1; i >= 0; i--) {
      const tr = this.fadingTrails[i]
      while (tr.length && tr[0].t < cut) tr.shift()
      if (tr.length < 2) this.fadingTrails.splice(i, 1)
    }
    const held = this.heldTicket()
    const hoverBin =
      held && this.phase === 'playing'
        ? (this.binAtPoint(held.x, held.y) ?? (this.pointer ? this.binAtPoint(this.pointer.x, this.pointer.y) : null))
        : null
    for (const b of this.bins) {
      b.flash = Math.max(0, b.flash - dt * 2.2)
      b.hover = damp(b.hover, b === hoverBin ? 1 : 0, 14, dt)
    }
    this.shake = this.shake > 0.05 ? damp(this.shake, 0, 9, dt) : 0
    this.edgeFlash = Math.max(0, this.edgeFlash - dt * 1.8)
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5)
    if (this.banner) {
      this.banner.t += dt
      if (this.banner.t >= this.banner.life) this.banner = null
    }
    // smooth score count-up
    if (this.shownScore !== this.score) {
      this.shownScore = damp(this.shownScore, this.score, 7, dt)
      if (Math.abs(this.score - this.shownScore) < 0.8) this.shownScore = this.score
    }
    this.emitHud()
  }

  private updateGame(dt: number) {
    const { W, H } = this
    this.elapsed += dt
    this.timeLeft = Math.max(0, RULES.roundSeconds - this.elapsed)
    if (this.timeLeft <= 0) {
      this.endGame('time')
      return
    }

    // spawning: 1.6 s at the start → 0.7 s at the end, sometimes two at once after 20 s
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0) {
      const flying = this.tickets.reduce((n, t) => n + (t.def.p1 ? 0 : 1), 0)
      if (flying < RULES.maxTickets) {
        this.launch()
        const dbl = this.elapsed > RULES.doubleAfter ? lerp(0.15, 0.45, clamp((this.elapsed - RULES.doubleAfter) / 40, 0, 1)) : 0
        if (flying + 1 < RULES.maxTickets && rnd.chance(dbl)) this.launch()
      }
      const interval = lerp(RULES.spawnStart, RULES.spawnEnd, clamp(this.elapsed / RULES.roundSeconds, 0, 1))
      this.spawnTimer = interval * rnd.range(0.85, 1.15)
    }

    // P1 schedule + alarm loop while one is alive
    if (this.p1Alive()) {
      this.alarmT -= dt
      if (this.alarmT <= 0) {
        sfx.play('alarm')
        this.alarmT = 1.1
      }
    } else {
      this.p1Timer -= dt
      if (this.p1Timer <= 0 && this.timeLeft > 6) {
        this.spawnP1()
        this.p1Timer = rnd.range(RULES.p1EveryMin, RULES.p1EveryMax)
      }
    }

    const ptr = this.pointer
    for (let i = this.tickets.length - 1; i >= 0; i--) {
      const t = this.tickets[i]
      t.lift = damp(t.lift, t.state === 'held' ? 1 : 0, 14, dt)
      // SLA timer runs from the first arrival on, also while held
      if (t.def.p1 && t.arrived && (t.state === 'p1' || t.state === 'held')) {
        t.timer -= dt
        if (t.timer <= 0) {
          this.breach(t)
          if (this.phase !== 'playing') return
          continue
        }
      }
      switch (t.state) {
        case 'flying': {
          t.vy += this.gravity * dt
          t.x += t.vx * dt
          t.y += t.vy * dt
          t.rot += t.vrot * dt
          const half = t.w / 2
          if (t.x < half + 6 && t.vx < 0) {
            t.vx *= -0.7
            t.x = half + 6
          } else if (t.x > W - half - 6 && t.vx > 0) {
            t.vx *= -0.7
            t.x = W - half - 6
          }
          if (t.vy > 0 && this.topEdge(t) > this.deskTop + 6) {
            this.loseTicket(t, 'MISSED')
            if (this.phase !== 'playing') return
          }
          break
        }
        case 'held': {
          if (ptr) {
            t.x = ptr.x + t.grabDx
            t.y = ptr.y + t.grabDy
            t.rot = damp(t.rot, clamp(ptr.vx / 5000, -0.3, 0.3), 12, dt)
          }
          break
        }
        case 'flicked': {
          t.x += t.vx * dt
          t.y += t.vy * dt
          t.rot += t.vrot * dt
          t.trail.push({ x: t.x, y: t.y, t: this.time })
          if (t.trail.length > 30) t.trail.shift()
          const bin = this.landingBin(t)
          if (bin) {
            this.deliver(t, bin)
            break
          }
          if (t.x < -t.w || t.x > W + t.w || t.y < -t.h || t.y > H + t.h) {
            this.loseTicket(t, 'TICKET LOST')
            if (this.phase !== 'playing') return
          }
          break
        }
        case 'p1': {
          if (t.rising) {
            t.riseT += dt
            const k = easeOutCubic(Math.min(1, t.riseT / t.riseDur))
            t.x = lerp(t.riseFromX, t.hoverX, k)
            t.y = lerp(t.riseFromY, t.hoverY, k)
            t.rot = damp(t.rot, 0, 6, dt)
            if (t.riseT >= t.riseDur) {
              t.rising = false
              t.arrived = true
            }
          } else {
            t.bob += dt
            t.y = t.hoverY + Math.sin(t.bob * 2.2) * 6
            t.x = t.hoverX + Math.sin(t.bob * 1.3) * 4
            t.rot = Math.sin(t.bob * 1.7) * 0.05
          }
          break
        }
      }
    }
  }

  private emitHud(force = false) {
    const h: HudState = {
      score: Math.round(this.shownScore),
      combo: this.combo,
      streak: this.streak,
      time: Math.ceil(this.timeLeft),
      lives: this.lives,
      p1: this.p1Alive(),
      solved: this.solved,
    }
    const L = this.lastHud
    const other =
      h.combo !== L.combo || h.streak !== L.streak || h.time !== L.time || h.lives !== L.lives || h.p1 !== L.p1 || h.solved !== L.solved
    const scoreChanged = h.score !== L.score
    if (!force && !other && !scoreChanged) return
    // the counting score would otherwise re-render React every frame
    if (!force && !other && this.time - this.lastHudEmit < 0.04) return
    this.lastHud = h
    this.lastHudEmit = this.time
    this.cb.onHud(h)
  }

  // ------------------------------------------------------------ render

  private render() {
    const { ctx, W, H } = this
    ctx.save()
    if (this.shake > 0.3) ctx.translate((Math.random() - 0.5) * 2 * this.shake, (Math.random() - 0.5) * 2 * this.shake)

    if (this.bg) ctx.drawImage(this.bg, 0, 0, W, H)
    drawBokeh(ctx, W, H, this.time)

    if (this.vignette && this.p1Alive() && this.phase === 'playing') {
      ctx.save()
      ctx.globalAlpha = 0.32 + 0.22 * Math.sin(this.time * 6)
      ctx.fillStyle = this.vignette
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    }

    // tickets launching from / falling behind the desk are drawn under it
    const front: Ticket[] = []
    for (const t of this.tickets) {
      if (t.state === 'flying' && this.bottomEdge(t) > this.binsTop) this.drawTicketItem(t)
      else front.push(t)
    }

    if (this.deskGrad) drawDesk(ctx, W, H, this.deskTop, this.deskGrad)
    if (!this.compact && this.bins.length) {
      const last = this.bins[this.bins.length - 1]
      drawDeskProps(ctx, this.deskTop, this.bins[0].x, last.x + last.w, W)
    }

    const dragging = this.phase === 'playing' && this.heldTicket() !== null
    const P = BIN_GLOW_PAD
    for (let i = 0; i < this.bins.length; i++) {
      const b = this.bins[i]
      const s = this.binSprites[i]
      if (!s) continue
      const sc = 1 + 0.06 * b.hover
      if (sc > 1.001) {
        ctx.save()
        ctx.translate(b.x + b.w / 2, b.y + b.h)
        ctx.scale(sc, sc)
        ctx.drawImage(s, -b.w / 2 - P, -b.h - P, b.w + P * 2, b.h + P * 2)
        ctx.restore()
      } else {
        ctx.drawImage(s, b.x - P, b.y - P, b.w + P * 2, b.h + P * 2)
      }
      drawBinDynamic(ctx, b, this.time, dragging)
    }

    // front tickets: flying, then P1, then flicked, held on top
    for (const t of front) if (t.state === 'flying') this.drawTicketItem(t)
    for (const t of front) if (t.state === 'p1') this.drawTicketItem(t)
    for (const t of front) if (t.state === 'flicked') this.drawTicketItem(t)
    for (const t of front) if (t.state === 'held') this.drawTicketItem(t)

    const trailW = this.small ? 9 : 12
    for (const tr of this.fadingTrails) drawTrail(ctx, tr, this.time, TRAIL_LIFE, trailW)
    for (const t of this.tickets) if (t.state === 'flicked') drawTrail(ctx, t.trail, this.time, TRAIL_LIFE, trailW)
    if (this.swipe.length > 1) drawTrail(ctx, this.swipe, this.time, TRAIL_LIFE, trailW)

    drawParticles(ctx, this.particles)
    drawFloatTexts(ctx, this.floats)

    if (this.edgeFlash > 0.01) {
      const g = ctx.createLinearGradient(0, H, 0, H - 140)
      g.addColorStop(0, `rgba(255, 50, 60, ${0.8 * this.edgeFlash})`)
      g.addColorStop(1, 'rgba(255, 50, 60, 0)')
      ctx.fillStyle = g
      ctx.fillRect(0, H - 140, W, 140)
    }
    if (this.hurtFlash > 0.01) {
      ctx.fillStyle = `rgba(255, 40, 40, ${0.22 * this.hurtFlash})`
      ctx.fillRect(0, 0, W, H)
    }
    if (this.banner) drawBanner(ctx, this.banner.text, this.banner.color, W / 2, H * 0.38, this.banner.t, this.banner.life, this.banner.size)
    ctx.restore()
  }

  private drawTicketItem(t: Ticket) {
    drawTicket(this.ctx, t, this.cardSprite(t), this.time, RULES.p1Seconds)
  }

  // ------------------------------------------------------------ dev hook

  private installDebugHook() {
    const hook: DebugHook & { owner: Engine } = {
      owner: this,
      tickets: () => this.tickets.map((t) => ({ x: t.x, y: t.y, category: t.def.category, p1: t.def.p1, state: t.state })),
      bins: () => this.bins.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, category: b.def.category })),
      state: () => ({
        phase: this.phase,
        score: this.score,
        lives: this.lives,
        combo: this.combo,
        streak: this.streak,
        time: this.timeLeft,
        fps: this.fps,
      }),
      spawnP1: () => {
        if (this.phase === 'playing' && !this.p1Alive()) this.spawnP1()
      },
    }
    ;(window as unknown as { __ticketSlash?: unknown }).__ticketSlash = hook
  }
}
