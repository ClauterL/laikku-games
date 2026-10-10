/**
 * Seeded chunk spawner for Access Crossing (runner).
 *
 * The corridor is generated lazily ahead of the player in "chunks": safe stretches with coin
 * trails, obstacle rows (1–3 lanes blocked, always leaving a path that a lane change, a jump or a
 * slide can take), camera zones, gate rows, PIN rows, the reception checkpoint (once per floor)
 * and finally the elevator wall. Every hazard keeps at least `reactionGap(speed)` of track from
 * the previous one, so the player always has ~1 s to react.
 */
import { pick, randInt, randRange, seededRng, shuffle, type Rng } from '../../shared/rng'
import { BADGE_ORDER, SPAWN_AHEAD, makeEntity, type Badge, type ElevatorReq, type Entity, type ObstacleKind } from './types'
import { HAIRS, SHIRTS, SKINS, makeVisitor } from './visitors'

export type ChunkKind = 'safe' | 'obstacles' | 'camera' | 'gate' | 'pin'
export type EventType = 'gate' | 'camera' | 'pin' | 'reception' | 'elevator'

export interface SpawnContext {
  /** Player's track distance on the current floor. */
  dist: number
  speed: number
  inventory: ReadonlySet<Badge>
  floor: number
}

export const NAMED_FLOORS = 5

/** Nominal running time of a floor: 60 s on floor 1, growing to 90 s on floor 5 and beyond. */
export function floorSeconds(floor: number): number {
  return 60 + 7.5 * Math.min(4, floor - 1)
}

/** Track distance the player must keep between two hazards (≥ ~1 s of travel). */
export function reactionGap(speed: number): number {
  return Math.max(7.5, speed * 1.0)
}

const NO_BADGES: ReadonlySet<Badge> = new Set<Badge>()

/** Lane positions (in lane units) of the decorations hugging the walls. */
const DECOR_X = 1.72
const PILLAR_X = 1.82
const CAMERA_ZONE_DEPTH = 5
/**
 * People only start walking once they are this close to the player. Their spawn position is pushed
 * back by the distance they will cover, so they still meet the player where the row was planned
 * and never wander into the reaction gap of the row before them.
 */
export const WALK_TRIGGER_Z = 22

export function walkShift(walk: number, speed: number): number {
  return (walk * WALK_TRIGGER_Z) / (speed + walk)
}

/** Which badge a floor introduces as a pickup, given what the player holds. */
export function badgeForFloor(floor: number, inventory: ReadonlySet<Badge>): Badge | null {
  const order: Badge[] =
    floor <= 1 ? ['CONTRACTOR'] : floor === 2 ? ['VIP', 'CONTRACTOR'] : floor === 3 ? ['SECURITY', 'VIP', 'CONTRACTOR'] : ['SECURITY', 'VIP', 'CONTRACTOR', 'VISITOR']
  for (const b of order) if (!inventory.has(b)) return b
  return null
}

function elevatorDoors(rng: Rng, floor: number): ElevatorReq[] {
  let others: ElevatorReq[]
  if (floor <= 2) others = ['EMPLOYEE', 'VIP']
  else if (floor === 3) others = ['CONTRACTOR', 'VIP']
  else if (floor === 4) others = ['VIP', 'SECURITY']
  else others = shuffle(rng, BADGE_ORDER).slice(0, 2)
  return shuffle(rng, ['ALL', ...others] as ElevatorReq[])
}

/* ------------------------------------------------------------------------------------ */
/* Entity factories                                                                      */
/* ------------------------------------------------------------------------------------ */

