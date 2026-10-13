/**
 * Uptime Keeper – the decorative banner drone that flies outside the hall.
 *
 * Purely cosmetic and screen-space: the engine hands it the screen rectangles
 * it must keep clear of (the HTML HUD panels, the hall with its glowing shell,
 * the joystick) and it picks the free area with the most room for its banner:
 *   - wide margins: a lazy figure-eight, the flyer hanging under the drone on one
 *     to four lines (the widest that still fits wins – it reads best)
 *   - tall, narrow margins (desktop beside a wide hall): a vertical figure-eight
 *     with a hanging vertical streamer
 *   - no room at all (phones, the widest halls): every 16–24 s a quick pass along
 *     the hall's top edge, towing the banner behind it on a rope. It is drawn under
 *     the alert badges and only flies where the hall's back wall is on screen.
 * The hanging banner lags behind the drone like a pendulum; both kinds flutter
 * (drawn in thin slices of a cached texture, so it stays cheap).
 */
import { hexToRgba, roundRectPath } from '../../shared/draw'
import { clamp, damp } from '../../shared/math'

export const SLOGAN = 'Construct, Automate, Explore & Exploit'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type BannerFormat = 'line' | 'two' | 'three' | 'four' | 'tall'

const LINES: Record<BannerFormat, string[]> = {
  line: [SLOGAN],
  two: ['Construct, Automate,', 'Explore & Exploit'],
  three: ['Construct,', 'Automate,', 'Explore & Exploit'],
  four: ['Construct,', 'Automate,', 'Explore &', 'Exploit'],
  tall: [SLOGAN],
}

/** Readability first: one long line beats a stacked flyer, both beat the rotated streamer. */
const FORMAT_BONUS: Record<BannerFormat, number> = { line: 1.6, two: 1.1, three: 0.6, four: 0.1, tall: -2.4 }
const FORMATS: BannerFormat[] = ['line', 'two', 'three', 'four', 'tall']
const FONT_MIN = 11
const FONT_MAX = 15
/** Top speed (px/s) outside fly-bys: flying in, changing patrols, leaving. */
const MAX_CRUISE = 170
/** Largest swing (radians) of a hanging flyer; the vertical streamer barely tilts (its tail would sweep sideways). */
const TILT_MAX = 0.2
const TILT_MAX_TALL = 0.02
/** Room (px) above and below a fly-by for its bob and the banner's flutter. */
const FLYBY_BOB = 3
const font = (s: number) => `800 ${s}px "Baloo 2", "Nunito", sans-serif`

/**
 * Deepest the hanging banner's top edge gets below the drone's centre: clear of a rotor even when
 * the X frame turns 45° (0.74 × span) and when the tilted edge rises under the drone.
 */
const hangOf = (d: Dims) => Math.max(d.span * 0.74 + d.rope * 0.9 * Math.sin(TILT_MAX), d.rope + d.span * 0.12)

/** Swing limit for a banner: wide flyers swing less (a corner drops at most ~14 px), so they stay readable. */
const tiltLimit = (format: BannerFormat, d: Dims) => (format === 'tall' ? TILT_MAX_TALL : Math.min(TILT_MAX, 14 / Math.max(1, d.bw / 2)))

export interface DroneInput {
  W: number
  H: number
  /** Area the drone may use at all (between the top and bottom HUD bands). */
  bounds: Rect
  /** HUD panels and the joystick – never fly under or over these. */
  hud: Rect[]
  /** The hall including its glowing shell – the patrol keeps out of it. */
  hall: Rect
  /** Screen y of the hall's top edge, its tile size, and whether that edge is on screen. */
  hallTop: number
  tile: number
  hallTopVisible: boolean
}

export interface DroneView {
  visible: boolean
  x: number
  y: number
  heading: number
  /** Drone span in px. */
  span: number
  alpha: number
  rotor: number
  /** The drone's own clock (stops while the game is paused). */
  clock: number
  /** Top centre of the banner. */
  bx: number
  by: number
  tilt: number
  format: BannerFormat
  fontSize: number
  wave: number
  /** Fly-by: the banner is towed behind (dir = flight direction) instead of hanging below. */
  towed: 0 | 1 | -1
}

