/**
 * Drawing of bins, ticket cards, the blade trail and banners.
 * Bins and cards are pre-rendered into small offscreen sprites (per size) so
 * the per-frame cost on a phone is a handful of drawImage calls.
 */
import { fillRoundRect, hexToRgba, outlinedText, roundRectPath, shade, strokeRoundRect, type Ctx } from '../../shared/draw'
import { clamp, easeOutBack } from '../../shared/math'
import { binDef } from './catalogue'
import { drawIcon } from './icons'
import { FONT_DISPLAY, FONT_UI } from './scene'
import type { Bin, Ticket, TicketDef, TrailPoint } from './types'

/** Padding around a bin sprite so its glow is not clipped. */
export const BIN_GLOW_PAD = 28
/** Padding around a card sprite (stroke + anti-aliasing). */
const CARD_PAD = 3

export const INK = '#15224a'
const INK_SOFT = '#4f5c7e'

/** Break `text` into at most `maxLines` lines that fit `maxW` with the current font. */
export function wrapLines(ctx: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w
    if (!cur || ctx.measureText(test).width <= maxW) cur = test
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = `${lines[maxLines - 1]}…`
  }
  return lines
}

function makeSprite(w: number, h: number, dpr: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * dpr))
  c.height = Math.max(1, Math.round(h * dpr))
  const ctx = c.getContext('2d')!
  ctx.scale(dpr, dpr)
  return [c, ctx]
}

/** Height of the open-top rim of a bin. */
export const binRim = (h: number) => Math.max(10, Math.round(h * 0.16))

// ---------------------------------------------------------------- bins