export function makeObstacle(kind: ObstacleKind, lane: number, d: number, rng: Rng): Entity {
  const e = makeEntity(kind, lane, d)
  e.variant = randInt(rng, 0, 3)
  e.phase = rng() * Math.PI * 2
  switch (kind) {
    case 'person':
      e.depth = 0.6
      e.y1 = 1.7
      e.dodge = 'lane'
      e.shirt = pick(rng, SHIRTS)
      e.hair = pick(rng, HAIRS)
      e.skin = pick(rng, SKINS)
      break
    case 'guard':
      e.depth = 0.6
      e.y1 = 1.7
      e.dodge = 'lane'
      e.shirt = '#243a63'
      e.hair = '#1a1a1a'
      e.skin = pick(rng, SKINS)
      break
    case 'glass':
      e.depth = 0.3
      e.y1 = 3.0
      e.dodge = 'lane'
      break
    case 'robot':
      e.depth = 0.9
      e.y1 = 0.42
      e.dodge = 'jump'
      break
    case 'cart':
      e.depth = 1.1
      e.y1 = 0.5
      e.dodge = 'jump'
      break
    case 'trolley':
      e.depth = 1.2
      e.y1 = 0.5
      e.dodge = 'jump'
      break
    case 'wetsign':
      e.depth = 0.6
      e.y1 = 0.4
      e.dodge = 'jump'
      break
    case 'planter':
      e.depth = 1.0
      e.y1 = 0.4
      e.dodge = 'jump'
      break
    case 'barrier':
      // variant encodes the span: 0 = all lanes, −1 = left + centre, 1 = centre + right.
      e.depth = 0.3
      e.y0 = 0.58
      e.y1 = 0.95
      e.dodge = 'slide'
      break
  }
  return e
}

/** Does a barrier with span `variant` cover `lane`? */
export function barrierCovers(variant: number, lane: number): boolean {
  return variant === 0 || (variant < 0 && lane <= 0) || (variant > 0 && lane >= 0)
}

function coin(lane: number, d: number, y = 0): Entity {
  const e = makeEntity('coin', lane, d)
  e.y = y
  e.depth = 0.5
  return e
}

/* ------------------------------------------------------------------------------------ */
/* The spawner                                                                           */
/* ------------------------------------------------------------------------------------ */

export class Spawner {
  private rng: Rng = seededRng(1)
  private floor = 1
  /** Next free track position / how far the wall decorations have been placed. */
  private spawnD = 0
  private decorD = 0
  /** Track position of the last hazard (keeps the reaction gap). */
  private lastHazardD = -100
  floorEnd = 540
  private receptionD = 270
  private receptionPlaced = false
  private elevatorPlaced = false
  /** Scripted opening of a floor; afterwards chunks are picked by weight. */
  private script: ChunkKind[] = []
  private lastKind: ChunkKind = 'safe'
  private sinceGate = 0
  private sinceCamera = 0
  private sincePin = 0
  private badgeToPlace: Badge | null = null
  private powerNextD = 0
  private powerToggle = 0
  private signSide: 1 | -1 = 1
  private lastCameraD = -100
  /** Title-screen mode: an endless calm corridor with coin trails only. */
  private attract = false

  /** True once the elevator wall of the current floor exists. */
  get finished(): boolean {
    return this.elevatorPlaced
  }

  /** Endless, hazard-free corridor for the title screen. */
  startAttract(seed: number) {
    this.startFloor(seed, 1, 9, NO_BADGES)
    this.attract = true
    this.floorEnd = Number.POSITIVE_INFINITY
    this.receptionPlaced = true
    this.script = []
    this.badgeToPlace = null
    this.powerNextD = Number.POSITIVE_INFINITY
    this.spawnD = 6
  }

  startFloor(seed: number, floor: number, speed: number, inventory: ReadonlySet<Badge>) {
    this.attract = false
    this.rng = seededRng((seed + floor * 7919) >>> 0)
    this.floor = floor
    this.spawnD = 0
    this.decorD = 0
    this.lastHazardD = -100
    this.floorEnd = Math.round(speed * floorSeconds(floor))
    this.receptionD = Math.round(this.floorEnd * randRange(this.rng, 0.46, 0.56))
    this.receptionPlaced = false
    this.elevatorPlaced = false
    this.lastKind = 'safe'
    this.sinceGate = 0
    this.sinceCamera = 0
    this.sincePin = 0
    this.badgeToPlace = badgeForFloor(floor, inventory)
    this.powerNextD = floor === 1 ? 160 : 60
    this.signSide = 1
    this.lastCameraD = -100
    this.script = floor === 1 ? ['obstacles', 'safe', 'gate', 'obstacles', 'safe', 'camera', 'obstacles'] : ['obstacles', 'gate', 'obstacles', floor >= 2 ? 'pin' : 'safe', 'camera']
  }