interface Plan {
  format: BannerFormat
  fontSize: number
  /** Figure-eight centre and amplitudes for the drone's body. */
  cx: number
  cy: number
  ax: number
  ay: number
  vertical: boolean
}

export interface Dims {
  bw: number
  bh: number
  span: number
  rope: number
}

const rectsOverlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
export const overlaps = rectsOverlap

export class DroneFlight {
  view: DroneView = { visible: false, x: -200, y: -200, heading: 0, span: 34, alpha: 0, rotor: 0, clock: 0, bx: 0, by: 0, tilt: 0, format: 'two', fontSize: 13, wave: 0, towed: 0 }
  /** Bumped when the web font arrives: text widths and the banner texture are rebuilt. */
  version = 0
  private measure: (text: string, font: string) => number
  /** Text widths at 100 px, per line. */
  private widths = new Map<string, number>()
  private fitMemo = new Map<string, Omit<Plan, 'cx' | 'cy'> & { ox: number; oy: number } | null>()
  private plan: Plan | null = null
  private theta = Math.random() * Math.PI * 2
  private vx = 0
  private vy = 0
  private sway = 0
  private swayV = 0
  /** A pass along the hall's top edge; `off` keeps it on the back wall when the camera scrolls. */
  private flyby: { t: number; dur: number; dir: 1 | -1; off: number; h: number; fontSize: number; forced: boolean; fade: boolean } | null = null
  private flybyWait = 6
  private entered = false
  /** A new patrol area that cannot be reached without crossing the hall or the HUD: fade over to it. */
  private pending: Plan | null = null

  constructor(measure: (text: string, font: string) => number) {
    this.measure = measure
  }

  resetMetrics() {
    this.widths.clear()
    this.fitMemo.clear()
    this.version++
  }

  /** Text width of a line at a font size (measured once at 100 px, scaled linearly). */
  private textW(line: string, size: number): number {
    let w = this.widths.get(line)
    if (w === undefined) {
      w = this.measure(line, font(100))
      this.widths.set(line, w)
    }
    return (w * size) / 100
  }

  dims(format: BannerFormat, size: number): Dims {
    const lines = LINES[format]
    const padX = size * 0.75
    const padY = size * 0.42
    const lineH = size * 1.08
    const longest = Math.max(...lines.map((l) => this.textW(l, size)))
    const span = Math.round(size * 2.9)
    const rope = Math.round(size * 1.6)
    if (format === 'tall') return { bw: lineH + padY * 2, bh: longest + padX * 2, span, rope }
    return { bw: longest + padX * 2, bh: lines.length * lineH + padY * 2, span, rope }
  }

  /** Largest empty rectangle (corners on obstacle edges) that fits a banner format, scored for readability. */
  private choose(input: DroneInput): Plan | null {
    const b = input.bounds
    const obs = [...input.hud, input.hall].filter((o) => rectsOverlap(o, b))
    this.fitMemo.clear()
    const xs = new Set<number>([b.x, b.x + b.w])
    const ys = new Set<number>([b.y, b.y + b.h])
    for (const o of obs) {
      for (const x of [o.x, o.x + o.w]) if (x > b.x && x < b.x + b.w) xs.add(x)
      for (const y of [o.y, o.y + o.h]) if (y > b.y && y < b.y + b.h) ys.add(y)
    }
    const X = [...xs].sort((p, q) => p - q)
    const Y = [...ys].sort((p, q) => p - q)
    let best: Plan | null = null
    let bestScore = -Infinity
    for (let i = 0; i < X.length; i++) {
      for (let j = i + 1; j < X.length; j++) {
        const w = X[j] - X[i]
        if (w < 56) continue
        for (let k = 0; k < Y.length; k++) {
          for (let l = k + 1; l < Y.length; l++) {
            const h = Y[l] - Y[k]
            if (h < 90) continue
            const r = { x: X[i], y: Y[k], w, h }
            if (obs.some((o) => rectsOverlap(o, r))) continue
            const fit = this.fit(r)
            if (!fit) continue
            const score = fit.fontSize + FORMAT_BONUS[fit.format] + Math.min(1, (w * h) / 120000)
            if (score > bestScore) {
              bestScore = score
              best = fit
            }
          }
        }
      }
    }
    return best
  }

