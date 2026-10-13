/**
 * Vector glyphs, defined once as SVG path data on a 24×24 grid and used twice:
 * on the canvas (Path2D) for the alert badges and stations, and in the HTML HUD
 * (Glyph.tsx). No emoji, no images.
 */
import type { ActionKind, AlertType, PipeKind } from './types'

export type GlyphName =
  | 'heat'
  | 'wrench'
  | 'plug'
  | 'wifi'
  | 'wifiOff'
  | 'bolt'
  | 'chevrons'
  | 'snow'
  | 'cross'
  | 'check'
  | 'power'
  | 'person'
  | 'slow'
  | 'bug'
  | 'skull'
  | 'chat'
  | 'thumb'

export interface GlyphPart {
  d: string
  fill?: boolean
}

/** Six-armed snowflake, generated so every arm is identical. */
function snowPath(): string {
  const parts: string[] = []
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 - Math.PI / 2
    const p = (r: number, da = 0) => `${(12 + Math.cos(a + da) * r).toFixed(2)} ${(12 + Math.sin(a + da) * r).toFixed(2)}`
    parts.push(`M12 12L${p(10.2)}`)
    parts.push(`M${p(8.8, 0.36)}L${p(5.8)}L${p(8.8, -0.36)}`)
  }
  return parts.join('')
}

const WIFI = 'M2.6 9.2a13.6 13.6 0 0 1 18.8 0M6 12.8a8.8 8.8 0 0 1 12 0M9.3 16.3a4.2 4.2 0 0 1 5.4 0'

export const GLYPHS: Record<GlyphName, GlyphPart[]> = {
  heat: [{ d: 'M7 20.5c-2.2-3 2.2-5.2 0-8.2s2.2-5.2 0-8.2M12 20.5c-2.2-3 2.2-5.2 0-8.2s2.2-5.2 0-8.2M17 20.5c-2.2-3 2.2-5.2 0-8.2s2.2-5.2 0-8.2' }],
  wrench: [{ d: 'M14.6 3.6a5 5 0 0 0-4.7 6.7L3.6 16.6V20.4h3.8l6.3-6.3a5 5 0 0 0 6.7-4.7l-3 3-2.8-.7-.7-2.8z', fill: true }],
  plug: [{ d: 'M9 2.5v5.2M15 2.5v5.2M12 17.6v4' }, { d: 'M6 7.7h12v3.9a6 6 0 0 1-12 0z', fill: true }],
  wifi: [{ d: WIFI }, { d: 'M12 18.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', fill: true }],
  wifiOff: [{ d: WIFI }, { d: 'M12 18.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', fill: true }, { d: 'M16.6 16.4l5 5M21.6 16.4l-5 5' }],
  bolt: [{ d: 'M13.6 1.8 4.6 13.4h5.9L9.2 22.2l10.2-12.6h-6.3z', fill: true }],
  chevrons: [{ d: 'M5 12.6l7-7 7 7M5 19.6l7-7 7 7' }],
  snow: [{ d: snowPath() }],
  cross: [{ d: 'M5.5 5.5l13 13M18.5 5.5l-13 13' }],
  check: [{ d: 'M4.8 12.6l4.8 4.8L19.4 7.2' }],
  power: [{ d: 'M12 3.2v8.4M6.6 6.8a7.8 7.8 0 1 0 10.8 0' }],
  // a visitor: head and shoulders
  person: [{ d: 'M12 3.4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', fill: true }, { d: 'M4 21c0-4.6 3.6-7.6 8-7.6s8 3 8 7.6z', fill: true }],
  // a snail – the rack is "crawling"
  slow: [
    { d: 'M2.6 18.6h18.2M3.4 18.6v-3.3a2.1 2.1 0 0 1 4.2 0M4.6 13.3 3.4 10.2M6.4 13.3l1.1-3.1M14.6 12.4a.9.9 0 0 0-.9.9 1.9 1.9 0 0 0 1.9 1.9 2.9 2.9 0 0 0 2.9-2.9 3.9 3.9 0 0 0-3.9-3.9' },
    { d: 'M14.5 6.4a6.1 6.1 0 1 0 0 12.2 6.1 6.1 0 0 0 0-12.2z' },
  ],
  // the virus: a little beetle
  bug: [
    { d: 'M12 8.2c-3 0-5 2.6-5 6s2 6 5 6 5-2.6 5-6-2-6-5-6zM12 8.6v11.4M7 12.2 3.4 10.4M7 15h-3.8M7.6 18.2 4.4 20.4M17 12.2l3.6-1.8M17 15h3.8M16.4 18.2l3.2 2.2M10.4 5 8.8 2.6M13.6 5l1.6-2.4' },
    { d: 'M12 3.6a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8z', fill: true },
  ],
  // malware on a rack
  skull: [
    { d: 'M12 3.3c-4.6 0-8 3.1-8 7.5 0 2.6 1.2 4.4 3 5.4v3.6h10v-3.6c1.8-1 3-2.8 3-5.4 0-4.4-3.4-7.5-8-7.5zM10 17.2v2.4M14 17.2v2.4' },
    { d: 'M9 9.2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM15 9.2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 13.8l-1.2 2h2.4z', fill: true },
  ],
  // TALK
  chat: [
    { d: 'M4.4 4.8h15.2c1 0 1.8.8 1.8 1.8v9c0 1-.8 1.8-1.8 1.8h-8.4l-4.8 3.6v-3.6h-2c-1 0-1.8-.8-1.8-1.8v-9c0-1 .8-1.8 1.8-1.8z' },
    { d: 'M8 9.8a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zM12 9.8a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zM16 9.8a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z', fill: true },
  ],
  thumb: [{ d: 'M3 10.6h3.6v9.8H3zM8.2 10.6l3.4-6.2c.5-.9 1.4-1.3 2.3-1 1 .4 1.5 1.4 1.2 2.4l-1 3.6h5.2c1.3 0 2.2 1.2 2 2.4l-1.3 6.6c-.2 1.1-1.2 2-2.3 2H8.2z', fill: true }],
}

