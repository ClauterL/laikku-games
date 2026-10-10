/**
 * NETWORK STATUS map – Finland outline with the six sector nodes.
 * The static layer (grid, country, labels) is cached per size; only links
 * and nodes are redrawn every frame so the panel stays cheap on phones.
 */
import { fitCanvas } from '../../shared/canvas'
import { FINLAND_ASPECT, FINLAND_RINGS } from './finland'
import { LINKS, SECTORS, type SectorDef } from './sectors'
import type { NodeState, SectorId } from './types'

export interface MapState {
  nodes: Record<SectorId, NodeState>
  /** sector of the incident being worked on right now */
  active: SectorId | null
  /** open incidents per sector */
  pending: Partial<Record<SectorId, number>>
}

const CYAN = '#19c8ff'
const GREEN = '#36ff6a'
const RED = '#ff3b3b'
const GREY = '#6b7a88'

interface Fit {
  ox: number
  oy: number
  w: number
  h: number
}

export class MapRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private width = 0
  private height = 0
  private fit: Fit = { ox: 0, oy: 0, w: 1, h: 1 }
  private layer: HTMLCanvasElement | null = null
  private layerKey = ''

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    // labels are baked into the cached layer – rebuild it once the web font is in
    document.fonts?.ready.then(() => {
      this.layer = null
    })
  }

  /** 1 on a desktop-sized map, down to 0.6 on the tiny landscape-phone map. */
  private get scale() {
    return Math.max(0.6, Math.min(1, this.fit.w / 140))
  }

  resize() {
    const size = fitCanvas(this.canvas)
    this.width = size.width
    this.height = size.height
    // leave room for the sector labels left and right of the country
    const margin = this.width < 200 ? 34 : 54
    const availW = Math.max(40, this.width - margin * 2)
    const availH = Math.max(40, this.height - 20)
    let h = availH
    let w = h * FINLAND_ASPECT
    if (w > availW) {
      w = availW
      h = w / FINLAND_ASPECT
    }
    this.fit = { ox: (this.width - w) / 2, oy: (this.height - h) / 2, w, h }
    this.layer = null
  }

  /** Node position in CSS pixels. */
  nodePos(sector: SectorDef): [number, number] {
    const f = this.fit
    return [f.ox + sector.pos[0] * f.w, f.oy + sector.pos[1] * f.h]
  }

  private buildLayer() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const key = `${this.width}x${this.height}@${dpr}`
    if (this.layer && this.layerKey === key) return
    const layer = document.createElement('canvas')
    layer.width = Math.max(1, Math.round(this.width * dpr))
    layer.height = Math.max(1, Math.round(this.height * dpr))
    const c = layer.getContext('2d')
    if (!c) return
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    const { width: W, height: H } = this
    const f = this.fit

    // faint tactical grid
    c.strokeStyle = 'rgba(25,200,255,0.07)'
    c.lineWidth = 1
    c.beginPath()
    for (let x = 0.5; x < W; x += 22) {
      c.moveTo(x, 0)
      c.lineTo(x, H)
    }
    for (let y = 0.5; y < H; y += 22) {
      c.moveTo(0, y)
      c.lineTo(W, y)
    }
    c.stroke()

    // country
    const path = new Path2D()
    for (const ring of FINLAND_RINGS) {
      ring.forEach(([x, y], i) => {
        const px = f.ox + x * f.w
        const py = f.oy + y * f.h
        if (i === 0) path.moveTo(px, py)
        else path.lineTo(px, py)
      })
      path.closePath()
    }
    const g = c.createLinearGradient(0, f.oy, 0, f.oy + f.h)
    g.addColorStop(0, 'rgba(16,70,66,0.78)')
    g.addColorStop(0.55, 'rgba(14,58,62,0.78)')
    g.addColorStop(1, 'rgba(10,46,70,0.8)')
    c.fillStyle = g
    c.fill(path)
    // inner texture: diagonal hatch, very faint
    c.save()
    c.clip(path)
    c.strokeStyle = 'rgba(54,255,106,0.06)'
    for (let d = -H; d < W + H; d += 9) {
      c.beginPath()
      c.moveTo(d, 0)
      c.lineTo(d + H, H)
      c.stroke()
    }
    c.restore()
    c.save()
    c.shadowColor = CYAN
    c.shadowBlur = 14
    c.strokeStyle = 'rgba(25,200,255,0.85)'
    c.lineWidth = 1.4
    c.stroke(path)
    c.restore()

    // labels (skipped on a tiny map – they would just collide)
    if (this.scale > 0.75) {
      c.font = '800 9px "Nunito", system-ui, sans-serif'
      c.textBaseline = 'middle'
      c.fillStyle = 'rgba(214,236,255,0.85)'
      for (const s of SECTORS) {
        const [x, y] = this.nodePos(s)
        c.textAlign = s.labelSide === 'left' ? 'right' : 'left'
        const tx = s.labelSide === 'left' ? x - 17 : x + 17
        c.fillText(s.label, tx, y)
      }
    }
    this.layer = layer
    this.layerKey = key
  }

  draw(state: MapState, t: number) {
    const c = this.ctx
    if (!c || this.width < 2) return
    this.buildLayer()
    c.clearRect(0, 0, this.width, this.height)
    if (this.layer) c.drawImage(this.layer, 0, 0, this.width, this.height)

    // links
    const pos: Partial<Record<SectorId, [number, number]>> = {}
    for (const s of SECTORS) pos[s.id] = this.nodePos(s)
    for (const [a, b] of LINKS) {
      const pa = pos[a]!
      const pb = pos[b]!
      const sa = state.nodes[a]
      const sb = state.nodes[b]
      const bad = sa === 'incident' || sb === 'incident'
      const off = sa === 'offline' || sb === 'offline'
      c.save()
      c.lineWidth = 1.4
      if (off) {
        c.strokeStyle = 'rgba(120,135,150,0.4)'
        c.setLineDash([2, 5])
      } else if (bad) {
        c.strokeStyle = 'rgba(255,80,80,0.8)'
        c.setLineDash([5, 5])
        c.lineDashOffset = -t * 18
        c.shadowColor = RED
        c.shadowBlur = 6
      } else {
        c.strokeStyle = 'rgba(54,255,106,0.55)'
        c.setLineDash([2, 5])
        c.lineDashOffset = -t * 6
      }
      c.beginPath()
      c.moveTo(pa[0], pa[1])
      c.lineTo(pb[0], pb[1])
      c.stroke()
      c.restore()
    }

    // nodes
    const k = this.scale
    for (const s of SECTORS) {
      const [x, y] = pos[s.id]!
      const st = state.nodes[s.id]
      const active = state.active === s.id
      const pulse = 0.5 + 0.5 * Math.sin(t * 6)
      if (st === 'incident') {
        const r = (active ? 15 + pulse * 2 : 12) * k
        c.save()
        if (active) {
          c.globalAlpha = 0.25 + 0.25 * pulse
          c.fillStyle = RED
          c.beginPath()
          c.arc(x, y, r + (10 + pulse * 6) * k, 0, Math.PI * 2)
          c.fill()
        }
        c.globalAlpha = 1
        c.shadowColor = RED
        c.shadowBlur = active ? 18 : 10
        c.fillStyle = 'rgba(70,8,8,0.95)'
        c.strokeStyle = active ? '#ff6060' : RED
        c.lineWidth = 2 * k
        c.beginPath()
        c.arc(x, y, r, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        c.restore()
        // warning triangle
        const tr = r * 0.62
        c.save()
        c.strokeStyle = '#fff'
        c.fillStyle = 'rgba(255,255,255,0.12)'
        c.lineWidth = 1.6 * k
        c.lineJoin = 'round'
        c.beginPath()
        c.moveTo(x, y - tr)
        c.lineTo(x + tr * 0.95, y + tr * 0.72)
        c.lineTo(x - tr * 0.95, y + tr * 0.72)
        c.closePath()
        c.fill()
        c.stroke()
        c.lineWidth = 1.8 * k
        c.beginPath()
        c.moveTo(x, y - tr * 0.35)
        c.lineTo(x, y + tr * 0.2)
        c.stroke()
        c.beginPath()
        c.arc(x, y + tr * 0.5, k, 0, Math.PI * 2)
        c.fillStyle = '#fff'
        c.fill()
        c.restore()
        const n = state.pending[s.id] ?? 0
        if (n > 1 && k > 0.75) {
          c.save()
          c.fillStyle = RED
          c.beginPath()
          c.arc(x + r * 0.85, y - r * 0.85, 7, 0, Math.PI * 2)
          c.fill()
          c.fillStyle = '#fff'
          c.font = '900 9px "Nunito", system-ui, sans-serif'
          c.textAlign = 'center'
          c.textBaseline = 'middle'
          c.fillText(String(n), x + r * 0.85, y - r * 0.85 + 0.5)
          c.restore()
        }
      } else if (st === 'offline') {
        c.save()
        c.fillStyle = 'rgba(20,26,34,0.95)'
        c.strokeStyle = GREY
        c.lineWidth = 2 * k
        c.beginPath()
        c.arc(x, y, 11 * k, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        c.strokeStyle = '#aab6c2'
        c.lineWidth = 1.8 * k
        c.beginPath()
        c.moveTo(x - 4 * k, y - 4 * k)
        c.lineTo(x + 4 * k, y + 4 * k)
        c.moveTo(x + 4 * k, y - 4 * k)
        c.lineTo(x - 4 * k, y + 4 * k)
        c.stroke()
        c.restore()
      } else {
        c.save()
        c.shadowColor = GREEN
        c.shadowBlur = 10
        c.fillStyle = 'rgba(6,40,22,0.95)'
        c.strokeStyle = GREEN
        c.lineWidth = 2 * k
        c.beginPath()
        c.arc(x, y, 11 * k, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        c.restore()
        drawMast(c, x, y, GREEN, k)
      }
    }
  }
}

/** Tiny radio-mast glyph for online nodes. */
function drawMast(c: CanvasRenderingContext2D, x: number, y: number, color: string, k = 1) {
  c.save()
  c.translate(x, y)
  c.scale(k, k)
  c.translate(-x, -y)
  c.strokeStyle = color
  c.lineWidth = 1.5
  c.lineCap = 'round'
  c.beginPath()
  c.moveTo(x, y + 6)
  c.lineTo(x, y - 1)
  c.moveTo(x - 3, y + 6)
  c.lineTo(x, y + 1)
  c.lineTo(x + 3, y + 6)
  c.stroke()
  c.beginPath()
  c.arc(x, y - 1, 3, Math.PI * 1.15, Math.PI * 1.85)
  c.stroke()
  c.beginPath()
  c.arc(x, y - 1, 5.5, Math.PI * 1.2, Math.PI * 1.8)
  c.stroke()
  c.fillStyle = color
  c.beginPath()
  c.arc(x, y - 1, 1.1, 0, Math.PI * 2)
  c.fill()
  c.restore()
}