  /** Generate everything that should exist up to SPAWN_AHEAD units in front of the player. */
  fill(list: Entity[], ctx: SpawnContext) {
    if (this.spawnD === 0) this.placeEasyStretch(list)
    const limit = ctx.dist + SPAWN_AHEAD
    let guard = 0
    while (this.spawnD < limit && guard++ < 40) {
      if (this.elevatorPlaced) break
      const finalLen = 14 + reactionGap(ctx.speed)
      if (this.spawnD >= this.floorEnd - finalLen - 2) {
        this.placeFinal(list, ctx)
        break
      }
      if (!this.receptionPlaced && this.spawnD >= this.receptionD - 4) {
        this.placeReception(list, ctx, this.spawnD)
        continue
      }
      const kind = this.chooseKind(ctx)
      this.placeChunk(kind, list, ctx)
    }
    this.decorate(list, Math.min(this.spawnD, this.elevatorPlaced ? this.floorEnd - 1 : this.spawnD))
  }

  /**
   * Dev helper: throw away everything ahead of the player and put one event of `type` about
   * 30 units ahead (with a short coin stretch before it) so a screenshot can catch it approaching.
   */
  forceEvent(type: EventType, list: Entity[], ctx: SpawnContext) {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i]
      if (e.d > ctx.dist + 2.5 || (e.kind === 'elevator' && !e.done)) list.splice(i, 1)
    }
    this.elevatorPlaced = false
    const d0 = ctx.dist + 8
    this.spawnD = d0
    // Decorations ahead were cleared too; let them regrow from just in front of the player.
    this.decorD = Math.min(this.decorD, ctx.dist + 3)
    this.lastHazardD = ctx.dist
    this.coinLine(list, pick(this.rng, [-1, 0, 1]), d0, 6)
    const eventD = ctx.dist + 30
    switch (type) {
      case 'gate':
        this.placeGate(list, ctx, eventD)
        break
      case 'camera':
        this.placeCamera(list, ctx, eventD)
        break
      case 'pin':
        this.placePin(list, ctx, ctx.dist + 16)
        break
      case 'reception':
        this.placeReception(list, ctx, eventD)
        break
      case 'elevator':
        this.floorEnd = Math.round(eventD + 4)
        this.placeFinal(list, ctx)
        break
    }
    // The dev event is now the nearest thing; keep everything after it coherent.
    if (type !== 'elevator') this.floorEnd = Math.max(this.floorEnd, this.spawnD + 120)
    this.decorate(list, this.spawnD)
  }

  /* ---------------------------------------------------------------------------------- */
  /* Chunk selection                                                                     */
  /* ---------------------------------------------------------------------------------- */

  private chooseKind(ctx: SpawnContext): ChunkKind {
    // title screen: coin trails with a gate row every few chunks (the runner takes the open lane)
    if (this.attract) return this.sinceGate >= 3 ? 'gate' : 'safe'
    const scripted = this.script.shift()
    if (scripted) return scripted
    const rng = this.rng
    const weights: [ChunkKind, number][] = []
    const afterSafe = this.lastKind === 'safe'
    weights.push(['obstacles', afterSafe ? 6 : 2.5])
    weights.push(['safe', afterSafe ? 0.5 : 4])
    if (this.sinceGate >= 2 && this.lastKind !== 'gate') weights.push(['gate', 3 + this.sinceGate])
    if (this.sinceCamera >= 2 && this.lastKind !== 'camera') weights.push(['camera', 2 + this.sinceCamera * 0.5])
    if (ctx.floor >= 2 && this.sincePin >= 3 && this.lastKind !== 'pin') weights.push(['pin', 1.5 + this.sincePin * 0.5])
    let total = 0
    for (const w of weights) total += w[1]
    let r = rng() * total
    for (const [k, w] of weights) {
      r -= w
      if (r <= 0) return k
    }
    return 'obstacles'
  }

  private placeChunk(kind: ChunkKind, list: Entity[], ctx: SpawnContext) {
    this.lastKind = kind
    this.sinceGate++
    this.sinceCamera++
    this.sincePin++
    switch (kind) {
      case 'safe':
        this.placeSafe(list)
        break
      case 'obstacles':
        this.placeObstacles(list, ctx)
        break
      case 'camera':
        this.sinceCamera = 0
        this.placeCamera(list, ctx, this.hazardStart(ctx) + 6)
        break
      case 'gate':
        this.sinceGate = 0
        this.placeGate(list, ctx, this.hazardStart(ctx) + 6)
        break
      case 'pin':
        this.sincePin = 0
        this.placePin(list, ctx, this.hazardStart(ctx) + 2)
        break
    }
  }

  /** First track position where a new hazard may stand. */
  private hazardStart(ctx: SpawnContext): number {
    return Math.max(this.spawnD, this.lastHazardD + reactionGap(ctx.speed))
  }

  /* ---------------------------------------------------------------------------------- */
  /* Chunks                                                                              */
  /* ---------------------------------------------------------------------------------- */

  /** Floor 1: ten easy seconds (coins + one cart to jump). Later floors: a short coin run-up. */
  private placeEasyStretch(list: Entity[]) {
    const rng = this.rng
    if (this.floor === 1) {
      this.coinLine(list, 0, 12, 7)
      this.coinLine(list, 1, 32, 6)
      const cart = makeObstacle('cart', 0, 56, rng)
      list.push(cart)
      this.coinArc(list, 0, 56)
      this.lastHazardD = 56
      this.coinLine(list, -1, 72, 7)
      this.spawnD = 90
    } else {
      this.coinLine(list, pick(rng, [-1, 0, 1]), 10, 8)
      this.coinLine(list, pick(rng, [-1, 0, 1]), 26, 6)
      this.spawnD = 38
    }
  }

  private placeSafe(list: Entity[]) {
    const rng = this.rng
    const d0 = this.spawnD + 2
    const len = randRange(rng, 10, 16)
    let lane = pick(rng, [-1, 0, 1])
    // The floor's new badge is introduced in the first safe stretch after the opening.
    if (this.badgeToPlace && d0 > this.floorEnd * 0.1) {
      const b = makeEntity('badge', lane, d0 + len * 0.5)
      b.badge = this.badgeToPlace
      b.y = 0.6
      b.depth = 0.6
      list.push(b)
      this.badgeToPlace = null
      this.coinLine(list, lane, d0, 3)
      this.coinLine(list, lane, d0 + len * 0.5 + 2.6, 3)
    } else if (d0 >= this.powerNextD && rng() < 0.6) {
      const p = makeEntity(this.powerToggle++ % 2 === 0 ? 'magnet' : 'shield', lane, d0 + len * 0.5)
      p.y = 0.6
      p.depth = 0.6
      list.push(p)
      this.powerNextD = d0 + randRange(rng, 260, 360)
      this.coinLine(list, lane, d0, 3)
    } else {
      // zig-zag coin trail: a line, then the trail continues in a neighbouring lane
      const n1 = randInt(rng, 4, 6)
      this.coinLine(list, lane, d0, n1)
      lane = lane === 0 ? pick(rng, [-1, 1]) : 0
      this.coinLine(list, lane, d0 + n1 * 1.3 + 1.3, randInt(rng, 3, 6))
    }
    this.spawnD = d0 + len
  }

  private placeObstacles(list: Entity[], ctx: SpawnContext) {
    const rng = this.rng
    const rows = this.floor === 1 && this.spawnD < 250 ? randInt(rng, 1, 2) : randInt(rng, 2, 3)
    let d = this.hazardStart(ctx)
    const gap = reactionGap(ctx.speed)
    for (let i = 0; i < rows; i++) {
      // The gap is measured from the far end of one row to the centre of the next.
      const end = this.placeRow(list, d, ctx.speed)
      this.lastHazardD = end
      d = end + gap + randRange(rng, 0, 3)
    }
    this.spawnD = this.lastHazardD + 3
  }

  /** One obstacle row centred on track position d. Returns the far end of the row. */
  private placeRow(list: Entity[], d: number, speed: number): number {
    const rng = this.rng
    const early = this.floor === 1 && d < 220
    const advanced = this.floor >= 2 || d > 320
    const patterns: [string, number][] = [
      ['single', 3],
      ['jump1', 3],
      ['barrier', early && d < 150 ? 0 : 2.2],
      ['double', early ? 0 : 2.5],
      ['walkers', early ? 0 : 2],
      ['barrier2', early ? 0 : 1.2],
      ['jumpAll', advanced ? 1.2 : 0],
      ['mixed', advanced ? 1.5 : 0],
    ]
    let total = 0
    for (const p of patterns) total += p[1]
    let r = rng() * total
    let pattern = 'single'
    for (const [k, w] of patterns) {
      r -= w
      if (r <= 0) {
        pattern = k
        break
      }
    }
    const lanes = shuffle(rng, [-1, 0, 1])
    const laneKind = (): ObstacleKind => (rng() < 0.25 ? 'glass' : rng() < 0.2 ? 'guard' : 'person')
    const jumpKind = (): ObstacleKind => pick(rng, ['cart', 'robot', 'wetsign', 'planter', 'trolley'] as const)
    switch (pattern) {
      case 'single':
        list.push(makeObstacle(laneKind(), lanes[0], d, rng))
        return d + 0.3
      case 'double':
        list.push(makeObstacle(laneKind(), lanes[0], d, rng))
        list.push(makeObstacle(laneKind(), lanes[1], d, rng))
        // reward for picking the open lane
        for (let k = -1; k <= 1; k++) list.push(coin(lanes[2], d + k * 1.3))
        return d + 0.3
      case 'jump1': {
        const k = jumpKind()
        list.push(makeObstacle(k, lanes[0], d, rng))
        this.coinArc(list, lanes[0], d)
        return d + 0.6
      }
      case 'jumpAll': {
        const k = jumpKind()
        for (const l of lanes) list.push(makeObstacle(k, l, d, rng))
        this.coinArc(list, lanes[0], d)
        return d + 0.6
      }
      case 'barrier': {
        const b = makeObstacle('barrier', 0, d, rng)
        b.variant = 0
        list.push(b)
        for (let k = -1; k <= 1; k++) list.push(coin(lanes[0], d + k * 1.3, 0))
        return d + 0.15
      }
      case 'barrier2': {
        const b = makeObstacle('barrier', 0, d, rng)
        b.variant = rng() < 0.5 ? -1 : 1
        list.push(b)
        // coins in the lane the pole does not cover
        for (let k = -1; k <= 1; k++) list.push(coin(-b.variant, d + k * 1.3))
        return d + 0.15
      }
      case 'mixed': {
        list.push(makeObstacle(laneKind(), lanes[0], d, rng))
        list.push(makeObstacle(laneKind(), lanes[1], d, rng))
        list.push(makeObstacle(jumpKind(), lanes[2], d, rng))
        this.coinArc(list, lanes[2], d)
        return d + 0.6
      }
      case 'walkers': {
        // One or two people walking toward the camera, staggered so they read as a group.
        const n = rng() < 0.5 ? 1 : 2
        const walk = randRange(rng, 1.0, 1.7)
        const shift = walkShift(walk, speed)
        for (let i = 0; i < n; i++) {
          const w = makeObstacle(rng() < 0.2 ? 'guard' : 'person', lanes[i], d + shift + i * 1.5, rng)
          w.walk = walk
          list.push(w)
        }
        return d + shift + (n - 1) * 1.5 + 0.3
      }
    }
    return d + 0.3
  }

  private placeCamera(list: Entity[], ctx: SpawnContext, d: number) {
    const rng = this.rng
    const cam = makeEntity('camera', 0, d)
    cam.depth = CAMERA_ZONE_DEPTH
    cam.side = rng() < 0.5 ? -1 : 1
    // Floors 1–2: the cone sweeps the two lanes on the camera's side, the far lane is always
    // safe. From floor 3 it sweeps all three; the zone is short and the sweep slow enough that
    // one outer lane stays dark for the whole crossing (see auditSpawner).
    cam.variant = ctx.floor >= 3 ? 1 : 0
    cam.period = Math.max(3.2, 4.6 - 0.25 * (ctx.floor - 1))
    cam.onDur = randRange(rng, 1.7, 2.1)
    cam.offDur = randRange(rng, 1.2, 1.5)
    cam.t = rng() * 10
    list.push(cam)
    this.lastCameraD = d
    // a risky coin line through the middle lane for players who time the dark phase
    for (let k = -1; k <= 1; k++) list.push(coin(0, d + k * 1.4))
    this.lastHazardD = d + CAMERA_ZONE_DEPTH * 0.5
    this.spawnD = this.lastHazardD + 3
  }

  private placeGate(list: Entity[], ctx: SpawnContext, d: number) {
    const rng = this.rng
    const held = BADGE_ORDER.filter((b) => ctx.inventory.has(b))
    const guaranteed = held.length ? pick(rng, held) : 'EMPLOYEE'
    const others = shuffle(
      rng,
      BADGE_ORDER.filter((b) => b !== guaranteed),
    )
    const slot = randInt(rng, 0, 2)
    const gates: Badge[] = []
    let k = 0
    for (let i = 0; i < 3; i++) gates.push(i === slot ? guaranteed : others[k++])
    const g = makeEntity('gate', 0, d)
    g.gates = gates
    g.depth = 1.0
    g.y1 = 1.1
    list.push(g)
    this.lastHazardD = d
    this.spawnD = d + 6
  }

  private placePin(list: Entity[], ctx: SpawnContext, d: number) {
    const rng = this.rng
    const code = String(randInt(rng, 1000, 9999))
    const lane = pick(rng, [-1, 0, 1])
    const note = makeEntity('note', lane, d)
    note.code = code
    note.y = 0.6
    note.depth = 0.6
    list.push(note)
    list.push(coin(lane, d - 2.6), coin(lane, d - 1.3))
    const rowD = d + Math.max(16, reactionGap(ctx.speed) * 1.6)
    const row = makeEntity('pin', 0, rowD)
    row.code = code
    row.depth = 1.0
    row.y1 = 1.1
    list.push(row)
    this.lastHazardD = rowD
    this.spawnD = rowD + 6
  }

  private placeReception(list: Entity[], ctx: SpawnContext, d: number) {
    const start = Math.max(d, this.lastHazardD + reactionGap(ctx.speed))
    const r = makeEntity('reception', 0, start + 4)
    r.depth = 1.6
    r.visitor = makeVisitor(this.rng)
    list.push(r)
    this.receptionPlaced = true
    this.lastHazardD = r.d
    this.spawnD = r.d + 6
  }

  /** Last coin stretch of the floor and the elevator wall. */
  private placeFinal(list: Entity[], ctx: SpawnContext) {
    const rng = this.rng
    const d0 = Math.max(this.spawnD + 2, this.lastHazardD + reactionGap(ctx.speed))
    const end = Math.max(this.floorEnd, d0 + 10)
    this.floorEnd = end
    const lane = pick(rng, [-1, 0, 1])
    this.coinLine(list, lane, d0, Math.max(3, Math.min(8, Math.floor((end - d0 - 6) / 1.3))))
    const el = makeEntity('elevator', 0, end)
    el.doors = elevatorDoors(rng, ctx.floor)
    el.depth = 1.0
    el.y1 = 4
    list.push(el)
    this.elevatorPlaced = true
    this.spawnD = end + 1
  }

  /* ---------------------------------------------------------------------------------- */
  /* Helpers                                                                             */
  /* ---------------------------------------------------------------------------------- */

  private coinLine(list: Entity[], lane: number, d: number, n: number) {
    for (let i = 0; i < n; i++) list.push(coin(lane, d + i * 1.3))
  }

  /** Five coins in a jump arc centred on a jump obstacle. */
  private coinArc(list: Entity[], lane: number, d: number) {
    const hs = [0.35, 0.8, 1.0, 0.8, 0.35]
    for (let i = 0; i < 5; i++) list.push(coin(lane, d + (i - 2) * 1.25, hs[i]))
  }

  /** Pillars, plants and wall signage along the corridor up to track position `upTo`. */
  private decorate(list: Entity[], upTo: number) {
    const rng = this.rng
    // nothing may stand in (or poke through) the elevator wall at the end of the floor
    const limit = this.elevatorPlaced ? this.floorEnd - 2.5 : Number.POSITIVE_INFINITY
    while (this.decorD < upTo) {
      const d = this.decorD
      for (const side of [-1, 1] as const) {
        const p = makeEntity('pillar', side * PILLAR_X, d)
        p.depth = 0.45
        if (d < limit) list.push(p)
        if (rng() < 0.7) {
          // (the cooler / bench choice is derived from the position so the RNG sequence – and
          // with it every hazard layout – stays exactly as before)
          const q = makeEntity(rng() < 0.75 ? 'plant' : Math.floor(d / 11) % 2 ? 'bench' : 'cooler', side * DECOR_X, d + 5.5 + randRange(rng, -1, 1))
          q.variant = randInt(rng, 0, 2)
          q.phase = rng() * 6
          if (q.d < limit) list.push(q)
        }
      }
      // (a wall sign would collide with a camera and its CCTV plate)
      if (Math.floor(d / 11) % 4 === 1 && d + 4.5 < limit && Math.abs(d + 3 - this.lastCameraD) > 8) {
        const s = makeEntity('wallsign', this.signSide * 1.9, d + 3)
        s.variant = this.signSide === 1 ? 0 : 1
        list.push(s)
        this.signSide = this.signSide === 1 ? -1 : 1
      }
      this.decorD += 11
    }
  }
}