/** Static look of a bin: glowing open-top box, icon, label. */
export function renderBinSprite(bin: Bin, dpr: number, compact: boolean): HTMLCanvasElement {
  const { w, h } = bin
  const { color } = bin.def
  const P = BIN_GLOW_PAD
  const [c, ctx] = makeSprite(w + P * 2, h + P * 2, dpr)
  ctx.translate(P, P)
  const rim = binRim(h)
  const faceY = Math.round(rim * 0.55)
  const r = compact ? 7 : 9

  // outer glow (the shadow of a filled silhouette)
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = compact ? 14 : 22
  fillRoundRect(ctx, 0, faceY, w, h - faceY, r, color)
  ctx.restore()

  // front face
  const g = ctx.createLinearGradient(0, faceY, 0, h)
  g.addColorStop(0, shade(color, 0.18))
  g.addColorStop(0.45, color)
  g.addColorStop(1, shade(color, -0.45))
  fillRoundRect(ctx, 0, faceY, w, h - faceY, r, g)
  // glossy left highlight
  ctx.save()
  roundRectPath(ctx, 0, faceY, w, h - faceY, r)
  ctx.clip()
  const gloss = ctx.createLinearGradient(0, 0, w * 0.22, 0)
  gloss.addColorStop(0, 'rgba(255,255,255,0.3)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gloss
  ctx.fillRect(0, faceY, w * 0.22, h - faceY)
  // bottom shade
  const bottom = ctx.createLinearGradient(0, h * 0.7, 0, h)
  bottom.addColorStop(0, 'rgba(0,0,0,0)')
  bottom.addColorStop(1, 'rgba(0,0,0,0.3)')
  ctx.fillStyle = bottom
  ctx.fillRect(0, h * 0.7, w, h * 0.3)
  ctx.restore()
  strokeRoundRect(ctx, 0, faceY, w, h - faceY, r, hexToRgba(shade(color, 0.5), 0.9), 2)

  // open top: dark interior with a bright rim
  const inset = compact ? 3 : 5
  fillRoundRect(ctx, inset, 0, w - inset * 2, rim, r * 0.6, '#0a1230')
  const inner = ctx.createLinearGradient(0, 0, 0, rim)
  inner.addColorStop(0, 'rgba(0,0,0,0.55)')
  inner.addColorStop(1, hexToRgba(color, 0.25))
  fillRoundRect(ctx, inset, 0, w - inset * 2, rim, r * 0.6, inner)
  strokeRoundRect(ctx, inset, 0, w - inset * 2, rim, r * 0.6, shade(color, 0.55), compact ? 2 : 2.5)

  // icon
  const k = compact ? 1 : clamp(w / 150, 0.8, 1.3)
  const iconSize = compact ? w * 0.44 : Math.min(w * 0.36, h * 0.42)
  const bodyTop = rim
  const labelH = compact ? 13 : (bin.def.label.includes('\n') ? 36 : 24) * k
  const iconY = bodyTop + (h - bodyTop - labelH) * 0.5 + (compact ? 1 : 2)
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 2
  drawIcon(ctx, bin.def.icon, w / 2, iconY, iconSize, '#ffffff', shade(color, -0.1))
  ctx.restore()

  // label
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (compact) {
    ctx.font = `900 9.5px ${FONT_UI}`
    outlinedText(ctx, bin.def.short, w / 2, h - 8, { font: ctx.font, fill: '#fff', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 3 })
  } else {
    const lines = bin.def.label.split('\n')
    const fs = (lines.length > 1 ? 11 : 12.5) * k
    const ph = labelH - 4
    fillRoundRect(ctx, 6, h - ph - 6, w - 12, ph, 7 * k, 'rgba(8, 14, 40, 0.6)')
    ctx.font = `800 ${fs}px ${FONT_UI}`
    ctx.fillStyle = '#ffffff'
    const lh = fs * 1.15
    const y0 = h - 6 - ph / 2 - ((lines.length - 1) * lh) / 2
    lines.forEach((l, i) => ctx.fillText(l, w / 2, y0 + i * lh))
  }
  return c
}

/** Per-frame overlays on top of the cached bin sprite: drag pulse, hover, delivery flash. */
export function drawBinDynamic(ctx: Ctx, bin: Bin, time: number, dragging: boolean) {
  const rim = binRim(bin.h)
  const faceY = bin.y + Math.round(rim * 0.55)
  const faceH = bin.h - Math.round(rim * 0.55)
  const r = 9
  if (dragging) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 9)
    ctx.save()
    ctx.globalAlpha = 0.22 + 0.3 * pulse
    strokeRoundRect(ctx, bin.x - 1, faceY - 1, bin.w + 2, faceH + 2, r, shade(bin.def.color, 0.6), 3)
    ctx.globalAlpha = 0.1 * pulse
    fillRoundRect(ctx, bin.x, faceY, bin.w, faceH, r, '#ffffff')
    ctx.restore()
  }
  if (bin.hover > 0.01) {
    ctx.save()
    ctx.globalAlpha = 0.3 * bin.hover
    fillRoundRect(ctx, bin.x, faceY, bin.w, faceH, r, '#ffffff')
    ctx.globalAlpha = bin.hover
    strokeRoundRect(ctx, bin.x - 2, faceY - 2, bin.w + 4, faceH + 4, r + 1, '#ffffff', 3)
    ctx.restore()
  }
  if (bin.flash > 0.01) {
    const f = bin.flash
    ctx.save()
    ctx.globalAlpha = 0.75 * f
    fillRoundRect(ctx, bin.x, faceY, bin.w, faceH, r, bin.flashColor)
    const grow = (1 - f) * 18
    ctx.globalAlpha = f
    strokeRoundRect(ctx, bin.x - grow, bin.y - grow, bin.w + grow * 2, bin.h + grow * 2, r + grow, bin.flashColor, 3)
    ctx.restore()
  }
}

// ---------------------------------------------------------------- tickets

/** Static look of a ticket card (white/pastel) or a red P1 card. */
export function renderCardSprite(def: TicketDef, w: number, h: number, small: boolean, dpr: number): HTMLCanvasElement {
  const P = CARD_PAD
  const [c, ctx] = makeSprite(w + P * 2, h + P * 2, dpr)
  ctx.translate(P, P)
  const color = binDef(def.category).color
  const r = small ? 8 : 10
  if (def.p1) renderP1(ctx, def, w, h, small, r)
  else renderCard(ctx, def, w, h, small, r, color)
  return c
}