export const ALERT_GLYPH: Record<AlertType, GlyphName> = {
  heat: 'heat',
  fan: 'wrench',
  psu: 'plug',
  net: 'wifiOff',
  power: 'bolt',
  upgrade: 'chevrons',
  down: 'cross',
  // the slow rack carries the snail; the objective row shows the person (OBJECTIVE_GLYPH)
  customer: 'slow',
  infected: 'skull',
  virus: 'bug',
}

/** Icon of an objective row (the customer row shows who is waiting, not the rack's symptom). */
export const OBJECTIVE_GLYPH: Record<AlertType, GlyphName> = { ...ALERT_GLYPH, customer: 'person' }

export const COLORS = {
  cooling: '#1ec8ff',
  power: '#ffb020',
  network: '#39ff7a',
  alert: '#ff2d3a',
  ok: '#39ff7a',
  upgrade: '#39ff7a',
  warn: '#ffb020',
  off: '#59606e',
  ficolo: '#e8102a',
  customer: '#ff6ec7',
  virus: '#b04dff',
  /** The virus' acid-green highlights. */
  toxic: '#b4ff39',
} as const

export const PIPE_COLOR: Record<PipeKind, string> = { cooling: COLORS.cooling, power: COLORS.power, network: COLORS.network }

export const ALERT_COLOR: Record<AlertType, string> = {
  heat: COLORS.alert,
  fan: COLORS.alert,
  psu: COLORS.alert,
  net: COLORS.alert,
  power: COLORS.power,
  upgrade: COLORS.upgrade,
  down: COLORS.alert,
  customer: COLORS.customer,
  infected: COLORS.virus,
  virus: COLORS.virus,
}

export const ACTION_GLYPH: Record<ActionKind, GlyphName> = { cool: 'snow', repair: 'wrench', upgrade: 'chevrons' }

const cache = new Map<string, Path2D>()

function pathOf(d: string): Path2D {
  let p = cache.get(d)
  if (!p) {
    p = new Path2D(d)
    cache.set(d, p)
  }
  return p
}

function paintGlyph(ctx: CanvasRenderingContext2D, name: GlyphName, cx: number, cy: number, size: number, color: string, weight: number, blur: number) {
  const s = size / 24
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(s, s)
  ctx.lineWidth = weight
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  if (blur > 0) {
    ctx.shadowColor = color
    ctx.shadowBlur = blur
  }
  for (const part of GLYPHS[name]) {
    const p = pathOf(part.d)
    if (part.fill) ctx.fill(p)
    else ctx.stroke(p)
  }
  ctx.restore()
}

/**
 * Canvas shadows are by far the most expensive thing a 2D context can do every
 * frame, so glowing glyphs are rendered once into small sprites and blitted.
 */
const SPRITE = 96
const SPRITE_GLYPH = 52
const sprites = new Map<string, HTMLCanvasElement>()

function glowSprite(name: GlyphName, color: string, weight: number): HTMLCanvasElement {
  const key = `${name}|${color}|${weight}`
  let c = sprites.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = SPRITE
  c.height = SPRITE
  const g = c.getContext('2d')
  if (g) {
    paintGlyph(g, name, SPRITE / 2, SPRITE / 2, SPRITE_GLYPH, color, weight, 16)
    paintGlyph(g, name, SPRITE / 2, SPRITE / 2, SPRITE_GLYPH, color, weight, 0)
  }
  sprites.set(key, c)
  return c
}

/**
 * Draws a glyph centred on (cx, cy) with the given pixel size.
 * `glow` switches to the pre-rendered neon version; `weight` is the stroke
 * width on the 24-unit grid.
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  name: GlyphName,
  cx: number,
  cy: number,
  size: number,
  color: string,
  glow = false,
  weight = 2.4,
) {
  if (glow) {
    const d = (size * SPRITE) / SPRITE_GLYPH
    ctx.drawImage(glowSprite(name, color, weight), cx - d / 2, cy - d / 2, d, d)
    return
  }
  paintGlyph(ctx, name, cx, cy, size, color, weight, 0)
}

/** The Ficolo-themed cube mark (a plain isometric cube – not a real logo). */
export function drawCube(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const s = size / 24
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(s, s)
  const face = (pts: number[], fill: string) => {
    ctx.beginPath()
    ctx.moveTo(pts[0], pts[1])
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }
  face([12, 2, 21, 7, 12, 12, 3, 7], '#ff4a5c')
  face([3, 7, 12, 12, 12, 22, 3, 17], '#e8102a')
  face([21, 7, 12, 12, 12, 22, 21, 17], '#a50b1d')
  ctx.restore()
}
