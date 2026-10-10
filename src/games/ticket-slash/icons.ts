/**
 * Vector icons drawn with canvas paths (no images, no emoji). Every icon is
 * drawn centred on (cx, cy) inside a `size`×`size` box, in a single colour.
 * `bg` is used by the "people" icon to separate overlapping silhouettes.
 */
import { roundRectPath, type Ctx } from '../../shared/draw'
import type { IconName } from './types'

type IconFn = (ctx: Ctx, s: number, color: string, bg: string) => void

function setup(ctx: Ctx, s: number, color: string) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(1.5, s * 0.11)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

const globe: IconFn = (ctx, s, color) => {
  setup(ctx, s, color)
  const r = s * 0.46
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(0, 0, r * 0.42, r, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-r, 0)
  ctx.lineTo(r, 0)
  ctx.stroke()
  // two latitude chords
  const ly = r * 0.5
  const lx = Math.sqrt(r * r - ly * ly)
  ctx.beginPath()
  ctx.moveTo(-lx, -ly)
  ctx.lineTo(lx, -ly)
  ctx.moveTo(-lx, ly)
  ctx.lineTo(lx, ly)
  ctx.stroke()
}

const envelope: IconFn = (ctx, s, color) => {
  setup(ctx, s, color)
  const w = s * 0.92
  const h = s * 0.64
  const r = s * 0.1
  ctx.beginPath()
  ctx.moveTo(-w / 2 + r, -h / 2)
  ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r)
  ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r)
  ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r)
  ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r)
  ctx.closePath()
  ctx.stroke()
  // flap
  ctx.beginPath()
  ctx.moveTo(-w / 2 + s * 0.04, -h / 2 + s * 0.06)
  ctx.lineTo(0, s * 0.08)
  ctx.lineTo(w / 2 - s * 0.04, -h / 2 + s * 0.06)
  ctx.stroke()
}

const shield: IconFn = (ctx, s, color) => {
  setup(ctx, s, color)
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.48)
  ctx.lineTo(s * 0.4, -s * 0.32)
  ctx.lineTo(s * 0.4, s * 0.02)
  ctx.quadraticCurveTo(s * 0.4, s * 0.3, 0, s * 0.48)
  ctx.quadraticCurveTo(-s * 0.4, s * 0.3, -s * 0.4, s * 0.02)
  ctx.lineTo(-s * 0.4, -s * 0.32)
  ctx.closePath()
  ctx.stroke()
  // lock inside
  ctx.lineWidth = Math.max(1.2, s * 0.07)
  ctx.beginPath()
  ctx.arc(0, -s * 0.06, s * 0.1, Math.PI, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.rect(-s * 0.15, -s * 0.06, s * 0.3, s * 0.22)
  ctx.fill()
}

const printer: IconFn = (ctx, s, color, bg) => {
  setup(ctx, s, color)
  const lw = ctx.lineWidth
  // body
  roundRectPath(ctx, -s * 0.48, -s * 0.16, s * 0.96, s * 0.42, s * 0.08)
  ctx.stroke()
  // paper (top, fed in)
  ctx.beginPath()
  ctx.rect(-s * 0.28, -s * 0.46, s * 0.56, s * 0.3)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.stroke()
  // paper (bottom, coming out)
  ctx.beginPath()
  ctx.rect(-s * 0.28, s * 0.1, s * 0.56, s * 0.36)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.stroke()
  // text lines on the output page
  ctx.lineWidth = lw * 0.55
  ctx.beginPath()
  ctx.moveTo(-s * 0.16, s * 0.24)
  ctx.lineTo(s * 0.16, s * 0.24)
  ctx.moveTo(-s * 0.16, s * 0.34)
  ctx.lineTo(s * 0.08, s * 0.34)
  ctx.stroke()
  // status LED
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(s * 0.34, -s * 0.03, s * 0.05, 0, Math.PI * 2)
  ctx.fill()
}