function renderCard(ctx: Ctx, def: TicketDef, w: number, h: number, small: boolean, r: number, color: string) {
  // everything is designed at 150×90 (118×72 on phones) and scaled with the card
  const k = w / (small ? 118 : 150)
  const edge = (small ? 6 : 8) * k
  const iconCol = (small ? 34 : 44) * k
  const pastel = shade(color, 0.86)
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(1, pastel)
  fillRoundRect(ctx, 0, 0, w, h, r, g)
  ctx.save()
  roundRectPath(ctx, 0, 0, w, h, r)
  ctx.clip()
  ctx.fillStyle = color
  ctx.fillRect(0, 0, edge, h)
  // hole-punch dots on the coloured edge (ticket stub feel)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.arc(edge / 2, h * (0.3 + i * 0.2), (small ? 1.2 : 1.6) * k, 0, Math.PI * 2)
    ctx.fill()
  }
  // faint rule lines like a form
  ctx.fillStyle = hexToRgba(color, 0.14)
  const ruleY = h - (small ? 12 : 16) * k
  ctx.fillRect(edge + (small ? 6 : 8) * k, ruleY, w * 0.35, 2 * k)
  ctx.fillRect(edge + (small ? 6 : 8) * k + w * 0.4, ruleY, w * 0.18, 2 * k)
  ctx.restore()
  strokeRoundRect(ctx, 0, 0, w, h, r, hexToRgba(color, 0.5), 1.5)
  // top highlight
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.fillRect(edge + r, 1, w - edge - r * 2, 1)

  // icon in a soft tinted circle
  const icx = edge + iconCol / 2 + 1
  const icy = h * 0.46
  const iconSize = (small ? 22 : 28) * k
  ctx.fillStyle = hexToRgba(color, 0.14)
  ctx.beginPath()
  ctx.arc(icx, icy, iconSize * 0.7, 0, Math.PI * 2)
  ctx.fill()
  drawIcon(ctx, binDef(def.category).icon, icx, icy, iconSize, color, '#ffffff')

  // title + problem
  const tx = edge + iconCol + (small ? 3 : 4) * k
  const maxW = w - tx - (small ? 6 : 8) * k
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const titleFs = (small ? 14 : 17) * k
  const probFs = (small ? 10 : 12) * k
  ctx.font = `700 ${probFs}px ${FONT_UI}`
  const lines = wrapLines(ctx, def.problem, maxW, 2)
  const blockH = titleFs * 1.05 + 2 + lines.length * probFs * 1.2
  let y = (h - (small ? 8 : 12) * k - blockH) / 2 + 1
  ctx.font = `800 ${titleFs}px ${FONT_DISPLAY}`
  ctx.fillStyle = INK
  ctx.fillText(def.title, tx, y)
  y += titleFs * 1.05 + 2
  ctx.font = `700 ${probFs}px ${FONT_UI}`
  ctx.fillStyle = INK_SOFT
  for (const l of lines) {
    ctx.fillText(l, tx, y)
    y += probFs * 1.2
  }
  // ticket number
  ctx.font = `800 ${(small ? 7.5 : 9) * k}px ${FONT_UI}`
  ctx.fillStyle = hexToRgba(INK, 0.4)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  const num = 1000 + ((def.title.length * 131 + def.problem.length * 977) % 8999)
  ctx.fillText(`#${num}`, w - (small ? 6 : 8) * k, h - (small ? 5 : 6) * k)
}

