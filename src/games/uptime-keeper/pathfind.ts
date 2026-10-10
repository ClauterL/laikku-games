/**
 * Grid A* (8 directions, no corner cutting) used for tap-to-move, plus the
 * collision helpers shared with keyboard movement.
 * Halls are tiny (≤ 24×16 cells) so a plain array-based open list is plenty.
 */
import { isWalkable } from './levels'
import type { HallLayout, Pt } from './types'

/** Half extents of the technician's collision box (tile units, centred on the feet). */
export const BODY_HX = 0.26
export const BODY_HY = 0.18

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

/** True when the technician's box at (x, y) overlaps a wall, rack or station. */
export function blocked(hall: HallLayout, x: number, y: number): boolean {
  const x0 = Math.floor(x - BODY_HX)
  const x1 = Math.floor(x + BODY_HX)
  const y0 = Math.floor(y - BODY_HY)
  const y1 = Math.floor(y + BODY_HY)
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (!isWalkable(hall, cx, cy)) return true
  return false
}

/** Can the technician walk in a straight line from a to b? (sampled sweep) */
export function clearLine(hall: HallLayout, a: Pt, b: Pt): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  const steps = Math.max(1, Math.ceil(d / 0.15))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    if (blocked(hall, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false
  }
  return true
}

/** Returns the list of cells from `from` (exclusive) to `to` (inclusive), or null if unreachable. */
export function findPath(hall: HallLayout, from: Pt, to: Pt): Pt[] | null {
  if (!isWalkable(hall, to.x, to.y) || !isWalkable(hall, from.x, from.y)) return null
  if (from.x === to.x && from.y === to.y) return []
  const W = hall.cols
  const N = W * hall.rows
  const g = new Float32Array(N).fill(Infinity)
  const f = new Float32Array(N).fill(Infinity)
  const parent = new Int32Array(N).fill(-1)
  const state = new Uint8Array(N) // 0 new, 1 open, 2 closed
  const open: number[] = []
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - to.x)
    const dy = Math.abs(y - to.y)
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }
  const s = from.y * W + from.x
  const goal = to.y * W + to.x
  g[s] = 0
  f[s] = h(from.x, from.y)
  open.push(s)
  state[s] = 1
  let found = false
  while (open.length) {
    // pick the lowest f (linear scan – the open list stays small on these grids)
    let bi = 0
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i
    const cur = open[bi]
    open[bi] = open[open.length - 1]
    open.pop()
    if (cur === goal) {
      found = true
      break
    }
    state[cur] = 2
    const cx = cur % W
    const cy = (cur - cx) / W
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx
      const ny = cy + dy
      if (!isWalkable(hall, nx, ny)) continue
      // no squeezing diagonally past the corner of a solid cell
      if (dx !== 0 && dy !== 0 && (!isWalkable(hall, cx + dx, cy) || !isWalkable(hall, cx, cy + dy))) continue
      const ni = ny * W + nx
      if (state[ni] === 2) continue
      const ng = g[cur] + cost
      if (ng < g[ni]) {
        g[ni] = ng
        f[ni] = ng + h(nx, ny)
        parent[ni] = cur
        if (state[ni] !== 1) {
          state[ni] = 1
          open.push(ni)
        }
      }
    }
  }
  if (!found) return null
  const path: Pt[] = []
  let c = goal
  while (c !== s && c >= 0) {
    path.push({ x: c % W, y: Math.floor(c / W) })
    c = parent[c]
  }
  path.reverse()
  return path
}

/**
 * Turns a cell path into waypoints (cell centres) and drops every waypoint the
 * technician can skip in a straight line, so tap-to-move does not zig-zag.
 */
export function smoothPath(hall: HallLayout, from: Pt, cellsPath: Pt[]): Pt[] {
  const pts = cellsPath.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }))
  const out: Pt[] = []
  let anchor = from
  let i = 0
  while (i < pts.length) {
    let j = pts.length - 1
    while (j > i && !clearLine(hall, anchor, pts[j])) j--
    out.push(pts[j])
    anchor = pts[j]
    i = j + 1
  }
  return out
}

/**
 * Walkable cell to stand on when interacting with a solid footprint.
 * Racks and top-row units are served from the front (below); wall units from
 * the side they face. Other free sides only win when they are much closer.
 */
export function accessCell(hall: HallLayout, fx: number, fy: number, fw: number, fh: number, from: Pt, facing: 'left' | 'right' | 'down' = 'down'): Pt | null {
  let best: Pt | null = null
  let bestScore = Infinity
  const consider = (x: number, y: number, weight: number) => {
    if (!isWalkable(hall, x, y)) return
    const score = Math.hypot(x + 0.5 - from.x, y + 0.5 - from.y) + weight
    if (score < bestScore) {
      bestScore = score
      best = { x, y }
    }
  }
  const side = facing !== 'down'
  for (let x = fx; x < fx + fw; x++) {
    consider(x, fy + fh, side ? 1.2 : 0)
    consider(x, fy - 1, side ? 1.6 : 2.6)
  }
  for (let y = fy; y < fy + fh; y++) {
    consider(fx - 1, y, facing === 'left' ? 0 : 1.2)
    consider(fx + fw, y, facing === 'right' ? 0 : 1.2)
  }
  return best
}

/** Nearest walkable cell to an arbitrary cell (ring search). */
export function nearestWalkable(hall: HallLayout, cx: number, cy: number): Pt | null {
  if (isWalkable(hall, cx, cy)) return { x: cx, y: cy }
  for (let r = 1; r < Math.max(hall.cols, hall.rows); r++) {
    let best: Pt | null = null
    let bd = Infinity
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue
        if (!isWalkable(hall, x, y)) continue
        const d = Math.hypot(x - cx, y - cy)
        if (d < bd) {
          bd = d
          best = { x, y }
        }
      }
    }
    if (best) return best
  }
  return null
}