/* ------------------------------------------------------------------------------------ */
/* Self-check (dev hook)                                                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * Generates `runs` × 6 floors and verifies the fairness rules the spawner promises: no row of
 * lane-change-only obstacles across all three lanes, at least 0.9 s of travel between hazard
 * rows, a usable gate in every gate row, and exactly one reception + elevator per floor.
 * Returns human-readable violations (empty = all good).
 */
export function auditSpawner(runs = 40): string[] {
  const issues: string[] = []
  const inv = new Set<Badge>(['EMPLOYEE'])
  let rows = 0
  for (let seed = 1; seed <= runs; seed++) {
    for (let floor = 1; floor <= 6; floor++) {
      const speed = Math.min(22, 9 + 1.5 * (floor - 1) + 2)
      const sp = new Spawner()
      const list: Entity[] = []
      const tag = `seed ${seed} floor ${floor}`
      sp.startFloor(seed * 7717, floor, speed, inv)
      const ctx: SpawnContext = { dist: 0, speed, inventory: inv, floor }
      for (let k = 0; k < 400 && !sp.finished; k++) {
        sp.fill(list, ctx)
        ctx.dist += 30
      }
      if (!sp.finished) issues.push(`${tag}: no elevator`)
      if (list.filter((e) => e.kind === 'reception').length !== 1) issues.push(`${tag}: reception count`)
      if (list.filter((e) => e.kind === 'elevator').length !== 1) issues.push(`${tag}: elevator count`)
      const spans: [number, number][] = []
      for (const e of list) {
        if (e.kind === 'gate' && !e.gates.some((b) => inv.has(b))) issues.push(`${tag}: gate row without a usable gate at ${e.d.toFixed(1)}`)
        if (e.kind === 'pin' && !list.some((n) => n.kind === 'note' && n.code === e.code && n.d < e.d)) issues.push(`${tag}: PIN row without a note`)
        if (e.kind === 'camera') spans.push([e.d - e.depth / 2, e.d + e.depth / 2])
        else if (e.kind === 'gate' || e.kind === 'pin' || e.kind === 'reception' || e.kind === 'elevator') spans.push([e.d - 0.5, e.d + 0.5])
        else if (e.dodge !== 'none') {
          const shift = e.walk > 0 ? walkShift(e.walk, speed) : 0
          spans.push([e.d - shift - e.depth / 2, e.d + e.depth / 2])
          if (e.dodge === 'lane') {
            const lanes = new Set<number>()
            for (const o of list) if (o.dodge === 'lane' && Math.abs(o.d - (o.walk > 0 ? walkShift(o.walk, speed) : 0) - (e.d - shift)) < 2.2) lanes.add(o.lane)
            if (lanes.size >= 3) issues.push(`${tag}: three lanes blocked at ${e.d.toFixed(1)}`)
          }
        }
      }
      spans.sort((a, b) => a[0] - b[0])
      let far = -1e9
      for (const [a, b] of spans) {
        // spans closer than 2.2 units belong to the same row (staggered walkers, a row's three lanes)
        if (a - far > 2.2) {
          rows++
          if (far > 0 && a - far < 0.9 * speed - 0.01) issues.push(`${tag}: only ${(a - far).toFixed(1)} units before the row at ${a.toFixed(1)} (speed ${speed})`)
        }
        far = Math.max(far, b)
      }
    }
  }
  if (rows < runs * 60) issues.push(`suspiciously few hazard rows: ${rows}`)
  return issues
}
