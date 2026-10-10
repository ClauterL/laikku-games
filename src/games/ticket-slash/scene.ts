/**
 * The dark-blue office at night behind the action. Everything static is
 * rendered once into an offscreen canvas (re-rendered on resize or when the
 * web fonts arrive); only a handful of drifting bokeh lights are drawn per frame.
 */
import { fillRoundRect, roundRectPath, strokeRoundRect, type Ctx } from '../../shared/draw'
import { seededRng, randRange } from '../../shared/rng'
import { clamp } from '../../shared/math'
import { drawCloud } from './icons'

export interface SceneLayout {
  W: number
  H: number
  dpr: number
  /** Phone portrait: HUD wraps to two rows, wordmark moves down. */
  compact: boolean
  /** Small screen (phone portrait or landscape): smaller type. */
  small: boolean
  /** Top of the desk slab the bins stand on. */
  deskTop: number
  binsTop: number
}

export const FONT_DISPLAY = '"Baloo 2", "Nunito", sans-serif'
export const FONT_UI = '"Nunito", "Baloo 2", sans-serif'

interface Bokeh {
  x: number
  y: number
  r: number
  color: string
  phase: number
  speed: number
}

const WARM = ['#ffb36b', '#ffd27a', '#ff8c5a', '#ffe0a3', '#8fb8ff', '#ffb36b']

/** Drifting lights, in screen fractions so they survive resizes. */
export const BOKEH: readonly Bokeh[] = (() => {
  const rng = seededRng(2024)
  const list: Bokeh[] = []
  for (let i = 0; i < 9; i++) {
    list.push({
      x: randRange(rng, 0.04, 0.96),
      y: randRange(rng, 0.14, 0.62),
      r: randRange(rng, 14, 38),
      color: WARM[i % WARM.length],
      phase: randRange(rng, 0, Math.PI * 2),
      speed: randRange(rng, 0.25, 0.6),
    })
  }
  return list
})()

function softCircle(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function leaf(ctx: Ctx, x: number, y: number, len: number, wid: number, angle: number, color: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(wid, -len * 0.5, 0, -len)
  ctx.quadraticCurveTo(-wid, -len * 0.5, 0, 0)
  ctx.fill()
  ctx.restore()
}

function plant(ctx: Ctx, x: number, y: number, s: number, rng: () => number) {
  // pot
  ctx.fillStyle = '#1b2a55'
  ctx.beginPath()
  ctx.moveTo(x - s * 0.28, y - s * 0.3)
  ctx.lineTo(x + s * 0.28, y - s * 0.3)
  ctx.lineTo(x + s * 0.22, y)
  ctx.lineTo(x - s * 0.22, y)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#243a72'
  fillRoundRect(ctx, x - s * 0.32, y - s * 0.36, s * 0.64, s * 0.1, 3, '#243a72')
  // leaves
  const greens = ['#1f6b3a', '#2a8a4a', '#1c5e34', '#34a05a']
  for (let i = 0; i < 9; i++) {
    const a = randRange(rng, -1.4, 1.4)
    const len = s * randRange(rng, 0.45, 0.85)
    leaf(ctx, x + randRange(rng, -s * 0.08, s * 0.08), y - s * 0.34, len, s * randRange(rng, 0.09, 0.16), a, greens[i % greens.length])
  }
}

function monitor(ctx: Ctx, x: number, y: number, w: number, glow: string) {
  const h = w * 0.6
  // stand
  ctx.fillStyle = '#0c1736'
  ctx.fillRect(x + w * 0.44, y + h, w * 0.12, h * 0.25)
  fillRoundRect(ctx, x + w * 0.25, y + h * 1.22, w * 0.5, h * 0.08, 3, '#0c1736')
  // bezel
  fillRoundRect(ctx, x, y, w, h, 5, '#0a1430')
  // screen with a soft bloom
  ctx.save()
  ctx.shadowColor = glow
  ctx.shadowBlur = 24
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, glow)
  g.addColorStop(1, 'rgba(10, 30, 80, 0.5)')
  fillRoundRect(ctx, x + 4, y + 4, w - 8, h - 8, 3, g)
  ctx.restore()
  // faint UI lines on the screen
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  for (let i = 0; i < 3; i++) ctx.fillRect(x + w * 0.12, y + h * (0.22 + i * 0.2), w * (0.5 - i * 0.12), 2)
}