  /** Best format + font for a region, with a little room left to fly. */
  private fit(r: Rect): Plan | null {
    // the choice only depends on the size; the position is added afterwards
    const key = `${Math.round(r.w)}x${Math.round(r.h)}`
    let shape = this.fitMemo.get(key)
    if (shape === undefined) {
      shape = null
      let bestScore = -Infinity
      for (const format of FORMATS) {
        for (let size = FONT_MAX; size >= FONT_MIN; size--) {
          const d = this.dims(format, size)
          const tall = format === 'tall'
          // room for the swing: a tilted flyer drops one bottom corner, the streamer's tail sweeps sideways
          const tilt = Math.sin(tiltLimit(format, d))
          const needW = Math.max(d.span, d.bw + (tall ? 6 + d.bh * tilt : 8) * 2) + 12
          const needH = d.span / 2 + hangOf(d) + d.bh + (d.bw / 2) * tilt + 14
          if (needW > r.w || needH > r.h) continue
          const score = size + FORMAT_BONUS[format]
          if (score > bestScore) {
            bestScore = score
            const ax = Math.max(0, (r.w - needW) / 2)
            const ay = Math.max(0, (r.h - needH) / 2)
            shape = { format, fontSize: size, ox: r.w / 2, oy: d.span / 2 + 8 + ay, ax: Math.min(ax, 160), ay: Math.min(ay, 140), vertical: ay > ax }
          }
          break
        }
      }
      this.fitMemo.set(key, shape)
    }
    if (!shape) return null
    return { format: shape.format, fontSize: shape.fontSize, cx: r.x + shape.ox, cy: r.y + shape.oy, ax: shape.ax, ay: shape.ay, vertical: shape.vertical }
  }

  /**
   * New hall or new screen size: drop the current flight (it may not fit any more) and fly in
   * again from the side of the next free area – never across the hall to get there.
   */
  layoutChanged() {
    this.plan = null
    this.pending = null
    this.flyby = null
    this.entered = false
    this.view.visible = false
    this.view.alpha = 0
    this.view.towed = 0
  }

  /** Re-plans the patrol (call when the layout or the HUD changed). */
  replan(input: DroneInput) {
    // a fly-by asked for by the dev hook finishes first
    if (this.flyby?.forced) return
    const next = this.choose(input)
    const v = this.view
    if (next && this.plan && this.entered && v.visible) {
      if (!this.clearPath(v.x, v.y, next.cx, next.cy, next, input, true)) {
        // the new area lies beyond the hall or a panel: fade out here and fade in there
        this.pending = next
        return
      }
    } else if (!v.visible) {
      // nothing on screen: the next patrol starts with a fresh entry
      this.entered = false
    }
    this.pending = null
    this.plan = next
  }

  /** Screen box of the drone with a hanging banner of this plan's format, centred at (x, y). */
  private footprint(x: number, y: number, plan: Plan): Rect {
    const d = this.dims(plan.format, plan.fontSize)
    const half = Math.max(d.span / 2, d.bw / 2 + 8)
    const below = hangOf(d) + d.bh + (d.bw / 2) * Math.sin(tiltLimit(plan.format, d)) + 4
    return { x: x - half, y: y - d.span / 2, w: half * 2, h: d.span / 2 + below }
  }