function renderP1(ctx: Ctx, def: TicketDef, w: number, h: number, small: boolean, r: number) {
  // designed at 1.15 × the regular card size and scaled with the card
  const k = w / ((small ? 118 : 150) * 1.15)
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#ff6b66')
  g.addColorStop(0.5, '#f0383c')
  g.addColorStop(1, '#c8191f')
  fillRoundRect(ctx, 0, 0, w, h, r, g)
  const band = (small ? 15 : 18) * k
  ctx.save()
  roundRectPath(ctx, 0, 0, w, h, r)
  ctx.clip()
  ctx.fillStyle = '#8c0b13'
  ctx.fillRect(0, 0, w, band)
  // hazard stripes at the right end of the ribbon
  ctx.fillStyle = 'rgba(255, 210, 60, 0.9)'
  for (let i = 0; i < 4; i++) {
    const x = w - 8 * k - i * 9 * k
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + 4 * k, 0)
    ctx.lineTo(x - 2 * k, band)
    ctx.lineTo(x - 6 * k, band)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  strokeRoundRect(ctx, 0, 0, w, h, r, 'rgba(255,255,255,0.55)', 1.5)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(r, 1, w - r * 2, 1)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = `900 ${(small ? 9.5 : 11) * k}px ${FONT_UI}`
  ctx.fillStyle = '#ffffff'
  ctx.fillText('P1  CRITICAL', 8 * k, band / 2 + 0.5)

  // bell
  const iconCol = (small ? 30 : 40) * k
  const icx = iconCol / 2 + 6 * k
  const icy = band + (h - band) / 2
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 1
  drawIcon(ctx, 'bell', icx, icy, (small ? 22 : 28) * k, '#ffffff', '#e03038')
  ctx.restore()

  // headline, up to two lines, vertically centred in the body
  const tx = iconCol + 8 * k
  const maxW = w - tx - 8 * k
  const fs = (small ? 12.5 : 15) * k
  ctx.font = `800 ${fs}px ${FONT_DISPLAY}`
  const lines = wrapLines(ctx, def.title, maxW, 2)
  const pillH = (small ? 12 : 14) * k
  const bodyTop = band
  const bodyH = h - band - pillH - 4 * k
  const lh = fs * 1.08
  let y = bodyTop + bodyH / 2 - ((lines.length - 1) * lh) / 2
  ctx.textBaseline = 'middle'
  for (const l of lines) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(120, 0, 10, 0.55)'
    ctx.strokeText(l, tx, y)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(l, tx, y)
    y += lh
  }
  // category pill bottom-right
  const label = binDef(def.category).short
  ctx.font = `900 ${(small ? 8 : 9.5) * k}px ${FONT_UI}`
  const pw = ctx.measureText(label).width + 12 * k
  fillRoundRect(ctx, w - pw - 6 * k, h - pillH - 5 * k, pw, pillH, pillH / 2, 'rgba(255,255,255,0.28)')
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, w - pw / 2 - 6 * k, h - pillH / 2 - 5 * k + 0.5)
}

/** Draw a ticket (shadow, optional P1 glow + ring, rotated card sprite). */
export function drawTicket(ctx: Ctx, t: Ticket, sprite: HTMLCanvasElement, time: number, p1Seconds: number) {
  const { x, y, w, h, rot } = t
  const lift = t.lift
  const scale = 1 + 0.08 * lift + (t.def.p1 ? 0.025 * Math.sin(time * 7) : 0)
  const P = CARD_PAD

  if (t.def.p1) {
    // pulsing red glow
    const pulse = 0.5 + 0.5 * Math.sin(time * 7)
    const gr = Math.max(w, h) * (0.8 + 0.1 * pulse)
    const g = ctx.createRadialGradient(x, y, w * 0.25, x, y, gr)
    g.addColorStop(0, `rgba(255, 60, 60, ${0.35 + 0.25 * pulse})`)
    g.addColorStop(1, 'rgba(255, 40, 40, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, gr, 0, Math.PI * 2)
    ctx.fill()
  }

  // drop shadow (offset, no blur – cheap on phones)
  ctx.save()
  ctx.translate(x + 4 + 6 * lift, y + 7 + 10 * lift)
  ctx.rotate(rot)
  ctx.scale(scale, scale)
  ctx.fillStyle = `rgba(0, 0, 0, ${0.28 - 0.08 * lift})`
  roundRectPath(ctx, -w / 2, -h / 2, w, h, 10)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.scale(scale, scale)
  ctx.drawImage(sprite, -w / 2 - P, -h / 2 - P, w + P * 2, h + P * 2)
  ctx.restore()

  if (t.def.p1) {
    // SLA timer ring (world space, not rotated with the card)
    const R = Math.hypot(w, h) / 2 + 9
    const frac = clamp(t.timer / p1Seconds, 0, 1)
    ctx.save()
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'
    ctx.beginPath()
    ctx.arc(x, y, R, 0, Math.PI * 2)
    ctx.stroke()
    const urgent = t.arrived && t.timer < 1.6 && Math.sin(time * 18) > 0
    ctx.strokeStyle = urgent ? '#ffffff' : frac > 0.4 ? '#ff3b3b' : '#ffb020'
    ctx.beginPath()
    ctx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac)
    ctx.stroke()
    // seconds left
    if (t.arrived) {
      outlinedText(ctx, `${Math.ceil(t.timer)}s`, x, y - R - 12, {
        font: `800 15px ${FONT_DISPLAY}`,
        fill: urgent ? '#ffffff' : '#ffb0b0',
        stroke: 'rgba(60,0,0,0.7)',
        strokeWidth: 4,
      })
    }
    ctx.restore()
  }
}

