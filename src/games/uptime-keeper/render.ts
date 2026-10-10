/**
 * Uptime Keeper – canvas renderer. Everything is drawn with primitives.
 *
 * View: classic 3/4 top-down. A cabinet stands on its tile; its front face
 * fills the tile and its top face rises above it, so things further up the
 * screen are drawn first and the technician can walk "behind" a rack row.
 *
 * Cost: canvas shadows are the one thing a 2D context cannot do cheaply every
 * frame, so every glow is pre-rendered – the hall with its neon pipes and
 * building shell into a cached static layer, glowing glyphs and alert badges
 * into small sprites – and the per-frame pass is blits, flat fills and thin
 * strokes: the animated pipe flow and fault states, the depth-sorted cabinets
 * and technician, badges, particles and the mini-map.
 */
import { drawFloatTexts, drawParticles, hexToRgba, roundRectPath, type FloatText, type Particle } from '../../shared/draw'
import { clamp } from '../../shared/math'
import { ALERT_COLOR, ALERT_GLYPH, COLORS, PIPE_COLOR, drawCube, drawGlyph } from './glyphs'
import { STUB_X, TRAY_OFFSET, TRAY_Y, cellAt, pipeKindOf } from './levels'
import { CRIT_TEMP, WARN_TEMP, alertSeverity, powerRatio } from './sim'
import {
  CELL_WALL,
  type ActionKind,
  type Alert,
  type AlertType,
  type Dir,
  type HallLayout,
  type PipeKind,
  type Pt,
  type Rack,
  type Station,
  type World,
} from './types'

type Ctx = CanvasRenderingContext2D

/** How far a rack's top face rises above its tile (tile units). */
export const RACK_RISE = 0.46
const SIDE_RISE = 0.36
const TOP_RISE = 0.38

const FONT = '"Baloo 2", "Nunito", sans-serif'
const PIPE_KINDS: PipeKind[] = ['cooling', 'power', 'network']
/** Width of a neon pipe's core – chunky tubes, as in the mock-up. */
const pipeCore = (T: number) => Math.max(2, T * 0.078)

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/* ------------------------------------------------------------------ */
/* geometry shared with the engine                                     */
/* ------------------------------------------------------------------ */

export interface SpriteBox {
  /** Bounding box of the drawn sprite in tile units. */
  x: number
  y: number
  w: number
  h: number
  /** Where badges and arrows attach (top centre). */
  ax: number
  ay: number
  /** Centre of the front face – effects spawn here. */
  fx: number
  fy: number
  /** Depth-sort baseline. */
  base: number
}

export function rackBox(r: { cx: number; cy: number }): SpriteBox {
  return { x: r.cx, y: r.cy - RACK_RISE, w: 1, h: 1 + RACK_RISE, ax: r.cx + 0.5, ay: r.cy - RACK_RISE, fx: r.cx + 0.5, fy: r.cy + 0.45, base: r.cy + 1 }
}

export function stationBox(s: { cx: number; cy: number; w: number; h: number }): SpriteBox {
  const rise = s.h === 2 ? SIDE_RISE : TOP_RISE
  return {
    x: s.cx,
    y: s.cy - rise,
    w: s.w,
    h: s.h + rise,
    ax: s.cx + s.w / 2,
    ay: s.cy - rise,
    fx: s.cx + s.w / 2,
    fy: s.h === 2 ? s.cy + 1.48 : s.cy + 0.55,
    base: s.cy + s.h,
  }
}

export function boxOf(w: World, id: string): SpriteBox | null {
  const r = w.rackById.get(id)
  if (r) return rackBox(r)
  const s = w.stationById.get(id)
  return s ? stationBox(s) : null
}

/* ------------------------------------------------------------------ */
/* static layer                                                        */
/* ------------------------------------------------------------------ */

function polyPath(pts: Pt[], T: number, radius: number, into?: Path2D): Path2D {
  const p = into ?? new Path2D()
  p.moveTo(pts[0].x * T, pts[0].y * T)
  for (let i = 1; i < pts.length - 1; i++) p.arcTo(pts[i].x * T, pts[i].y * T, pts[i + 1].x * T, pts[i + 1].y * T, radius)
  const last = pts[pts.length - 1]
  p.lineTo(last.x * T, last.y * T)
  return p
}

export interface PipeCache {
  byStation: Map<string, { kind: PipeKind; path: Path2D }>
  byKind: Record<PipeKind, Path2D>
  all: Path2D
}

/** Path2D objects for the pipe network at the current tile size. */
export function buildPipes(hall: HallLayout, T: number): PipeCache {
  const byStation = new Map<string, { kind: PipeKind; path: Path2D }>()
  const byKind: Record<PipeKind, Path2D> = { cooling: new Path2D(), power: new Path2D(), network: new Path2D() }
  const all = new Path2D()
  const radius = T * 0.14
  for (const st of hall.stations) {
    const kind = pipeKindOf(st.kind)
    if (kind) byStation.set(st.id, { kind, path: new Path2D() })
  }
  const add = (stationId: string, pts: Pt[]) => {
    const entry = byStation.get(stationId)
    if (!entry) return
    polyPath(pts, T, radius, entry.path)
    polyPath(pts, T, radius, byKind[entry.kind])
    polyPath(pts, T, radius, all)
  }
  for (const p of hall.pipes) add(p.stationId, p.pts)
  // short stubs from the tray into every rack
  for (const r of hall.racks) {
    const feeds: [PipeKind, string][] = [
      ['cooling', r.cracId],
      ['power', r.pduId],
      ['network', r.switchId],
    ]
    for (const [kind, id] of feeds) {
      const x = r.cx + STUB_X[kind]
      add(id, [
        { x, y: r.cy + TRAY_Y + TRAY_OFFSET[kind] },
        { x, y: r.cy - RACK_RISE + 0.04 },
      ])
    }
  }
  return { byStation, byKind, all }
}

function paintFloor(g: Ctx, hall: HallLayout, T: number) {
  const rackCells = new Set(hall.racks.map((r) => r.cx + r.cy * hall.cols))
  for (let y = 0; y < hall.rows; y++) {
    for (let x = 0; x < hall.cols; x++) {
      if (cellAt(hall, x, y) === CELL_WALL) continue
      const px = x * T
      const py = y * T
      g.fillStyle = (x + y) % 2 ? '#1b1f27' : '#21262f'
      g.fillRect(px, py, T, T)
      g.fillStyle = 'rgba(255,255,255,0.04)'
      g.fillRect(px, py, T, 1)
      g.fillRect(px, py, 1, T)
      g.fillStyle = 'rgba(0,0,0,0.28)'
      g.fillRect(px, py + T - 1, T, 1)
      g.fillRect(px + T - 1, py, 1, T)
      const h = hash(x * 31.7 + y * 57.3)
      const coldAisle = rackCells.has(x + (y - 1) * hall.cols)
      if (coldAisle || h < 0.1) {
        // perforated cold-aisle tile
        g.fillStyle = 'rgba(0,0,0,0.42)'
        const n = 5
        const step = T / (n + 1)
        const rad = Math.max(0.8, T * 0.028)
        for (let j = 1; j <= n; j++) {
          for (let i = 1; i <= n; i++) {
            g.beginPath()
            g.arc(px + i * step, py + j * step, rad, 0, Math.PI * 2)
            g.fill()
          }
        }
        if (coldAisle) {
          g.fillStyle = 'rgba(30,200,255,0.05)'
          g.fillRect(px, py, T, T)
        }
      } else if (h > 0.86) {
        // service hatch
        g.strokeStyle = 'rgba(255,255,255,0.05)'
        g.lineWidth = 1
        g.strokeRect(px + T * 0.18 + 0.5, py + T * 0.18 + 0.5, T * 0.64, T * 0.64)
        g.fillStyle = 'rgba(255,255,255,0.07)'
        for (const [cx, cy] of [
          [0.24, 0.24],
          [0.76, 0.24],
          [0.24, 0.76],
          [0.76, 0.76],
        ]) {
          g.fillRect(px + T * cx - 1, py + T * cy - 1, 2, 2)
        }
      }
    }
  }
}

function paintTrays(g: Ctx, hall: HallLayout, T: number) {
  for (const t of hall.trays) {
    const x = t.x0 * T
    const w = (t.x1 - t.x0) * T
    const y = (t.y - 0.2) * T
    const h = 0.4 * T
    g.fillStyle = '#0e1116'
    g.fillRect(x, y, w, h)
    g.fillStyle = 'rgba(255,255,255,0.05)'
    for (let rx = x + T * 0.25; rx < x + w; rx += T * 0.5) g.fillRect(rx, y + 1, 1, h - 2)
    g.fillStyle = '#2d343f'
    g.fillRect(x, y, w, 1)
    g.fillStyle = '#05070a'
    g.fillRect(x, y + h - 1, w, 1)
  }
}

function paintPipeCasings(g: Ctx, pipes: PipeCache, T: number) {
  g.save()
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.strokeStyle = '#06080b'
  g.lineWidth = T * 0.18
  g.stroke(pipes.all)
  g.strokeStyle = '#1a1f28'
  g.lineWidth = T * 0.11
  g.stroke(pipes.all)
  g.restore()
}

function paintHazards(g: Ctx, hall: HallLayout, T: number) {
  for (const hz of hall.hazards) {
    const bw = T * 0.2
    const x = hz.side === 'r' ? (hz.cx + 1) * T - bw : hz.cx * T
    const y = hz.cy * T + 2
    const h = T - 4
    g.save()
    g.beginPath()
    g.rect(x, y, bw, h)
    g.clip()
    g.fillStyle = '#e0aa12'
    g.fillRect(x, y, bw, h)
    g.fillStyle = '#14161b'
    const step = T * 0.22
    for (let o = -bw; o < h + bw; o += step) {
      g.beginPath()
      g.moveTo(x, y + o)
      g.lineTo(x + bw, y + o - bw)
      g.lineTo(x + bw, y + o - bw + step * 0.5)
      g.lineTo(x, y + o + step * 0.5)
      g.closePath()
      g.fill()
    }
    g.fillStyle = 'rgba(0,0,0,0.22)'
    g.fillRect(x, y, bw, h)
    g.restore()
  }
}

