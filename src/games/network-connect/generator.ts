/**
 * Seeded level generator for Network Connect.
 *
 * Every level is built from the level number alone (`seededRng`), so level 12
 * is the same puzzle for every player. The puzzle is solvable by construction:
 * obstacles are placed first, then the remaining required tiles are covered by
 * random self-avoiding walks that are merged / split until every path is at
 * least MIN_PATH_LEN long and the colour count is in the wanted range. The
 * walks *are* the solution – their ends become USER / CLOUD endpoints and a
 * middle tile may become a waypoint. Layouts that break an invariant are
 * rejected and the next seed variant is tried.
 */
import { pick, randInt, seededRng, shuffle, type Rng } from '../../shared/rng'
import {
  MAX_COLORS,
  MIN_PATH_LEN,
  type Cell,
  type CellKind,
  type Level,
  type SolutionPath,
  type Waypoint,
  type WaypointKind,
} from './types'

const LEVEL_NAMES = [
  'Home Office',
  'Startup LAN',
  'Coffee Shop Wi-Fi',
  'School Network',
  'Branch Office',
  'Retail Store',
  'Hotel Backbone',
  'City Hall',
  'Hospital Network',
  'Campus Backbone',
  'Factory Floor',
  'Corporate Network',
  'Data Center',
  'Cloud Region',
  'Smart City Grid',
  'Stadium Wi-Fi',
  'Airport Core',
  'Bank Vault LAN',
  'Research Lab',
  'Internet Exchange',
]

const WAYPOINT_KINDS: readonly WaypointKind[] = ['switch', 'firewall', 'server']

export interface LevelRecipe {
  size: number
  blocks: number
  loss: number
  broken: number
  waypoints: number
  minColors: number
  maxColors: number
}

export function gridSizeFor(level: number): number {
  if (level <= 3) return 5
  if (level <= 7) return 6
  if (level <= 12) return 7
  return 8
}

/** Difficulty knobs per level – obstacle counts grow slowly, colour range follows the grid size. */
export function recipeFor(level: number): LevelRecipe {
  const size = gridSizeFor(level)
  const blocks = level < 4 ? 0 : Math.min(4, 1 + Math.floor((level - 4) / 3))
  const loss = level < 6 ? 0 : Math.min(3, 1 + Math.floor((level - 6) / 4))
  const broken = level < 8 ? 0 : Math.min(2, 1 + Math.floor((level - 8) / 5))
  const waypoints = level < 3 ? 0 : level < 9 ? 1 : 2
  const range: Record<number, [number, number]> = { 5: [4, 5], 6: [5, 6], 7: [5, 7], 8: [6, 8] }
  const [minColors, maxColors] = range[size]
  // Level 1 gets the most colours (= shortest paths) so the very first board is a gentle warm-up.
  return {
    size,
    blocks,
    loss,
    broken,
    waypoints,
    minColors: level === 1 ? maxColors : minColors,
    maxColors: Math.min(maxColors, MAX_COLORS),
  }
}

export function levelName(level: number): string {
  return LEVEL_NAMES[(level - 1) % LEVEL_NAMES.length]
}