  /**
   * True when the drone can fly straight from (x0, y0) to (x1, y1) without passing the hall or a
   * HUD panel. `skipStart` ignores where it is now (a panel that just grew may graze it there).
   */
  private clearPath(x0: number, y0: number, x1: number, y1: number, plan: Plan, input: DroneInput, skipStart = false): boolean {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 24))
    for (let i = skipStart ? 1 : 0; i <= n; i++) {
      const k = i / n
      const box = this.footprint(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, plan)
      if (rectsOverlap(box, input.hall) || input.hud.some((o) => rectsOverlap(o, box))) return false
    }
    return true
  }

  /**
   * Where to appear for a patrol starting at (x, y): just off the nearest screen side whose
   * straight path in stays clear of the hall and the HUD – or right there, fading in.
   */
  private entryPoint(x: number, y: number, plan: Plan, input: DroneInput): { x: number; y: number } {
    const cands = [
      { x: -70, y },
      { x: input.W + 70, y },
      { x, y: -90 },
      { x, y: input.H + 30 },
    ].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
    for (const c of cands) if (this.clearPath(c.x, c.y, x, y, plan, input)) return c
    return { x, y }
  }

  update(dt: number, input: DroneInput) {
    const v = this.view
    v.clock += dt
    v.rotor += dt * 40
    v.wave += dt * 6
    const plan = this.plan
    let tx: number
    let ty: number
    if (plan && this.pending) {
      // fading over to an area on the other side of the hall or a panel: hold still, reappear there
      this.flyby = null
      v.alpha = Math.max(0, v.alpha - dt * 2.5)
      tx = v.x
      ty = v.y
      if (v.alpha <= 0) {
        this.plan = this.pending
        this.pending = null
        this.entered = false
        v.visible = false
        return
      }
    } else if (plan) {
      this.flyby = null
      v.towed = 0
      v.format = plan.format
      v.fontSize = plan.fontSize
      // constant speed along a lazy figure-eight, stretched along the region's long side
      const speed = 46
      const dxdT = plan.vertical ? 2 * plan.ax * Math.cos(2 * this.theta) : plan.ax * Math.cos(this.theta)
      const dydT = plan.vertical ? plan.ay * Math.cos(this.theta) : 1.7 * plan.ay * Math.cos(2 * this.theta)
      this.theta += (speed * dt) / Math.max(18, Math.hypot(dxdT, dydT))
      tx = plan.cx + plan.ax * (plan.vertical ? Math.sin(2 * this.theta) : Math.sin(this.theta))
      ty = plan.cy + plan.ay * (plan.vertical ? Math.sin(this.theta) : 0.85 * Math.sin(2 * this.theta))
      if (!this.entered) {
        // fly in from a screen side whose way in is clear of the hall and the HUD (else fade in)
        const e = this.entryPoint(tx, ty, plan, input)
        v.x = e.x
        v.y = e.y
        v.alpha = 0
        this.sway = 0
        this.swayV = 0
        this.entered = true
      }
      v.alpha = Math.min(1, v.alpha + dt * 2)
    } else {
      this.entered = false
      this.stepFlyby(dt, input)
      const f = this.flyby
      if (f) {
        const k = f.t / f.dur
        const y = input.hallTop + f.off
        // a panel grew into the flight band, or the back wall scrolled away: fade out on the way
        if (!input.hallTopVisible || input.hud.some((o) => rectsOverlap(o, { x: 0, y: y - f.h / 2, w: input.W, h: f.h }))) f.fade = true
        tx = f.dir > 0 ? -90 + (input.W + 360) * k : input.W + 90 - (input.W + 360) * k
        ty = y + Math.sin(k * Math.PI * 2) * (FLYBY_BOB - 1)
        v.format = 'line'
        v.fontSize = f.fontSize
        v.towed = f.dir
        v.alpha = f.fade ? Math.max(0, v.alpha - dt * 4) : 1
        if (f.fade && v.alpha <= 0) {
          this.flyby = null
          v.towed = 0
          v.visible = false
          return
        }
      } else {
        // no room any more (a panel grew): fade out where it is – flying off could cross the HUD
        if (!v.visible) return
        v.alpha = Math.max(0, v.alpha - dt * 2.5)
        tx = v.x
        ty = v.y
      }
    }
    // the body follows its target with a soft spring (smooth hand-over when the plan changes)
    const px = v.x
    const py = v.y
    const stiff = this.flyby ? 30 : plan ? 3.2 : 1.2
    let nx = damp(v.x, tx, stiff, dt)
    let ny = damp(v.y, ty, stiff, dt)
    if (!this.flyby) {
      // a calm cruise when flying in or handing over to a new patrol – no dash across the screen
      const step = Math.hypot(nx - px, ny - py)
      const max = MAX_CRUISE * dt
      if (step > max) {
        nx = px + ((nx - px) / step) * max
        ny = py + ((ny - py) / step) * max
      }
    }
    v.x = nx
    v.y = ny
    this.vx = dt > 0 ? (v.x - px) / dt : 0
    this.vy = dt > 0 ? (v.y - py) / dt : 0
    if (Math.hypot(this.vx, this.vy) > 4) {
      const want = Math.atan2(this.vy, this.vx)
      let d = want - v.heading
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      v.heading += d * Math.min(1, dt * 4)
    }
    const d = this.dims(v.format, v.fontSize)
    v.span = d.span
    if (v.towed) {
      // towed: the banner trails behind on the rope, sagging a little
      v.bx = v.x - v.towed * (d.span * 0.42 + d.rope + d.bw / 2)
      v.by = v.y - d.bh / 2 + 3
      v.tilt = 0
    } else {
      // hanging: a pendulum that swings back against the horizontal motion,
      // never so far that the banner rides up into the rotors
      const target = clamp(-this.vx * 0.32, -d.rope * 0.9, d.rope * 0.9)
      this.swayV += ((target - this.sway) * 18 - this.swayV * 5) * dt
      this.sway += this.swayV * dt
      v.bx = v.x + this.sway
      const maxTilt = tiltLimit(v.format, d)
      v.tilt = clamp(this.sway / (d.rope * 3), -maxTilt, maxTilt)
      // 0.74 × span keeps the banner clear of a rotor even when the X frame turns 45°;
      // `lift` is how far the tilted top edge rises right under the drone
      const lift = Math.abs(this.sway * Math.sin(v.tilt))
      v.by = v.y + Math.max(d.span * 0.74 + lift, Math.sqrt(Math.max(0, d.rope * d.rope - this.sway * this.sway * 0.5)) + d.span * 0.12)
    }
    v.visible = v.alpha > 0.01
  }

  private stepFlyby(dt: number, input: DroneInput, forced = false) {
    const f = this.flyby
    if (f) {
      f.t += dt
      if (f.t >= f.dur) {
        this.flyby = null
        this.view.visible = false
        this.view.alpha = 0
        this.view.towed = 0
      }
      return
    }
    this.flybyWait -= dt
    if (this.flybyWait > 0) return
    this.flybyWait = 16 + Math.random() * 8
    if (!input.hallTopVisible) return
    // the drone flies just above the hall's top edge where there is room, else lower over its back
    // wall – the towed banner must stay on the wall band (above the units of the top row) – and its
    // whole band (with the gentle bob) must stay clear of the HUD
    for (let size = 13; size >= FONT_MIN; size--) {
      const d = this.dims('line', size)
      const h = Math.max(d.span, d.bh + 6) + FLYBY_BOB * 2
      const yMin = Math.max(input.bounds.y + h / 2 + 2, input.hallTop - h / 2 - 2)
      const yMax = input.hallTop + input.tile * 0.62 - h / 2
      for (let y = yMin; y <= yMax; y += 2) {
        if (input.hud.some((o) => rectsOverlap(o, { x: 0, y: y - h / 2, w: input.W, h }))) continue
        const dir = Math.random() < 0.5 ? 1 : -1
        // long enough for the banner to clear the far edge too
        this.flyby = { t: 0, dur: (input.W + 360) / 110, dir, off: y - input.hallTop, h, fontSize: size, forced, fade: false }
        this.view.x = dir > 0 ? -90 : input.W + 90
        this.view.y = y
        this.view.heading = dir > 0 ? 0 : Math.PI
        this.sway = 0
        this.swayV = 0
        return
      }
    }
  }

  /** Fly-by right now (dev hook / screenshots). Returns false when the hall's top edge is not usable. */
  forceFlyby(input: DroneInput): boolean {
    this.plan = null
    this.flyby = null
    this.flybyWait = 0
    this.stepFlyby(0, input, true)
    return !!this.flyby
  }

  get mode(): 'patrol' | 'flyby' | 'hidden' {
    return this.plan ? 'patrol' : this.flyby ? 'flyby' : 'hidden'
  }

  /** Screen box around the drone and its banner (for the dev hook's overlap check). */
  bbox(): Rect {
    const v = this.view
    const d = this.dims(v.format, v.fontSize)
    let x0 = v.x - d.span / 2
    let x1 = v.x + d.span / 2
    let y0 = v.y - d.span / 2
    let y1 = v.y + d.span / 2
    // the banner's corners, turned by its tilt around the top centre (+ the ripple)
    const cos = Math.cos(v.tilt)
    const sin = Math.sin(v.tilt)
    for (const [cx, cy] of [[-d.bw / 2, 0], [d.bw / 2, 0], [-d.bw / 2, d.bh], [d.bw / 2, d.bh]]) {
      const px = v.bx + cx * cos - cy * sin
      const py = v.by + cx * sin + cy * cos
      x0 = Math.min(x0, px - 4)
      x1 = Math.max(x1, px + 4)
      y0 = Math.min(y0, py - 4)
      y1 = Math.max(y1, py + 4)
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }
}

