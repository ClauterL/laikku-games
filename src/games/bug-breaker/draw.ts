/**
 * All drawing for Bug Breaker – canvas primitives only (no images, no emoji).
 * World-space helpers expect the camera transform to be applied already;
 * screen-space helpers (signs, float texts) work in CSS pixels.
 */
import type Matter from 'matter-js'
import { outlinedText, roundRectPath, type Ctx } from '../../shared/draw'
import { AMMO, BUGS, MATERIALS, WORLD } from './levels'
import type { AmmoType, BodyData, BugKind, Material, SignKind } from './types'

export interface Camera {
  scale: number
  offX: number
  offY: number
  cw: number
  ch: number
  portrait: boolean
  /** pointer-drag amplification on small screens */
  gain: number
}

const DISPLAY = '"Baloo 2", "Nunito", sans-serif'
const UI = '"Nunito", "Baloo 2", sans-serif'

/** Tiny deterministic hash → [0,1) for texture details that must not flicker. */
function hash(seed: number, i: number): number {
  let h = (seed * 374761393 + i * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function visibleRect(cam: Camera) {
  return {
    x0: -cam.offX / cam.scale,
    y0: -cam.offY / cam.scale,
    x1: (cam.cw - cam.offX) / cam.scale,
    y1: (cam.ch - cam.offY) / cam.scale,
  }
}

/* ------------------------------------------------------------------ */
/* scenery                                                             */
/* ------------------------------------------------------------------ */

export function drawSky(ctx: Ctx, cam: Camera) {
  const v = visibleRect(cam)
  const g = ctx.createLinearGradient(0, v.y0, 0, 560)
  g.addColorStop(0, '#5ec8ff')
  g.addColorStop(1, '#bfe9ff')
  ctx.fillStyle = g
  ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0)
  // sun glow top right
  const sun = ctx.createRadialGradient(1380, v.y0 + 60, 10, 1380, v.y0 + 60, 260)
  sun.addColorStop(0, 'rgba(255,255,230,0.55)')
  sun.addColorStop(1, 'rgba(255,255,230,0)')
  ctx.fillStyle = sun
  ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0)
}

interface Cloud {
  x: number
  y: number
  s: number
  v: number
}
const CLOUDS: Cloud[] = [
  { x: 120, y: 120, s: 1.1, v: 7 },
  { x: 520, y: 70, s: 0.8, v: 10 },
  { x: 880, y: 150, s: 1.3, v: 6 },
  { x: 1250, y: 90, s: 0.9, v: 9 },
  { x: 1550, y: 200, s: 0.7, v: 12 },
  { x: 350, y: 300, s: 0.6, v: 14 },
]

export function drawClouds(ctx: Ctx, cam: Camera, t: number) {
  const v = visibleRect(cam)
  const span = v.x1 - v.x0 + 400
  // spread the clouds over whatever sky is visible
  const skyTop = Math.min(v.y0, 0)
  for (const c of CLOUDS) {
    const x = v.x0 - 200 + ((((c.x + t * c.v) % span) + span) % span)
    const y = skyTop + (c.y / 330) * (470 - skyTop) * 0.85
    drawCloud(ctx, x, y, c.s)
  }
}

