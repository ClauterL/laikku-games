/**
 * Network Connect – game engine (plain TypeScript, no React).
 *
 * Owns the board state, the Flow-Free drawing rules, power-ups, progress
 * persistence and all canvas rendering. The React component only renders the
 * HTML panels around the board from the `HudState` this engine pushes.
 */
import { fitCanvas, observeResize, pointerPos, startLoop } from '../../shared/canvas'
import {
  burst,
  drawFloatTexts,
  drawParticles,
  fillRoundRect,
  hexToRgba,
  outlinedText,
  shade,
  strokeRoundRect,
  updateFloatTexts,
  updateParticles,
  type FloatText,
  type Particle,
} from '../../shared/draw'
import { clamp, easeOutBack, easeOutCubic, lerp } from '../../shared/math'
import { seededRng } from '../../shared/rng'
import { sfx } from '../../shared/sfx'
import { loadJSON, saveJSON, submitBest } from '../../shared/storage'
import { generateLevel } from './generator'
import { drawBricks, drawGlyph, drawNodeBox } from './glyphs'
import {
  PALETTE,
  POWER_UPS,
  adjacent,
  sameCell,
  type Cell,
  type Inventory,
  type Level,
  type PowerUp,
  type TileKind,
  type WaypointKind,
} from './types'

export const SLUG = 'network-connect'
const PROGRESS_KEY = `${SLUG}:progress`
const MAX_CHARGES = 5
const HISTORY_LIMIT = 40

export type Phase = 'start' | 'playing' | 'won'

export interface Progress {
  /** Level to play next (CONTINUE). */
  level: number
  coins: number
  inventory: Inventory
  bestLevel: number
}

export const defaultProgress = (): Progress => ({
  level: 1,
  coins: 0,
  inventory: { reroute: 3, firewall: 3, vpn: 2, boost: 3 },
  bestLevel: 1,
})

export function loadProgress(): Progress | null {
  const p = loadJSON<Partial<Progress> | null>(PROGRESS_KEY, null)
  if (!p || typeof p.level !== 'number' || !p.inventory) return null
  const d = defaultProgress()
  return {
    level: Math.max(1, Math.floor(p.level)),
    coins: typeof p.coins === 'number' ? p.coins : 0,
    inventory: { ...d.inventory, ...p.inventory },
    bestLevel: Math.max(p.bestLevel ?? 1, p.level),
  }
}

export interface WinSummary {
  level: number
  moves: number
  latency: number
  stars: number
  earned: number
  bonus: number
  unused: number
  gift: PowerUp | null
  coins: number
  nextLevel: number
}

export interface HudState {
  level: number
  name: string
  size: number
  moves: number
  stars: number
  latency: number
  coins: number
  inventory: Inventory
  armed: PowerUp | null
  pairs: number
  connected: number
  loss: number
  blocks: number
  broken: number
  canUndo: boolean
  solved: boolean
  win: WinSummary | null
}

export const initialHud = (): HudState => ({
  level: 1,
  name: '',
  size: 5,
  moves: 0,
  stars: 3,
  latency: 0,
  coins: 0,
  inventory: defaultProgress().inventory,
  armed: null,
  pairs: 0,
  connected: 0,
  loss: 0,
  blocks: 0,
  broken: 0,
  canUndo: false,
  solved: false,
  win: null,
})

export interface EngineOptions {
  /** Element whose box the board is fitted into (CSS layout decides where the board lives). */
  boardHost?: HTMLElement | null
  onHud: (hud: HudState) => void
  onPhase: (phase: Phase) => void
}

interface Tile {
  kind: TileKind
  /** Colour index of the endpoint on this tile, or -1. */
  end: number
  /** 0 = USER, 1 = CLOUD. */
  endWhich: number
  /** Colour index of the waypoint on this tile, or -1. */
  way: number
  wayKind: WaypointKind | null
}

type Pending = { type: 'restart'; cell: Cell } | { type: 'truncate'; index: number } | null

interface Drag {
  color: number
  pending: Pending
  cur: Cell
  lastX: number
  lastY: number
  tunnelled: boolean
  snapshot: string
  before: Cell[][]
}

interface Flash {
  cell: Cell
  t: number
  color: string
}

interface DevHook {
  solution: () => { color: number; cells: [number, number][]; waypoints: { r: number; c: number; kind: WaypointKind }[] }[]
  cellCenter: (r: number, c: number) => { x: number; y: number }
  state: () => { phase: Phase; moves: number; solved: boolean; connected: number; pairs: number; level: number; armed: PowerUp | null }
  grid: () => { size: number; kinds: TileKind[] }
  paths: () => [number, number][][]
}

const NODE_LABEL: Record<WaypointKind, string> = { switch: 'SWITCH', firewall: 'FIREWALL', server: 'SERVER' }

export class Engine {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly boardHost: HTMLElement | null
  private readonly onHud: (hud: HudState) => void
  private readonly onPhase: (phase: Phase) => void
  private disposers: Array<() => void> = []
  private destroyed = false

  private width = 0
  private height = 0
  private board = { x: 0, y: 0, size: 0, cell: 0 }

  private level!: Level
  private n = 5
  private tiles: Tile[] = []
  private paths: Cell[][] = []
  private occ = new Int8Array(64)
  private ends: Cell[][] = []
  private ways: Cell[][] = []

  private progress: Progress = defaultProgress()
  private phase: Phase = 'start'
  private moves = 0
  private usedTypes = new Set<PowerUp>()
  private armed: PowerUp | null = null
  private drag: Drag | null = null
  private history: Cell[][][] = []
  private solved = false
  private winAt = -1
  private winShown = false
  private win: WinSummary | null = null
  private lastHud = ''

