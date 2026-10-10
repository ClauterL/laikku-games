/**
 * Vector glyphs for Network Connect, drawn with canvas paths only (no images,
 * no emoji). Every glyph is drawn centred on (cx, cy) inside a box of `s` px.
 */
import { fillRoundRect, roundRectPath, shade, strokeRoundRect, type Ctx } from '../../shared/draw'

export type GlyphKind =
  | 'user'
  | 'cloud'
  | 'switch'
  | 'firewall'
  | 'server'
  | 'loss'
  | 'broken'
  | 'lock'
  | 'reroute'
  | 'boost'
  | 'check'
  | 'star'
  | 'shield'
  | 'bricks'

export const BRICK = {
  base: '#7a3312',
  mortar: '#5a2410',
  bricks: ['#c25a2b', '#b7522a', '#cf6632', '#ad4b24'],
  highlight: 'rgba(255,255,255,0.14)',
} as const

/** Brick pattern clipped to a rounded rect – the firewall tiles and the firewall glyph. */
export function drawBricks(ctx: Ctx, x: number, y: number, w: number, h: number, radius: number, rows = 4) {
  ctx.save()
  roundRectPath(ctx, x, y, w, h, radius)
  ctx.clip()
  ctx.fillStyle = BRICK.mortar
  ctx.fillRect(x, y, w, h)
  const bh = h / rows
  const bw = bh * 1.9
  const gap = Math.max(1, Math.min(3, bh * 0.14))
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : -bw / 2
    for (let bx = x + offset; bx < x + w; bx += bw) {
      const col = BRICK.bricks[(row * 3 + Math.round((bx - x) / bw)) % BRICK.bricks.length]
      const by = y + row * bh
      ctx.fillStyle = col
      ctx.fillRect(bx + gap / 2, by + gap / 2, bw - gap, bh - gap)
      ctx.fillStyle = BRICK.highlight
      ctx.fillRect(bx + gap / 2, by + gap / 2, bw - gap, Math.max(1, bh * 0.16))
    }
  }
  ctx.restore()
}

function bolt(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.beginPath()
  ctx.moveTo(cx + 0.12 * s, cy - 0.5 * s)
  ctx.lineTo(cx - 0.3 * s, cy + 0.08 * s)
  ctx.lineTo(cx - 0.04 * s, cy + 0.08 * s)
  ctx.lineTo(cx - 0.14 * s, cy + 0.5 * s)
  ctx.lineTo(cx + 0.3 * s, cy - 0.1 * s)
  ctx.lineTo(cx + 0.04 * s, cy - 0.1 * s)
  ctx.closePath()
}

function shieldPath(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.beginPath()
  ctx.moveTo(cx - 0.36 * s, cy - 0.36 * s)
  ctx.lineTo(cx + 0.36 * s, cy - 0.36 * s)
  ctx.lineTo(cx + 0.36 * s, cy + 0.02 * s)
  ctx.quadraticCurveTo(cx + 0.34 * s, cy + 0.34 * s, cx, cy + 0.5 * s)
  ctx.quadraticCurveTo(cx - 0.34 * s, cy + 0.34 * s, cx - 0.36 * s, cy + 0.02 * s)
  ctx.closePath()
}

function arrowArc(ctx: Ctx, cx: number, cy: number, r: number, from: number, to: number, lw: number) {
  ctx.beginPath()
  ctx.arc(cx, cy, r, from, to)
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.stroke()
  // arrow head at the end of the arc, tangent direction
  const ex = cx + Math.cos(to) * r
  const ey = cy + Math.sin(to) * r
  const tx = -Math.sin(to)
  const ty = Math.cos(to)
  const nx = Math.cos(to)
  const ny = Math.sin(to)
  const h = lw * 1.9
  ctx.beginPath()
  ctx.moveTo(ex + tx * h, ey + ty * h)
  ctx.lineTo(ex + nx * h * 0.9, ey + ny * h * 0.9)
  ctx.lineTo(ex - nx * h * 0.9, ey - ny * h * 0.9)
  ctx.closePath()
  ctx.fill()
}

/**
 * Draw one glyph. `color` is the main ink (usually white), `accent` the
 * secondary colour used for inner details (usually the node colour).
 */