/* ------------------------------------------------------------------ */
/* drawing                                                             */
/* ------------------------------------------------------------------ */

type Ctx = CanvasRenderingContext2D

let bannerCache: { key: string; canvas: HTMLCanvasElement; w: number; h: number } | null = null
let shadowSprite: HTMLCanvasElement | null = null

/** The fabric banner with the slogan, rendered once per format / size / pixel ratio. */
function bannerTexture(flight: DroneFlight, format: BannerFormat, size: number, dpr: number) {
  const key = `${format}:${size}:${dpr}:${flight.version}`
  if (bannerCache && bannerCache.key === key) return bannerCache
  const d = flight.dims(format, size)
  const w = Math.ceil(d.bw)
  const h = Math.ceil(d.bh)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * dpr))
  c.height = Math.max(1, Math.round(h * dpr))
  const g = c.getContext('2d')
  if (g) {
    g.scale(dpr, dpr)
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#fffdf6')
    grad.addColorStop(1, '#e9e4d6')
    roundRectPath(g, 0.5, 0.5, w - 1, h - 1, 3)
    g.fillStyle = grad
    g.fill()
    // red hems along the long edges, a stitched seam just inside
    g.fillStyle = '#e8102a'
    if (format === 'tall') {
      g.fillRect(0.5, 0.5, 2.6, h - 1)
      g.fillRect(w - 3.1, 0.5, 2.6, h - 1)
    } else {
      g.fillRect(0.5, 0.5, w - 1, 2.6)
      g.fillRect(0.5, h - 3.1, w - 1, 2.6)
    }
    g.strokeStyle = 'rgba(40,30,20,0.18)'
    g.setLineDash([2, 2])
    g.lineWidth = 1
    roundRectPath(g, 4, 4, w - 8, h - 8, 2)
    g.stroke()
    g.setLineDash([])
    g.fillStyle = '#16181f'
    g.font = font(size)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    if (format === 'tall') {
      g.save()
      g.translate(w / 2, h / 2)
      g.rotate(Math.PI / 2)
      g.fillText(SLOGAN, 0, size * 0.06)
      g.restore()
    } else {
      const lines = LINES[format]
      const lineH = size * 1.08
      const y0 = h / 2 - ((lines.length - 1) * lineH) / 2
      lines.forEach((line, i) => g.fillText(line, w / 2, y0 + i * lineH + size * 0.06))
    }
  }
  bannerCache = { key, canvas: c, w, h }
  return bannerCache
}