  private time = 0
  private particles: Particle[] = []
  private floats: FloatText[] = []
  private flashes: Flash[] = []
  private pendingBursts: number[] = []
  private shake = 0
  private denyAt = -1
  private pulse: Float32Array = new Float32Array(8)

  private bgNodes: { x: number; y: number; phase: number; speed: number; r: number }[] = []
  private skyline: { x: number; w: number; h: number; windows: number[] }[] = []

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas not available')
    this.ctx = ctx
    this.boardHost = opts.boardHost ?? null
    this.onHud = opts.onHud
    this.onPhase = opts.onPhase

    this.buildBackdrop()
    this.progress = loadProgress() ?? defaultProgress()
    this.loadLevel(this.progress.level)

    this.disposers.push(observeResize(canvas, () => this.resize()))
    if (this.boardHost) this.disposers.push(observeResize(this.boardHost, () => this.resize()))

    const onDown = (e: PointerEvent) => this.onPointerDown(e)
    const onMove = (e: PointerEvent) => this.onPointerMove(e)
    const onUp = (e: PointerEvent) => this.onPointerUp(e)
    const onKey = (e: KeyboardEvent) => this.onKey(e)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    this.disposers.push(() => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    })
    this.disposers.push(
      startLoop(
        (dt) => this.update(dt),
        () => this.render(),
      ),
    )

    if (import.meta.env.DEV) {
      const hook: DevHook = {
        solution: () =>
          this.level.paths.map((p) => ({
            color: p.color,
            cells: p.cells.map((c) => [c.r, c.c] as [number, number]),
            waypoints: p.waypoints.map((w) => ({ r: w.r, c: w.c, kind: w.kind })),
          })),
        cellCenter: (r, c) => {
          const rect = this.canvas.getBoundingClientRect()
          return {
            x: rect.left + this.board.x + (c + 0.5) * this.board.cell,
            y: rect.top + this.board.y + (r + 0.5) * this.board.cell,
          }
        },
        state: () => ({
          phase: this.phase,
          moves: this.moves,
          solved: this.solved,
          connected: this.connectedCount(),
          pairs: this.paths.length,
          level: this.level.level,
          armed: this.armed,
        }),
        grid: () => ({ size: this.n, kinds: this.tiles.map((t) => t.kind) }),
        paths: () => this.paths.map((p) => p.map((c) => [c.r, c.c] as [number, number])),
      }
      ;(window as unknown as { __networkConnect?: DevHook }).__networkConnect = hook
    }
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const d of this.disposers) d()
    this.disposers = []
    if (import.meta.env.DEV) delete (window as unknown as { __networkConnect?: DevHook }).__networkConnect
  }

  /* ---------------------------------------------------------------- */
  /* public API used by the React component                            */

  hasProgress(): boolean {
    return loadProgress() !== null
  }

  getProgress(): Progress {
    return this.progress
  }

  start(mode: 'new' | 'continue') {
    if (mode === 'new') {
      this.progress = defaultProgress()
      this.saveProgress()
    } else {
      this.progress = loadProgress() ?? defaultProgress()
    }
    this.loadLevel(this.progress.level)
    this.setPhase('playing')
    sfx.play('click')
  }

  nextLevel() {
    this.loadLevel(this.progress.level)
    this.setPhase('playing')
    sfx.play('click')
  }

  replayLevel() {
    this.loadLevel(this.level.level)
    this.setPhase('playing')
    sfx.play('click')
  }

  /** Clears every path. The move counter is kept on purpose (a reset is not free). */
  resetLevel() {
    if (this.phase !== 'playing' || this.solved) return
    if (this.paths.every((p) => p.length === 0)) return
    this.pushHistory()
    this.paths = this.paths.map(() => [])
    this.drag = null
    this.rebuildOcc()
    sfx.play('whoosh')
    this.syncHud()
  }

  undo() {
    if (this.phase !== 'playing' || this.solved || this.drag) return
    const prev = this.history.pop()
    if (!prev) return
    this.paths = prev
    this.rebuildOcc()
    sfx.play('click')
    this.syncHud()
  }

  cancelArmed() {
    if (!this.armed) return
    this.armed = null
    sfx.play('click')
    this.syncHud()
  }

  usePowerUp(kind: PowerUp) {
    if (this.phase !== 'playing' || this.solved) return
    if (this.progress.inventory[kind] <= 0) {
      this.deny('No charges left')
      return
    }
    switch (kind) {
      case 'reroute':
        this.reroute()
        break
      case 'firewall':
        if (this.armed === 'firewall') {
          this.cancelArmed()
          return
        }
        if (!this.tiles.some((t) => t.kind === 'block')) {
          this.deny('No firewall blocks here')
          return
        }
        this.armed = 'firewall'
        sfx.play('click')
        this.toast('Tap a firewall block', '#ff8c8c')
        break
      case 'vpn':
        if (this.armed === 'vpn') {
          this.cancelArmed()
          return
        }
        if (!this.tiles.some((t) => t.kind === 'block' || t.kind === 'broken')) {
          this.deny('Nothing to tunnel through')
          return
        }
        this.armed = 'vpn'
        sfx.play('click')
        this.toast('VPN armed – draw through a block', '#8fd3ff')
        break
      case 'boost':
        this.boost()
        break
    }
    this.syncHud()
  }

  /* ---------------------------------------------------------------- */
  /* level state                                                       */

  private idx(c: Cell) {
    return c.r * this.n + c.c
  }

  private tile(c: Cell) {
    return this.tiles[this.idx(c)]
  }

  private loadLevel(levelNo: number) {
    this.level = generateLevel(levelNo)
    this.n = this.level.size
    this.tiles = this.level.kinds.map((kind) => ({ kind, end: -1, endWhich: 0, way: -1, wayKind: null }))
    this.ends = []
    this.ways = []
    for (const p of this.level.paths) {
      const first = p.cells[0]
      const last = p.cells[p.cells.length - 1]
      this.tile(first).end = p.color
      this.tile(first).endWhich = 0
      this.tile(last).end = p.color
      this.tile(last).endWhich = 1
      this.ends[p.color] = [first, last]
      this.ways[p.color] = p.waypoints.map((w) => ({ r: w.r, c: w.c }))
      for (const w of p.waypoints) {
        this.tile(w).way = p.color
        this.tile(w).wayKind = w.kind
      }
    }
    this.paths = this.level.paths.map(() => [])
    this.occ = new Int8Array(this.n * this.n)
    this.moves = 0
    this.usedTypes.clear()
    this.armed = null
    this.drag = null
    this.history = []
    this.solved = false
    this.winAt = -1
    this.winShown = false
    this.win = null
    this.particles.length = 0
    this.floats.length = 0
    this.flashes.length = 0
    this.pendingBursts.length = 0
    this.pulse = new Float32Array(this.paths.length)
    this.rebuildOcc()
    this.layoutBoard()
    this.syncHud()
  }

  private rebuildOcc() {
    this.occ.fill(-1)
    this.paths.forEach((path, color) => {
      for (const c of path) this.occ[this.idx(c)] = color
    })
  }

  private isComplete(color: number): boolean {
    const path = this.paths[color]
    if (path.length < 2) return false
    const [a, b] = this.ends[color]
    const first = path[0]
    const last = path[path.length - 1]
    const endsOk = (sameCell(first, a) && sameCell(last, b)) || (sameCell(first, b) && sameCell(last, a))
    if (!endsOk) return false
    return this.ways[color].every((w) => path.some((c) => sameCell(c, w)))
  }

  private connectedCount() {
    let n = 0
    for (let c = 0; c < this.paths.length; c++) if (this.isComplete(c)) n++
    return n
  }

  private latency() {
    let n = 0
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i].kind === 'loss' && this.occ[i] >= 0) n++
    return n
  }

  private starsFor(moves: number, latency: number) {
    const pairs = this.paths.length
    if (moves <= pairs && latency === 0) return 3
    if (moves <= pairs + 3) return 2
    return 1
  }

  private isEndpointOf(cell: Cell, color: number) {
    const t = this.tile(cell)
    return t.end === color
  }

  /** Orientation-independent serialisation, used to detect whether a stroke changed anything. */
  private serialize(): string {
    return this.paths
      .map((p) => {
        const f = p.map((c) => `${c.r},${c.c}`).join(';')
        const b = p
          .slice()
          .reverse()
          .map((c) => `${c.r},${c.c}`)
          .join(';')
        return f < b ? f : b
      })
      .join('|')
  }

  private clonePaths(): Cell[][] {
    return this.paths.map((p) => p.map((c) => ({ r: c.r, c: c.c })))
  }

  private pushHistory(snapshot?: Cell[][]) {
    this.history.push(snapshot ?? this.clonePaths())
    if (this.history.length > HISTORY_LIMIT) this.history.shift()
  }

  private saveProgress() {
    saveJSON(PROGRESS_KEY, this.progress)
  }

  private setPhase(p: Phase) {
    this.phase = p
    this.onPhase(p)
    this.syncHud()
  }

  private syncHud() {
    let loss = 0
    let blocks = 0
    let broken = 0
    for (const t of this.tiles) {
      if (t.kind === 'loss') loss++
      else if (t.kind === 'block') blocks++
      else if (t.kind === 'broken') broken++
    }
    const latency = this.latency()
    const hud: HudState = {
      level: this.level.level,
      name: this.level.name,
      size: this.n,
      moves: this.moves,
      stars: this.starsFor(this.moves, latency),
      latency,
      coins: this.progress.coins,
      inventory: { ...this.progress.inventory },
      armed: this.armed,
      pairs: this.paths.length,
      connected: this.connectedCount(),
      loss,
      blocks,
      broken,
      canUndo: this.history.length > 0,
      solved: this.solved,
      win: this.win,
    }
    const key = JSON.stringify(hud)
    if (key === this.lastHud) return
    this.lastHud = key
    this.onHud(hud)
  }

  /* ---------------------------------------------------------------- */
  /* power-ups                                                         */

  private consume(kind: PowerUp) {
    this.progress.inventory[kind] = Math.max(0, this.progress.inventory[kind] - 1)
    this.usedTypes.add(kind)
    this.saveProgress()
  }

  private reroute() {
    let best = -1
    for (let c = 0; c < this.paths.length; c++) {
      if (this.isComplete(c)) continue
      if (best < 0 || this.paths[c].length < this.paths[best].length) best = c
    }
    if (best < 0) {
      this.deny('All paths connected already')
      return
    }
    this.pushHistory()
    const solution = this.level.paths[best].cells.map((c) => ({ r: c.r, c: c.c }))
    for (const cell of solution) {
      const o = this.occ[this.idx(cell)]
      if (o >= 0 && o !== best) {
        const other = this.paths[o]
        const k = other.findIndex((x) => sameCell(x, cell))
        if (k >= 0) other.length = k
      }
      this.rebuildOcc()
    }
    this.paths[best] = solution
    this.rebuildOcc()
    this.moves++
    this.consume('reroute')
    sfx.play('whoosh')
    sfx.play('connect')
    const col = PALETTE[best]
    for (const cell of solution) {
      const { x, y } = this.cellCenter(cell)
      burst(this.particles, x, y, 3, [col, '#ffffff'], { speed: 90, life: 0.5, size: 4, gravity: 0, shape: 'circle' })
    }
    this.pulse[best] = 1
    this.toast('REROUTED', col)
    this.checkWin()
  }

  private boost() {
    const targets: Cell[] = []
    this.tiles.forEach((t, i) => {
      if (t.kind === 'loss' || t.kind === 'broken') targets.push({ r: Math.floor(i / this.n), c: i % this.n })
    })
    if (targets.length === 0) {
      this.deny('Network already healthy')
      return
    }
    for (const cell of targets) {
      this.tile(cell).kind = 'free'
      const { x, y } = this.cellCenter(cell)
      burst(this.particles, x, y, 14, ['#37e36b', '#b7ffd0', '#ffffff'], { speed: 160, life: 0.7, size: 5, gravity: 300 })
      this.flashes.push({ cell, t: 0.6, color: '#37e36b' })
    }
    this.consume('boost')
    sfx.play('repair')
    this.toast('NETWORK BOOST', '#37e36b')
    this.shake = 4
  }

  private removeBlock(cell: Cell) {
    this.tile(cell).kind = 'free'
    this.armed = null
    this.consume('firewall')
    const { x, y } = this.cellCenter(cell)
    burst(this.particles, x, y, 22, ['#c25a2b', '#e07a45', '#7a3312', '#ffd0a8'], { speed: 220, life: 0.8, size: 6, gravity: 700 })
    this.flashes.push({ cell, t: 0.6, color: '#ff8c42' })
    sfx.play('explode')
    this.toast('FIREWALL REMOVED', '#ff8c42')
    this.shake = 6
    this.syncHud()
  }

  /* ---------------------------------------------------------------- */
  /* input                                                             */

  private cellAt(x: number, y: number, slack = 0): Cell | null {
    const { x: bx, y: by, size, cell } = this.board
    if (size <= 0) return null
    if (x < bx - slack || y < by - slack || x >= bx + size + slack || y >= by + size + slack) return null
    const c = clamp(Math.floor((x - bx) / cell), 0, this.n - 1)
    const r = clamp(Math.floor((y - by) / cell), 0, this.n - 1)
    return { r, c }
  }

  private onPointerDown(e: PointerEvent) {
    if (this.phase !== 'playing' || this.solved) return
    sfx.unlock()
    const { x, y } = pointerPos(this.canvas, e)
    const cell = this.cellAt(x, y)
    if (!cell) {
      if (this.armed === 'firewall') this.cancelArmed()
      return
    }
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      /* capture is a nicety */
    }
    const t = this.tile(cell)
    if (this.armed === 'firewall') {
      if (t.kind === 'block') {
        this.removeBlock(cell)
        return
      }
      // tapping anything else disarms and falls through to normal drawing
      this.armed = null
      this.syncHud()
    }

    const snapshot = this.serialize()
    const before = this.clonePaths()
    let color = -1
    let pending: Pending = null
    if (t.end >= 0) {
      color = t.end
      pending = { type: 'restart', cell }
    } else if (t.way >= 0) {
      color = t.way
      const path = this.paths[color]
      const i = path.findIndex((c) => sameCell(c, cell))
      if (i < 0) pending = { type: 'restart', cell }
      else if (i === 0 && path.length > 1) {
        // Grabbing the anchor end of a waypoint-anchored path: draw from this end instead.
        path.reverse()
        this.rebuildOcc()
      } else pending = { type: 'truncate', index: i }
    } else {
      const o = this.occ[this.idx(cell)]
      if (o < 0) return
      color = o
      pending = { type: 'truncate', index: this.paths[o].findIndex((c) => sameCell(c, cell)) }
    }
    this.drag = { color, pending, cur: cell, lastX: x, lastY: y, tunnelled: false, snapshot, before }
    sfx.play('tap')
  }

  private onPointerMove(e: PointerEvent) {
    const d = this.drag
    if (!d) return
    const { x, y } = pointerPos(this.canvas, e)
    // Walk from the previous pointer position so a fast swipe still visits every cell on the way.
    const distance = Math.hypot(x - d.lastX, y - d.lastY)
    const steps = Math.max(1, Math.ceil(distance / Math.max(8, this.board.cell * 0.3)))
    for (let s = 1; s <= steps; s++) {
      const px = lerp(d.lastX, x, s / steps)
      const py = lerp(d.lastY, y, s / steps)
      const cell = this.cellAt(px, py, this.board.cell * 0.35)
      if (cell && !sameCell(cell, d.cur)) this.enterCell(cell)
      if (!this.drag) break
    }
    if (this.drag) {
      this.drag.lastX = x
      this.drag.lastY = y
    }
  }

  private onPointerUp(e: PointerEvent) {
    const d = this.drag
    if (!d) return
    this.drag = null
    try {
      this.canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (this.serialize() !== d.snapshot) {
      this.pushHistory(d.before)
      this.moves++
    }
    this.checkWin()
    this.syncHud()
  }

  private onKey(e: KeyboardEvent) {
    if (this.phase !== 'playing') return
    if (e.key === 'Escape') {
      if (this.armed) {
        this.cancelArmed()
        e.preventDefault()
      }
    } else if (e.key === 'r' || e.key === 'R') {
      this.resetLevel()
    } else if (e.key === 'z' || e.key === 'Z' || e.key === 'u' || e.key === 'U') {
      this.undo()
    }
  }

  /** The pointer entered a new cell while drawing. Applies the Flow Free rules. */
  private enterCell(cell: Cell) {
    const d = this.drag
    if (!d) return
    d.cur = cell

    // The press itself is deferred until the pointer actually moves, so a tap never
    // destroys anything. Moving back along the existing path simply retracts it; only a
    // move into a cell *off* the path applies the pressed-cell semantics (restart from
    // an endpoint / waypoint, or cut the path at the pressed tile).
    if (d.pending) {
      const p = d.pending
      d.pending = null
      const onPath = this.paths[d.color].some((c) => sameCell(c, cell))
      if (!onPath) {
        if (p.type === 'restart') this.paths[d.color] = [{ r: p.cell.r, c: p.cell.c }]
        else this.paths[d.color].length = p.index + 1
        this.rebuildOcc()
      }
    }

    const path = this.paths[d.color]
    const head = path[path.length - 1]
    if (sameCell(cell, head)) return

    // Back onto our own path: retract to that cell.
    const j = path.findIndex((c) => sameCell(c, cell))
    if (j >= 0) {
      path.length = j + 1
      this.rebuildOcc()
      return
    }

    if (adjacent(cell, head)) {
      this.step(cell)
      return
    }
    // Diagonal jump (the pointer crossed a corner): route through whichever side cell is open.
    if (Math.abs(cell.r - head.r) === 1 && Math.abs(cell.c - head.c) === 1) {
      const viaA = { r: head.r, c: cell.c }
      const viaB = { r: cell.r, c: head.c }
      for (const via of [viaA, viaB]) {
        if (this.step(via, true)) {
          this.step(cell)
          return
        }
      }
    }
  }

  /** Try to extend the dragged path into `cell` (which is adjacent to the head). Returns true if it did. */
  private step(cell: Cell, quiet = false): boolean {
    const d = this.drag
    if (!d) return false
    const path = this.paths[d.color]
    const head = path[path.length - 1]
    // A path never continues past an endpoint.
    if (path.length > 1 && this.isEndpointOf(head, d.color)) return false
    if (path.findIndex((c) => sameCell(c, cell)) >= 0) return false
    const t = this.tile(cell)
    if ((t.end >= 0 && t.end !== d.color) || (t.way >= 0 && t.way !== d.color)) {
      if (!quiet) this.deny()
      return false
    }
    if (t.kind === 'block' || t.kind === 'broken') {
      if (this.armed === 'vpn' && !d.tunnelled && this.progress.inventory.vpn > 0) {
        t.kind = 'tunnel'
        d.tunnelled = true
        this.armed = null
        this.consume('vpn')
        const { x, y } = this.cellCenter(cell)
        burst(this.particles, x, y, 18, ['#2fa8ff', '#8fd3ff', '#ffffff'], { speed: 170, life: 0.7, size: 5, gravity: 200 })
        this.flashes.push({ cell, t: 0.7, color: '#2fa8ff' })
        sfx.play('repair')
        this.toast('VPN TUNNEL', '#4fd0ff')
        this.syncHud()
      } else {
        if (!quiet) this.deny()
        return false
      }
    }
    // Another colour's path: cut it from this cell onward (Flow Free behaviour).
    const o = this.occ[this.idx(cell)]
    if (o >= 0 && o !== d.color) {
      const other = this.paths[o]
      const k = other.findIndex((c) => sameCell(c, cell))
      if (k >= 1) other.length = k
      else if (k === 0) other.length = 0
    }
    path.push({ r: cell.r, c: cell.c })
    this.rebuildOcc()
    if (t.kind === 'loss') this.toast('+1 LATENCY', '#ff6b6b', cell)
    if (t.end === d.color && this.isComplete(d.color)) {
      sfx.play('connect')
      const col = PALETTE[d.color]
      const { x, y } = this.cellCenter(cell)
      burst(this.particles, x, y, 16, [col, '#ffffff'], { speed: 150, life: 0.6, size: 5, gravity: 250, shape: 'circle' })
      this.pulse[d.color] = 1
    }
    return true
  }

  private deny(message?: string) {
    if (this.time - this.denyAt > 0.25) {
      sfx.play('denied')
      this.denyAt = this.time
    }
    if (message) this.toast(message, '#ff6b6b')
  }

  private toast(text: string, color: string, cell?: Cell, yFrac = 0.42) {
    const pos = cell ? this.cellCenter(cell) : { x: this.board.x + this.board.size / 2, y: this.board.y + this.board.size * yFrac }
    this.floats.push({ x: pos.x, y: pos.y, text, color, life: 1.2, maxLife: 1.2, size: cell ? Math.max(12, this.board.cell * 0.26) : 22 })
    if (this.floats.length > 6) this.floats.shift()
  }

  /* ---------------------------------------------------------------- */
  /* win                                                               */

  private checkWin() {
    if (this.solved) return
    for (let c = 0; c < this.paths.length; c++) if (!this.isComplete(c)) return
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i].kind === 'tile' && this.occ[i] < 0) return
    this.solve()
  }

  private solve() {
    this.solved = true
    this.winAt = this.time
    this.drag = null
    this.armed = null
    const latency = this.latency()
    const stars = this.starsFor(this.moves, latency)
    const unused = POWER_UPS.filter((p) => !this.usedTypes.has(p)).length
    const bonus = 20 * unused
    const earned = 100 * stars + bonus
    const levelNo = this.level.level
    this.progress.coins += earned
    this.progress.level = Math.max(this.progress.level, levelNo + 1)
    this.progress.bestLevel = Math.max(this.progress.bestLevel, levelNo + 1)
    // One extra charge for a random power-up that is not full yet.
    const candidates = POWER_UPS.filter((p) => this.progress.inventory[p] < MAX_CHARGES)
    let gift: PowerUp | null = null
    if (candidates.length) {
      const rng = seededRng(this.level.seed ^ (this.moves * 977))
      gift = candidates[Math.floor(rng() * candidates.length)]
      this.progress.inventory[gift]++
    }
    this.saveProgress()
    submitBest(SLUG, this.progress.coins)
    this.win = { level: levelNo, moves: this.moves, latency, stars, earned, bonus, unused, gift, coins: this.progress.coins, nextLevel: levelNo + 1 }
    sfx.play('win')
    this.shake = 8
    this.pendingBursts = [0.05, 0.3, 0.55, 0.85]
    this.toast(`+${earned} COINS`, '#ffd43b', undefined, 0.22)
    for (let c = 0; c < this.paths.length; c++) this.pulse[c] = 1
    this.syncHud()
  }

  /* ---------------------------------------------------------------- */
  /* layout & update                                                   */

  private resize() {
    const { width, height } = fitCanvas(this.canvas)
    this.width = width
    this.height = height
    this.layoutBoard()
  }

  private layoutBoard() {
    let ax = 0
    let ay = 0
    let aw = this.width
    let ah = this.height
    if (this.boardHost) {
      const hr = this.boardHost.getBoundingClientRect()
      const cr = this.canvas.getBoundingClientRect()
      if (hr.width > 40 && hr.height > 40) {
        ax = hr.left - cr.left
        ay = hr.top - cr.top
        aw = hr.width
        ah = hr.height
      }
    }
    const margin = Math.max(10, Math.min(aw, ah) * 0.035)
    const inner = Math.max(60, Math.min(aw, ah) - margin * 2)
    const cell = Math.floor(inner / this.n)
    const size = cell * this.n
    this.board = {
      x: Math.round(ax + (aw - size) / 2),
      y: Math.round(ay + (ah - size) / 2),
      size,
      cell,
    }
  }

  private cellCenter(c: Cell) {
    return { x: this.board.x + (c.c + 0.5) * this.board.cell, y: this.board.y + (c.r + 0.5) * this.board.cell }
  }

  private buildBackdrop() {
    const rng = seededRng(2024)
    let x = 0
    while (x < 1) {
      const w = 0.018 + rng() * 0.045
      const windows: number[] = []
      const count = Math.floor(rng() * 4)
      for (let i = 0; i < count; i++) windows.push(rng())
      this.skyline.push({ x, w, h: 0.05 + rng() * 0.14, windows })
      x += w + 0.004 + rng() * 0.02
    }
    for (let i = 0; i < 18; i++) {
      this.bgNodes.push({ x: rng(), y: rng() * 0.42, phase: rng() * Math.PI * 2, speed: 0.15 + rng() * 0.25, r: 1.5 + rng() * 2 })
    }
  }

  private update(dt: number) {
    this.time += dt
    updateParticles(this.particles, dt)
    updateFloatTexts(this.floats, dt)
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].t -= dt
      if (this.flashes[i].t <= 0) this.flashes.splice(i, 1)
    }
    for (let c = 0; c < this.pulse.length; c++) this.pulse[c] = Math.max(0, this.pulse[c] - dt * 1.6)
    this.shake = Math.max(0, this.shake - dt * 18)
    if (this.solved) {
      const since = this.time - this.winAt
      while (this.pendingBursts.length && since >= this.pendingBursts[0]) {
        this.pendingBursts.shift()
        const bx = this.board.x + this.board.size * (0.15 + Math.random() * 0.7)
        const by = this.board.y + this.board.size * (0.1 + Math.random() * 0.5)
        burst(this.particles, bx, by, 34, [...PALETTE, '#ffffff'], { speed: 320, life: 1.3, size: 7, gravity: 520 })
      }
      if (!this.winShown && since > 1.7) {
        this.winShown = true
        sfx.play('coin')
        this.setPhase('won')
      }
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400)
  }

  /* ---------------------------------------------------------------- */
  /* rendering                                                         */

  private render() {
    const ctx = this.ctx
    const { width: W, height: H } = this
    if (W <= 0 || H <= 0) return
    ctx.save()
    ctx.clearRect(0, 0, W, H)
    this.drawBackdrop()
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake)
    }
    this.drawBoard()
    drawParticles(ctx, this.particles)
    drawFloatTexts(ctx, this.floats)
    // The banner hands over to the HTML "level cleared" card once that is shown.
    if (this.solved && !this.winShown) this.drawWinBanner()
    ctx.restore()
  }

  private drawBackdrop() {
    const ctx = this.ctx
    const { width: W, height: H, time } = this
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#0d1b42')
    g.addColorStop(0.5, '#0b1736')
    g.addColorStop(1, '#070f26')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // faint city skyline silhouette across the top
    const base = Math.min(H * 0.3, 240)
    ctx.fillStyle = 'rgba(28, 52, 110, 0.28)'
    for (const b of this.skyline) {
      const bh = b.h * base * 1.6
      ctx.fillRect(b.x * W, base - bh, b.w * W, bh)
    }
    ctx.fillStyle = 'rgba(120, 190, 255, 0.35)'
    for (const b of this.skyline) {
      const bh = b.h * base * 1.6
      for (const wv of b.windows) {
        const wx = b.x * W + b.w * W * (0.2 + wv * 0.6)
        const wy = base - bh + bh * ((wv * 7) % 1) * 0.8 + 4
        ctx.fillRect(wx, wy, 2, 2)
      }
    }
    const fade = ctx.createLinearGradient(0, base * 0.4, 0, base + 40)
    fade.addColorStop(0, 'rgba(11,23,54,0)')
    fade.addColorStop(1, 'rgba(11,23,54,0.9)')
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, W, base + 40)

    // drifting node-link decoration
    const nodes = this.bgNodes
    const px: number[] = []
    const py: number[] = []
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i]
      px[i] = nd.x * W + Math.sin(time * nd.speed + nd.phase) * 14
      py[i] = nd.y * H * 0.9 + Math.cos(time * nd.speed * 0.8 + nd.phase) * 10
    }
    ctx.strokeStyle = 'rgba(79, 160, 255, 0.16)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 5])
    ctx.beginPath()
    const maxD = Math.max(120, W * 0.14)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = px[i] - px[j]
        const dy = py[i] - py[j]
        if (dx * dx + dy * dy < maxD * maxD) {
          ctx.moveTo(px[i], py[i])
          ctx.lineTo(px[j], py[j])
        }
      }
    }
    ctx.stroke()
    ctx.setLineDash([])
    for (let i = 0; i < nodes.length; i++) {
      const tw = 0.5 + 0.5 * Math.sin(time * 1.3 + nodes[i].phase)
      ctx.fillStyle = `rgba(120, 200, 255, ${0.25 + tw * 0.45})`
      ctx.beginPath()
      ctx.arc(px[i], py[i], nodes[i].r, 0, Math.PI * 2)
      ctx.fill()
    }

    // floor glow under the board
    const fg = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, Math.max(W, H) * 0.6)
    fg.addColorStop(0, 'rgba(47,168,255,0.12)')
    fg.addColorStop(1, 'rgba(47,168,255,0)')
    ctx.fillStyle = fg
    ctx.fillRect(0, H * 0.5, W, H * 0.5)
  }

  private drawBoard() {
    const ctx = this.ctx
    const { x: bx, y: by, size, cell } = this.board
    if (size <= 0) return
    const n = this.n
    const pad = Math.max(8, cell * 0.14)
    const panelR = Math.max(14, cell * 0.28)

    // panel with glowing border
    ctx.save()
    ctx.shadowColor = 'rgba(47,168,255,0.55)'
    ctx.shadowBlur = 24
    fillRoundRect(ctx, bx - pad, by - pad, size + pad * 2, size + pad * 2, panelR, '#091230')
    ctx.restore()
    strokeRoundRect(ctx, bx - pad, by - pad, size + pad * 2, size + pad * 2, panelR, 'rgba(79,170,255,0.55)', 2)
    strokeRoundRect(ctx, bx - pad + 3, by - pad + 3, size + pad * 2 - 6, size + pad * 2 - 6, panelR - 3, 'rgba(255,255,255,0.06)', 1)

    // tiles
    const gap = Math.max(2, cell * 0.06)
    const tr = Math.max(5, cell * 0.14)
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const t = this.tiles[r * n + c]
        const x = bx + c * cell + gap / 2
        const y = by + r * cell + gap / 2
        const s = cell - gap
        if (t.kind === 'block') {
          drawBricks(ctx, x, y, s, s, tr)
          strokeRoundRect(ctx, x, y, s, s, tr, 'rgba(0,0,0,0.45)', 1)
          continue
        }
        const optional = t.kind !== 'tile'
        fillRoundRect(ctx, x, y, s, s, tr, optional ? '#0c1733' : '#13224a')
        strokeRoundRect(ctx, x + 0.5, y + 0.5, s - 1, s - 1, tr, optional ? '#17264d' : '#1d2f5c', 1)
        if (t.kind === 'loss') {
          drawGlyph(ctx, 'loss', x + s / 2, y + s * (cell >= 44 ? 0.4 : 0.5), s * 0.42, '#ff4a4a')
          if (cell >= 44) this.tileLabel('PACKET LOSS', x + s / 2, y + s * 0.78, s, 'rgba(255,255,255,0.85)')
        } else if (t.kind === 'broken') {
          ctx.save()
          ctx.shadowColor = 'rgba(255,255,255,0.5)'
          ctx.shadowBlur = 8
          drawGlyph(ctx, 'broken', x + s / 2, y + s * (cell >= 44 ? 0.4 : 0.5), s * 0.5, '#ffffff')
          ctx.restore()
          if (cell >= 44) this.tileLabel('BROKEN', x + s / 2, y + s * 0.8, s, 'rgba(255,255,255,0.85)')
        } else if (t.kind === 'tunnel') {
          fillRoundRect(ctx, x, y, s, s, tr, 'rgba(47,168,255,0.12)')
          drawGlyph(ctx, 'lock', x + s / 2, y + s * (cell >= 44 ? 0.42 : 0.5), s * 0.42, '#8fd3ff', '#0b1736')
          if (cell >= 44) this.tileLabel('VPN', x + s / 2, y + s * 0.8, s, 'rgba(143,211,255,0.9)')
        } else if (t.kind === 'free') {
          // optional tile (obstacle removed by a power-up): dashed outline, no data required
          ctx.save()
          ctx.setLineDash([4, 4])
          strokeRoundRect(ctx, x + 3, y + 3, s - 6, s - 6, tr - 2, 'rgba(130,180,255,0.4)', 1.5)
          ctx.restore()
        }
      }
    }

    // armed power-up highlights: tint + pulsing outline on every tile the power-up can target
    if (this.armed) {
      const a = 0.65 + 0.35 * Math.sin(this.time * 7)
      const rgb = this.armed === 'firewall' ? '255,74,74' : '79,208,255'
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const t = this.tiles[r * n + c]
          const hit = this.armed === 'firewall' ? t.kind === 'block' : t.kind === 'block' || t.kind === 'broken'
          if (!hit) continue
          fillRoundRect(ctx, bx + c * cell + gap / 2, by + r * cell + gap / 2, cell - gap, cell - gap, tr, `rgba(${rgb},${0.18 + a * 0.12})`)
          ctx.save()
          ctx.shadowColor = `rgba(${rgb},0.9)`
          ctx.shadowBlur = 12
          strokeRoundRect(ctx, bx + c * cell + 2, by + r * cell + 2, cell - 4, cell - 4, tr, `rgba(${rgb},${a})`, 3)
          ctx.restore()
        }
      }
    }

    // tile flashes (power-up effects)
    for (const f of this.flashes) {
      const a = clamp(f.t / 0.6, 0, 1)
      ctx.save()
      ctx.globalAlpha = a * 0.7
      fillRoundRect(ctx, bx + f.cell.c * cell + gap / 2, by + f.cell.r * cell + gap / 2, cell - gap, cell - gap, tr, f.color)
      ctx.restore()
    }

    // paths
    const w = cell * 0.45
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let color = 0; color < this.paths.length; color++) {
      const path = this.paths[color]
      if (path.length < 2) continue
      const col = PALETTE[color]
      const complete = this.isComplete(color)
      const pulse = this.pulse[color]
      ctx.beginPath()
      for (let i = 0; i < path.length; i++) {
        const { x, y } = this.cellCenter(path[i])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = hexToRgba(col, complete ? 0.34 + pulse * 0.3 : 0.22)
      ctx.lineWidth = w * (complete ? 1.95 : 1.75) + pulse * w * 0.6
      ctx.stroke()
      ctx.strokeStyle = col
      ctx.lineWidth = w
      ctx.stroke()
      ctx.strokeStyle = `rgba(255,255,255,${complete ? 0.45 : 0.3})`
      ctx.lineWidth = w * 0.3
      ctx.stroke()
    }

    // drawing head
    if (this.drag) {
      const path = this.paths[this.drag.color]
      if (path.length) {
        const head = path[path.length - 1]
        const { x, y } = this.cellCenter(head)
        const col = PALETTE[this.drag.color]
        ctx.save()
        ctx.globalAlpha = 0.55 + 0.3 * Math.sin(this.time * 10)
        ctx.strokeStyle = col
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(x, y, cell * 0.36, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }

    // endpoints & waypoints
    const boxSize = cell - gap * 1.2
    const labelled = cell >= 44
    for (let color = 0; color < this.paths.length; color++) {
      const col = PALETTE[color]
      const complete = this.isComplete(color)
      const [user, cloud] = this.ends[color]
      const lit = complete || (this.drag?.color === color && this.paths[color].length > 0)
      drawNodeBox(ctx, bx + user.c * cell + (cell - boxSize) / 2, by + user.r * cell + (cell - boxSize) / 2, boxSize, col, 'user', labelled ? 'USER' : null, { lit, pulse: this.pulse[color] })
      drawNodeBox(ctx, bx + cloud.c * cell + (cell - boxSize) / 2, by + cloud.r * cell + (cell - boxSize) / 2, boxSize, col, 'cloud', labelled ? 'CLOUD' : null, { lit, pulse: this.pulse[color] })
      for (const wp of this.ways[color]) {
        const kind = this.tile(wp).wayKind ?? 'switch'
        drawNodeBox(ctx, bx + wp.c * cell + (cell - boxSize) / 2, by + wp.r * cell + (cell - boxSize) / 2, boxSize, col, kind, labelled ? NODE_LABEL[kind] : null, { lit, pulse: this.pulse[color] })
      }
    }

    // packets travelling along completed paths
    for (let color = 0; color < this.paths.length; color++) {
      if (!this.isComplete(color)) continue
      const path = this.paths[color]
      const col = PALETTE[color]
      const segs = path.length - 1
      const forward = sameCell(path[0], this.ends[color][0])
      const count = Math.max(1, Math.round(segs / 3.5))
      const speed = 2.4
      ctx.save()
      ctx.shadowColor = col
      ctx.shadowBlur = cell * 0.3
      for (let k = 0; k < count; k++) {
        let t = (this.time * speed + (k * segs) / count) % segs
        if (!forward) t = segs - t
        const i = clamp(Math.floor(t), 0, segs - 1)
        const f = t - i
        const a = this.cellCenter(path[i])
        const b = this.cellCenter(path[i + 1])
        const x = lerp(a.x, b.x, f)
        const y = lerp(a.y, b.y, f)
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(x, y, cell * 0.085, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }

  private tileLabel(text: string, x: number, y: number, s: number, color: string) {
    const ctx = this.ctx
    const words = text.split(' ')
    const fontPx = Math.max(7, Math.min(11, s * 0.14))
    ctx.save()
    ctx.font = `800 ${fontPx}px "Nunito", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    if (words.length === 2 && s < 70) {
      ctx.fillText(words[0], x, y - fontPx * 0.55)
      ctx.fillText(words[1], x, y + fontPx * 0.6)
    } else {
      ctx.fillText(text, x, y)
    }
    ctx.restore()
  }

  private drawWinBanner() {
    const ctx = this.ctx
    const t = clamp((this.time - this.winAt) / 0.55, 0, 1)
    const sc = easeOutBack(t)
    const { x: bx, y: by, size } = this.board
    const w = Math.min(size * 0.94, 560)
    const h = Math.max(54, Math.min(w * 0.17, 84))
    const cx = bx + size / 2
    const cy = by + size / 2
    // dim the board a touch
    ctx.save()
    ctx.globalAlpha = easeOutCubic(t) * 0.35
    fillRoundRect(ctx, bx - 8, by - 8, size + 16, size + 16, 18, '#030814')
    ctx.restore()

    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(sc, sc)
    ctx.shadowColor = 'rgba(55,227,107,0.7)'
    ctx.shadowBlur = 30
    fillRoundRect(ctx, -w / 2, -h / 2, w, h, h / 2, '#0b1f3a')
    ctx.shadowBlur = 0
    strokeRoundRect(ctx, -w / 2, -h / 2, w, h, h / 2, '#37e36b', 3)
    const glyphS = h * 0.62
    drawGlyph(ctx, 'check', -w / 2 + h * 0.62, 0, glyphS, '#ffffff', '#37e36b')
    outlinedText(ctx, 'ALL PATHS CONNECTED!', h * 0.28, 0, {
      font: `800 ${Math.round(h * 0.4)}px "Baloo 2", "Nunito", sans-serif`,
      fill: '#ffffff',
      stroke: shade('#37e36b', -0.6),
      strokeWidth: Math.max(3, h * 0.07),
    })
    ctx.restore()
  }
}
