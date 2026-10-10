/** Small canvas drawing helpers shared by all games (CSS-pixel space). */

export type Ctx = CanvasRenderingContext2D

export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

export function fillRoundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient) {
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
}

export function strokeRoundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, stroke: string, width = 2) {
  roundRectPath(ctx, x, y, w, h, r)
  ctx.strokeStyle = stroke
  ctx.lineWidth = width
  ctx.stroke()
}

/** Text with an outline – the "mobile game" look for scores and labels. */
export function outlinedText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  opts: {
    font?: string
    fill?: string
    stroke?: string
    strokeWidth?: number
    align?: CanvasTextAlign
    baseline?: CanvasTextBaseline
  } = {},
) {
  ctx.save()
  ctx.font = opts.font ?? '800 18px "Baloo 2", "Nunito", sans-serif'
  ctx.textAlign = opts.align ?? 'center'
  ctx.textBaseline = opts.baseline ?? 'middle'
  ctx.lineJoin = 'round'
  if (opts.stroke !== 'none') {
    ctx.lineWidth = opts.strokeWidth ?? 4
    ctx.strokeStyle = opts.stroke ?? 'rgba(0,0,0,0.6)'
    ctx.strokeText(text, x, y)
  }
  ctx.fillStyle = opts.fill ?? '#fff'
  ctx.fillText(text, x, y)
  ctx.restore()
}

/** Run `fn` with a soft glow (shadowBlur) around whatever it draws. */
export function withGlow(ctx: Ctx, color: string, blur: number, fn: () => void) {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  fn()
  ctx.restore()
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** Mix a hex colour towards black (amount<0) or white (amount>0). */
export function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  const ch = (v: number) => {
    const t = amount < 0 ? 0 : 255
    const p = Math.abs(amount)
    return Math.round((t - v) * p + v)
  }
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

/** Simple particle used for confetti / debris / sparks. */
export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  gravity?: number
  shape?: 'circle' | 'square' | 'spark'
  rot?: number
  vr?: number
}

export function burst(
  particles: Particle[],
  x: number,
  y: number,
  count: number,
  colors: string[],
  opts: { speed?: number; life?: number; size?: number; gravity?: number; shape?: Particle['shape'] } = {},
) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = (opts.speed ?? 260) * (0.4 + Math.random() * 0.8)
    const life = (opts.life ?? 0.7) * (0.6 + Math.random() * 0.6)
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life,
      maxLife: life,
      size: (opts.size ?? 6) * (0.5 + Math.random()),
      color: colors[Math.floor(Math.random() * colors.length)],
      gravity: opts.gravity ?? 600,
      shape: opts.shape ?? 'square',
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 10,
    })
  }
}

export function updateParticles(particles: Particle[], dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.life -= dt
    if (p.life <= 0) {
      particles.splice(i, 1)
      continue
    }
    p.vy += (p.gravity ?? 0) * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.rot = (p.rot ?? 0) + (p.vr ?? 0) * dt
  }
}

export function drawParticles(ctx: Ctx, particles: Particle[]) {
  for (const p of particles) {
    const a = Math.max(0, p.life / p.maxLife)
    ctx.save()
    ctx.globalAlpha = a
    ctx.fillStyle = p.color
    ctx.translate(p.x, p.y)
    ctx.rotate(p.rot ?? 0)
    if (p.shape === 'circle') {
      ctx.beginPath()
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
      ctx.fill()
    } else if (p.shape === 'spark') {
      ctx.fillRect(-p.size, -1, p.size * 2, 2)
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size)
    }
    ctx.restore()
  }
}

/** Floating "+100" style text. */
export interface FloatText {
  x: number
  y: number
  text: string
  color: string
  life: number
  maxLife: number
  size?: number
}

export function updateFloatTexts(list: FloatText[], dt: number) {
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i]
    f.life -= dt
    f.y -= 40 * dt
    if (f.life <= 0) list.splice(i, 1)
  }
}

export function drawFloatTexts(ctx: Ctx, list: FloatText[]) {
  for (const f of list) {
    ctx.save()
    ctx.globalAlpha = Math.min(1, f.life / (f.maxLife * 0.5))
    outlinedText(ctx, f.text, f.x, f.y, {
      font: `800 ${f.size ?? 22}px "Baloo 2", "Nunito", sans-serif`,
      fill: f.color,
      stroke: 'rgba(0,0,0,0.7)',
      strokeWidth: 5,
    })
    ctx.restore()
  }
}