function paintDecals(g: Ctx, hall: HallLayout, T: number) {
  g.save()
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.lineWidth = Math.max(1.5, T * 0.06)
  for (const d of hall.decals) {
    const kind = pipeKindOf(d.kind)
    g.strokeStyle = hexToRgba(kind ? PIPE_COLOR[kind] : COLORS.upgrade, 0.42)
    const cx = d.x * T
    const cy = d.y * T
    const s = T * 0.17
    g.save()
    g.translate(cx, cy)
    g.rotate(d.dir === 'up' ? 0 : d.dir === 'left' ? -Math.PI / 2 : Math.PI / 2)
    for (const o of [-s * 0.55, s * 0.55]) {
      g.beginPath()
      g.moveTo(-s, o + s * 0.5)
      g.lineTo(0, o - s * 0.5)
      g.lineTo(s, o + s * 0.5)
      g.stroke()
    }
    g.restore()
  }
  g.restore()
}

function paintWalls(g: Ctx, hall: HallLayout, T: number) {
  const W = hall.cols * T
  const H = hall.rows * T
  const cap = '#2a303b'
  const edge = '#454d5c'
  // side + bottom walls: we look down on their tops
  g.fillStyle = cap
  g.fillRect(0, 0, T, H)
  g.fillRect(W - T, 0, T, H)
  g.fillRect(0, H - T, W, T)
  g.fillStyle = '#1c2029'
  g.fillRect(T * 0.2, T, T * 0.6, H - T * 1.2)
  g.fillRect(W - T * 0.8, T, T * 0.6, H - T * 1.2)
  g.fillRect(T * 0.2, H - T * 0.8, W - T * 0.4, T * 0.6)
  g.fillStyle = edge
  g.fillRect(T - 2, T, 2, H - 2 * T)
  g.fillRect(W - T, T, 2, H - 2 * T)
  g.fillRect(T - 2, H - T, W - 2 * T + 4, 2)
  // shadow the side walls cast on the floor
  let grad = g.createLinearGradient(T, 0, T + T * 0.3, 0)
  grad.addColorStop(0, 'rgba(0,0,0,0.4)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(T, T, T * 0.3, H - 2 * T)
  grad = g.createLinearGradient(W - T, 0, W - T - T * 0.3, 0)
  grad.addColorStop(0, 'rgba(0,0,0,0.4)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(W - T - T * 0.3, T, T * 0.3, H - 2 * T)

  // back wall: top cap + front face with panels, vents and light strips
  g.fillStyle = '#3a4250'
  g.fillRect(0, 0, W, T * 0.24)
  grad = g.createLinearGradient(0, T * 0.24, 0, T)
  grad.addColorStop(0, '#2c323e')
  grad.addColorStop(1, '#161a21')
  g.fillStyle = grad
  g.fillRect(T * 0.9, T * 0.24, W - T * 1.8, T * 0.76)
  g.fillStyle = 'rgba(255,255,255,0.08)'
  g.fillRect(0, T * 0.24, W, 1)
  for (let x = 1; x < hall.cols - 1; x++) {
    const px = x * T
    g.fillStyle = 'rgba(0,0,0,0.35)'
    g.fillRect(px, T * 0.24, 1, T * 0.76)
    const pick = (x * 7 + hall.cols) % 3
    if (pick === 0) {
      // vent
      g.fillStyle = '#0d1015'
      g.fillRect(px + T * 0.2, T * 0.42, T * 0.6, T * 0.36)
      g.fillStyle = 'rgba(255,255,255,0.09)'
      for (let i = 0; i < 4; i++) g.fillRect(px + T * 0.24, T * (0.47 + i * 0.08), T * 0.52, 1)
    } else if (pick === 1) {
      // red light strip
      g.save()
      g.shadowColor = COLORS.alert
      g.shadowBlur = T * 0.3
      g.fillStyle = '#ff3b47'
      roundRectPath(g, px + T * 0.22, T * 0.52, T * 0.56, Math.max(2, T * 0.08), T * 0.04)
      g.fill()
      g.restore()
    } else {
      // panel with status LEDs
      g.strokeStyle = 'rgba(255,255,255,0.06)'
      g.lineWidth = 1
      g.strokeRect(px + T * 0.18 + 0.5, T * 0.4 + 0.5, T * 0.64, T * 0.4)
      g.fillStyle = COLORS.network
      g.fillRect(px + T * 0.26, T * 0.5, 2, 2)
      g.fillStyle = COLORS.power
      g.fillRect(px + T * 0.26 + 5, T * 0.5, 2, 2)
    }
  }
  // floor shadow under the back wall
  grad = g.createLinearGradient(0, T, 0, T * 1.4)
  grad.addColorStop(0, 'rgba(0,0,0,0.5)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(T, T, W - 2 * T, T * 0.4)

  // amber strip lights on the side and bottom wall caps
  g.save()
  g.shadowColor = COLORS.alert
  g.shadowBlur = T * 0.25
  g.fillStyle = '#ff5661'
  for (let y = 2; y < hall.rows - 1; y += 3) {
    roundRectPath(g, T * 0.44, y * T + T * 0.2, Math.max(2, T * 0.1), T * 0.6, T * 0.05)
    g.fill()
    roundRectPath(g, W - T * 0.54, y * T + T * 0.2, Math.max(2, T * 0.1), T * 0.6, T * 0.05)
    g.fill()
  }
  for (let x = 2; x < hall.cols - 1; x += 3) {
    roundRectPath(g, x * T + T * 0.2, H - T * 0.55, T * 0.6, Math.max(2, T * 0.1), T * 0.05)
    g.fill()
  }
  g.restore()
  g.strokeStyle = '#05060a'
  g.lineWidth = 2
  g.strokeRect(1, 1, W - 2, H - 2)
}

/** Zone names painted on the lowest aisle, under each rack block. */
function paintZoneLabels(g: Ctx, hall: HallLayout, T: number) {
  if (hall.zones.length < 2) return
  g.save()
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `800 ${Math.round(T * 0.4)}px ${FONT}`
  for (const zone of hall.zones) {
    const racks = hall.racks.filter((r) => r.zone === zone)
    if (!racks.length) continue
    const x0 = Math.min(...racks.map((r) => r.cx))
    const x1 = Math.max(...racks.map((r) => r.cx)) + 1
    const y = (hall.rows - 1.5) * T
    g.fillStyle = 'rgba(255,255,255,0.07)'
    g.fillRect(x0 * T + T * 0.15, y - T * 0.36, (x1 - x0) * T - T * 0.3, 2)
    g.fillStyle = 'rgba(255,255,255,0.16)'
    g.fillText(`ZONE ${zone}`, ((x0 + x1) / 2) * T, y + T * 0.04)
  }
  g.restore()
}

/** The building around the hall: a dark shell with a red neon outline. */
function paintShell(g: Ctx, hall: HallLayout, T: number) {
  const pad = T * 0.3
  const w = hall.cols * T + pad * 2
  const h = hall.rows * T + pad * 2
  g.save()
  g.shadowColor = COLORS.alert
  g.shadowBlur = T * 0.6
  roundRectPath(g, -pad, -pad, w, h, T * 0.18)
  g.fillStyle = '#14171d'
  g.fill()
  g.restore()
  roundRectPath(g, -pad, -pad, w, h, T * 0.18)
  g.strokeStyle = 'rgba(255,45,58,0.55)'
  g.lineWidth = 2
  g.stroke()
}

/** Neon pipes in their healthy colours – the per-frame pass only adds the flow and fault states. */
function paintPipeGlow(g: Ctx, pipes: PipeCache, T: number) {
  g.save()
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.lineWidth = pipeCore(T)
  for (const kind of PIPE_KINDS) {
    g.shadowColor = PIPE_COLOR[kind]
    g.shadowBlur = T * 0.28
    g.strokeStyle = PIPE_COLOR[kind]
    g.stroke(pipes.byKind[kind])
  }
  g.restore()
}

export interface StaticLayer {
  canvas: HTMLCanvasElement
  /** Border around the hall (CSS px) that holds the building shell and its glow. */
  margin: number
}

/**
 * Everything that never changes during a level, drawn once per tile size –
 * including every glow that would otherwise need a canvas shadow each frame.
 */
export function buildStatic(hall: HallLayout, pipes: PipeCache, T: number, dpr: number): StaticLayer {
  const margin = Math.ceil(T * 1.1)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round((hall.cols * T + margin * 2) * dpr))
  c.height = Math.max(1, Math.round((hall.rows * T + margin * 2) * dpr))
  const g = c.getContext('2d')
  if (!g) return { canvas: c, margin }
  g.scale(dpr, dpr)
  g.translate(margin, margin)
  paintShell(g, hall, T)
  paintFloor(g, hall, T)
  paintTrays(g, hall, T)
  paintPipeCasings(g, pipes, T)
  paintPipeGlow(g, pipes, T)
  paintHazards(g, hall, T)
  paintDecals(g, hall, T)
  paintZoneLabels(g, hall, T)
  paintWalls(g, hall, T)
  return { canvas: c, margin }
}

/* ------------------------------------------------------------------ */
/* scene                                                               */
/* ------------------------------------------------------------------ */

export interface PlayerView {
  x: number
  y: number
  dir: Dir
  walk: number
  moving: boolean
  act: ActionKind | null
  /** 0–1 repair progress, −1 when not repairing. */
  repair: number
}

export interface Fx {
  kind: 'mist' | 'chev' | 'smoke' | 'ring'
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
}

export interface StickView {
  x: number
  y: number
  r: number
  dx: number
  dy: number
  active: boolean
}

export interface Scene {
  W: number
  H: number
  T: number
  camX: number
  camY: number
  shakeX: number
  shakeY: number
  time: number
  world: World
  staticLayer: StaticLayer | null
  pipes: PipeCache | null
  player: PlayerView
  /** Interactable the technician can reach right now. */
  targetId: string | null
  /** Target highlighted from the objectives list or a tap. */
  selectedId: string | null
  /** Tutorial target – gets the big bouncing arrow. */
  guideId: string | null
  /** Remaining tap-to-move waypoints (tile units). */
  path: Pt[]
  tap: { x: number; y: number; t: number } | null
  fx: Fx[]
  particles: Particle[]
  floats: FloatText[]
  safe: { l: number; t: number; r: number; b: number }
  scrolling: boolean
  stick: StickView | null
  live: boolean
}

/** Highest-priority non-upgrade alert on a target (alerts are kept sorted). */
function alertOn(w: World, id: string): Alert | undefined {
  let up: Alert | undefined
  for (const a of w.alerts) {
    if (a.targetId !== id) continue
    if (a.type !== 'upgrade') return a
    up = a
  }
  return up
}

/** Rounded outline with a cheap fake glow (wide translucent stroke under a crisp one). `hex` must be #rrggbb. */
function neonRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, hex: string, lw: number, halo = 0.2, alpha = 1) {
  roundRectPath(ctx, x, y, w, h, r)
  ctx.strokeStyle = hexToRgba(hex, halo * alpha)
  ctx.lineWidth = lw * 3.4
  ctx.stroke()
  ctx.strokeStyle = alpha < 1 ? hexToRgba(hex, alpha) : hex
  ctx.lineWidth = lw
  ctx.stroke()
}

/* ---------- pipes + pad ---------- */

function drawPipes(ctx: Ctx, s: Scene) {
  const pipes = s.pipes
  if (!pipes) return
  const { T, world: w, time: t } = s
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const core = pipeCore(T)
  let anyFault = false
  for (const st of w.stations) if (st.fault && pipes.byStation.has(st.id)) anyFault = true
  if (anyFault) {
    // A unit with a fault: paint over its baked glow …
    ctx.strokeStyle = '#0e1116'
    ctx.lineWidth = T * 0.2
    for (const st of w.stations) {
      const entry = st.fault ? pipes.byStation.get(st.id) : undefined
      if (entry) ctx.stroke(entry.path)
    }
    // … put back the healthy pipes that share its tray …
    ctx.lineWidth = core
    for (const st of w.stations) {
      const entry = st.fault ? undefined : pipes.byStation.get(st.id)
      if (!entry) continue
      ctx.strokeStyle = PIPE_COLOR[entry.kind]
      ctx.stroke(entry.path)
    }
    // … and draw the faulted one in its alarm colour.
    for (const st of w.stations) {
      const entry = st.fault ? pipes.byStation.get(st.id) : undefined
      if (!entry) continue
      const battery = st.kind === 'pdu' && st.battery > 0
      const hex = battery && Math.floor(t * 5) % 2 ? COLORS.power : COLORS.alert
      const a = battery ? 0.95 : 0.35 + 0.5 * Math.abs(Math.sin(t * 7))
      ctx.strokeStyle = hexToRgba(hex, a * 0.22)
      ctx.lineWidth = core * 2.6
      ctx.stroke(entry.path)
      ctx.strokeStyle = hexToRgba(hex, a)
      ctx.lineWidth = core
      ctx.stroke(entry.path)
    }
  }
  // bright pulses travelling along the healthy pipes
  if (s.live) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
    ctx.lineWidth = core * 0.5
    ctx.setLineDash([T * 0.16, T * 0.9])
    ctx.lineDashOffset = -t * T * 1.6
    if (!anyFault) for (const kind of PIPE_KINDS) ctx.stroke(pipes.byKind[kind])
    else {
      for (const st of w.stations) {
        const entry = st.fault ? undefined : pipes.byStation.get(st.id)
        if (entry) ctx.stroke(entry.path)
      }
    }
  }
  ctx.restore()
}