// ---------------------------------------------------------------- blade trail

/**
 * Fruit-Ninja style blade: a tapered ribbon (one polygon per pass, so there are
 * no overlapping joints under additive blending), widest and brightest at the
 * newest point, with a soft blue glow underneath.
 */
const HALF_WIDTHS = new Float32Array(64)

export function drawTrail(ctx: Ctx, points: TrailPoint[], now: number, life: number, maxW: number) {
  // the engine caps trails well below 64 points; slice (rarely) keeps the newest ones
  const pts = points.length > HALF_WIDTHS.length ? points.slice(-HALF_WIDTHS.length) : points
  const n = pts.length
  if (n < 2) return
  // half-widths per point: taper with age, and a round tip at the newest point
  const half = HALF_WIDTHS
  let visible = 0
  for (let i = 0; i < n; i++) {
    const a = clamp(1 - (now - pts[i].t) / life, 0, 1)
    half[i] = (maxW / 2) * (0.1 + 0.9 * a)
    if (a > 0) visible++
  }
  if (visible < 2) return
  const ribbon = (scale: number) => {
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[Math.min(n - 1, i + 1)]
      let dx = p1.x - p0.x
      let dy = p1.y - p0.y
      const len = Math.hypot(dx, dy) || 1
      dx /= len
      dy /= len
      const w = half[i] * scale
      const x = pts[i].x - dy * w
      const y = pts[i].y + dx * w
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    for (let i = n - 1; i >= 0; i--) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[Math.min(n - 1, i + 1)]
      let dx = p1.x - p0.x
      let dy = p1.y - p0.y
      const len = Math.hypot(dx, dy) || 1
      dx /= len
      dy /= len
      const w = half[i] * scale
      ctx.lineTo(pts[i].x + dy * w, pts[i].y - dx * w)
    }
    ctx.closePath()
    ctx.fill()
    // round tip at the newest point
    const tip = pts[n - 1]
    ctx.beginPath()
    ctx.arc(tip.x, tip.y, half[n - 1] * scale, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = 'rgba(80, 160, 255, 0.4)'
  ribbon(2.6)
  ctx.fillStyle = 'rgba(190, 225, 255, 0.55)'
  ribbon(1.5)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ribbon(1)
  ctx.restore()
}

// ---------------------------------------------------------------- banner

export function drawBanner(ctx: Ctx, text: string, color: string, x: number, y: number, t: number, life: number, size: number) {
  const k = clamp(t / 0.25, 0, 1)
  const scale = easeOutBack(k)
  const alpha = t > life - 0.35 ? clamp((life - t) / 0.35, 0, 1) : 1
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  outlinedText(ctx, text, 0, 0, {
    font: `800 ${size}px ${FONT_DISPLAY}`,
    fill: color,
    stroke: 'rgba(0,0,0,0.75)',
    strokeWidth: Math.max(5, size * 0.16),
  })
  ctx.restore()
}