const database: IconFn = (ctx, s, color) => {
  setup(ctx, s, color)
  const rx = s * 0.38
  const ry = s * 0.13
  const top = -s * 0.32
  const bottom = s * 0.32
  ctx.beginPath()
  ctx.ellipse(0, top, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-rx, top)
  ctx.lineTo(-rx, bottom)
  ctx.moveTo(rx, top)
  ctx.lineTo(rx, bottom)
  ctx.stroke()
  for (const y of [0, bottom]) {
    ctx.beginPath()
    ctx.ellipse(0, y, rx, ry, 0, 0, Math.PI)
    ctx.stroke()
  }
}

function person(ctx: Ctx, x: number, y: number, s: number, color: string, bg: string, outline: boolean) {
  const head = s * 0.15
  const bodyR = s * 0.26
  ctx.fillStyle = color
  if (outline) {
    ctx.strokeStyle = bg
    ctx.lineWidth = s * 0.09
    ctx.beginPath()
    ctx.arc(x, y - s * 0.17, head, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y + s * 0.3, bodyR, Math.PI, Math.PI * 2)
    ctx.closePath()
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(x, y - s * 0.17, head, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y + s * 0.3, bodyR, Math.PI, Math.PI * 2)
  ctx.closePath()
  ctx.fill()
}

const people: IconFn = (ctx, s, color, bg) => {
  setup(ctx, s, color)
  ctx.save()
  ctx.globalAlpha = 0.8
  person(ctx, -s * 0.3, s * 0.02, s * 0.8, color, bg, false)
  person(ctx, s * 0.3, s * 0.02, s * 0.8, color, bg, false)
  ctx.restore()
  person(ctx, 0, 0, s, color, bg, true)
}

const bell: IconFn = (ctx, s, color) => {
  setup(ctx, s, color)
  ctx.beginPath()
  ctx.arc(0, -s * 0.06, s * 0.3, Math.PI, Math.PI * 2)
  ctx.lineTo(s * 0.3, s * 0.2)
  ctx.quadraticCurveTo(s * 0.44, s * 0.3, s * 0.44, s * 0.32)
  ctx.lineTo(-s * 0.44, s * 0.32)
  ctx.quadraticCurveTo(-s * 0.44, s * 0.3, -s * 0.3, s * 0.2)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, s * 0.42, s * 0.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, -s * 0.4, s * 0.07, 0, Math.PI * 2)
  ctx.fill()
  // ringing marks
  ctx.lineWidth = Math.max(1.2, s * 0.07)
  ctx.beginPath()
  ctx.arc(0, -s * 0.06, s * 0.44, Math.PI * 1.15, Math.PI * 1.4)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, -s * 0.06, s * 0.44, Math.PI * 1.6, Math.PI * 1.85)
  ctx.stroke()
}

const ICONS: Record<IconName, IconFn> = { globe, envelope, shield, printer, database, people, bell }

export function drawIcon(ctx: Ctx, name: IconName, cx: number, cy: number, size: number, color: string, bg = '#0f1b3d') {
  ctx.save()
  ctx.translate(cx, cy)
  ICONS[name](ctx, size, color, bg)
  ctx.restore()
}

/** The "Topteam IT" cloud glyph: a white cloud with a blue cloud peeking out behind it. */
export function drawCloud(ctx: Ctx, cx: number, cy: number, size: number, front = '#ffffff', back = '#2f80ff') {
  const cloud = (ox: number, oy: number, s: number, color: string) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(ox - s * 0.28, oy + s * 0.08, s * 0.22, 0, Math.PI * 2)
    ctx.arc(ox - s * 0.04, oy - s * 0.12, s * 0.3, 0, Math.PI * 2)
    ctx.arc(ox + s * 0.26, oy + 0.02 * s, s * 0.24, 0, Math.PI * 2)
    ctx.rect(ox - s * 0.28, oy + s * 0.02, s * 0.54, s * 0.28)
    ctx.fill()
  }
  ctx.save()
  ctx.translate(cx, cy)
  cloud(size * 0.16, -size * 0.14, size * 0.9, back)
  cloud(0, 0, size, front)
  ctx.restore()
}