function drawPad(ctx: Ctx, s: Scene) {
  const { T, time: t } = s
  const p = s.world.hall.pad
  const x = (p.cx + 0.1) * T
  const y = (p.cy + 0.1) * T
  const w = (p.w - 0.2) * T
  const h = (p.h - (p.h === 1 ? 0.14 : 0.22)) * T
  roundRectPath(ctx, x, y, w, h, T * 0.1)
  ctx.fillStyle = '#12151b'
  ctx.fill()
  const pulse = 0.55 + 0.25 * Math.sin(t * 1.8)
  neonRect(ctx, x + 1, y + 1, w - 2, h - 2, T * 0.1, COLORS.ficolo, Math.max(1.5, T * 0.035), 0.2, pulse + 0.2)
  ctx.save()
  ctx.strokeStyle = hexToRgba(COLORS.ficolo, 0.3)
  ctx.lineWidth = 1
  ctx.setLineDash([T * 0.1, T * 0.1])
  roundRectPath(ctx, x + T * 0.1, y + T * 0.1, w - T * 0.2, h - T * 0.2, T * 0.06)
  ctx.stroke()
  ctx.restore()
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f4f7ff'
  if (p.h === 1) {
    // one-line wordmark: cube + text
    ctx.font = `800 ${Math.round(T * 0.44)}px ${FONT}`
    const tw = ctx.measureText('Ficolo').width
    const cube = T * 0.56
    const gap = T * 0.14
    const sx = x + (w - cube - gap - tw) / 2
    drawCube(ctx, sx + cube / 2, y + h / 2, cube)
    ctx.textAlign = 'left'
    ctx.fillText('Ficolo', sx + cube + gap, y + h / 2 + T * 0.03)
  } else {
    const cx = x + w / 2
    drawCube(ctx, cx, y + h * 0.36, T * 0.72)
    ctx.font = `800 ${Math.round(T * 0.4)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('Ficolo', cx, y + h * 0.78)
  }
}

/* ---------- floor effects ---------- */

function drawFloorFx(ctx: Ctx, s: Scene) {
  const { T, world: w, time: t } = s
  // light spilled on the floor by racks in trouble
  for (const r of w.racks) {
    const hot = r.temp >= WARN_TEMP - 6 && !r.down
    if (!hot && !r.down) continue
    const k = r.down ? 0.5 + 0.2 * Math.sin(t * 3) : clamp((r.temp - (WARN_TEMP - 6)) / 20, 0.25, 1) * (0.75 + 0.25 * Math.sin(t * 8))
    const cx = (r.cx + 0.5) * T
    const cy = (r.cy + 1.12) * T
    const rad = T * 0.95
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    g.addColorStop(0, `rgba(255,45,58,${(0.34 * k).toFixed(3)})`)
    g.addColorStop(1, 'rgba(255,45,58,0)')
    ctx.fillStyle = g
    ctx.fillRect(cx - rad, cy - rad * 0.3, rad * 2, rad * 1.1)
  }
  // route preview for tap-to-move
  if (s.path.length) {
    ctx.fillStyle = 'rgba(30,200,255,0.75)'
    let px = s.player.x
    let py = s.player.y
    let carry = (t * 1.4) % 0.4
    for (const p of s.path) {
      const d = Math.hypot(p.x - px, p.y - py)
      for (let o = carry; o < d; o += 0.4) {
        const k = o / d
        ctx.beginPath()
        ctx.arc((px + (p.x - px) * k) * T, (py + (p.y - py) * k) * T, Math.max(1.5, T * 0.045), 0, Math.PI * 2)
        ctx.fill()
      }
      carry = (carry - d) % 0.4
      if (carry < 0) carry += 0.4
      px = p.x
      py = p.y
    }
  }
  if (s.tap) {
    const k = clamp(s.tap.t / 0.45, 0, 1)
    ctx.strokeStyle = `rgba(30,200,255,${(1 - k).toFixed(3)})`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(s.tap.x * T, s.tap.y * T, T * (0.15 + 0.3 * k), T * (0.09 + 0.18 * k), 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  // ring in front of the highlighted / guided target
  for (const id of [s.selectedId, s.guideId !== s.selectedId ? s.guideId : null]) {
    if (!id) continue
    const box = boxOf(w, id)
    if (!box) continue
    const k = (t * 1.2) % 1
    ctx.strokeStyle = id === s.guideId ? `rgba(255,228,92,${(0.9 * (1 - k)).toFixed(3)})` : `rgba(255,255,255,${(0.7 * (1 - k)).toFixed(3)})`
    ctx.lineWidth = id === s.guideId ? 3 : 2
    ctx.beginPath()
    ctx.ellipse(box.fx * T, (box.base + 0.3) * T, T * (0.3 + 0.35 * k), T * (0.14 + 0.16 * k), 0, 0, Math.PI * 2)
    ctx.stroke()
  }
}

/* ---------- cabinets ---------- */

function rackTone(w: World, r: Rack, alert: Alert | undefined): { color: string; level: number } {
  if (r.down) return { color: COLORS.off, level: 3 }
  if (r.temp >= CRIT_TEMP || (alert && alert.type !== 'upgrade' && alertSeverity(w, alert) === 'critical')) return { color: COLORS.alert, level: 2 }
  if (r.temp >= 68 || !r.fanOk || !r.psuOk || r.onBattery || !r.linkOk) return { color: COLORS.warn, level: 1 }
  return { color: COLORS.ok, level: 0 }
}

function drawBrackets(ctx: Ctx, x: number, y: number, w: number, h: number, len: number, color: string, lw: number) {
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]) {
    ctx.moveTo(cx + dx * len, cy)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx, cy + dy * len)
  }
  ctx.stroke()
}

function drawRack(ctx: Ctx, s: Scene, r: Rack) {
  const { T, time: t, world: w } = s
  const x = r.cx * T
  const y = r.cy * T
  const m = Math.max(1.5, T * 0.05)
  const bx = x + m
  const bw = T - 2 * m
  const topY = y - RACK_RISE * T
  const frontY = y - 0.04 * T
  const botY = y + 0.95 * T
  const fh = botY - frontY
  const th = frontY - topY
  const alert = alertOn(w, r.id)
  const tone = rackTone(w, r, alert)
  const isTarget = s.targetId === r.id
  const dark = r.down

  ctx.fillStyle = 'rgba(0,0,0,0.42)'
  ctx.fillRect(bx - 1, botY, bw + 2, T * 0.07)

  // top face
  ctx.fillStyle = dark ? '#272b34' : '#3a414e'
  ctx.fillRect(bx, topY, bw, th)
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.fillRect(bx, topY, bw, 1.5)
  ctx.fillStyle = dark ? '#1b1e25' : '#262b35'
  ctx.fillRect(bx + bw * 0.08, topY + th * 0.16, bw * 0.84, th * 0.68)
  // label or live temperature
  const showTemp = !dark ? r.temp >= 60 || isTarget || s.selectedId === r.id || (!!alert && alert.type !== 'upgrade') : true
  ctx.textBaseline = 'middle'
  if (showTemp) {
    ctx.font = `800 ${Math.round(T * 0.27)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillStyle = r.temp >= CRIT_TEMP ? '#ff5a66' : r.temp >= 68 ? '#ffc04a' : dark ? '#8b93a3' : '#bfe9ff'
    ctx.fillText(`${Math.round(r.temp)}°`, bx + bw / 2, topY + th * 0.54)
  } else {
    ctx.font = `700 ${Math.round(T * 0.23)}px ${FONT}`
    ctx.textAlign = 'left'
    ctx.fillStyle = '#8b95a8'
    ctx.fillText(r.label, bx + bw * 0.14, topY + th * 0.54)
    // server level pips
    const ps = Math.max(2, T * 0.06)
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i < r.serverLevel ? COLORS.upgrade : 'rgba(255,255,255,0.12)'
      ctx.fillRect(bx + bw * 0.88 - (4 - i) * (ps + 1.5), topY + th * 0.5 - ps / 2, ps, ps)
    }
  }

  // front face with server units
  ctx.fillStyle = '#11141a'
  ctx.fillRect(bx, frontY, bw, fh)
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fillRect(bx, frontY, 1.5, fh)
  const ix = bx + bw * 0.11
  const iy = frontY + fh * 0.08
  const iw = bw * 0.78
  const ih = fh * 0.84
  ctx.fillStyle = '#06080b'
  ctx.fillRect(ix, iy, iw, ih)
  const units = 5
  const gap = Math.max(1, T * 0.028)
  const uh = (ih - gap * (units + 1)) / units
  const ls = Math.max(1.5, T * 0.05)
  const degraded = !r.linkOk
  for (let i = 0; i < units; i++) {
    const uy = iy + gap + i * (uh + gap)
    ctx.fillStyle = dark ? '#0d1014' : '#181d26'
    ctx.fillRect(ix + gap, uy, iw - 2 * gap, uh)
    if (dark) continue
    const ly = uy + (uh - ls) / 2
    for (let j = 0; j < 3; j++) {
      const seed = r.ledSeed + i * 17 + j * 5
      let color: string
      let on: boolean
      if (degraded) {
        color = COLORS.warn
        on = Math.floor(t * 2.5) % 2 === 0
      } else if (r.onBattery) {
        color = COLORS.power
        on = j === 0 || Math.floor(t * 4 + i) % 2 === 0
      } else {
        const c = hash(seed)
        color = r.temp >= WARN_TEMP && c < 0.5 ? COLORS.alert : c < 0.58 ? COLORS.network : c < 0.84 ? COLORS.cooling : COLORS.power
        on = hash(seed + Math.floor(t * (2 + hash(seed + 3) * 5)) * 1.37) > 0.22
      }
      if (!on) continue
      ctx.fillStyle = color
      ctx.fillRect(ix + gap * 2 + j * (ls + gap), ly, ls, ls)
    }
    // activity bar
    const act = hash(r.ledSeed + i * 3 + Math.floor(t * 3) * 7.1)
    ctx.fillStyle = 'rgba(30,200,255,0.32)'
    ctx.fillRect(ix + iw * 0.56, ly, iw * 0.34 * act, ls)
  }
  if (dark) {
    // one red standby LED so the cabinet does not look deleted
    if (Math.floor(t * 2) % 2 === 0) {
      ctx.fillStyle = COLORS.alert
      ctx.fillRect(ix + gap * 2, iy + gap + (uh - ls) / 2, ls, ls)
    }
  }

  // heat tint + cooling frost
  if (!dark && r.temp > 62) {
    const a = clamp((r.temp - 62) / 38, 0, 1) * 0.44 * (r.temp >= WARN_TEMP ? 0.72 + 0.28 * Math.sin(t * 9) : 1)
    ctx.fillStyle = `rgba(255,45,58,${a.toFixed(3)})`
    ctx.fillRect(bx, frontY, bw, fh)
  }
  if (r.boost > 0) {
    ctx.fillStyle = `rgba(30,200,255,${(0.1 + 0.08 * Math.sin(t * 6)).toFixed(3)})`
    ctx.fillRect(bx, topY, bw, botY - topY)
  }
  if (dark) {
    ctx.fillStyle = 'rgba(4,5,8,0.5)'
    ctx.fillRect(bx, frontY, bw, fh)
    ctx.globalAlpha = 0.72 + 0.28 * Math.sin(t * 4)
    drawGlyph(ctx, 'cross', bx + bw / 2, frontY + fh / 2, T * 0.56, COLORS.alert, true, 3)
    ctx.globalAlpha = 1
  } else if (degraded) {
    drawGlyph(ctx, 'wifiOff', bx + bw * 0.74, frontY + fh * 0.82, T * 0.3, COLORS.warn, false, 3)
  } else if (r.onBattery) {
    drawGlyph(ctx, 'bolt', bx + bw * 0.74, frontY + fh * 0.82, T * 0.3, COLORS.power, false, 3)
  }

  // status frame
  const lw = Math.max(1.5, T * 0.04)
  if (tone.level === 2) {
    // critical: a thick frame with a breathing halo
    neonRect(ctx, bx + lw / 2, frontY + lw / 2, bw - lw, fh - lw, T * 0.05, tone.color, lw * 1.4, 0.3 + 0.22 * Math.sin(t * 8))
  } else {
    neonRect(ctx, bx + lw / 2, frontY + lw / 2, bw - lw, fh - lw, T * 0.05, tone.color, lw, tone.level === 0 ? 0.14 : 0.24, tone.level === 0 ? 0.8 : 1)
  }
  if (isTarget) drawBrackets(ctx, bx - 3, topY - 3, bw + 6, botY - topY + 6, T * 0.2, `rgba(255,255,255,${(0.75 + 0.25 * Math.sin(t * 6)).toFixed(3)})`, 2)
}