/** Integer hash so neighbouring levels / variants get unrelated random streams. */
function mixSeed(level: number, variant: number): number {
  let h = Math.imul(level, 0x9e3779b1) ^ Math.imul(variant + 1, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

export function generateLevel(level: number): Level {
  const recipe = recipeFor(level)
  for (let variant = 0; variant < 400; variant++) {
    const seed = mixSeed(level, variant)
    const lv = attempt(level, recipe, seededRng(seed), seed, variant)
    if (lv && validateLevel(lv).length === 0) return lv
  }
  throw new Error(`Network Connect: no valid layout for level ${level}`)
}

/* ------------------------------------------------------------------ */

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

function attempt(level: number, recipe: LevelRecipe, rng: Rng, seed: number, variant: number): Level | null {
  const n = recipe.size
  const total = n * n
  const kinds: CellKind[] = new Array<CellKind>(total).fill('tile')

  // 1. Obstacles. Never adjacent to each other so the board stays open.
  const wanted = recipe.blocks + recipe.loss + recipe.broken
  if (wanted > 0) {
    const order = shuffle(
      rng,
      Array.from({ length: total }, (_, i) => i),
    )
    const chosen: number[] = []
    for (const i of order) {
      if (chosen.length >= wanted) break
      const r = Math.floor(i / n)
      const c = i % n
      let touching = false
      for (const [dr, dc] of DIRS) {
        const rr = r + dr
        const cc = c + dc
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && kinds[rr * n + cc] !== 'tile') touching = true
      }
      if (touching) continue
      chosen.push(i)
      kinds[i] = 'block'
    }
    if (chosen.length < wanted) return null
    const mixed = shuffle(rng, chosen)
    mixed.forEach((i, k) => {
      kinds[i] = k < recipe.blocks ? 'block' : k < recipe.blocks + recipe.loss ? 'loss' : 'broken'
    })
  }

  // 2. The required tiles must form one connected region with no dead single cells.
  if (!plainRegionConnected(kinds, n)) return null

  // 3. Cover the required tiles with paths.
  const paths = coverWithPaths(kinds, n, rng, recipe)
  if (!paths) return null

  // 4. Waypoints on one or two of the longer paths.
  const waypointsFor = new Map<number, Waypoint>()
  if (recipe.waypoints > 0) {
    const candidates = shuffle(
      rng,
      paths.map((_, i) => i).filter((i) => paths[i].length >= 5),
    )
    const kindsPool = shuffle(rng, WAYPOINT_KINDS)
    candidates.slice(0, recipe.waypoints).forEach((pi, k) => {
      const p = paths[pi]
      const mid = Math.floor(p.length / 2) + randInt(rng, -1, 1)
      const idx = Math.max(2, Math.min(p.length - 3, mid))
      const cell = p[idx]
      waypointsFor.set(pi, { r: Math.floor(cell / n), c: cell % n, kind: kindsPool[k % kindsPool.length] })
    })
  }

  // 5. Colours in random order.
  const order = shuffle(
    rng,
    paths.map((_, i) => i),
  )
  const solution: SolutionPath[] = order.map((pi, color) => {
    const cells: Cell[] = paths[pi].map((i) => ({ r: Math.floor(i / n), c: i % n }))
    const wp = waypointsFor.get(pi)
    return { color, cells, waypoints: wp ? [wp] : [] }
  })

  return { level, seed, variant, size: n, name: levelName(level), kinds, paths: solution }
}

function plainRegionConnected(kinds: CellKind[], n: number): boolean {
  const total = n * n
  let start = -1
  let count = 0
  for (let i = 0; i < total; i++) {
    if (kinds[i] === 'tile') {
      count++
      if (start < 0) start = i
    }
  }
  if (count < MIN_PATH_LEN) return false
  const seen = new Uint8Array(total)
  const stack = [start]
  seen[start] = 1
  let reached = 0
  while (stack.length) {
    const i = stack.pop() as number
    reached++
    const r = Math.floor(i / n)
    const c = i % n
    let deg = 0
    for (const [dr, dc] of DIRS) {
      const rr = r + dr
      const cc = c + dc
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue
      const j = rr * n + cc
      if (kinds[j] !== 'tile') continue
      deg++
      if (!seen[j]) {
        seen[j] = 1
        stack.push(j)
      }
    }
    if (deg === 0) return false
  }
  return reached === count
}

/**
 * Random self-avoiding walks until every required tile is covered, then merge
 * short paths into neighbours and split long ones until the colour count fits.
 * Returns paths as arrays of flat cell indices, or null when the layout is unusable.
 */
function coverWithPaths(kinds: CellKind[], n: number, rng: Rng, recipe: LevelRecipe): number[][] | null {
  const total = n * n
  const free = new Uint8Array(total)
  let uncovered = 0
  for (let i = 0; i < total; i++) {
    if (kinds[i] === 'tile') {
      free[i] = 1
      uncovered++
    }
  }
  const neighbours = (i: number): number[] => {
    const r = Math.floor(i / n)
    const c = i % n
    const out: number[] = []
    for (const [dr, dc] of DIRS) {
      const rr = r + dr
      const cc = c + dc
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc)
    }
    return out
  }
  const freeDeg = (i: number) => neighbours(i).reduce((s, j) => s + free[j], 0)
  const isAdj = (a: number, b: number) => {
    const dr = Math.abs(Math.floor(a / n) - Math.floor(b / n))
    const dc = Math.abs((a % n) - (b % n))
    return dr + dc === 1
  }

  const paths: number[][] = []
  while (uncovered > 0) {
    // Start walks at the most constrained tiles (dead ends first) so fewer singles get stranded.
    let bestDeg = 9
    let best: number[] = []
    for (let i = 0; i < total; i++) {
      if (!free[i]) continue
      const d = freeDeg(i)
      if (d < bestDeg) {
        bestDeg = d
        best = [i]
      } else if (d === bestDeg) best.push(i)
    }
    let cur = pick(rng, best)
    const path = [cur]
    free[cur] = 0
    uncovered--
    for (;;) {
      const cands = neighbours(cur).filter((j) => free[j] === 1)
      if (cands.length === 0) break
      let next: number
      if (rng() < 0.7) {
        // Warnsdorff-style: prefer the neighbour with the fewest onward options, and
        // prefer not to run alongside our own path (keeps the solution "tight").
        const scored = cands.map((j) => {
          const touches = neighbours(j).some((k) => k !== cur && path.includes(k))
          return { j, score: freeDeg(j) * 2 + (touches ? 1 : 0) + rng() * 0.5 }
        })
        scored.sort((a, b) => a.score - b.score)
        next = scored[0].j
      } else {
        next = pick(rng, cands)
      }
      path.push(next)
      free[next] = 0
      uncovered--
      cur = next
    }
    paths.push(path)
  }

  /** Join path `a` with any other path whose end touches one of a's ends. Prefers short partners. */
  const tryMerge = (ai: number): boolean => {
    const a = paths[ai]
    const partners = paths
      .map((_, i) => i)
      .filter((i) => i !== ai)
      .sort((x, y) => paths[x].length - paths[y].length)
    for (const bi of partners) {
      const b = paths[bi]
      let merged: number[] | null = null
      if (isAdj(a[a.length - 1], b[0])) merged = a.concat(b)
      else if (isAdj(a[a.length - 1], b[b.length - 1])) merged = a.concat(b.slice().reverse())
      else if (isAdj(a[0], b[b.length - 1])) merged = b.concat(a)
      else if (isAdj(a[0], b[0])) merged = b.slice().reverse().concat(a)
      if (merged) {
        paths[Math.min(ai, bi)] = merged
        paths.splice(Math.max(ai, bi), 1)
        return true
      }
    }
    return false
  }

  const longestIndex = () => {
    let li = 0
    paths.forEach((p, i) => {
      if (p.length > paths[li].length) li = i
    })
    return li
  }
  const shortestIndex = () => {
    let si = 0
    paths.forEach((p, i) => {
      if (p.length < paths[si].length) si = i
    })
    return si
  }
  /** Split the longest path somewhere around its middle third (both halves stay ≥ MIN_PATH_LEN). */
  const splitLongest = (): boolean => {
    const li = longestIndex()
    const p = paths[li]
    if (p.length < MIN_PATH_LEN * 2) return false
    const lo = Math.max(MIN_PATH_LEN, Math.floor(p.length / 3))
    const hi = Math.min(p.length - MIN_PATH_LEN, Math.ceil((p.length * 2) / 3))
    const k = randInt(rng, lo, hi)
    paths[li] = p.slice(0, k)
    paths.push(p.slice(k))
    return true
  }

  // No path shorter than MIN_PATH_LEN: merge short walks into a neighbour.
  for (let guard = 0; guard < 200; guard++) {
    const si = paths.findIndex((p) => p.length < MIN_PATH_LEN)
    if (si < 0) break
    if (!tryMerge(si)) return null
  }
  // Colour count in range.
  while (paths.length > recipe.maxColors) if (!tryMerge(shortestIndex())) return null
  while (paths.length < recipe.minColors) if (!splitLongest()) return null
  // Balance: one giant snake makes a puzzle both tedious and unfair, so cap the longest path
  // relative to the average and split while the colour budget allows it.
  const required = paths.reduce((s, p) => s + p.length, 0)
  const cap = Math.max(MIN_PATH_LEN * 2, Math.round((required / recipe.minColors) * 1.45))
  while (paths[longestIndex()].length > cap) {
    if (paths.length >= recipe.maxColors || !splitLongest()) return null
  }
  if (paths.some((p) => p.length < MIN_PATH_LEN)) return null
  return paths
}