function droneShadow(): HTMLCanvasElement {
  if (shadowSprite) return shadowSprite
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(0,0,0,0.55)')
    grad.addColorStop(0.55, 'rgba(0,0,0,0.25)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
  }
  shadowSprite = c
  return c
}

export function drawDrone(ctx: Ctx, flight: DroneFlight, dpr: number) {
  const v = flight.view
  if (!v.visible) return
  const time = v.clock
  const tex = bannerTexture(flight, v.format, v.fontSize, dpr)
  const s = v.span
  const tall = v.format === 'tall'
  ctx.save()

  // soft shadows on the floor far below (down-right, like the light in the hall)
  const sh = droneShadow()
  ctx.globalAlpha = v.alpha * 0.55
  ctx.drawImage(sh, v.x + s * 0.35 - s * 0.7, v.y + s * 0.85 - s * 0.45, s * 1.4, s * 0.9)
  ctx.globalAlpha = v.alpha * 0.22
  ctx.drawImage(sh, v.bx + s * 0.35 - tex.w * 0.55, v.by + s * 0.85, tex.w * 1.1, Math.min(tex.h, 40) * 0.9)
  ctx.globalAlpha = v.alpha

  // banner, drawn in thin slices that ripple like fabric
  const left = v.bx - tex.w / 2
  const top = v.by
  ctx.save()
  ctx.translate(v.bx, top)
  ctx.rotate(v.tilt)
  ctx.translate(-v.bx, -top)
  const n = tall ? Math.max(8, Math.round(tex.h / 9)) : Math.max(8, Math.round(tex.w / 9))
  const amp = Math.max(1.2, v.fontSize * 0.14)
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1)
    // the free end ripples most: the bottom of a streamer, the tail of a towed banner, both ends of a hanging one
    const a = amp * (tall ? 0.25 + 0.75 * k : v.towed ? 0.2 + 0.8 * (v.towed > 0 ? 1 - k : k) : 0.45 + 0.55 * Math.abs(k - 0.5) * 2)
    const off = Math.sin(v.wave - i * 0.32 * (v.towed ? v.towed : 1)) * a
    if (tall) {
      const sy = (tex.h / n) * i
      const shh = tex.h / n
      ctx.drawImage(tex.canvas, 0, sy * dpr, tex.canvas.width, shh * dpr, left + off, top + sy, tex.w, shh + 0.6)
    } else {
      const sx = (tex.w / n) * i
      const sw = tex.w / n
      ctx.drawImage(tex.canvas, sx * dpr, 0, sw * dpr, tex.canvas.height, left + sx, top + off, sw + 0.6, tex.h)
    }
    // shading of the folds
    const shade = Math.cos(v.wave - i * 0.32)
    ctx.fillStyle = shade > 0 ? `rgba(255,255,255,${(shade * 0.1).toFixed(3)})` : `rgba(0,0,0,${(-shade * 0.12).toFixed(3)})`
    if (tall) ctx.fillRect(left + off, top + (tex.h / n) * i, tex.w, tex.h / n + 0.6)
    else ctx.fillRect(left + (tex.w / n) * i, top + off, tex.w / n + 0.6, tex.h)
  }
  ctx.restore()

  // rope (light, so it reads on the dark floor)
  ctx.strokeStyle = 'rgba(214,222,236,0.85)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  if (v.towed) {
    // tow line from the tail to a bridle on the banner's leading edge
    const tailX = v.x - v.towed * s * 0.3
    const edgeX = v.bx + v.towed * (tex.w / 2)
    const midY = top + tex.h / 2
    ctx.moveTo(tailX, v.y)
    ctx.quadraticCurveTo((tailX + edgeX) / 2, Math.max(v.y, midY) + 4, edgeX + v.towed * 6, midY)
    ctx.moveTo(edgeX + v.towed * 6, midY)
    ctx.lineTo(edgeX, top + 2)
    ctx.moveTo(edgeX + v.towed * 6, midY)
    ctx.lineTo(edgeX, top + tex.h - 2)
  } else {
    // rope down to a bridle on the banner's top corners (they swing with the banner's tilt)
    const ropeY = v.y + s * 0.12
    const knotY = top - Math.min(8, s * 0.22)
    ctx.moveTo(v.x, ropeY)
    ctx.quadraticCurveTo((v.x + v.bx) / 2 - (v.bx - v.x) * 0.2, (ropeY + knotY) / 2 + 3, v.bx, knotY)
    const half = tall ? tex.w / 2 - 2 : tex.w * 0.38
    const cos = Math.cos(v.tilt)
    const sin = Math.sin(v.tilt)
    for (const side of [-1, 1]) {
      ctx.moveTo(v.bx, knotY)
      ctx.lineTo(v.bx + side * half * cos - 1.5 * sin, top + side * half * sin + 1.5 * cos)
    }
  }
  ctx.stroke()

  // quadcopter (top-down): X frame, four rotors, body, nav lights
  ctx.save()
  ctx.translate(v.x, v.y)
  ctx.rotate(v.heading + Math.PI / 2)
  const arm = s * 0.36
  const rr = s * 0.2
  ctx.strokeStyle = '#2b303a'
  ctx.lineWidth = Math.max(2, s * 0.08)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-arm, -arm)
  ctx.lineTo(arm, arm)
  ctx.moveTo(arm, -arm)
  ctx.lineTo(-arm, arm)
  ctx.stroke()
  for (let i = 0; i < 4; i++) {
    const rx = (i % 2 ? 1 : -1) * arm
    const ry = (i < 2 ? -1 : 1) * arm
    // motion-blurred disc + one visible blade
    ctx.fillStyle = 'rgba(200,225,255,0.16)'
    ctx.beginPath()
    ctx.arc(rx, ry, rr, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(220,235,255,0.5)'
    ctx.lineWidth = 1
    ctx.stroke()
    const a = v.rotor * (i % 2 ? 1 : -1) + i
    ctx.strokeStyle = 'rgba(235,242,255,0.75)'
    ctx.lineWidth = Math.max(1.2, s * 0.045)
    ctx.beginPath()
    ctx.moveTo(rx + Math.cos(a) * rr * 0.92, ry + Math.sin(a) * rr * 0.92)
    ctx.lineTo(rx - Math.cos(a) * rr * 0.92, ry - Math.sin(a) * rr * 0.92)
    ctx.stroke()
    ctx.fillStyle = '#1a1d24'
    ctx.beginPath()
    ctx.arc(rx, ry, Math.max(1.6, s * 0.05), 0, Math.PI * 2)
    ctx.fill()
  }
  // body with a red stripe and a camera bubble at the nose
  roundRectPath(ctx, -s * 0.17, -s * 0.21, s * 0.34, s * 0.42, s * 0.09)
  ctx.fillStyle = '#3a404c'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = '#e8102a'
  ctx.fillRect(-s * 0.04, -s * 0.18, s * 0.08, s * 0.36)
  ctx.fillStyle = '#0b0d12'
  ctx.beginPath()
  ctx.arc(0, -s * 0.22, s * 0.065, 0, Math.PI * 2)
  ctx.fill()
  // nav lights: red port (left), green starboard (right), white strobe at the tail
  const blink = Math.floor(time * 2.2) % 2 === 0
  const lights: [number, number, string, boolean][] = [
    [-arm * 0.98, -arm * 0.98, '#ff2d3a', blink],
    [arm * 0.98, -arm * 0.98, '#39ff7a', blink],
    [0, s * 0.24, '#ffffff', Math.floor(time * 3.1) % 3 === 0],
  ]
  for (const [lx, ly, color, on] of lights) {
    if (on) {
      ctx.fillStyle = hexToRgba(color, 0.3)
      ctx.beginPath()
      ctx.arc(lx, ly, s * 0.13, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = on ? color : hexToRgba(color, 0.35)
    ctx.beginPath()
    ctx.arc(lx, ly, Math.max(1.5, s * 0.045), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  ctx.restore()
}