function stationTone(st: Station, t: number): string {
  const base = st.kind === 'crac' ? COLORS.cooling : st.kind === 'pdu' ? COLORS.power : COLORS.network
  if (!st.fault) return base
  if (st.kind === 'pdu' && st.battery > 0) return Math.floor(t * 5) % 2 ? COLORS.power : COLORS.alert
  return Math.floor(t * 4) % 2 ? COLORS.alert : '#7a1820'
}

function drawSideStation(ctx: Ctx, s: Scene, st: Station) {
  const { T, time: t } = s
  const x = st.cx * T
  const y = st.cy * T
  const m = Math.max(1.5, T * 0.06)
  const bx = x + m
  const bw = T - 2 * m
  const topY = y - SIDE_RISE * T
  const frontY = y + 1.02 * T
  const botY = y + 1.95 * T
  const th = frontY - topY
  const fh = botY - frontY
  const tone = stationTone(st, t)
  const cx = bx + bw / 2
  ctx.fillStyle = 'rgba(0,0,0,0.42)'
  ctx.fillRect(bx - 1, botY, bw + 2, T * 0.07)
  if (st.kind === 'crac') {
    ctx.fillStyle = '#1a3d5a'
    ctx.fillRect(bx, topY, bw, th)
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(bx, topY, bw, 1.5)
    // fan grille
    const fy = topY + th * 0.5
    const R = bw * 0.38
    ctx.fillStyle = '#071622'
    ctx.beginPath()
    ctx.arc(cx, fy, R, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    ctx.translate(cx, fy)
    ctx.rotate(t * (s.live ? 7 : 1.5))
    ctx.fillStyle = 'rgba(120,220,255,0.85)'
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2)
      ctx.beginPath()
      ctx.ellipse(R * 0.48, 0, R * 0.42, R * 0.17, 0.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    ctx.fillStyle = '#d6f6ff'
    ctx.beginPath()
    ctx.arc(cx, fy, R * 0.16, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = hexToRgba(COLORS.cooling, 0.9)
    ctx.lineWidth = Math.max(1.5, T * 0.04)
    ctx.beginPath()
    ctx.arc(cx, fy, R, 0, Math.PI * 2)
    ctx.stroke()
    // grille bars
    ctx.strokeStyle = 'rgba(7,22,34,0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - R, fy)
    ctx.lineTo(cx + R, fy)
    ctx.moveTo(cx, fy - R)
    ctx.lineTo(cx, fy + R)
    ctx.stroke()
    // front
    ctx.fillStyle = '#0e2436'
    ctx.fillRect(bx, frontY, bw, fh)
    ctx.fillStyle = 'rgba(30,200,255,0.22)'
    for (let i = 0; i < 4; i++) ctx.fillRect(bx + bw * 0.16, frontY + fh * (0.68 + i * 0.07), bw * 0.68, Math.max(1, T * 0.025))
    drawGlyph(ctx, 'snow', cx, frontY + fh * 0.36, T * 0.52, '#c9f3ff', true)
  } else {
    ctx.fillStyle = '#14351f'
    ctx.fillRect(bx, topY, bw, th)
    ctx.fillStyle = 'rgba(255,255,255,0.14)'
    ctx.fillRect(bx, topY, bw, 1.5)
    // patch panel with link lights
    const px = bx + bw * 0.14
    const py = topY + th * 0.12
    const pw = bw * 0.72
    const ph = th * 0.76
    ctx.fillStyle = '#050d08'
    ctx.fillRect(px, py, pw, ph)
    const colsN = 3
    const rowsN = 6
    const ls = Math.max(1.5, T * 0.06)
    for (let j = 0; j < rowsN; j++) {
      for (let i = 0; i < colsN; i++) {
        const lx = px + (pw / (colsN + 1)) * (i + 1) - ls / 2
        const ly = py + (ph / (rowsN + 1)) * (j + 1) - ls / 2
        if (st.fault) {
          if (Math.floor(t * 4) % 2 === 0) continue
          ctx.fillStyle = COLORS.alert
        } else {
          const seed = i * 13 + j * 29 + st.cy * 7
          if (hash(seed + Math.floor(t * (3 + hash(seed) * 6)) * 1.7) < 0.3) continue
          ctx.fillStyle = hash(seed + 1) < 0.8 ? COLORS.network : COLORS.power
        }
        ctx.fillRect(lx, ly, ls, ls)
      }
    }
    ctx.fillStyle = '#0b2014'
    ctx.fillRect(bx, frontY, bw, fh)
    ctx.fillStyle = 'rgba(57,255,122,0.2)'
    for (let i = 0; i < 3; i++) ctx.fillRect(bx + bw * 0.18, frontY + fh * (0.72 + i * 0.08), bw * 0.64, Math.max(1, T * 0.025))
    drawGlyph(ctx, st.fault ? 'wifiOff' : 'wifi', cx, frontY + fh * 0.38, T * 0.52, st.fault ? COLORS.alert : '#b9ffcf', true)
  }
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fillRect(bx, frontY, bw, 1.5)
  const lw = Math.max(1.5, T * 0.04)
  neonRect(ctx, bx + lw / 2, topY + lw / 2, bw - lw, botY - topY - lw, T * 0.06, tone, lw, 0.24)
  if (s.targetId === st.id) drawBrackets(ctx, bx - 3, topY - 3, bw + 6, botY - topY + 6, T * 0.2, `rgba(255,255,255,${(0.75 + 0.25 * Math.sin(t * 6)).toFixed(3)})`, 2)
}

function drawTopStation(ctx: Ctx, s: Scene, st: Station) {
  const { T, time: t, world: w } = s
  const x = st.cx * T
  const y = st.cy * T
  const m = Math.max(1.5, T * 0.06)
  const bx = x + m
  const bw = st.w * T - 2 * m
  const topY = y - TOP_RISE * T
  const frontY = y + 0.14 * T
  const botY = y + 0.95 * T
  const th = frontY - topY
  const fh = botY - frontY
  const cx = bx + bw / 2
  ctx.fillStyle = 'rgba(0,0,0,0.42)'
  ctx.fillRect(bx - 1, botY, bw + 2, T * 0.07)
  let tone: string
  let toneAlpha = 1
  if (st.kind === 'pdu') {
    tone = stationTone(st, t)
    ctx.fillStyle = '#56431a'
    ctx.fillRect(bx, topY, bw, th)
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(bx, topY, bw, 1.5)
    // battery cells on the roof once the hall has a UPS
    if (w.level.ups) {
      const cells = 5
      const cw = (bw * 0.5) / cells
      for (let i = 0; i < cells; i++) {
        const lit = !st.fault || st.battery <= 0 ? !st.fault : i < Math.ceil((st.battery / w.level.battery) * cells)
        ctx.fillStyle = lit ? COLORS.network : '#2b230f'
        ctx.fillRect(bx + bw * 0.25 + i * cw + 1, topY + th * 0.3, cw - 2, th * 0.4)
      }
    } else {
      ctx.fillStyle = '#3b2e12'
      ctx.fillRect(bx + bw * 0.1, topY + th * 0.24, bw * 0.8, th * 0.5)
    }
    ctx.fillStyle = '#2a210b'
    ctx.fillRect(bx, frontY, bw, fh)
    // gauge
    const gx = bx + bw * 0.2
    const gy = frontY + fh * 0.62
    const gr = Math.min(bw * 0.12, fh * 0.42)
    ctx.strokeStyle = 'rgba(255,176,32,0.55)'
    ctx.lineWidth = Math.max(1.5, T * 0.04)
    ctx.beginPath()
    ctx.arc(gx, gy, gr, Math.PI, 0)
    ctx.stroke()
    const load = clamp(powerRatio(w), 0, 1.1)
    const ang = Math.PI + Math.PI * clamp(load / 1.1, 0, 1) + (s.live ? Math.sin(t * 9) * 0.03 : 0)
    ctx.strokeStyle = load > 0.9 ? COLORS.alert : '#fff2c9'
    ctx.beginPath()
    ctx.moveTo(gx, gy)
    ctx.lineTo(gx + Math.cos(ang) * gr * 0.85, gy + Math.sin(ang) * gr * 0.85)
    ctx.stroke()
    // zone breakers
    const zones = w.hall.zones
    const bwid = Math.min(bw * 0.12, T * 0.26)
    zones.forEach((z, i) => {
      const zx = bx + bw * 0.8 + (i - (zones.length - 1) / 2) * (bwid + 3) - bwid / 2
      const zy = frontY + fh * 0.2
      const tripped = st.fault && st.faultZone === z
      ctx.fillStyle = tripped ? (Math.floor(t * 5) % 2 ? COLORS.alert : '#4a1016') : '#16130a'
      ctx.fillRect(zx, zy, bwid, fh * 0.56)
      ctx.fillStyle = tripped ? '#fff' : COLORS.network
      ctx.fillRect(zx + bwid * 0.25, zy + (tripped ? fh * 0.32 : fh * 0.08), bwid * 0.5, fh * 0.16)
    })
    drawGlyph(ctx, 'bolt', cx, frontY + fh * 0.48, T * 0.6, st.fault ? tone : '#ffd98a', true)
    // hazard strip along the base
    ctx.save()
    ctx.beginPath()
    ctx.rect(bx, botY - T * 0.09, bw, T * 0.09)
    ctx.clip()
    ctx.fillStyle = '#e0aa12'
    ctx.fillRect(bx, botY - T * 0.09, bw, T * 0.09)
    ctx.fillStyle = '#14161b'
    for (let o = -T * 0.1; o < bw; o += T * 0.2) {
      ctx.beginPath()
      ctx.moveTo(bx + o, botY)
      ctx.lineTo(bx + o + T * 0.09, botY - T * 0.09)
      ctx.lineTo(bx + o + T * 0.19, botY - T * 0.09)
      ctx.lineTo(bx + o + T * 0.1, botY)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  } else {
    // upgrade terminal
    const offer = w.alerts.some((a) => a.type === 'upgrade')
    tone = COLORS.upgrade
    toneAlpha = offer ? 1 : 0.6
    ctx.fillStyle = '#2a323d'
    ctx.fillRect(bx, topY, bw, th)
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(bx, topY, bw, 1.5)
    ctx.fillStyle = '#12171e'
    ctx.fillRect(bx, frontY, bw, fh)
    const sx = bx + bw * 0.16
    const sy = topY + th * 0.3
    const sw = bw * 0.68
    const sh = th * 0.7 + fh * 0.46
    ctx.fillStyle = '#03130a'
    ctx.fillRect(sx, sy, sw, sh)
    ctx.save()
    ctx.beginPath()
    ctx.rect(sx, sy, sw, sh)
    ctx.clip()
    ctx.strokeStyle = hexToRgba(COLORS.upgrade, offer ? 0.95 : 0.5)
    ctx.lineWidth = Math.max(1.5, T * 0.05)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const cs = sh * 0.26
    const speed = offer ? 1.6 : 0.5
    for (let col = 0; col < 3; col++) {
      const ccx = sx + (sw / 4) * (col + 1)
      const phase = ((t * speed + col * 0.33) % 1) * sh * 0.6
      for (let k = -1; k < 3; k++) {
        const cy = sy + sh - k * sh * 0.6 - phase + cs
        ctx.beginPath()
        ctx.moveTo(ccx - cs, cy)
        ctx.lineTo(ccx, cy - cs)
        ctx.lineTo(ccx + cs, cy)
        ctx.stroke()
      }
    }
    ctx.restore()
    ctx.strokeStyle = hexToRgba(COLORS.upgrade, 0.7)
    ctx.lineWidth = 1
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1)
    // keys
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    const ky = frontY + fh * 0.7
    for (let i = 0; i < 9; i++) ctx.fillRect(sx + (sw / 9) * i + 1, ky, sw / 9 - 2, Math.max(2, fh * 0.12))
  }
  const lw = Math.max(1.5, T * 0.04)
  neonRect(ctx, bx + lw / 2, topY + lw / 2, bw - lw, botY - topY - lw, T * 0.06, tone, lw, 0.22, toneAlpha)
  if (s.targetId === st.id) drawBrackets(ctx, bx - 3, topY - 3, bw + 6, botY - topY + 6, T * 0.2, `rgba(255,255,255,${(0.75 + 0.25 * Math.sin(t * 6)).toFixed(3)})`, 2)
}

/* ---------- technician ---------- */

function drawPlayer(ctx: Ctx, s: Scene) {
  const p = s.player
  const { T, time: t } = s
  const k = T / 48
  const x = p.x * T
  const y = p.y * T
  const swing = p.moving ? Math.sin(p.walk) : 0
  const bob = p.moving ? Math.abs(Math.sin(p.walk)) * 2 * k : Math.sin(t * 2.2) * 0.6 * k
  const side = p.dir === 'left' ? -1 : p.dir === 'right' ? 1 : 0
  const back = p.dir === 'up'
  const RED = '#e8102a'
  const RED_D = '#a80b1e'
  const SKIN = '#f3c9a0'
  const HAIR = '#5b3516'

  ctx.fillStyle = 'rgba(0,0,0,0.42)'
  ctx.beginPath()
  ctx.ellipse(x, y + 1 * k, 11 * k, 4.5 * k, 0, 0, Math.PI * 2)
  ctx.fill()

  // legs + boots
  const legW = 6.5 * k
  const legH = 10 * k
  for (const sgn of [-1, 1]) {
    const lift = p.moving ? Math.max(0, swing * sgn) * 3.5 * k : 0
    const lx = x + sgn * 4.2 * k - legW / 2 + (side ? swing * sgn * 2.5 * k : 0)
    ctx.fillStyle = RED_D
    ctx.fillRect(lx, y - legH - lift, legW, legH - 3 * k)
    ctx.fillStyle = '#15171c'
    ctx.fillRect(lx - 0.5 * k, y - 3.5 * k - lift, legW + 1 * k, 3.5 * k)
  }

  // torso
  const bw = 20 * k
  const bh = 17 * k
  const by = y - 9 * k - bh - bob
  const bxl = x - bw / 2
  roundRectPath(ctx, bxl, by, bw, bh, 5 * k)
  ctx.fillStyle = RED
  ctx.fill()
  ctx.fillStyle = RED_D
  ctx.fillRect(bxl + 1 * k, by + bh - 4.5 * k, bw - 2 * k, 2 * k)
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(bxl + 2 * k, by + 1.5 * k, bw - 4 * k, 1.5 * k)

  // white badge with the red F
  const fs = back ? 10 * k : 8 * k
  const fx = x + (back ? 0 : side * 3.5 * k) - fs / 2
  const fy = by + (back ? 3.5 * k : 4 * k)
  roundRectPath(ctx, fx, fy, fs, fs, 2 * k)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.fillStyle = RED
  const u = fs / 8
  ctx.fillRect(fx + 2.2 * u, fy + 1.6 * u, 1.5 * u, 4.9 * u)
  ctx.fillRect(fx + 2.2 * u, fy + 1.6 * u, 3.8 * u, 1.4 * u)
  ctx.fillRect(fx + 2.2 * u, fy + 3.6 * u, 3 * u, 1.3 * u)

  // arms
  const armW = 5 * k
  const armH = 12 * k
  for (const sgn of [-1, 1]) {
    const acting = p.act !== null && (side ? sgn === side : sgn === 1)
    const ax = x + sgn * (bw / 2 + 0.5 * k) - armW / 2
    let ay = by + 2.5 * k
    let ah = armH
    if (acting) {
      // reaching towards the cabinet
      ay -= 5 * k + Math.sin(t * 22) * (p.act === 'repair' ? 1.5 * k : 0)
      ah = armH * 0.82
    } else if (p.moving) ay += swing * sgn * -2.2 * k
    roundRectPath(ctx, ax, ay, armW, ah, 2.2 * k)
    ctx.fillStyle = RED_D
    ctx.fill()
    ctx.fillStyle = SKIN
    const hy = acting ? ay - 1.5 * k : ay + ah - 3 * k
    ctx.fillRect(ax + 0.4 * k, hy, armW - 0.8 * k, 3.6 * k)
    if (acting) {
      const glow = p.act === 'cool' ? COLORS.cooling : p.act === 'repair' ? '#ffd23f' : COLORS.upgrade
      const gr = (2.6 + Math.sin(t * 18) * 0.8) * k
      ctx.fillStyle = hexToRgba(glow, 0.28)
      ctx.beginPath()
      ctx.arc(ax + armW / 2, hy - 2 * k, gr * 2.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(ax + armW / 2, hy - 2 * k, gr, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // head
  const hw = 18 * k
  const hh = 16 * k
  const hx = x - hw / 2 + side * 1.5 * k
  const hy = by - hh + 3 * k
  roundRectPath(ctx, hx, hy, hw, hh, 6 * k)
  ctx.fillStyle = back ? HAIR : SKIN
  ctx.fill()
  if (!back) {
    // hair cap + fringe
    ctx.save()
    roundRectPath(ctx, hx, hy, hw, hh, 6 * k)
    ctx.clip()
    ctx.fillStyle = HAIR
    ctx.fillRect(hx, hy, hw, 6.5 * k)
    if (side) ctx.fillRect(side > 0 ? hx : hx + hw - 5 * k, hy, 5 * k, 11 * k)
    else {
      ctx.fillRect(hx, hy, 3 * k, 10 * k)
      ctx.fillRect(hx + hw - 3 * k, hy, 3 * k, 10 * k)
    }
    ctx.restore()
    ctx.fillStyle = '#20150c'
    const ey = hy + 9.2 * k
    if (side) ctx.fillRect(x + side * 5.5 * k - 1.2 * k, ey, 2.4 * k, 3 * k)
    else {
      ctx.fillRect(x - 4.6 * k, ey, 2.4 * k, 3 * k)
      ctx.fillRect(x + 2.2 * k, ey, 2.4 * k, 3 * k)
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(hx + 3 * k, hy + 2 * k, hw - 6 * k, 1.5 * k)
  }
}

/* ---------- overlays ---------- */

function drawShimmer(ctx: Ctx, s: Scene) {
  const { T, time: t, world: w } = s
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1.5, T * 0.045)
  for (const r of w.racks) {
    if (r.down || r.temp < WARN_TEMP - 4) continue
    const k = clamp((r.temp - (WARN_TEMP - 4)) / 16, 0.3, 1)
    for (let i = 0; i < 3; i++) {
      const phase = (t * 0.9 + i * 0.33 + hash(r.ledSeed) * 3) % 1
      const x0 = (r.cx + 0.25 + i * 0.25) * T
      const y0 = (r.cy - RACK_RISE - 0.05 - phase * 0.55) * T
      ctx.strokeStyle = `rgba(255,90,70,${(0.6 * k * (1 - phase)).toFixed(3)})`
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.bezierCurveTo(x0 - T * 0.09, y0 - T * 0.08, x0 + T * 0.09, y0 - T * 0.14, x0, y0 - T * 0.22)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function badgeText(w: World, a: Alert): string {
  if (a.type === 'power') {
    const st = w.stationById.get(a.targetId)
    return st && st.battery > 0 ? `${Math.ceil(st.battery)}s` : ''
  }
  if (a.type === 'psu') {
    const r = w.rackById.get(a.targetId)
    return r && r.psuTimer > 0 ? `${Math.ceil(r.psuTimer)}s` : ''
  }
  return ''
}

/**
 * Y of a badge's pointer tip (world px). When the technician stands behind the
 * cabinet the badge would sit right on his head, so it floats above him instead.
 */
function badgeTip(s: Scene, id: string, ax: number, ay: number, base: number): number {
  const T = s.T
  const p = s.player
  const tip = ay * T - T * 0.06
  if (s.targetId === id && Math.abs(p.x - ax) < 0.8 && p.y < base - 0.5 && p.y > ay - 0.95) return Math.min(tip, (p.y - 1.08) * T)
  return tip
}

const BADGE_PX = 128
const BADGE_BODY = 72
const badgeSprites = new Map<AlertType, HTMLCanvasElement>()

/** Alert badge (neon frame + glyph) rendered once per alert type; the glow lives in the sprite. */
function badgeSprite(type: AlertType): HTMLCanvasElement {
  let c = badgeSprites.get(type)
  if (c) return c
  c = document.createElement('canvas')
  c.width = BADGE_PX
  c.height = BADGE_PX
  const g = c.getContext('2d')
  if (g) {
    const color = ALERT_COLOR[type]
    const o = (BADGE_PX - BADGE_BODY) / 2
    g.shadowColor = color
    g.shadowBlur = 20
    roundRectPath(g, o, o, BADGE_BODY, BADGE_BODY, BADGE_BODY * 0.2)
    g.fillStyle = type === 'upgrade' ? '#06150c' : type === 'power' ? '#1a1304' : '#1a0508'
    g.fill()
    g.shadowBlur = 0
    g.strokeStyle = color
    g.lineWidth = 4.5
    g.stroke()
    drawGlyph(g, ALERT_GLYPH[type], BADGE_PX / 2, BADGE_PX / 2, BADGE_BODY * 0.64, type === 'upgrade' ? '#b9ffcf' : type === 'power' ? '#ffd98a' : '#ffd6d9', false, 2.6)
  }
  badgeSprites.set(type, c)
  return c
}

function drawBadges(ctx: Ctx, s: Scene) {
  const { T, time: t, world: w } = s
  const seen = new Set<string>()
  for (const a of w.alerts) {
    if (seen.has(a.targetId)) continue
    seen.add(a.targetId)
    // the repair ring takes the badge's place while the job is running
    if (w.repair && w.repair.targetId === a.targetId) continue
    const box = boxOf(w, a.targetId)
    if (!box) continue
    const color = ALERT_COLOR[a.type]
    const crit = alertSeverity(w, a) === 'critical'
    const size = clamp(T * 0.62, 24, 42) * (crit ? 1 + 0.08 * Math.sin(t * 10) : 1)
    const appear = clamp(a.age / 0.25, 0, 1)
    const bob = Math.sin(t * 3 + a.id) * T * 0.04
    const cx = box.ax * T
    const tip = badgeTip(s, a.targetId, box.ax, box.ay, box.base) + bob
    const cy = tip - 6 - size / 2 - (1 - appear) * T * 0.3
    ctx.globalAlpha = appear
    // pointer
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(cx - 5, tip - 7)
    ctx.lineTo(cx + 5, tip - 7)
    ctx.lineTo(cx, tip)
    ctx.closePath()
    ctx.fill()
    const d = (size * BADGE_PX) / BADGE_BODY
    ctx.drawImage(badgeSprite(a.type), cx - d / 2, cy - d / 2, d, d)
    const label = badgeText(w, a)
    if (label) {
      ctx.font = `800 ${Math.round(size * 0.42)}px ${FONT}`
      const tw = ctx.measureText(label).width + 10
      const lx = cx + size / 2 + 3
      roundRectPath(ctx, lx, cy - size * 0.28, tw, size * 0.56, size * 0.16)
      ctx.fillStyle = color
      ctx.fill()
      ctx.fillStyle = '#12090a'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, lx + tw / 2, cy + 1)
    }
    ctx.globalAlpha = 1
  }
}

function drawGuide(ctx: Ctx, s: Scene) {
  const id = s.guideId ?? s.selectedId
  if (!id) return
  const w = s.world
  const box = boxOf(w, id)
  if (!box) return
  const { T, time: t } = s
  // while a repair runs the ring above the technician marks the spot
  if (w.repair && w.repair.targetId === id) return
  const hasBadge = w.alerts.some((a) => a.targetId === id)
  const cx = box.ax * T
  const base = badgeTip(s, id, box.ax, box.ay, box.base) - T * 0.04 - (hasBadge ? clamp(T * 0.62, 24, 42) + 10 : 0)
  const y = base - 6 - Math.abs(Math.sin(t * 4.5)) * T * 0.22
  const sz = clamp(T * 0.32, 12, 20)
  const hex = s.guideId ? '#ffe45c' : '#ffffff'
  const arrow = () => {
    ctx.beginPath()
    ctx.moveTo(cx, y)
    ctx.lineTo(cx - sz, y - sz)
    ctx.lineTo(cx - sz * 0.42, y - sz)
    ctx.lineTo(cx - sz * 0.42, y - sz * 1.9)
    ctx.lineTo(cx + sz * 0.42, y - sz * 1.9)
    ctx.lineTo(cx + sz * 0.42, y - sz)
    ctx.lineTo(cx + sz, y - sz)
    ctx.closePath()
  }
  // soft halo from a fat translucent outline, then a dark rim so it reads on any floor
  ctx.lineJoin = 'round'
  arrow()
  ctx.strokeStyle = hexToRgba(hex, 0.22)
  ctx.lineWidth = 9
  ctx.stroke()
  ctx.strokeStyle = 'rgba(6,8,12,0.9)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = hex
  ctx.fill()
}

function drawRepairRing(ctx: Ctx, s: Scene) {
  const p = s.player
  if (p.repair < 0) return
  const { T } = s
  const k = T / 48
  const cx = p.x * T
  const cy = p.y * T - 58 * k
  const R = Math.max(11, 13 * k)
  ctx.save()
  ctx.fillStyle = 'rgba(8,10,14,0.85)'
  ctx.beginPath()
  ctx.arc(cx, cy, R + 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  const end = -Math.PI / 2 + Math.PI * 2 * clamp(p.repair, 0.02, 1)
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(255,210,63,0.25)'
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.arc(cx, cy, R, -Math.PI / 2, end)
  ctx.stroke()
  ctx.strokeStyle = '#ffd23f'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(cx, cy, R, -Math.PI / 2, end)
  ctx.stroke()
  ctx.restore()
  drawGlyph(ctx, 'wrench', cx, cy, R * 1.25, '#ffffff')
}

let mistSprite: HTMLCanvasElement | null = null

/** Soft round puff, drawn once and reused for every mist particle. */
function mistPuff(): HTMLCanvasElement {
  if (mistSprite) return mistSprite
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(200,240,255,0.95)')
    grad.addColorStop(0.4, 'rgba(140,215,255,0.4)')
    grad.addColorStop(1, 'rgba(120,205,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
  }
  mistSprite = c
  return c
}

function drawFx(ctx: Ctx, list: Fx[]) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // cold mist first, as additive light so it glows instead of greying the floor
  ctx.globalCompositeOperation = 'lighter'
  const puff = mistPuff()
  for (const f of list) {
    if (f.kind !== 'mist') continue
    const k = clamp(f.life / f.max, 0, 1)
    const rad = f.size * (1.7 + (1 - k) * 2.4)
    // kept faint: puffs add up where they overlap
    ctx.globalAlpha = 0.2 * Math.sin(k * Math.PI)
    ctx.drawImage(puff, f.x - rad, f.y - rad, rad * 2, rad * 2)
  }
  ctx.globalCompositeOperation = 'source-over'
  for (const f of list) {
    if (f.kind === 'mist') continue
    const k = clamp(f.life / f.max, 0, 1)
    if (f.kind === 'smoke') {
      ctx.globalAlpha = 0.45 * k
      ctx.fillStyle = f.color
      ctx.beginPath()
      ctx.arc(f.x, f.y, f.size * (1 + (1 - k) * 1.3), 0, Math.PI * 2)
      ctx.fill()
    } else if (f.kind === 'chev') {
      ctx.globalAlpha = Math.min(1, k * 1.6)
      ctx.strokeStyle = f.color
      ctx.lineWidth = Math.max(2, f.size * 0.3)
      ctx.beginPath()
      ctx.moveTo(f.x - f.size, f.y + f.size * 0.5)
      ctx.lineTo(f.x, f.y - f.size * 0.5)
      ctx.lineTo(f.x + f.size, f.y + f.size * 0.5)
      ctx.stroke()
    } else {
      ctx.globalAlpha = k
      ctx.strokeStyle = f.color
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(f.x, f.y, f.size * (1 + (1 - k) * 2.2), 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/* ---------- screen-space ---------- */

function drawEdgeArrows(ctx: Ctx, s: Scene) {
  if (!s.scrolling || !s.live) return
  const { T, W, H, world: w, time: t } = s
  const l = s.safe.l + 22
  const r = W - s.safe.r - 22
  const top = s.safe.t + 22
  const bot = H - s.safe.b - 22
  const cx = (l + r) / 2
  const cy = (top + bot) / 2
  const seen = new Set<string>()
  for (const a of w.alerts) {
    if (seen.has(a.targetId)) continue
    seen.add(a.targetId)
    const box = boxOf(w, a.targetId)
    if (!box) continue
    const sx = box.fx * T - s.camX
    const sy = box.fy * T - s.camY
    if (sx >= l - 10 && sx <= r + 10 && sy >= top - 10 && sy <= bot + 10) continue
    // clamp onto the border of the visible area, pointing at the target
    const dx = sx - cx
    const dy = sy - cy
    const k = Math.min(dx !== 0 ? (dx > 0 ? r - cx : l - cx) / dx : Infinity, dy !== 0 ? (dy > 0 ? bot - cy : top - cy) / dy : Infinity)
    const ex = cx + dx * k
    const ey = cy + dy * k
    const ang = Math.atan2(dy, dx)
    const color = ALERT_COLOR[a.type]
    const pulse = 1 + 0.08 * Math.sin(t * 8 + a.id)
    ctx.save()
    ctx.translate(ex, ey)
    ctx.fillStyle = hexToRgba(color, 0.2)
    ctx.beginPath()
    ctx.arc(0, 0, 21 * pulse, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#0b0d12'
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, 15 * pulse, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.rotate(ang)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(26 * pulse, 0)
    ctx.lineTo(17 * pulse, -7)
    ctx.lineTo(17 * pulse, 7)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    drawGlyph(ctx, ALERT_GLYPH[a.type], ex, ey, 17, '#ffffff', false, 2.8)
  }
}

function drawStick(ctx: Ctx, st: StickView) {
  ctx.save()
  ctx.globalAlpha = st.active ? 0.95 : 0.6
  ctx.fillStyle = 'rgba(10,14,20,0.55)'
  ctx.strokeStyle = 'rgba(30,200,255,0.7)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // direction ticks
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    ctx.beginPath()
    ctx.moveTo(st.x + Math.cos(a) * st.r * 0.86, st.y + Math.sin(a) * st.r * 0.86)
    ctx.lineTo(st.x + Math.cos(a + 0.22) * st.r * 0.68, st.y + Math.sin(a + 0.22) * st.r * 0.68)
    ctx.lineTo(st.x + Math.cos(a - 0.22) * st.r * 0.68, st.y + Math.sin(a - 0.22) * st.r * 0.68)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = st.active ? 'rgba(30,200,255,0.75)' : 'rgba(30,200,255,0.4)'
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.beginPath()
  ctx.arc(st.x + st.dx * st.r * 0.62, st.y + st.dy * st.r * 0.62, st.r * 0.42, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

let backdrop: { key: string; canvas: HTMLCanvasElement } | null = null

/** A 4×4-tile piece of plant-room wall/floor panelling that repeats around the hall. */
function backdropTile(T: number, dpr: number): HTMLCanvasElement {
  const key = `${T}:${dpr}`
  if (backdrop && backdrop.key === key) return backdrop.canvas
  const size = T * 4
  const c = document.createElement('canvas')
  c.width = Math.round(size * dpr)
  c.height = Math.round(size * dpr)
  const g = c.getContext('2d')
  if (g) {
    g.scale(dpr, dpr)
    g.fillStyle = '#07090c'
    g.fillRect(0, 0, size, size)
    const P = T * 2
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const x = i * P
        const y = j * P
        g.fillStyle = (i + j) % 2 ? '#0e1116' : '#10141a'
        g.fillRect(x + 1, y + 1, P - 2, P - 2)
        g.fillStyle = 'rgba(255,255,255,0.035)'
        g.fillRect(x + 1, y + 1, P - 2, 1)
        g.fillRect(x + 1, y + 1, 1, P - 2)
        g.fillStyle = 'rgba(255,255,255,0.06)'
        for (const [rx, ry] of [
          [0.1, 0.1],
          [0.9, 0.1],
          [0.1, 0.9],
          [0.9, 0.9],
        ]) {
          g.fillRect(x + P * rx - 1, y + P * ry - 1, 2, 2)
        }
      }
    }
    // a vent grille
    g.fillStyle = '#06080b'
    g.fillRect(T * 0.5, T * 0.55, T, T * 0.9)
    g.fillStyle = 'rgba(255,255,255,0.05)'
    for (let k = 0; k < 6; k++) g.fillRect(T * 0.56, T * (0.64 + k * 0.13), T * 0.88, 1)
    // a floor hatch
    g.strokeStyle = 'rgba(255,255,255,0.05)'
    g.lineWidth = 1
    g.strokeRect(T * 2.5 + 0.5, T * 2.5 + 0.5, T, T)
    g.beginPath()
    g.moveTo(T * 2.5, T * 2.5)
    g.lineTo(T * 3.5, T * 3.5)
    g.stroke()
    // dim service lights
    g.fillStyle = 'rgba(255,45,58,0.34)'
    roundRectPath(g, T * 2.6, T * 0.92, T * 0.8, Math.max(2, T * 0.07), T * 0.03)
    g.fill()
    g.fillStyle = 'rgba(30,200,255,0.2)'
    roundRectPath(g, T * 0.92, T * 2.6, Math.max(2, T * 0.07), T * 0.8, T * 0.03)
    g.fill()
  }
  backdrop = { key, canvas: c }
  return c
}

function drawVoid(ctx: Ctx, s: Scene) {
  const { W, H, T } = s
  // plant-room panelling, scrolling with the camera
  const tile = backdropTile(T, Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1))
  const size = T * 4
  const ox = -((((s.camX - s.shakeX) % size) + size) % size)
  const oy = -((((s.camY - s.shakeY) % size) + size) % size)
  for (let y = oy; y < H; y += size) for (let x = ox; x < W; x += size) ctx.drawImage(tile, x, y, size, size)
}

/* ---------- frame ---------- */

interface Sorted {
  base: number
  rack: Rack | null
  station: Station | null
}
const sortedCache = new WeakMap<World, Sorted[]>()

function sortedSprites(w: World): Sorted[] {
  let list = sortedCache.get(w)
  if (!list) {
    list = [
      ...w.racks.map((r) => ({ base: r.cy + 1, rack: r, station: null })),
      ...w.stations.map((st) => ({ base: st.cy + st.h, rack: null, station: st })),
    ]
    list.sort((a, b) => a.base - b.base)
    sortedCache.set(w, list)
  }
  return list
}

export function drawScene(ctx: Ctx, s: Scene) {
  const { T, W, H, world: w } = s
  drawVoid(ctx, s)
  ctx.save()
  ctx.translate(-s.camX + s.shakeX, -s.camY + s.shakeY)
  const layer = s.staticLayer
  if (layer) ctx.drawImage(layer.canvas, -layer.margin, -layer.margin, w.hall.cols * T + layer.margin * 2, w.hall.rows * T + layer.margin * 2)
  drawPipes(ctx, s)
  drawPad(ctx, s)
  drawFloorFx(ctx, s)

  // depth-sorted cabinets with the technician slotted in by his feet
  const minX = s.camX / T - 2.5
  const maxX = (s.camX + W) / T + 0.5
  const minY = s.camY / T - 2.5
  const maxY = (s.camY + H) / T + 0.6
  let playerDrawn = false
  for (const item of sortedSprites(w)) {
    if (!playerDrawn && s.player.y < item.base) {
      drawPlayer(ctx, s)
      playerDrawn = true
    }
    const o = item.rack ?? item.station!
    if (o.cx > maxX || o.cx < minX || o.cy > maxY || o.cy < minY) continue
    if (item.rack) drawRack(ctx, s, item.rack)
    else if (item.station!.h === 2) drawSideStation(ctx, s, item.station!)
    else drawTopStation(ctx, s, item.station!)
  }
  if (!playerDrawn) drawPlayer(ctx, s)

  drawShimmer(ctx, s)
  drawFx(ctx, s.fx)
  drawParticles(ctx, s.particles)
  if (s.live) {
    drawBadges(ctx, s)
    drawGuide(ctx, s)
    drawRepairRing(ctx, s)
  }
  drawFloatTexts(ctx, s.floats)
  ctx.restore()

  drawEdgeArrows(ctx, s)
  if (s.stick) drawStick(ctx, s.stick)
}

/* ---------- mini-map ---------- */

/** Scale and offset that fit the hall into a map canvas of mw × mh CSS pixels. */
export function miniMapTransform(hall: HallLayout, mw: number, mh: number) {
  const sc = Math.min((mw - 6) / hall.cols, (mh - 6) / hall.rows)
  return { sc, ox: (mw - hall.cols * sc) / 2, oy: (mh - hall.rows * sc) / 2 }
}

export function drawMiniMap(ctx: Ctx, mw: number, mh: number, s: Scene) {
  const { world: w, time: t } = s
  const hall = w.hall
  ctx.clearRect(0, 0, mw, mh)
  const { sc, ox, oy } = miniMapTransform(hall, mw, mh)
  ctx.fillStyle = '#12161d'
  ctx.fillRect(ox, oy, hall.cols * sc, hall.rows * sc)
  ctx.fillStyle = '#1b212b'
  ctx.fillRect(ox + sc, oy + sc, (hall.cols - 2) * sc, (hall.rows - 2) * sc)
  ctx.strokeStyle = 'rgba(150,170,200,0.55)'
  ctx.lineWidth = 1
  ctx.strokeRect(ox + 0.5, oy + 0.5, hall.cols * sc - 1, hall.rows * sc - 1)
  // pad
  ctx.strokeStyle = hexToRgba(COLORS.ficolo, 0.8)
  ctx.strokeRect(ox + (hall.pad.cx + 0.15) * sc, oy + (hall.pad.cy + 0.15) * sc, (hall.pad.w - 0.3) * sc, (hall.pad.h - 0.3) * sc)
  const blink = Math.floor(t * 4) % 2 === 0
  for (const r of w.racks) {
    const alert = alertOn(w, r.id)
    const tone = rackTone(w, r, alert)
    ctx.fillStyle = tone.level === 2 && !blink ? '#7a1820' : tone.level === 0 ? 'rgba(57,255,122,0.78)' : tone.color
    ctx.fillRect(ox + (r.cx + 0.12) * sc, oy + (r.cy + 0.12) * sc, sc * 0.76, sc * 0.76)
  }
  for (const st of w.stations) {
    ctx.fillStyle = st.fault ? (blink ? COLORS.alert : '#7a1820') : st.kind === 'crac' ? COLORS.cooling : st.kind === 'pdu' ? COLORS.power : st.kind === 'switch' ? COLORS.network : '#d9ffe6'
    ctx.fillRect(ox + (st.cx + 0.1) * sc, oy + (st.cy + 0.1) * sc, (st.w - 0.2) * sc, (st.h - 0.2) * sc)
  }
  // viewport when the hall scrolls
  if (s.scrolling) {
    const vx = clamp((s.camX + s.safe.l) / s.T, 0, hall.cols)
    const vy = clamp((s.camY + s.safe.t) / s.T, 0, hall.rows)
    const vx2 = clamp((s.camX + s.W - s.safe.r) / s.T, 0, hall.cols)
    const vy2 = clamp((s.camY + s.H - s.safe.b) / s.T, 0, hall.rows)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(ox + vx * sc, oy + vy * sc, (vx2 - vx) * sc, (vy2 - vy) * sc)
  }
  // alert markers
  const seen = new Set<string>()
  for (const a of w.alerts) {
    if (seen.has(a.targetId)) continue
    seen.add(a.targetId)
    const box = boxOf(w, a.targetId)
    if (!box) continue
    const cx = ox + box.fx * sc
    const cy = oy + (box.base - 0.5) * sc
    const color = ALERT_COLOR[a.type]
    const R = clamp(sc * 0.75, 6.5, 9)
    const rr = R + (a.type !== 'upgrade' && blink ? 1 : 0)
    ctx.fillStyle = hexToRgba(color, 0.25)
    ctx.beginPath()
    ctx.arc(cx, cy, rr + 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#0b0d12'
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, rr, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    drawGlyph(ctx, ALERT_GLYPH[a.type], cx, cy, R * 1.35, color, false, 3)
  }
  // technician
  const px = ox + s.player.x * sc
  const py = oy + (s.player.y - 0.2) * sc
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(px, py, 3.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = COLORS.ficolo
  ctx.beginPath()
  ctx.arc(px, py, 2.1, 0, Math.PI * 2)
  ctx.fill()
}