function poster(ctx: Ctx, x: number, y: number, w: number) {
  const h = w * 1.28
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 4
  fillRoundRect(ctx, x, y, w, h, 4, '#eef0f6')
  ctx.restore()
  strokeRoundRect(ctx, x + 3, y + 3, w - 6, h - 6, 2, 'rgba(15,27,61,0.18)', 1)
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = ['HAPPY', 'USERS', 'BRIGHTER', 'DAYS']
  const fs = w * 0.17
  ctx.font = `800 ${fs}px ${FONT_DISPLAY}`
  lines.forEach((l, i) => {
    ctx.fillStyle = i < 2 ? '#15224a' : '#2f80ff'
    ctx.fillText(l, x + w / 2, y + h * 0.2 + i * fs * 1.15)
  })
  // smiley
  const cx = x + w / 2
  const cy = y + h * 0.84
  const r = w * 0.09
  ctx.strokeStyle = '#ffb020'
  ctx.lineWidth = Math.max(1.5, r * 0.22)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy + r * 0.05, r * 0.6, Math.PI * 0.15, Math.PI * 0.85)
  ctx.stroke()
  ctx.fillStyle = '#ffb020'
  ctx.beginPath()
  ctx.arc(cx - r * 0.35, cy - r * 0.3, r * 0.12, 0, Math.PI * 2)
  ctx.arc(cx + r * 0.35, cy - r * 0.3, r * 0.12, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function wordmark(ctx: Ctx, cx: number, cy: number, size: number, withTagline: boolean) {
  ctx.save()
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${size}px ${FONT_DISPLAY}`
  const a = 'Topteam '
  const b = 'IT'
  const wa = ctx.measureText(a).width
  const wb = ctx.measureText(b).width
  const cloud = size * 1.05
  const total = cloud + size * 0.2 + wa + wb
  let x = cx - total / 2
  drawCloud(ctx, x + cloud * 0.5, cy + size * 0.02, cloud)
  x += cloud + size * 0.2
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  ctx.lineWidth = size * 0.16
  ctx.strokeStyle = 'rgba(8, 16, 40, 0.55)'
  ctx.strokeText(a, x, cy)
  ctx.strokeText(b, x + wa, cy)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(a, x, cy)
  ctx.fillStyle = '#2f80ff'
  ctx.fillText(b, x + wa, cy)
  // "TICKET SLASH" splash
  const sy = cy + size * 0.92
  const ss = size * 0.62
  ctx.font = `800 ${ss}px ${FONT_DISPLAY}`
  ctx.textAlign = 'center'
  const sw = ctx.measureText('TICKET SLASH').width
  ctx.save()
  ctx.translate(cx, sy)
  ctx.rotate(-0.035)
  // slash streak behind the text
  const g = ctx.createLinearGradient(-sw * 0.7, 0, sw * 0.7, 0)
  g.addColorStop(0, 'rgba(255,176,32,0)')
  g.addColorStop(0.2, 'rgba(255,176,32,0.9)')
  g.addColorStop(0.8, 'rgba(255,120,40,0.9)')
  g.addColorStop(1, 'rgba(255,120,40,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(-sw * 0.68, -ss * 0.42)
  ctx.lineTo(sw * 0.7, -ss * 0.5)
  ctx.lineTo(sw * 0.62, ss * 0.48)
  ctx.lineTo(-sw * 0.62, ss * 0.4)
  ctx.closePath()
  ctx.fill()
  ctx.lineWidth = ss * 0.18
  ctx.strokeStyle = '#2b1500'
  ctx.strokeText('TICKET SLASH', 0, 0)
  ctx.fillStyle = '#fff4d6'
  ctx.fillText('TICKET SLASH', 0, 0)
  ctx.restore()
  if (withTagline) {
    ctx.font = `800 ${size * 0.26}px ${FONT_UI}`
    ctx.fillStyle = 'rgba(244,247,255,0.55)'
    ctx.fillText('T R I A G E  ·  S W I P E  ·  S O L V E  ·  K E E P  I T  M O V I N G', cx, sy + ss * 0.95)
  }
  ctx.restore()
}

/** Render the whole static backdrop at the given size into an offscreen canvas. */
export function renderBackground(l: SceneLayout): HTMLCanvasElement {
  const { W, H, dpr } = l
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(W * dpr))
  c.height = Math.max(1, Math.round(H * dpr))
  const ctx = c.getContext('2d')!
  ctx.scale(dpr, dpr)
  const rng = seededRng(99)

  // base gradient
  const base = ctx.createLinearGradient(0, 0, 0, H)
  base.addColorStop(0, '#0f1b3d')
  base.addColorStop(0.55, '#162659')
  base.addColorStop(0.8, '#1a2a5c')
  base.addColorStop(1, '#0c1530')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, W, H)

  // ceiling light pools
  for (let i = 0; i < 3; i++) softCircle(ctx, W * (0.2 + i * 0.3), -H * 0.05, Math.max(W, H) * 0.32, '#3a5aa8', 0.22)

  // glass wall panels
  const panelW = clamp(W / 9, 60, 160)
  for (let x = -panelW * 0.3; x < W; x += panelW) {
    ctx.fillStyle = `rgba(90, 130, 220, ${0.03 + (Math.floor(x / panelW) % 2) * 0.03})`
    ctx.fillRect(x, 0, panelW - 6, H * 0.5)
    ctx.fillStyle = 'rgba(140, 170, 255, 0.07)'
    ctx.fillRect(x + panelW - 7, 0, 2, H * 0.5)
  }

  // far desks: a row of blurred monitor silhouettes in the middle band
  const deskY = H * (l.compact ? 0.56 : 0.55)
  const mw = clamp(W * 0.085, 48, 110)
  const slots = l.compact ? [0.1, 0.45, 0.8] : [0.07, 0.22, 0.38, 0.56, 0.72, 0.9]
  ctx.save()
  ctx.globalAlpha = 0.7
  if ('filter' in ctx) ctx.filter = 'blur(2.5px)'
  slots.forEach((f, i) => {
    const glow = i % 3 === 1 ? 'rgba(70, 180, 240, 0.4)' : 'rgba(50, 110, 230, 0.4)'
    monitor(ctx, W * f - mw / 2, deskY + (i % 2) * 10, mw, glow)
  })
  // desk surface line
  ctx.fillStyle = 'rgba(8, 16, 40, 0.75)'
  ctx.fillRect(0, deskY + mw * 0.6 * 1.3, W, 6)
  ctx.restore()
  // floor darkening
  const floor = ctx.createLinearGradient(0, deskY + mw * 0.78, 0, H)
  floor.addColorStop(0, 'rgba(6, 12, 32, 0)')
  floor.addColorStop(1, 'rgba(6, 12, 32, 0.7)')
  ctx.fillStyle = floor
  ctx.fillRect(0, deskY + mw * 0.78, W, H)

  // static bokeh (behind everything else)
  for (let i = 0; i < 14; i++) {
    softCircle(ctx, randRange(rng, 0, W), randRange(rng, H * 0.08, H * 0.6), randRange(rng, 10, 30), WARM[i % WARM.length], randRange(rng, 0.12, 0.3))
  }

  // phone portrait: a nearer desk with a laptop and a mug fills the lower middle
  if (l.compact) {
    const ny = H * 0.8
    ctx.fillStyle = 'rgba(8, 16, 40, 0.7)'
    ctx.fillRect(0, ny, W, 5)
    const lw = W * 0.3
    const lx = W * 0.5
    // laptop: screen + base
    fillRoundRect(ctx, lx - lw / 2, ny - lw * 0.62, lw, lw * 0.6, 5, '#0a1430')
    ctx.save()
    ctx.shadowColor = 'rgba(80, 160, 255, 0.5)'
    ctx.shadowBlur = 16
    const sg = ctx.createLinearGradient(0, ny - lw * 0.6, 0, ny)
    sg.addColorStop(0, 'rgba(60, 130, 255, 0.45)')
    sg.addColorStop(1, 'rgba(20, 50, 120, 0.4)')
    fillRoundRect(ctx, lx - lw / 2 + 4, ny - lw * 0.58, lw - 8, lw * 0.52, 3, sg)
    ctx.restore()
    ctx.fillStyle = 'rgba(255,255,255,0.14)'
    for (let i = 0; i < 3; i++) ctx.fillRect(lx - lw * 0.4, ny - lw * 0.5 + i * lw * 0.11, lw * (0.5 - i * 0.12), 2)
    fillRoundRect(ctx, lx - lw * 0.56, ny - 6, lw * 1.12, 8, 3, '#0c1736')
    // mug
    const mx = W * 0.18
    fillRoundRect(ctx, mx - 16, ny - 34, 32, 32, 5, '#dfe5f2')
    ctx.strokeStyle = '#dfe5f2'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(mx + 17, ny - 18, 8, -Math.PI / 2, Math.PI / 2)
    ctx.stroke()
    drawCloud(ctx, mx, ny - 18, 15, '#2f80ff', '#9cc3ff')
  }

  // plants
  const ps = clamp(Math.min(W, H) * 0.2, 70, 140)
  plant(ctx, W * 0.06, H * 0.78, ps, rng)
  plant(ctx, W * 0.95, H * 0.74, ps * 0.85, rng)

  // poster on the left wall
  const pw = clamp(W * 0.1, 64, 130)
  poster(ctx, W * 0.03, H * (l.compact ? 0.3 : l.small ? 0.36 : 0.28), pw)

  // soft light pool on the desk area behind the bins
  softCircle(ctx, W / 2, l.binsTop + 10, Math.max(W * 0.45, 260), '#4a78d8', 0.22)

  // wordmark
  const size = l.compact ? 30 : l.small ? 26 : 46
  const cy = l.compact ? 150 : l.small ? 34 : 48
  wordmark(ctx, W / 2, cy, size, !l.small)

  return c
}

/**
 * Small props standing on the desk beside the bins (only when there is room):
 * a Topteam mug on the left, a sticky note on the right.
 */
export function drawDeskProps(ctx: Ctx, deskTop: number, binsX0: number, binsX1: number, W: number) {
  if (binsX0 < 96) return
  // --- mug
  const mx = binsX0 - 62
  const my = deskTop + 6
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(mx + 22, my + 44, 30, 7, 0, 0, Math.PI * 2)
  ctx.fill()
  // handle
  ctx.strokeStyle = '#e4e8f2'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(mx + 44, my + 20, 11, -Math.PI / 2, Math.PI / 2)
  ctx.stroke()
  // body
  const g = ctx.createLinearGradient(mx, 0, mx + 44, 0)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(1, '#cfd6e6')
  fillRoundRect(ctx, mx, my, 44, 42, 6, g)
  fillRoundRect(ctx, mx, my, 44, 7, 3, '#f7f9ff')
  drawCloud(ctx, mx + 22, my + 24, 20, '#2f80ff', '#9cc3ff')
  ctx.restore()

  // --- sticky note
  const nx = Math.min(binsX1 + 26, W - 70)
  const ny = deskTop - 46
  ctx.save()
  ctx.translate(nx + 29, ny + 29)
  ctx.rotate(0.1)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(-26, -24, 58, 58)
  ctx.fillStyle = '#ffe066'
  ctx.fillRect(-29, -29, 58, 58)
  ctx.fillStyle = '#ffd43b'
  ctx.fillRect(-29, -29, 58, 8)
  ctx.fillStyle = '#4a2a00'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 10px ${FONT_UI}`
  ctx.fillText('GOOD', 0, -9)
  ctx.fillText('TRIAGE', 0, 3)
  ctx.strokeStyle = '#4a2a00'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(0, 17, 6, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 17.5, 3.5, Math.PI * 0.15, Math.PI * 0.85)
  ctx.stroke()
  ctx.fillStyle = '#4a2a00'
  ctx.beginPath()
  ctx.arc(-2.2, 15.5, 0.9, 0, Math.PI * 2)
  ctx.arc(2.2, 15.5, 0.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * The desk slab the bins stand on. Drawn per frame (after the tickets that
 * are launching from / falling behind it) so those cards disappear behind it.
 */
export function drawDesk(ctx: Ctx, W: number, H: number, deskTop: number, grad: CanvasGradient) {
  ctx.fillStyle = grad
  roundRectPath(ctx, -10, deskTop, W + 20, H - deskTop + 20, 10)
  ctx.fill()
  ctx.fillStyle = 'rgba(150, 180, 255, 0.35)'
  ctx.fillRect(0, deskTop, W, 2)
}

export function makeDeskGradient(ctx: Ctx, H: number, deskTop: number): CanvasGradient {
  const slab = ctx.createLinearGradient(0, deskTop, 0, H)
  slab.addColorStop(0, '#1b2b58')
  slab.addColorStop(0.3, '#121f44')
  slab.addColorStop(1, '#070d20')
  return slab
}

const BOKEH_SPRITES = new Map<string, HTMLCanvasElement>()

/** A 64×64 soft disc per colour, so the per-frame bokeh is a plain drawImage. */
function bokehSprite(color: string): HTMLCanvasElement {
  let s = BOKEH_SPRITES.get(color)
  if (!s) {
    s = document.createElement('canvas')
    s.width = 64
    s.height = 64
    const c = s.getContext('2d')!
    softCircle(c, 32, 32, 32, color, 1)
    BOKEH_SPRITES.set(color, s)
  }
  return s
}

/** Slow drifting warm lights – the only per-frame part of the backdrop. */
export function drawBokeh(ctx: Ctx, W: number, H: number, time: number) {
  ctx.save()
  for (const b of BOKEH) {
    const x = b.x * W + Math.sin(time * b.speed + b.phase) * 16
    const y = b.y * H + Math.cos(time * b.speed * 0.7 + b.phase) * 9
    ctx.globalAlpha = 0.16 + 0.1 * Math.sin(time * 1.3 + b.phase)
    ctx.drawImage(bokehSprite(b.color), x - b.r, y - b.r, b.r * 2, b.r * 2)
  }
  ctx.restore()
}

/** Radial red vignette used while a P1 is alive (alpha applied by the caller). */
export function makeVignette(ctx: Ctx, W: number, H: number): CanvasGradient {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72)
  g.addColorStop(0, 'rgba(255, 40, 50, 0)')
  g.addColorStop(1, 'rgba(255, 40, 50, 0.85)')
  return g
}