export function drawGlyph(ctx: Ctx, kind: GlyphKind, cx: number, cy: number, s: number, color = '#ffffff', accent = '#2fa8ff') {
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  switch (kind) {
    case 'user': {
      ctx.beginPath()
      ctx.arc(cx, cy - 0.2 * s, 0.19 * s, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(cx - 0.38 * s, cy + 0.46 * s)
      ctx.arc(cx, cy + 0.44 * s, 0.38 * s, Math.PI, Math.PI * 2)
      ctx.lineTo(cx + 0.38 * s, cy + 0.46 * s)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'cloud': {
      ctx.beginPath()
      ctx.arc(cx - 0.27 * s, cy + 0.08 * s, 0.2 * s, 0, Math.PI * 2)
      ctx.arc(cx - 0.04 * s, cy - 0.1 * s, 0.27 * s, 0, Math.PI * 2)
      ctx.arc(cx + 0.25 * s, cy + 0.04 * s, 0.21 * s, 0, Math.PI * 2)
      ctx.fill()
      roundRectPath(ctx, cx - 0.3 * s, cy + 0.02 * s, 0.6 * s, 0.26 * s, 0.1 * s)
      ctx.fill()
      break
    }
    case 'switch': {
      fillRoundRect(ctx, cx - 0.46 * s, cy - 0.3 * s, 0.92 * s, 0.6 * s, 0.1 * s, color)
      ctx.fillStyle = accent
      fillRoundRect(ctx, cx - 0.34 * s, cy - 0.17 * s, 0.68 * s, 0.09 * s, 0.04 * s, accent)
      for (const dx of [-0.24, 0, 0.24]) {
        ctx.beginPath()
        ctx.arc(cx + dx * s, cy + 0.1 * s, 0.075 * s, 0, Math.PI * 2)
        ctx.fill()
      }
      // small uplink arrows on top
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(cx - 0.16 * s, cy - 0.3 * s)
      ctx.lineTo(cx - 0.08 * s, cy - 0.42 * s)
      ctx.lineTo(cx, cy - 0.3 * s)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(cx + 0.02 * s, cy - 0.3 * s)
      ctx.lineTo(cx + 0.1 * s, cy - 0.42 * s)
      ctx.lineTo(cx + 0.18 * s, cy - 0.3 * s)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'firewall': {
      drawBricks(ctx, cx - 0.46 * s, cy - 0.4 * s, 0.92 * s, 0.8 * s, 0.08 * s, 3)
      strokeRoundRect(ctx, cx - 0.46 * s, cy - 0.4 * s, 0.92 * s, 0.8 * s, 0.08 * s, 'rgba(255,255,255,0.7)', Math.max(1, s * 0.05))
      const sx = cx + 0.24 * s
      const sy = cy + 0.16 * s
      shieldPath(ctx, sx, sy, 0.6 * s)
      ctx.fillStyle = '#5fc4ff'
      ctx.fill()
      ctx.lineWidth = Math.max(1, s * 0.05)
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(sx - 0.1 * s, sy)
      ctx.lineTo(sx - 0.02 * s, sy + 0.09 * s)
      ctx.lineTo(sx + 0.12 * s, sy - 0.1 * s)
      ctx.lineWidth = Math.max(1.2, s * 0.07)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
      break
    }
    case 'server': {
      fillRoundRect(ctx, cx - 0.38 * s, cy - 0.46 * s, 0.76 * s, 0.92 * s, 0.09 * s, color)
      for (let k = 0; k < 3; k++) {
        const y = cy - 0.36 * s + k * 0.29 * s
        fillRoundRect(ctx, cx - 0.3 * s, y, 0.6 * s, 0.2 * s, 0.05 * s, accent)
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(cx + 0.2 * s, y + 0.1 * s, 0.045 * s, 0, Math.PI * 2)
        ctx.fill()
        fillRoundRect(ctx, cx - 0.24 * s, y + 0.07 * s, 0.26 * s, 0.06 * s, 0.03 * s, 'rgba(255,255,255,0.75)')
      }
      break
    }
    case 'loss': {
      ctx.beginPath()
      ctx.arc(cx, cy, 0.36 * s, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,74,74,0.14)'
      ctx.fill()
      ctx.lineWidth = Math.max(1.5, s * 0.09)
      ctx.strokeStyle = color
      ctx.stroke()
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(cx - 0.16 * s, cy - 0.16 * s)
      ctx.lineTo(cx + 0.16 * s, cy + 0.16 * s)
      ctx.moveTo(cx + 0.16 * s, cy - 0.16 * s)
      ctx.lineTo(cx - 0.16 * s, cy + 0.16 * s)
      ctx.stroke()
      break
    }
    case 'broken':
    case 'boost': {
      bolt(ctx, cx, cy, s)
      ctx.fill()
      break
    }
    case 'lock': {
      ctx.lineWidth = Math.max(1.5, s * 0.1)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(cx, cy - 0.1 * s, 0.21 * s, Math.PI, Math.PI * 2)
      ctx.stroke()
      fillRoundRect(ctx, cx - 0.32 * s, cy - 0.1 * s, 0.64 * s, 0.5 * s, 0.09 * s, color)
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(cx, cy + 0.1 * s, 0.07 * s, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(cx - 0.03 * s, cy + 0.1 * s, 0.06 * s, 0.14 * s)
      break
    }
    case 'reroute': {
      const lw = Math.max(1.5, s * 0.11)
      arrowArc(ctx, cx, cy, 0.33 * s, Math.PI * 1.15, Math.PI * 1.85, lw)
      arrowArc(ctx, cx, cy, 0.33 * s, Math.PI * 0.15, Math.PI * 0.85, lw)
      break
    }
    case 'check': {
      ctx.beginPath()
      ctx.arc(cx, cy, 0.5 * s, 0, Math.PI * 2)
      ctx.fillStyle = accent
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(2, s * 0.13)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(cx - 0.22 * s, cy + 0.02 * s)
      ctx.lineTo(cx - 0.06 * s, cy + 0.18 * s)
      ctx.lineTo(cx + 0.24 * s, cy - 0.18 * s)
      ctx.stroke()
      break
    }
    case 'star': {
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const rr = i % 2 === 0 ? 0.5 * s : 0.22 * s
        const px = cx + Math.cos(a) * rr
        const py = cy + Math.sin(a) * rr
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'shield': {
      shieldPath(ctx, cx, cy, s)
      ctx.fill()
      break
    }
    case 'bricks': {
      drawBricks(ctx, cx - 0.5 * s, cy - 0.5 * s, s, s, 0.14 * s, 3)
      strokeRoundRect(ctx, cx - 0.5 * s, cy - 0.5 * s, s, s, 0.14 * s, 'rgba(0,0,0,0.45)', 1)
      break
    }
  }
  ctx.restore()
}

export type NodeKind = 'user' | 'cloud' | 'switch' | 'firewall' | 'server'

/**
 * Rounded, glossy square in the path colour with a glyph and an optional
 * label – USER / CLOUD endpoints and SWITCH / FIREWALL / SERVER waypoints.
 */
export function drawNodeBox(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  color: string,
  kind: NodeKind,
  label: string | null,
  opts: { lit?: boolean; pulse?: number } = {},
) {
  const r = size * 0.2
  ctx.save()
  if (opts.lit) {
    ctx.shadowColor = color
    ctx.shadowBlur = size * (0.35 + (opts.pulse ?? 0) * 0.25)
  }
  const g = ctx.createLinearGradient(0, y, 0, y + size)
  g.addColorStop(0, shade(color, 0.3))
  g.addColorStop(0.55, color)
  g.addColorStop(1, shade(color, -0.2))
  fillRoundRect(ctx, x, y, size, size, r, g)
  ctx.restore()
  strokeRoundRect(ctx, x + 1, y + 1, size - 2, size - 2, r - 1, 'rgba(255,255,255,0.55)', Math.max(1, size * 0.035))
  strokeRoundRect(ctx, x, y, size, size, r, 'rgba(0,0,0,0.35)', 1)
  // glossy top
  ctx.save()
  roundRectPath(ctx, x, y, size, size, r)
  ctx.clip()
  const gloss = ctx.createLinearGradient(0, y, 0, y + size * 0.5)
  gloss.addColorStop(0, 'rgba(255,255,255,0.28)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gloss
  ctx.fillRect(x, y, size, size * 0.5)
  ctx.restore()

  const glyphAccent = shade(color, -0.35)
  if (label) {
    drawGlyph(ctx, kind, x + size / 2, y + size * 0.4, size * 0.46, '#ffffff', glyphAccent)
    ctx.save()
    ctx.font = `800 ${Math.max(7, size * 0.16)}px "Nunito", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(2, size * 0.05)
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.strokeText(label, x + size / 2, y + size * 0.8)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, x + size / 2, y + size * 0.8)
    ctx.restore()
  } else {
    drawGlyph(ctx, kind, x + size / 2, y + size / 2, size * 0.56, '#ffffff', glyphAccent)
  }
}