/* ------------------------------------------------------------------ */

/** Returns a list of broken invariants (empty = valid). Used by the generator and the check script. */
export function validateLevel(lv: Level): string[] {
  const errors: string[] = []
  const n = lv.size
  const total = n * n
  if (lv.kinds.length !== total) errors.push(`kinds has ${lv.kinds.length} cells, expected ${total}`)
  if (lv.paths.length === 0) errors.push('no paths')
  if (lv.paths.length > MAX_COLORS) errors.push(`${lv.paths.length} colours > ${MAX_COLORS}`)
  const cover = new Int8Array(total).fill(-1)
  const nodes = new Set<number>()
  lv.paths.forEach((p, i) => {
    if (p.color !== i) errors.push(`path ${i} has colour ${p.color}`)
    if (p.cells.length < MIN_PATH_LEN) errors.push(`path ${i} is only ${p.cells.length} long`)
    p.cells.forEach((cell, j) => {
      if (cell.r < 0 || cell.r >= n || cell.c < 0 || cell.c >= n) {
        errors.push(`path ${i} leaves the board at ${cell.r},${cell.c}`)
        return
      }
      const idx = cell.r * n + cell.c
      if (lv.kinds[idx] !== 'tile') errors.push(`path ${i} crosses a ${lv.kinds[idx]} at ${cell.r},${cell.c}`)
      if (cover[idx] !== -1) errors.push(`cell ${cell.r},${cell.c} covered twice (${cover[idx]} and ${i})`)
      cover[idx] = i
      if (j > 0) {
        const prev = p.cells[j - 1]
        if (Math.abs(prev.r - cell.r) + Math.abs(prev.c - cell.c) !== 1) errors.push(`path ${i} is not 4-connected at step ${j}`)
      }
    })
    const first = p.cells[0]
    const last = p.cells[p.cells.length - 1]
    for (const e of [first, last]) {
      const key = e.r * n + e.c
      if (nodes.has(key)) errors.push(`endpoint ${e.r},${e.c} used twice`)
      nodes.add(key)
    }
    for (const w of p.waypoints) {
      const at = p.cells.findIndex((c) => c.r === w.r && c.c === w.c)
      if (at < 1 || at > p.cells.length - 2) errors.push(`waypoint of path ${i} is not an interior cell (index ${at})`)
      if (!WAYPOINT_KINDS.includes(w.kind)) errors.push(`waypoint of path ${i} has kind ${w.kind}`)
      const key = w.r * n + w.c
      if (nodes.has(key)) errors.push(`waypoint ${w.r},${w.c} collides with another node`)
      nodes.add(key)
    }
  })
  for (let i = 0; i < total; i++) {
    if (lv.kinds[i] === 'tile' && cover[i] === -1) errors.push(`tile ${Math.floor(i / n)},${i % n} is not covered`)
  }
  return errors
}