function drawCloud(ctx: Ctx, x: number, y: number, s: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  const puffs = [
    [0, 0, 38],
    [-42, 10, 28],
    [44, 8, 30],
    [-14, -18, 30],
    [20, -14, 26],
    [70, 16, 20],
    [-70, 18, 18],
  ]
  ctx.fillStyle = 'rgba(190,220,245,0.9)'
  for (const [px, py, r] of puffs) {
    ctx.beginPath()
    ctx.arc(px, py + 6, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#ffffff'
  for (const [px, py, r] of puffs) {
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function pine(ctx: Ctx, x: number, y: number, h: number, color: string, dark: string) {
  ctx.fillStyle = dark
  ctx.fillRect(x - h * 0.06, y - h * 0.1, h * 0.12, h * 0.14)
  ctx.fillStyle = color
  for (let i = 0; i < 3; i++) {
    const w = h * (0.5 - i * 0.12)
    const top = y - h * (0.45 + i * 0.28)
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x + w, top + h * 0.38)
    ctx.lineTo(x - w, top + h * 0.38)
    ctx.closePath()
    ctx.fill()
  }
}

function castle(ctx: Ctx, x: number, y: number, s: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.fillStyle = '#b9c2cc'
  ctx.strokeStyle = '#5c6670'
  ctx.lineWidth = 2
  // keep
  roundRectPath(ctx, -34, -60, 68, 60, 3)
  ctx.fill()
  ctx.stroke()
  // towers
  for (const tx of [-44, 44]) {
    roundRectPath(ctx, tx - 12, -84, 24, 84, 3)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#c94a3a'
    ctx.beginPath()
    ctx.moveTo(tx - 15, -84)
    ctx.lineTo(tx, -112)
    ctx.lineTo(tx + 15, -84)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#b9c2cc'
  }
  // battlements
  for (let i = -3; i <= 3; i++) {
    ctx.fillRect(i * 10 - 4, -68, 8, 8)
  }
  // windows
  ctx.fillStyle = '#3a4650'
  for (const [wx, wy] of [
    [-16, -40],
    [0, -40],
    [16, -40],
    [-44, -60],
    [44, -60],
  ]) {
    roundRectPath(ctx, wx - 3, wy - 7, 6, 12, 3)
    ctx.fill()
  }
  // gate with </> badge
  ctx.fillStyle = '#2b3640'
  roundRectPath(ctx, -14, -26, 28, 26, 10)
  ctx.fill()
  ctx.fillStyle = '#1e4f3f'
  roundRectPath(ctx, -20, -54, 40, 20, 4)
  ctx.fill()
  outlinedText(ctx, '</>', 0, -44, { font: `800 13px ${DISPLAY}`, fill: '#9ff0c8', stroke: 'none' })
  // flag pole on the left tower
  ctx.strokeStyle = '#3a3a3a'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-44, -112)
  ctx.lineTo(-44, -150)
  ctx.stroke()
  ctx.restore()
}

/** Castle flag – animated, drawn live. */
export function drawCastleFlag(ctx: Ctx, t: number) {
  const x = 560 - 44 * 0.9
  const y = 528 - 150 * 0.9
  ctx.save()
  ctx.translate(x, y)
  const w = 30
  const h = 18
  ctx.fillStyle = '#d93a3a'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  for (let i = 0; i <= 6; i++) {
    const px = (w * i) / 6
    ctx.lineTo(px, Math.sin(t * 6 + i * 0.9) * 2 * (i / 6))
  }
  ctx.lineTo(w, h + Math.sin(t * 6 + 5) * 2)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fill()
  outlinedText(ctx, '</>', w / 2, h / 2 + 1, { font: `800 10px ${DISPLAY}`, fill: '#fff', stroke: 'none' })
  ctx.restore()
}

function hill(ctx: Ctx, pts: number[][], color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  const last = pts[pts.length - 1]
  ctx.lineTo(last[0], last[1])
  ctx.closePath()
  ctx.fill()
}

function grassStrip(ctx: Ctx, x0: number, x1: number, y: number, seed: number) {
  ctx.fillStyle = '#7ccc50'
  ctx.fillRect(x0, y, x1 - x0, 14)
  ctx.fillStyle = '#5ab040'
  ctx.fillRect(x0, y + 14, x1 - x0, 10)
  // jagged grass edge
  ctx.fillStyle = '#7ccc50'
  for (let x = x0; x < x1; x += 11) {
    const h = 4 + hash(seed, x) * 7
    ctx.beginPath()
    ctx.moveTo(x, y + 1)
    ctx.lineTo(x + 5, y - h)
    ctx.lineTo(x + 10, y + 1)
    ctx.closePath()
    ctx.fill()
  }
}

function dirt(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, seed: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y0 + 260)
  g.addColorStop(0, '#8a5a30')
  g.addColorStop(0.35, '#6d4423')
  g.addColorStop(1, '#4b2f18')
  ctx.fillStyle = g
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  ctx.fillStyle = 'rgba(0,0,0,0.14)'
  const n = Math.max(0, Math.floor(((x1 - x0) * Math.min(260, y1 - y0)) / 7000))
  for (let i = 0; i < n; i++) {
    const px = x0 + hash(seed, i * 3) * (x1 - x0)
    const py = y0 + 20 + hash(seed, i * 3 + 1) * Math.min(230, y1 - y0 - 20)
    const r = 3 + hash(seed, i * 3 + 2) * 6
    ctx.beginPath()
    ctx.ellipse(px, py, r * 1.4, r, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

function rockFace(ctx: Ctx, pts: number[][], seed: number) {
  ctx.fillStyle = '#7d7265'
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
  ctx.fill()
  ctx.save()
  ctx.clip()
  for (let i = 0; i < 14; i++) {
    const px = pts[0][0] + hash(seed, i * 2) * 120 - 60
    const py = pts[0][1] + hash(seed, i * 2 + 1) * 120
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)'
    ctx.beginPath()
    ctx.ellipse(px, py, 14, 9, 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Everything static behind and under the structures. Rendered once into an
 * offscreen layer per camera size (the sky and clouds are drawn live).
 */
export function drawLand(ctx: Ctx, v: { x0: number; y0: number; x1: number; y1: number }) {
  const L = WORLD.ledge
  const P = WORLD.plateau
  const V = WORLD.valley

  // far mountains (behind everything)
  hill(
    ctx,
    [
      [v.x0 - 100, 470],
      [v.x0 + 100, 380],
      [260, 420],
      [420, 340],
      [620, 430],
      [820, 360],
      [1000, 440],
      [1200, 350],
      [1420, 420],
      [v.x1 + 100, 380],
      [v.x1 + 100, 520],
      [v.x0 - 100, 520],
    ],
    '#8fb8c9',
  )
  hill(
    ctx,
    [
      [v.x0 - 100, 500],
      [60, 450],
      [300, 470],
      [520, 420],
      [760, 460],
      [980, 410],
      [1250, 450],
      [1500, 400],
      [v.x1 + 100, 450],
      [v.x1 + 100, 560],
      [v.x0 - 100, 560],
    ],
    '#6f9fb2',
  )
  // far shore forest line
  for (let x = v.x0 - 20; x < v.x1 + 20; x += 22) {
    pine(ctx, x, 478, 22 + hash(7, x) * 14, '#2f6e4e', '#1f4a34')
  }
  // lake
  const lake = ctx.createLinearGradient(0, 470, 0, 650)
  lake.addColorStop(0, '#59b4e6')
  lake.addColorStop(1, '#2f7fc0')
  ctx.fillStyle = lake
  ctx.fillRect(v.x0 - 100, 474, v.x1 - v.x0 + 200, 240)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  for (let i = 0; i < 40; i++) {
    const px = v.x0 + hash(11, i * 2) * (v.x1 - v.x0)
    const py = 490 + hash(11, i * 2 + 1) * 140
    ctx.fillRect(px, py, 14 + hash(12, i) * 24, 2)
  }
  // rocky cliffs at the left, mid distance
  rockFace(
    ctx,
    [
      [v.x0 - 100, 540],
      [v.x0 - 100, 420],
      [40, 400],
      [120, 430],
      [210, 395],
      [300, 440],
      [360, 480],
      [380, 540],
    ],
    3,
  )
  for (let x = v.x0 - 40; x < 360; x += 26) pine(ctx, x, 404 + hash(5, x) * 24, 26 + hash(6, x) * 10, '#3d8a55', '#2a5e3b')

  // islands
  const island = (x: number, y: number, w: number, trees: number, seed: number) => {
    ctx.fillStyle = '#4a9a3a'
    ctx.beginPath()
    ctx.ellipse(x, y, w, w * 0.32, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#7a6a55'
    ctx.beginPath()
    ctx.ellipse(x, y + w * 0.08, w * 0.98, w * 0.22, 0, 0, Math.PI)
    ctx.fill()
    for (let i = 0; i < trees; i++) {
      const tx = x - w * 0.8 + hash(seed, i) * w * 1.6
      pine(ctx, tx, y - 2 + hash(seed, i + 50) * 8, 24 + hash(seed, i + 100) * 16, '#2f7a45', '#1f5230')
    }
  }
  island(300, 500, 60, 4, 21)
  island(1010, 548, 70, 5, 22)
  island(560, 530, 150, 0, 23)
  for (const tx of [430, 470, 650, 690]) pine(ctx, tx, 526 + hash(9, tx) * 8, 34 + hash(9, tx + 1) * 10, '#2f7a45', '#1f5230')
  castle(ctx, 560, 528, 0.9)

  // right-hand rolling hills (behind the plateau)
  hill(
    ctx,
    [
      [640, 720],
      [760, 560],
      [900, 600],
      [1040, 520],
      [1200, 580],
      [1360, 500],
      [1520, 570],
      [v.x1 + 100, 540],
      [v.x1 + 100, 760],
      [640, 760],
    ],
    '#4a9a35',
  )
  hill(
    ctx,
    [
      [700, 740],
      [820, 640],
      [980, 660],
      [1120, 600],
      [1300, 650],
      [1460, 600],
      [v.x1 + 100, 640],
      [v.x1 + 100, 760],
      [700, 760],
    ],
    '#5ab040',
  )
  for (let x = 700; x < v.x1 + 40; x += 48) pine(ctx, x, 612 + hash(13, x) * 50, 30 + hash(14, x) * 16, '#3d8a55', '#2a5e3b')
  // near shore bank between the ledge and the plateau
  hill(
    ctx,
    [
      [340, 720],
      [440, 650],
      [560, 672],
      [690, 640],
      [800, 690],
      [860, 760],
      [860, 840],
      [340, 840],
    ],
    '#4f9c3c',
  )
  for (let x = 400; x < 800; x += 34) pine(ctx, x, 668 + hash(15, x) * 30, 26 + hash(16, x) * 14, '#3d8a55', '#2a5e3b')

  // valley floor
  dirt(ctx, L.x1 - 30, V.top, P.x0 + 40, v.y1 + 10, 31)
  grassStrip(ctx, L.x1 - 20, P.x0 + 20, V.top - 4, 32)
  // ledge (slingshot side)
  dirt(ctx, v.x0 - 100, L.top, L.x1 + 16, v.y1 + 10, 33)
  rockFace(
    ctx,
    [
      [L.x1 - 6, L.top + 10],
      [L.x1 + 16, L.top + 40],
      [L.x1 + 8, V.top - 20],
      [L.x1 + 22, V.top + 4],
      [L.x1 - 40, V.top + 4],
      [L.x1 - 40, L.top + 10],
    ],
    34,
  )
  grassStrip(ctx, v.x0 - 100, L.x1 + 2, L.top - 2, 35)
  // plateau with a rocky front face
  dirt(ctx, P.x0 - 10, P.top, v.x1 + 100, v.y1 + 10, 36)
  rockFace(
    ctx,
    [
      [P.x0 + 4, P.top + 8],
      [P.x0 - 30, P.top + 40],
      [P.x0 - 56, V.top - 10],
      [P.x0 - 60, V.top + 4],
      [P.x0 + 40, V.top + 4],
      [P.x0 + 40, P.top + 8],
    ],
    37,
  )
  grassStrip(ctx, P.x0 - 4, v.x1 + 100, P.top - 2, 38)

  // foreground meadow – below the cliff faces the world turns green again
  hill(
    ctx,
    [
      [v.x0 - 100, 860],
      [160, 826],
      [420, 866],
      [700, 830],
      [980, 870],
      [1260, 828],
      [1500, 862],
      [v.x1 + 100, 840],
      [v.x1 + 100, v.y1 + 10],
      [v.x0 - 100, v.y1 + 10],
    ],
    '#3f8f30',
  )
  hill(
    ctx,
    [
      [v.x0 - 100, 930],
      [240, 900],
      [560, 940],
      [900, 896],
      [1240, 944],
      [v.x1 + 100, 910],
      [v.x1 + 100, v.y1 + 10],
      [v.x0 - 100, v.y1 + 10],
    ],
    '#357f2a',
  )
  // bushes on the meadow
  for (let i = 0; i < 16; i++) {
    const bx = v.x0 + hash(61, i) * (v.x1 - v.x0)
    const by = 850 + hash(62, i) * Math.max(40, Math.min(300, v.y1 - 870))
    const bs = 14 + hash(63, i) * 14
    ctx.fillStyle = i % 2 ? '#2f7a28' : '#3d8f33'
    for (const [ox, oy, k] of [
      [0, 0, 1],
      [-0.8, 0.25, 0.75],
      [0.8, 0.25, 0.75],
    ]) {
      ctx.beginPath()
      ctx.arc(bx + ox * bs, by + oy * bs, bs * k, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // small flowers and stones
  for (let i = 0; i < 26; i++) {
    const onLedge = i % 2 === 0
    const px = onLedge ? v.x0 + hash(41, i) * (L.x1 - v.x0) : P.x0 + 40 + hash(42, i) * (v.x1 - P.x0 - 40)
    const py = (onLedge ? L.top : P.top) + 18 + hash(43, i) * 40
    if (i % 3 === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)'
      ctx.beginPath()
      ctx.ellipse(px, py, 6, 4, 0, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = ['#ffd23f', '#ff7aa8', '#ffffff'][i % 3]
      ctx.beginPath()
      ctx.arc(px, py, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ff9f1a'
      ctx.beginPath()
      ctx.arc(px, py, 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  drawGoodCodeSign(ctx)
}

/** Foreground grass tufts along the edges – gently swaying, drawn live. */
export function drawGrassFront(ctx: Ctx, cam: Camera, t: number) {
  const v = visibleRect(cam)
  ctx.strokeStyle = '#3f8a2a'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  const tuft = (x: number, y: number, s: number, phase: number) => {
    const sway = Math.sin(t * 1.6 + phase) * 2
    ctx.beginPath()
    for (let i = -1; i <= 1; i++) {
      ctx.moveTo(x + i * 3, y)
      ctx.quadraticCurveTo(x + i * 5 + sway, y - 8 * s, x + i * 9 + sway * 1.6, y - 14 * s)
    }
    ctx.stroke()
  }
  for (let i = 0; i < 14; i++) {
    tuft(v.x0 + hash(51, i) * (WORLD.ledge.x1 - v.x0), WORLD.ledge.top + 4 + hash(52, i) * 6, 0.8 + hash(53, i) * 0.6, i)
  }
  for (let i = 0; i < 18; i++) {
    tuft(WORLD.plateau.x0 + 10 + hash(54, i) * (v.x1 - WORLD.plateau.x0 - 10), WORLD.plateau.top + 4 + hash(55, i) * 6, 0.8 + hash(56, i) * 0.6, i * 1.7)
  }
}

/* ------------------------------------------------------------------ */
/* signs                                                               */
/* ------------------------------------------------------------------ */

function plank(ctx: Ctx, x: number, y: number, w: number, h: number, r = 8) {
  ctx.save()
  ctx.strokeStyle = '#4a2a12'
  ctx.lineWidth = 4
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, '#b07a3e')
  g.addColorStop(0.5, '#8b5a2b')
  g.addColorStop(1, '#6b421d')
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fillStyle = g
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = 'rgba(60,30,10,0.35)'
  ctx.lineWidth = 1.5
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath()
    ctx.moveTo(x + 10, y + (h * i) / 3 + 2)
    ctx.bezierCurveTo(x + w * 0.3, y + (h * i) / 3 - 3, x + w * 0.6, y + (h * i) / 3 + 4, x + w - 10, y + (h * i) / 3)
    ctx.stroke()
  }
  ctx.fillStyle = '#3a2210'
  for (const [nx, ny] of [
    [x + 10, y + 10],
    [x + w - 10, y + 10],
    [x + 10, y + h - 10],
    [x + w - 10, y + h - 10],
  ]) {
    ctx.beginPath()
    ctx.arc(nx, ny, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function leaf(ctx: Ctx, x: number, y: number, a: number, s: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(a)
  ctx.scale(s, s)
  ctx.fillStyle = '#4faa3a'
  ctx.beginPath()
  ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#2f7a28'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(-10, 0)
  ctx.lineTo(10, 0)
  ctx.stroke()
  ctx.restore()
}

/** "GOOD CODE · STRONGER WORLDS ♥" on the left hill (world space). */
function drawGoodCodeSign(ctx: Ctx) {
  const x = 322
  const y = 604
  ctx.fillStyle = '#4a2a12'
  ctx.fillRect(x + 36, y + 70, 10, 40)
  plank(ctx, x, y, 84, 78, 8)
  const opts = { font: `800 13px ${DISPLAY}`, fill: '#f6e3c0', stroke: 'rgba(40,20,5,0.8)', strokeWidth: 3 }
  outlinedText(ctx, 'GOOD', x + 42, y + 16, opts)
  outlinedText(ctx, 'CODE', x + 42, y + 31, opts)
  outlinedText(ctx, 'STRONGER', x + 42, y + 47, { ...opts, font: `800 11px ${DISPLAY}` })
  outlinedText(ctx, 'WORLDS', x + 42, y + 61, { ...opts, font: `800 11px ${DISPLAY}` })
  ctx.fillStyle = '#f6e3c0'
  heart(ctx, x + 42, y + 72, 3.2)
}

function heart(ctx: Ctx, x: number, y: number, s: number) {
  ctx.beginPath()
  ctx.moveTo(x, y + s * 1.6)
  ctx.bezierCurveTo(x - s * 2.4, y - s * 0.4, x - s * 0.8, y - s * 1.8, x, y - s * 0.4)
  ctx.bezierCurveTo(x + s * 0.8, y - s * 1.8, x + s * 2.4, y - s * 0.4, x, y + s * 1.6)
  ctx.fill()
}

/** Title lock-up (screen space). `w` is the sign width in CSS px. */
export function drawTitleSign(ctx: Ctx, x: number, y: number, w: number, t: number) {
  const s = w / 320
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.rotate(-0.03)
  // badge
  ctx.fillStyle = '#163d35'
  roundRectPath(ctx, 128, 0, 64, 30, 8)
  ctx.fill()
  ctx.strokeStyle = '#8ff0c0'
  ctx.lineWidth = 2
  ctx.stroke()
  outlinedText(ctx, '</>', 160, 15, { font: `800 20px ${DISPLAY}`, fill: '#9ff0c8', stroke: 'none' })
  // INFOMAATTI – chunky yellow with brown outline, slight bounce
  const bounce = Math.sin(t * 2) * 1.5
  ctx.save()
  ctx.translate(160, 62 + bounce)
  ctx.font = `800 54px ${DISPLAY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 12
  ctx.strokeStyle = '#5a2e0c'
  ctx.strokeText('INFOMAATTI', 0, 0)
  ctx.lineWidth = 5
  ctx.strokeStyle = '#8a4a14'
  ctx.strokeText('INFOMAATTI', 0, 3)
  const tg = ctx.createLinearGradient(0, -26, 0, 26)
  tg.addColorStop(0, '#ffe24a')
  tg.addColorStop(0.55, '#ffbb1c')
  tg.addColorStop(1, '#ff9a12')
  ctx.fillStyle = tg
  ctx.fillText('INFOMAATTI', 0, 0)
  ctx.restore()
  // BUG BREAKER plank
  plank(ctx, 30, 96, 260, 46, 10)
  outlinedText(ctx, 'BUG BREAKER', 160, 119, { font: `800 30px ${DISPLAY}`, fill: '#ffffff', stroke: '#3a2210', strokeWidth: 6 })
  leaf(ctx, 28, 100, -0.6, 1)
  leaf(ctx, 22, 130, 0.4, 0.9)
  leaf(ctx, 292, 100, 0.6, 1)
  leaf(ctx, 298, 132, -0.3, 0.9)
  // strapline
  const strap = { font: `900 13px ${UI}`, fill: '#ffffff', stroke: 'rgba(20,40,80,0.85)', strokeWidth: 4 }
  outlinedText(ctx, 'LAUNCH CODE. BREAK BUGS.', 160, 160, strap)
  outlinedText(ctx, 'BUILD A CLEANER WORLD!', 160, 176, strap)
  ctx.strokeStyle = '#ff7a1a'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(110, 188)
  ctx.quadraticCurveTo(160, 192, 210, 187)
  ctx.stroke()
  ctx.restore()
}

/** "CODE YOUR WAY TO VICTORY!" board (screen space, bottom-right on the title screen). */
export function drawVictorySign(ctx: Ctx, x: number, y: number, w: number) {
  const s = w / 300
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.rotate(-0.06)
  ctx.fillStyle = '#4a2a12'
  ctx.fillRect(140, 120, 16, 60)
  plank(ctx, 0, 0, 300, 130, 12)
  outlinedText(ctx, 'CODE', 150, 32, { font: `800 38px ${DISPLAY}`, fill: '#ffffff', stroke: '#3a2210', strokeWidth: 7 })
  outlinedText(ctx, 'YOUR WAY', 150, 66, { font: `800 34px ${DISPLAY}`, fill: '#ffffff', stroke: '#3a2210', strokeWidth: 7 })
  outlinedText(ctx, 'TO VICTORY!', 150, 102, { font: `800 36px ${DISPLAY}`, fill: '#ffd23f', stroke: '#3a2210', strokeWidth: 7 })
  leaf(ctx, 6, 8, -0.7, 1.3)
  leaf(ctx, 294, 6, 0.7, 1.3)
  leaf(ctx, 290, 126, -0.5, 1.1)
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* slingshot, aiming                                                   */
/* ------------------------------------------------------------------ */

/** The wooden fork. `front` draws the arm that sits in front of the cube. */
export function drawSlingshotFork(ctx: Ctx) {
  const S = WORLD.sling
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // shadow on the grass
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.ellipse(S.x + 6, S.baseY + 2, 30, 7, 0, 0, Math.PI * 2)
  ctx.fill()
  const draw = (w: number, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(S.x, S.baseY + 4)
    ctx.lineTo(S.x, 612)
    ctx.lineTo(S.forkL.x, S.forkL.y)
    ctx.moveTo(S.x, 612)
    ctx.lineTo(S.forkR.x, S.forkR.y)
    ctx.stroke()
  }
  draw(18, '#3b2010')
  draw(12, '#8b5a2b')
  ctx.strokeStyle = 'rgba(255,220,160,0.35)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(S.x - 3, S.baseY - 4)
  ctx.lineTo(S.x - 3, 616)
  ctx.lineTo(S.forkL.x - 2, S.forkL.y + 6)
  ctx.stroke()
  ctx.restore()
}

/** Rubber band from one fork tip to the pouch; `back` = the band behind the cube. */
export function drawBand(ctx: Ctx, pouch: { x: number; y: number }, back: boolean, slack: boolean) {
  const S = WORLD.sling
  const tip = back ? S.forkR : S.forkL
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = back ? '#2a1a12' : '#3d2819'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  if (slack) ctx.quadraticCurveTo((tip.x + pouch.x) / 2, pouch.y + 10, pouch.x, pouch.y)
  else ctx.lineTo(pouch.x, pouch.y)
  ctx.stroke()
  ctx.restore()
}

export function drawPouch(ctx: Ctx, pouch: { x: number; y: number }, angle: number) {
  ctx.save()
  ctx.translate(pouch.x, pouch.y)
  ctx.rotate(angle)
  ctx.fillStyle = '#2a1a12'
  roundRectPath(ctx, -14, -24, 28, 48, 8)
  ctx.fill()
  ctx.restore()
}

/** Dotted aim preview. `dotR` is in world units (the engine keeps it ≥ ~3 CSS px). */
export function drawTrajectory(ctx: Ctx, pts: number[], n: number, dotR: number) {
  ctx.lineWidth = dotR * 0.35
  for (let i = 0; i < n; i++) {
    const a = 1 - i / n
    ctx.fillStyle = `rgba(255,255,255,${0.5 + a * 0.5})`
    ctx.strokeStyle = `rgba(20,40,70,${0.45 + a * 0.4})`
    ctx.beginPath()
    ctx.arc(pts[i * 2], pts[i * 2 + 1], dotR * (0.75 + a * 0.35), 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}

/** Dotted trail of the last flight – stays until the next launch. */
export function drawTrail(ctx: Ctx, trail: number[], dotR: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.strokeStyle = 'rgba(20,40,70,0.45)'
  ctx.lineWidth = dotR * 0.3
  for (let i = 0; i < trail.length; i += 2) {
    ctx.beginPath()
    ctx.arc(trail[i], trail[i + 1], dotR, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}

/* ------------------------------------------------------------------ */
/* bodies                                                              */
/* ------------------------------------------------------------------ */

function crack(ctx: Ctx, seed: number, i: number, w: number, h: number, color: string) {
  // a jagged line from a random edge point towards the centre
  const side = Math.floor(hash(seed, i) * 4)
  let x = side === 0 ? -w / 2 : side === 1 ? w / 2 : (hash(seed, i + 10) - 0.5) * w
  let y = side === 2 ? -h / 2 : side === 3 ? h / 2 : (hash(seed, i + 20) - 0.5) * h
  ctx.strokeStyle = color
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x, y)
  const steps = 4
  for (let k = 1; k <= steps; k++) {
    const t = k / steps
    x = x * (1 - t) * 0.9 + (hash(seed, i + 30 + k) - 0.5) * w * 0.3
    y = y * (1 - t) * 0.9 + (hash(seed, i + 40 + k) - 0.5) * h * 0.3
    ctx.lineTo(x, y)
  }
  ctx.stroke()
}

export function drawBlock(ctx: Ctx, body: Matter.Body, d: BodyData) {
  const m = MATERIALS[d.material as Material]
  const w = d.w
  const h = d.h
  ctx.save()
  ctx.translate(body.position.x, body.position.y)
  ctx.rotate(body.angle)
  const x = -w / 2
  const y = -h / 2

  if (d.sign === 'syntax') {
    drawMonitorBlock(ctx, w, h)
    ctx.restore()
    return
  }

  if (d.material === 'wood') {
    ctx.fillStyle = m.color
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = 'rgba(255,230,180,0.28)'
    ctx.fillRect(x, y, w, Math.min(6, h * 0.2))
    ctx.fillStyle = 'rgba(70,35,10,0.22)'
    ctx.fillRect(x, y + h - Math.min(5, h * 0.18), w, Math.min(5, h * 0.18))
    // grain along the long axis
    ctx.strokeStyle = 'rgba(110,60,20,0.45)'
    ctx.lineWidth = 1.2
    const along = w >= h
    const len = along ? w : h
    const across = along ? h : w
    const lines = Math.max(1, Math.min(3, Math.floor(across / 12)))
    for (let i = 1; i <= lines; i++) {
      const c = -across / 2 + (across * i) / (lines + 1) + (hash(d.seed, i) - 0.5) * 3
      ctx.beginPath()
      if (along) {
        ctx.moveTo(x + 4, c)
        ctx.bezierCurveTo(x + len * 0.3, c - 2, x + len * 0.6, c + 2, x + len - 4, c)
      } else {
        ctx.moveTo(c, y + 4)
        ctx.bezierCurveTo(c - 2, y + len * 0.3, c + 2, y + len * 0.6, c, y + len - 4)
      }
      ctx.stroke()
    }
    if (len > 50) {
      ctx.fillStyle = 'rgba(110,60,20,0.35)'
      const kx = (hash(d.seed, 9) - 0.5) * len * 0.6
      ctx.beginPath()
      if (along) ctx.ellipse(kx, (hash(d.seed, 8) - 0.5) * across * 0.4, 4, 2.5, 0, 0, Math.PI * 2)
      else ctx.ellipse((hash(d.seed, 8) - 0.5) * across * 0.4, kx, 2.5, 4, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (d.material === 'stone') {
    ctx.fillStyle = m.color
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.fillRect(x, y, w, Math.min(6, h * 0.2))
    ctx.fillRect(x, y, Math.min(5, w * 0.2), h)
    ctx.fillStyle = 'rgba(0,0,0,0.16)'
    ctx.fillRect(x, y + h - Math.min(6, h * 0.2), w, Math.min(6, h * 0.2))
    ctx.fillRect(x + w - Math.min(5, w * 0.2), y, Math.min(5, w * 0.2), h)
    // speckles
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    const n = Math.floor((w * h) / 400)
    for (let i = 0; i < n; i++) {
      ctx.beginPath()
      ctx.arc(x + 4 + hash(d.seed, i * 2) * (w - 8), y + 4 + hash(d.seed, i * 2 + 1) * (h - 8), 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    ctx.fillStyle = m.color
    ctx.fillRect(x, y, w, h)
    // diagonal shine
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.beginPath()
    ctx.moveTo(x + w * 0.15, y)
    ctx.lineTo(x + w * 0.45, y)
    ctx.lineTo(x + w * 0.05, y + h)
    ctx.lineTo(x - w * 0.25, y + h)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.beginPath()
    ctx.moveTo(x + w * 0.62, y)
    ctx.lineTo(x + w * 0.72, y)
    ctx.lineTo(x + w * 0.32, y + h)
    ctx.lineTo(x + w * 0.22, y + h)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = 'rgba(80,160,220,0.35)'
    ctx.fillRect(x, y + h - Math.min(5, h * 0.2), w, Math.min(5, h * 0.2))
  }

  // damage cracks
  const ratio = d.hp / d.maxHp
  if (ratio < 0.75) {
    const col = d.material === 'ice' ? 'rgba(255,255,255,0.95)' : 'rgba(35,18,8,0.8)'
    crack(ctx, d.seed, 1, w, h, col)
    if (ratio < 0.45) crack(ctx, d.seed, 2, w, h, col)
    if (ratio < 0.2) crack(ctx, d.seed, 3, w, h, col)
  }

  // outline
  ctx.strokeStyle = m.dark
  ctx.lineWidth = d.material === 'ice' ? 2 : 2.5
  ctx.strokeRect(x, y, w, h)

  if (d.sign) drawSignText(ctx, d.sign, w, h)
  ctx.restore()
}

function drawSignText(ctx: Ctx, sign: SignKind, w: number, h: number) {
  const dark = '#3a1d08'
  if (sign === 'bug') {
    outlinedText(ctx, 'BUG', 0, 1, { font: `800 ${Math.min(h * 0.7, w * 0.4)}px ${DISPLAY}`, fill: dark, stroke: 'none' })
  } else if (sign === 'null') {
    outlinedText(ctx, 'NULL', 0, 1, { font: `800 ${Math.min(h * 0.68, w * 0.36)}px ${DISPLAY}`, fill: dark, stroke: 'none' })
  } else if (sign === '404') {
    ctx.fillStyle = '#f3e6c8'
    ctx.fillRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8)
    outlinedText(ctx, '404', 0, -h * 0.17, { font: `800 ${h * 0.52}px ${DISPLAY}`, fill: '#d9262c', stroke: 'none' })
    outlinedText(ctx, 'NOT FOUND', 0, h * 0.3, { font: `900 ${Math.min(h * 0.22, w * 0.13)}px ${UI}`, fill: dark, stroke: 'none' })
  }
}

/** Dark monitor block with a red "SYNTAX ERROR" screen. */
function drawMonitorBlock(ctx: Ctx, w: number, h: number) {
  const x = -w / 2
  const y = -h / 2
  ctx.fillStyle = '#2b3140'
  roundRectPath(ctx, x, y, w, h, 4)
  ctx.fill()
  ctx.fillStyle = '#0d1117'
  roundRectPath(ctx, x + 5, y + 5, w - 10, h - 10, 3)
  ctx.fill()
  // pixel face
  ctx.fillStyle = '#ff3b3b'
  const px = Math.max(2, w * 0.045)
  const cx = 0
  const cy = y + h * 0.36
  for (const [ox, oy] of [
    [-3, -2],
    [-2, -2],
    [2, -2],
    [3, -2],
    [-2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [2, 0],
  ]) {
    ctx.fillRect(cx + ox * px - px / 2, cy + oy * px, px, px)
  }
  outlinedText(ctx, 'SYNTAX', 0, y + h * 0.66, { font: `900 ${Math.min(h * 0.2, w * 0.17)}px ${UI}`, fill: '#ff3b3b', stroke: 'none' })
  outlinedText(ctx, 'ERROR', 0, y + h * 0.85, { font: `900 ${Math.min(h * 0.2, w * 0.17)}px ${UI}`, fill: '#ff3b3b', stroke: 'none' })
  // scanlines
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  for (let ly = y + 6; ly < y + h - 6; ly += 4) ctx.fillRect(x + 5, ly, w - 10, 1.5)
  ctx.strokeStyle = '#0b0e14'
  ctx.lineWidth = 2.5
  roundRectPath(ctx, x, y, w, h, 4)
  ctx.stroke()
}

export function drawBug(ctx: Ctx, body: Matter.Body, d: BodyData, scared: boolean) {
  const kind = d.bug as BugKind
  const info = BUGS[kind]
  const r = d.r
  ctx.save()
  ctx.translate(body.position.x, body.position.y)
  ctx.rotate(body.angle)
  const pop = d.age < 0.3 ? 0.6 + (d.age / 0.3) * 0.4 : 1
  ctx.scale(pop, pop)

  // legs
  ctx.strokeStyle = info.dark
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + side * (0.35 + i * 0.42)
      const sx = Math.cos(a) * r * 0.85
      const sy = Math.sin(a) * r * 0.85
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx + side * r * 0.4, sy + r * 0.3)
      ctx.stroke()
    }
  }
  // antennae
  ctx.lineWidth = 2
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(side * r * 0.3, -r * 0.8)
    ctx.quadraticCurveTo(side * r * 0.5, -r * 1.35, side * r * 0.85, -r * 1.3)
    ctx.stroke()
    ctx.fillStyle = info.dark
    ctx.beginPath()
    ctx.arc(side * r * 0.88, -r * 1.3, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }

  // body
  if (kind === 'null') {
    ctx.globalAlpha = 0.92
    ctx.fillStyle = info.color
    ctx.beginPath()
    ctx.arc(0, 0, r, Math.PI, 0)
    ctx.lineTo(r, r * 0.55)
    // wavy skirt along the bottom (bumps reach the physical radius)
    const waves = 4
    const seg = (2 * r) / waves
    for (let i = 0; i < waves; i++) {
      const x0 = r - i * seg
      const x1 = x0 - seg
      ctx.quadraticCurveTo((x0 + x1) / 2, r * 0.55 + r * 0.9, x1, r * 0.55)
    }
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = info.dark
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.globalAlpha = 1
  } else {
    ctx.fillStyle = info.color
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    // belly highlight
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath()
    ctx.ellipse(-r * 0.3, -r * 0.35, r * 0.35, r * 0.22, -0.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = info.dark
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.stroke()
  }

  if (kind === 'bug') {
    // ladybug: dark head cap + spots + wing split
    ctx.fillStyle = '#2a0f0c'
    ctx.beginPath()
    ctx.arc(0, 0, r, Math.PI * 1.2, Math.PI * 1.8)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(42,15,12,0.8)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, r * 0.15)
    ctx.lineTo(0, r)
    ctx.stroke()
    ctx.fillStyle = '#2a0f0c'
    for (const [sx, sy, sr] of [
      [-r * 0.55, r * 0.45, r * 0.16],
      [r * 0.55, r * 0.45, r * 0.16],
      [-r * 0.6, -r * 0.1, r * 0.12],
      [r * 0.6, -r * 0.1, r * 0.12],
    ]) {
      ctx.beginPath()
      ctx.arc(sx, sy, sr, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (kind === '404') {
    // hard hat
    ctx.fillStyle = '#ffc21a'
    ctx.beginPath()
    ctx.arc(0, -r * 0.55, r * 0.78, Math.PI, 0)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#7a5a00'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#ffd34d'
    roundRectPath(ctx, -r * 0.95, -r * 0.62, r * 1.9, r * 0.2, 3)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#7a5a00'
    ctx.fillRect(-r * 0.1, -r * 1.3, r * 0.2, r * 0.6)
    outlinedText(ctx, '404', 0, r * 0.55, { font: `800 ${r * 0.5}px ${DISPLAY}`, fill: '#fff', stroke: info.dark, strokeWidth: 2.5 })
  } else if (kind === 'syntax') {
    // glasses
    ctx.strokeStyle = '#1b0a26'
    ctx.lineWidth = 2.2
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(side * r * 0.4, -r * 0.1, r * 0.33, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(-r * 0.07, -r * 0.1)
    ctx.lineTo(r * 0.07, -r * 0.1)
    ctx.stroke()
    // badge
    ctx.fillStyle = '#e8262c'
    roundRectPath(ctx, -r * 0.8, r * 0.42, r * 1.6, r * 0.42, 3)
    ctx.fill()
    ctx.strokeStyle = '#5a0a0e'
    ctx.lineWidth = 1.5
    ctx.stroke()
    outlinedText(ctx, 'SYNTAX ERR', 0, r * 0.64, { font: `900 ${r * 0.27}px ${UI}`, fill: '#fff', stroke: 'none' })
  }

  // face
  const eyeY = kind === 'syntax' ? -r * 0.1 : -r * 0.18
  const eyeR = kind === 'syntax' ? r * 0.2 : r * 0.24
  const pupil = scared ? eyeR * 0.75 : eyeR * 0.5
  for (const side of [-1, 1]) {
    const ex = side * r * 0.38
    if (d.blinking) {
      ctx.strokeStyle = info.dark
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(ex - eyeR, eyeY)
      ctx.lineTo(ex + eyeR, eyeY)
      ctx.stroke()
      continue
    }
    if (kind === 'null') {
      ctx.fillStyle = '#2b3a30'
      ctx.beginPath()
      ctx.ellipse(ex, eyeY, eyeR * 0.75, eyeR * (scared ? 1.2 : 0.95), 0, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath()
    ctx.arc(ex + side * eyeR * 0.15, eyeY + eyeR * 0.1, pupil, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(ex - eyeR * 0.2, eyeY - eyeR * 0.3, pupil * 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
  // brows + mouth
  ctx.strokeStyle = kind === 'null' ? '#2b3a30' : '#1a1a1a'
  ctx.lineWidth = 2.6
  ctx.lineCap = 'round'
  if (scared) {
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(side * r * 0.2, eyeY - eyeR * 1.6)
      ctx.lineTo(side * r * 0.56, eyeY - eyeR * 1.25)
      ctx.stroke()
    }
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath()
    ctx.ellipse(0, r * 0.3, r * 0.16, r * 0.22, 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(side * r * 0.16, eyeY - eyeR * 1.15)
      ctx.lineTo(side * r * 0.58, eyeY - eyeR * 1.55)
      ctx.stroke()
    }
    ctx.beginPath()
    if (kind === 'null') {
      ctx.arc(0, r * 0.32, r * 0.14, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.moveTo(-r * 0.3, r * 0.4)
      ctx.quadraticCurveTo(0, r * 0.18, r * 0.3, r * 0.4)
      ctx.stroke()
      // teeth
      ctx.fillStyle = '#fff'
      ctx.fillRect(-r * 0.14, r * 0.26, r * 0.1, r * 0.1)
      ctx.fillRect(r * 0.04, r * 0.26, r * 0.1, r * 0.1)
    }
  }
  ctx.restore()
}

/** Ammo cube at the origin (rotation already applied). */
export function drawCube(ctx: Ctx, type: AmmoType, size: number, opts: { t?: number; special?: boolean } = {}) {
  const info = AMMO[type]
  const s = size
  const x = -s / 2
  const y = -s / 2
  const rr = s * 0.2
  ctx.save()
  // drop shadow-ish darker base
  roundRectPath(ctx, x, y, s, s, rr)
  const g = ctx.createLinearGradient(x, y, x + s, y + s)
  g.addColorStop(0, info.color2)
  g.addColorStop(0.45, info.color)
  g.addColorStop(1, info.dark)
  ctx.fillStyle = g
  ctx.fill()
  // bevel highlight top-left
  ctx.save()
  roundRectPath(ctx, x, y, s, s, rr)
  ctx.clip()
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  roundRectPath(ctx, x + 3, y + 3, s - 6, s * 0.34, rr * 0.8)
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.fillRect(x, y + s - 7, s, 7)
  ctx.fillRect(x + s - 7, y, 7, s)
  ctx.restore()
  // glyph
  if (type === 'python') {
    drawSnake(ctx, s)
  } else if (type === 'js') {
    outlinedText(ctx, 'JS', 0, -s * 0.06, { font: `800 ${s * 0.46}px ${DISPLAY}`, fill: '#1d1a00', stroke: 'none' })
  } else {
    outlinedText(ctx, info.glyph, 0, -s * 0.06, {
      font: `800 ${type === 'sql' ? s * 0.36 : s * 0.42}px ${DISPLAY}`,
      fill: '#fff',
      stroke: 'rgba(0,0,0,0.45)',
      strokeWidth: 3,
    })
  }
  // label
  outlinedText(ctx, info.name, 0, s * 0.34, {
    font: `800 ${s * 0.19}px ${DISPLAY}`,
    fill: type === 'js' ? '#1d1a00' : '#fff',
    stroke: type === 'js' ? 'none' : 'rgba(0,0,0,0.5)',
    strokeWidth: 2,
  })
  // outline
  ctx.strokeStyle = info.dark
  ctx.lineWidth = 2.5
  roundRectPath(ctx, x, y, s, s, rr)
  ctx.stroke()
  if (opts.special) {
    const pulse = 0.5 + 0.5 * Math.sin((opts.t ?? 0) * 12)
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.5})`
    ctx.lineWidth = 3
    roundRectPath(ctx, x - 4, y - 4, s + 8, s + 8, rr + 3)
    ctx.stroke()
  }
  ctx.restore()
}

function drawSnake(ctx: Ctx, s: number) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(-s * 0.22, -s * 0.26)
    ctx.bezierCurveTo(s * 0.3, -s * 0.3, s * 0.3, -s * 0.02, -s * 0.05, -s * 0.03)
    ctx.bezierCurveTo(-s * 0.32, -s * 0.03, -s * 0.3, s * 0.22, s * 0.2, s * 0.2)
  }
  path()
  ctx.strokeStyle = '#1d3a5c'
  ctx.lineWidth = s * 0.19
  ctx.stroke()
  path()
  ctx.strokeStyle = '#ffd43b'
  ctx.lineWidth = s * 0.12
  ctx.stroke()
  // head + eye
  ctx.fillStyle = '#ffd43b'
  ctx.beginPath()
  ctx.arc(-s * 0.22, -s * 0.26, s * 0.09, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1d3a5c'
  ctx.beginPath()
  ctx.arc(-s * 0.25, -s * 0.28, s * 0.025, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Speed streaks behind a flying cube (python boost / sql drill / js sparks). */
export function drawCubeFx(ctx: Ctx, body: Matter.Body, d: BodyData, t: number) {
  const type = d.ammo as AmmoType
  const v = body.velocity
  const speed = Math.hypot(v.x, v.y)
  if (speed < 3) return
  const nx = v.x / speed
  const ny = v.y / speed
  ctx.save()
  ctx.translate(body.position.x, body.position.y)
  ctx.lineCap = 'round'
  if (type === 'sql' || (type === 'python' && d.boosted)) {
    const col = type === 'sql' ? 'rgba(200,120,255,' : 'rgba(255,212,59,'
    const len = Math.min(140, speed * 5)
    for (let i = -1; i <= 1; i++) {
      ctx.strokeStyle = `${col}${0.55 - Math.abs(i) * 0.2})`
      ctx.lineWidth = 5 - Math.abs(i) * 2
      ctx.beginPath()
      ctx.moveTo(-nx * 16 + ny * i * 11, -ny * 16 - nx * i * 11)
      ctx.lineTo(-nx * len + ny * i * 11, -ny * len - nx * i * 11)
      ctx.stroke()
    }
  }
  if (type === 'js' && !d.specialUsed) {
    ctx.strokeStyle = 'rgba(255,230,80,0.9)'
    ctx.lineWidth = 2.2
    for (let i = 0; i < 6; i++) {
      const a = t * 9 + (i * Math.PI) / 3
      const r0 = 30 + Math.sin(t * 20 + i) * 4
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
      ctx.lineTo(Math.cos(a) * (r0 + 9), Math.sin(a) * (r0 + 9))
      ctx.stroke()
    }
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* effects                                                             */
/* ------------------------------------------------------------------ */

export interface Ring {
  x: number
  y: number
  r: number
  maxR: number
  life: number
  maxLife: number
  color: string
  width: number
}

export function drawRings(ctx: Ctx, rings: Ring[]) {
  for (const r of rings) {
    const t = 1 - r.life / r.maxLife
    const e = 1 - Math.pow(1 - t, 3)
    ctx.globalAlpha = 1 - t
    ctx.strokeStyle = r.color
    ctx.lineWidth = r.width * (1 - t * 0.6)
    ctx.beginPath()
    ctx.arc(r.x, r.y, r.r + (r.maxR - r.r) * e, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

export interface Flash {
  x: number
  y: number
  r: number
  life: number
  maxLife: number
}

export function drawFlashes(ctx: Ctx, flashes: Flash[]) {
  for (const f of flashes) {
    const t = f.life / f.maxLife
    const rr = f.r * (1.4 - t * 0.5)
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rr)
    g.addColorStop(0, `rgba(255,255,230,${0.95 * t})`)
    g.addColorStop(0.35, `rgba(255,200,70,${0.85 * t})`)
    g.addColorStop(0.7, `rgba(255,120,30,${0.5 * t})`)
    g.addColorStop(1, 'rgba(255,90,20,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(f.x, f.y, rr, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Convenience for HUD-ish canvas labels. */
export function label(ctx: Ctx, text: string, x: number, y: number, size: number, fill = '#fff', stroke = 'rgba(20,40,70,0.85)') {
  outlinedText(ctx, text, x, y, { font: `800 ${size}px ${DISPLAY}`, fill, stroke, strokeWidth: Math.max(3, size * 0.22) })
}
