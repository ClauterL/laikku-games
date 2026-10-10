/**
 * Effects layer behind the arrow row: speed-line bursts on every correct
 * arrow, sparks + a ring when a code completes, a big burst on wave clear,
 * and a faint idle "data stream" so the panel never looks static.
 * Everything is in CSS pixels on the centre-panel canvas.
 */
import { burst, drawParticles, updateParticles, type Particle } from '../../shared/draw'

interface SpeedLine {
  x: number
  y: number
  angle: number
  len: number
  speed: number
  life: number
  maxLife: number
  color: string
  width: number
}

interface Ring {
  x: number
  y: number
  r: number
  speed: number
  life: number
  maxLife: number
  color: string
}

interface Streak {
  x: number
  y: number
  len: number
  speed: number
  alpha: number
}

const MAX_LINES = 160
const MAX_PARTICLES = 220

export class Fx {
  private lines: SpeedLine[] = []
  private particles: Particle[] = []
  private rings: Ring[] = []
  private streaks: Streak[] = []
  private streakTimer = 0
  private scan = 0
  /** burst origin (centre of the arrow row) in canvas CSS pixels */
  origin = { x: 0, y: 0 }
  width = 1
  height = 1

  /** Radial speed lines – fired on every correct arrow. */
  speedBurst(count: number, colors: string[], strength = 1) {
    const { x, y } = this.origin
    for (let i = 0; i < count; i++) {
      if (this.lines.length >= MAX_LINES) this.lines.shift()
      const angle = Math.random() * Math.PI * 2
      const life = 0.28 + Math.random() * 0.22
      this.lines.push({
        x: x + Math.cos(angle) * (40 + Math.random() * 40),
        y: y + Math.sin(angle) * (20 + Math.random() * 30),
        angle,
        len: (30 + Math.random() * 70) * strength,
        speed: (520 + Math.random() * 520) * strength,
        life,
        maxLife: life,
        color: colors[Math.floor(Math.random() * colors.length)],
        width: 1 + Math.random() * 1.6,
      })
    }
  }

  /** Sparks + expanding ring – code completed. */
  solveBurst(colors: string[], big = false) {
    const { x, y } = this.origin
    burst(this.particles, x, y, big ? 90 : 38, colors, { speed: big ? 520 : 360, life: big ? 1.1 : 0.7, size: 7, gravity: big ? 260 : 120, shape: 'spark' })
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES)
    this.rings.push({ x, y, r: 10, speed: big ? 900 : 620, life: big ? 0.7 : 0.45, maxLife: big ? 0.7 : 0.45, color: colors[0] })
    this.speedBurst(big ? 70 : 28, colors, big ? 1.6 : 1.1)
  }

  update(dt: number) {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i]
      l.life -= dt
      if (l.life <= 0) {
        this.lines.splice(i, 1)
        continue
      }
      l.x += Math.cos(l.angle) * l.speed * dt
      l.y += Math.sin(l.angle) * l.speed * dt
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.life -= dt
      r.r += r.speed * dt
      if (r.life <= 0) this.rings.splice(i, 1)
    }
    updateParticles(this.particles, dt)

    // idle data streaks drifting right, a few at a time
    this.streakTimer -= dt
    if (this.streakTimer <= 0 && this.streaks.length < 14) {
      this.streakTimer = 0.25 + Math.random() * 0.5
      this.streaks.push({
        x: -120,
        y: Math.random() * this.height,
        len: 40 + Math.random() * 120,
        speed: 60 + Math.random() * 120,
        alpha: 0.05 + Math.random() * 0.08,
      })
    }
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i]
      s.x += s.speed * dt
      if (s.x > this.width + 20) this.streaks.splice(i, 1)
    }
    this.scan = (this.scan + dt * 0.12) % 1
  }

  draw(c: CanvasRenderingContext2D) {
    const { width: W, height: H } = this
    c.clearRect(0, 0, W, H)

    // idle: streaks + a slow scan band
    c.save()
    c.lineWidth = 1
    for (const s of this.streaks) {
      c.strokeStyle = `rgba(25,200,255,${s.alpha})`
      c.beginPath()
      c.moveTo(s.x, s.y)
      c.lineTo(s.x + s.len, s.y)
      c.stroke()
    }
    const sy = this.scan * (H + 80) - 40
    const g = c.createLinearGradient(0, sy - 30, 0, sy + 30)
    g.addColorStop(0, 'rgba(25,200,255,0)')
    g.addColorStop(0.5, 'rgba(25,200,255,0.05)')
    g.addColorStop(1, 'rgba(25,200,255,0)')
    c.fillStyle = g
    c.fillRect(0, sy - 30, W, 60)
    c.restore()

    // speed lines
    c.save()
    c.lineCap = 'round'
    for (const l of this.lines) {
      const a = l.life / l.maxLife
      c.globalAlpha = a * 0.9
      c.strokeStyle = l.color
      c.lineWidth = l.width
      c.beginPath()
      c.moveTo(l.x, l.y)
      c.lineTo(l.x - Math.cos(l.angle) * l.len * a, l.y - Math.sin(l.angle) * l.len * a)
      c.stroke()
    }
    c.restore()

    // rings
    for (const r of this.rings) {
      const a = r.life / r.maxLife
      c.save()
      c.globalAlpha = a * 0.8
      c.strokeStyle = r.color
      c.lineWidth = 3 * a + 1
      c.beginPath()
      c.ellipse(r.x, r.y, r.r, r.r * 0.55, 0, 0, Math.PI * 2)
      c.stroke()
      c.restore()
    }

    drawParticles(c, this.particles)
  }

  clear() {
    this.lines.length = 0
    this.particles.length = 0
    this.rings.length = 0
  }
}
