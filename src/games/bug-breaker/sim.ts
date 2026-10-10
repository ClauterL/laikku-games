/**
 * Bug Breaker simulation core – Matter.js world, shot state machine, damage
 * model, specials and level flow. Deterministic and DOM-free so it can be
 * driven headlessly; the canvas engine wraps it and adds rendering, input,
 * sound and juice.
 */
import Matter from 'matter-js'
import { AMMO, AMMO_SIZE, BUGS, LAUNCH_FACTOR, LEVELS, MATERIALS, MAX_PULL, WORLD } from './levels'
import type { AmmoType, BodyData, BugKind, LevelDef, Material, ShotState, SimEvent } from './types'

const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter

/** Physics runs at 120 Hz (two sub-steps per 60 Hz frame) – fast cubes tunnel less. */
export const STEP = 1 / 120
const STEP_MS = 1000 / 120
const MAX_STEPS_PER_FRAME = 8

/** Base damage factor: damage = relative speed × min(mass) × DAMAGE_K. */
const DAMAGE_K = 1.0
/** Bugs are squishy – they take more damage than blocks… */
const BUG_DAMAGE = 2.0
/** …but landing on the ground is forgiving. */
const GROUND_DAMAGE = 0.6
/** Contacts slower than this (units per 1/60 s) are resting jitter, not hits. */
const MIN_REL_SPEED = 2.0

const SHOT_TIMEOUT = 6
const REST_END = 0.8
const NEXT_SHOT_DELAY = 0.7
const CLEAR_DELAY = 1.2
const SLOWMO_DURATION = 0.8
const SLOWMO_SCALE = 0.3
const SETTLE_MAX = 4

const CSS_RADIUS = 140
const CSS_DAMAGE = 35
const JS_RADIUS = 200
const JS_DAMAGE = 60
const JS_FUSE = 0.4
const PY_BOOST = 1.8
const PY_MAX_SPEED = 36
const SQL_MAX_HP = 60
const SQL_MAX_PENETRATIONS = 3
const SQL_KEEP = 0.85

export type SimState = 'idle' | 'playing' | 'clearing' | 'settling' | 'cleared' | 'failed'

export function dataOf(body: Matter.Body): BodyData | undefined {
  return (body.plugin as { bb?: BodyData } | undefined)?.bb
}

function makeData(partial: Partial<BodyData> & Pick<BodyData, 'kind'>, seed: number): BodyData {
  return {
    hp: 1,
    maxHp: 1,
    score: 0,
    w: 0,
    h: 0,
    r: 0,
    seed,
    blink: 1.5 + ((seed * 7919) % 1000) / 500,
    blinking: false,
    age: 0,
    impacted: false,
    specialUsed: false,
    penetrations: 0,
    fuse: -1,
    boosted: false,
    ...partial,
  }
}

export class Sim {
  readonly engine: Matter.Engine
  listener: (e: SimEvent) => void = () => {}

  state: SimState = 'idle'
  levelIndex = 0
  /** total run score (all levels) */
  score = 0
  levelScore = 0
  queue: AmmoType[] = []
  shot: ShotState = 'none'
  ammoBody: Matter.Body | null = null
  /** current pull vector (world units, pointing from the anchor to the pouch) */
  pull = { x: 0, y: 0 }
  /** dotted trail of the last flight (world coords, flat x/y pairs) */
  trail: number[] = []
  /** the last three stats computed on level clear */
  stars = 0
  bonus = 0
  /** game-time seconds (scaled by slow motion) */
  time = 0
  slowMo = 0

  private acc = 0
  private flightTime = 0
  private restTime = 0
  private nextTimer = -1
  private clearTimer = -1
  private settleTimer = 0
  private seedCounter = 1
  private toRemove: Matter.Body[] = []
  private bodyCache: Matter.Body[] = []
  private cacheDirty = true
  private trailTick = 0

  constructor() {
    this.engine = Engine.create({
      gravity: { x: 0, y: 1.2, scale: 0.001 },
      enableSleeping: true,
      positionIterations: 8,
      velocityIterations: 6,
    })
    Events.on(this.engine, 'collisionStart', this.onCollisionStart)
  }

  destroy() {
    Events.off(this.engine, 'collisionStart', this.onCollisionStart)
    Composite.clear(this.engine.world, false, true)
    Engine.clear(this.engine)
  }

  /* ---------------------------------------------------------------- */
  /* queries                                                           */
  /* ---------------------------------------------------------------- */

  get level(): LevelDef {
    return LEVELS[this.levelIndex]
  }

  bodies(): Matter.Body[] {
    if (this.cacheDirty) {
      this.bodyCache = Composite.allBodies(this.engine.world)
      this.cacheDirty = false
    }
    return this.bodyCache
  }

  bugsLeft(): number {
    let n = 0
    for (const b of this.bodies()) {
      const d = dataOf(b)
      if (d && d.kind === 'bug') n++
    }
    return n
  }

  get shotsLeft(): number {
    return this.queue.length
  }

  get current(): AmmoType | null {
    return this.shot === 'ready' || this.shot === 'aiming' ? (this.queue[0] ?? null) : null
  }

  /** Ammo type currently in the air (null otherwise). */
  get flying(): AmmoType | null {
    if (this.shot !== 'flying' || !this.ammoBody) return null
    return dataOf(this.ammoBody)?.ammo ?? null
  }

  /** Position of the pouch (resting, or stretched while aiming). */
  pouch(): { x: number; y: number } {
    const s = WORLD.sling
    if (this.shot === 'aiming') return { x: s.pouchX + this.pull.x, y: s.pouchY + this.pull.y }
    return { x: s.pouchX, y: s.pouchY }
  }

  /** Does the loaded / flying cube still have an unused tap special? */
  specialReady(): boolean {
    if (this.shot === 'flying' && this.ammoBody) {
      const d = dataOf(this.ammoBody)
      return !!d && !d.specialUsed && (d.ammo === 'js' || d.ammo === 'python')
    }
    const c = this.current
    return c === 'js' || c === 'python'
  }

  /* ---------------------------------------------------------------- */
  /* level flow                                                        */
  /* ---------------------------------------------------------------- */

  loadLevel(index: number) {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index))
    const level = this.level
    Composite.clear(this.engine.world, false, true)
    this.cacheDirty = true
    // seeds restart per level so a level plays out identically whatever came before
    this.seedCounter = 1
    this.toRemove.length = 0
    this.trail.length = 0
    this.levelScore = 0
    this.queue = level.ammo.slice()
    this.shot = 'none'
    this.ammoBody = null
    this.pull.x = this.pull.y = 0
    this.acc = 0
    this.slowMo = 0
    this.clearTimer = -1
    this.settleTimer = 0
    this.stars = 0
    this.bonus = 0
    this.state = 'playing'
    this.nextTimer = 0.25

    const ground = (x0: number, x1: number, top: number) =>
      Bodies.rectangle((x0 + x1) / 2, (top + WORLD.h + 200) / 2, x1 - x0, WORLD.h + 200 - top, {
        isStatic: true,
        friction: 0.9,
        plugin: { bb: makeData({ kind: 'ground' }, this.seedCounter++) },
      })
    Composite.add(this.engine.world, [
      ground(WORLD.ledge.x0 - 400, WORLD.ledge.x1, WORLD.ledge.top),
      ground(WORLD.ledge.x1, WORLD.plateau.x0, WORLD.valley.top),
      ground(WORLD.plateau.x0, WORLD.plateau.x1, WORLD.plateau.top),
    ])

    for (const b of level.blocks) {
      const m = MATERIALS[b.material]
      const body = Bodies.rectangle(b.x, b.y, b.w, b.h, {
        angle: b.angle ?? 0,
        density: m.density,
        friction: 0.7,
        frictionStatic: 0.9,
        restitution: 0.05,
        plugin: {
          bb: makeData(
            { kind: 'block', material: b.material, hp: m.hp, maxHp: m.hp, score: m.score, w: b.w, h: b.h, sign: b.sign },
            this.seedCounter++,
          ),
        },
      })
      Composite.add(this.engine.world, body)
    }
    for (const g of level.bugs) {
      const info = BUGS[g.kind]
      const body = Bodies.circle(g.x, g.y, info.r, {
        density: 0.001,
        friction: 0.9,
        frictionStatic: 1,
        restitution: 0.2,
        plugin: {
          bb: makeData({ kind: 'bug', bug: g.kind, hp: info.hp, maxHp: info.hp, score: info.score, r: info.r }, this.seedCounter++),
        },
      })
      Composite.add(this.engine.world, body)
    }
    this.cacheDirty = true
    // let the structure settle silently so the player never sees the micro-adjustments
    const listener = this.listener
    this.listener = () => {}
    for (let i = 0; i < 90; i++) Engine.update(this.engine, STEP_MS)
    this.listener = listener
    this.flushRemovals()
  }

  /** Horizontal centre of the level's structures (used by the phone camera). */
  structureCenter(): number {
    const lv = this.level
    let minX = Infinity
    let maxX = -Infinity
    for (const b of lv.blocks) {
      minX = Math.min(minX, b.x - b.w / 2)
      maxX = Math.max(maxX, b.x + b.w / 2)
    }
    for (const g of lv.bugs) {
      minX = Math.min(minX, g.x - 30)
      maxX = Math.max(maxX, g.x + 30)
    }
    return minX === Infinity ? WORLD.plateau.x0 + 400 : (minX + maxX) / 2
  }

  /* ---------------------------------------------------------------- */
  /* input                                                             */
  /* ---------------------------------------------------------------- */

  /** Start dragging the loaded cube. Returns false when no cube is ready. */
  beginAim(): boolean {
    if (this.state !== 'playing' || this.shot !== 'ready') return false
    this.shot = 'aiming'
    this.pull.x = this.pull.y = 0
    return true
  }

  /** Pointer position relative to the pouch anchor (world units). */
  setPull(dx: number, dy: number) {
    if (this.shot !== 'aiming') return
    const len = Math.hypot(dx, dy)
    if (len > MAX_PULL) {
      dx = (dx / len) * MAX_PULL
      dy = (dy / len) * MAX_PULL
    }
    this.pull.x = dx
    this.pull.y = dy
  }

  /** Let go of the cube: launches when pulled far enough, otherwise snaps back. */
  release(): boolean {
    if (this.shot !== 'aiming') return false
    const len = Math.hypot(this.pull.x, this.pull.y)
    if (len < 14) {
      this.shot = 'ready'
      this.pull.x = this.pull.y = 0
      return false
    }
    this.launch(-this.pull.x * LAUNCH_FACTOR, -this.pull.y * LAUNCH_FACTOR)
    return true
  }

  /** Fire the loaded cube with an explicit pull vector (used by tests / autoplay). */
  fire(pullX: number, pullY: number): boolean {
    if (this.state !== 'playing' || (this.shot !== 'ready' && this.shot !== 'aiming')) return false
    this.shot = 'aiming'
    this.setPull(pullX, pullY)
    return this.release()
  }

  private launch(vx: number, vy: number) {
    const type = this.queue.shift()
    if (!type) return
    const info = AMMO[type]
    const p = this.pouch()
    const body = Bodies.rectangle(p.x, p.y, AMMO_SIZE, AMMO_SIZE, {
      chamfer: { radius: 7 },
      density: 0.002 * info.density,
      friction: 0.5,
      frictionStatic: 0.6,
      frictionAir: 0.004,
      restitution: 0.15,
      plugin: { bb: makeData({ kind: 'ammo', ammo: type, w: AMMO_SIZE, h: AMMO_SIZE, hp: 1e9, maxHp: 1e9 }, this.seedCounter++) },
    })
    Body.setVelocity(body, { x: vx, y: vy })
    Body.setAngularVelocity(body, (vx > 0 ? 1 : -1) * 0.08)
    Composite.add(this.engine.world, body)
    this.cacheDirty = true
    this.ammoBody = body
    this.shot = 'flying'
    this.flightTime = 0
    this.restTime = 0
    this.trail.length = 0
    this.trailTick = 0
    this.pull.x = this.pull.y = 0
    this.listener({ type: 'launch', x: p.x, y: p.y, ammo: type })
  }

  /** Tap / Space while a cube is flying. */
  special(): boolean {
    if (this.state !== 'playing' || this.shot !== 'flying' || !this.ammoBody) return false
    const body = this.ammoBody
    const d = dataOf(body)
    if (!d || d.specialUsed) return false
    if (d.ammo === 'js') {
      this.explode(body)
      return true
    }
    if (d.ammo === 'python') {
      const v = Body.getVelocity(body)
      const speed = Math.hypot(v.x, v.y)
      if (speed < 0.5) return false
      d.specialUsed = true
      d.boosted = true
      const target = Math.min(PY_MAX_SPEED, speed * PY_BOOST)
      Body.setVelocity(body, { x: (v.x / speed) * target, y: (v.y / speed) * target })
      this.listener({ type: 'boost', x: body.position.x, y: body.position.y })
      return true
    }
    return false
  }

  /**
   * Gravity-only trajectory preview for the current pull (same integration
   * as Matter's Verlet sub-steps, so the dots match the real flight).
   */
  previewTrajectory(out: number[], maxPoints = 40): number {
    out.length = 0
    if (this.shot !== 'aiming') return 0
    const p = this.pouch()
    let x = p.x
    let y = p.y
    const vx = -this.pull.x * LAUNCH_FACTOR
    const vy = -this.pull.y * LAUNCH_FACTOR
    // per sub-step displacement; gravity per sub-step; air friction per sub-step
    let dx = vx * 0.5
    let dy = vy * 0.5
    const g = 1.2 * 0.001 * STEP_MS * STEP_MS
    const fa = 1 - 0.004 * 0.5
    let n = 0
    for (let i = 0; i < 1200 && n < maxPoints; i++) {
      dx *= fa
      dy = dy * fa + g
      x += dx
      y += dy
      if (i % 5 === 4) {
        out.push(x, y)
        n++
      }
      if (x > WORLD.plateau.x0 && y > WORLD.plateau.top) break
      if (x <= WORLD.ledge.x1 && y > WORLD.ledge.top) break
      if (y > WORLD.valley.top || x > WORLD.w + 100) break
    }
    return n
  }

  /* ---------------------------------------------------------------- */
  /* time                                                              */
  /* ---------------------------------------------------------------- */

  /** Advance the simulation by `dt` real seconds (handles slow motion + fixed steps). */
  update(dt: number) {
    if (this.state === 'idle') return
    const scale = this.slowMo > 0 ? SLOWMO_SCALE : 1
    this.slowMo = Math.max(0, this.slowMo - dt)
    this.acc += dt * scale
    let n = 0
    while (this.acc >= STEP && n < MAX_STEPS_PER_FRAME) {
      this.stepOnce()
      this.acc -= STEP
      n++
    }
    if (n === MAX_STEPS_PER_FRAME) this.acc = 0
  }

  private stepOnce() {
    const dt = STEP
    this.time += dt
    Engine.update(this.engine, STEP_MS)
    this.flushRemovals()

    for (const b of this.bodies()) {
      const d = dataOf(b)
      if (!d) continue
      d.age += dt
      if (d.kind === 'bug') {
        d.blink -= dt
        if (d.blink <= 0) {
          d.blinking = !d.blinking
          d.blink = d.blinking ? 0.12 : 2 + ((d.seed * 31) % 100) / 40
        }
        if (b.position.y > WORLD.killY || b.position.x < WORLD.killXMin || b.position.x > WORLD.killXMax) {
          this.squash(b, d, true)
        }
      } else if (d.kind === 'block') {
        if (b.position.y > WORLD.killY || b.position.x < WORLD.killXMin || b.position.x > WORLD.killXMax) {
          this.toRemove.push(b)
        }
      }
    }
    this.flushRemovals()

    if (this.shot === 'flying' && this.ammoBody) this.updateFlight(dt)

    if (this.nextTimer >= 0) {
      this.nextTimer -= dt
      if (this.nextTimer < 0) this.loadNext()
    }

    if (this.state === 'clearing') {
      this.clearTimer -= dt
      if (this.clearTimer <= 0) this.finishClear()
    } else if (this.state === 'settling') {
      this.settleTimer += dt
      if (this.settleTimer >= SETTLE_MAX || (this.settleTimer > 0.8 && this.allAtRest())) {
        this.state = 'failed'
        this.listener({ type: 'levelFailed' })
      }
    }
  }

  private updateFlight(dt: number) {
    const body = this.ammoBody!
    const d = dataOf(body)!
    this.flightTime += dt
    if (++this.trailTick % 4 === 0) this.trail.push(body.position.x, body.position.y)
    if (d.fuse >= 0) {
      d.fuse -= dt
      if (d.fuse < 0) {
        this.explode(body)
        return
      }
    }
    const speed = body.speed
    if (speed < 0.35) this.restTime += dt
    else this.restTime = 0
    const out =
      body.position.y > WORLD.killY || body.position.x < WORLD.killXMin || body.position.x > WORLD.killXMax
    if (body.isSleeping || this.restTime > REST_END || out || this.flightTime > SHOT_TIMEOUT) this.endShot()
  }

  private endShot() {
    const body = this.ammoBody
    if (body) {
      this.listener({ type: 'shotEnded', x: body.position.x, y: body.position.y })
      this.removeBody(body)
    }
    this.ammoBody = null
    this.shot = 'done'
    if (this.state === 'playing') this.nextTimer = NEXT_SHOT_DELAY
  }

  private loadNext() {
    this.nextTimer = -1
    if (this.state !== 'playing') return
    if (this.queue.length > 0) {
      this.shot = 'ready'
      this.pull.x = this.pull.y = 0
    } else {
      this.shot = 'none'
      if (this.bugsLeft() > 0) {
        this.state = 'settling'
        this.settleTimer = 0
      }
    }
  }

  private allAtRest(): boolean {
    for (const b of this.bodies()) {
      if (b.isStatic || b.isSleeping) continue
      if (b.speed > 0.25 || b.angularSpeed > 0.01) return false
    }
    return true
  }

  private finishClear() {
    this.state = 'cleared'
    const left = this.queue.length
    this.stars = left >= 2 ? 3 : left === 1 ? 2 : 1
    this.bonus = 1000 * left
    this.score += this.bonus
    this.levelScore += this.bonus
    this.listener({ type: 'levelCleared', stars: this.stars, bonus: this.bonus, levelScore: this.levelScore })
  }

  /* ---------------------------------------------------------------- */
  /* collisions & damage                                               */
  /* ---------------------------------------------------------------- */

  private onCollisionStart = (ev: Matter.IEventCollision<Matter.Engine>) => {
    for (const pair of ev.pairs) {
      const a = pair.bodyA
      const b = pair.bodyB
      const da = dataOf(a)
      const db = dataOf(b)
      if (!da || !db) continue
      if (da.kind === 'ground' && db.kind === 'ground') continue

      const va = Body.getVelocity(a)
      const vb = Body.getVelocity(b)
      const n = pair.collision.normal
      const rvx = va.x - vb.x
      const rvy = va.y - vb.y
      // mostly the normal component, with a little of the tangential rub
      const rel = Math.max(Math.abs(rvx * n.x + rvy * n.y), 0.35 * Math.hypot(rvx, rvy))
      if (rel < MIN_REL_SPEED) continue

      // specials that hijack the contact (SQL drill) return true
      if (da.kind === 'ammo' && this.ammoContact(a, da, b, db, pair, rel)) continue
      if (db.kind === 'ammo' && this.ammoContact(b, db, a, da, pair, rel)) continue

      this.hit(a, da, b, db, rel)
      this.hit(b, db, a, da, rel)
      if (da.kind === 'ammo' || db.kind === 'ammo') {
        const ammo = da.kind === 'ammo' ? a : b
        const other = ammo === a ? b : a
        const dmg = rel * Math.min(ammo.mass, other.isStatic ? ammo.mass : other.mass) * DAMAGE_K
        const p = pair.collision.supports[0] ?? ammo.position
        this.listener({ type: 'impact', x: p.x, y: p.y, damage: dmg, ammo: dataOf(ammo)?.ammo ?? null })
      }
    }
  }

  /** Apply the impact of `other` to `victim`. */
  private hit(victim: Matter.Body, dv: BodyData, other: Matter.Body, dother: BodyData, rel: number) {
    if (dv.kind !== 'block' && dv.kind !== 'bug') return
    const mOther = other.isStatic ? Infinity : other.mass
    // bugs are light – let heavy things hurt them properly
    const mCap = dv.kind === 'bug' ? victim.mass * 3 : victim.mass
    let dmg = rel * Math.min(mOther, mCap) * DAMAGE_K
    if (dother.kind === 'ammo' && dother.ammo) dmg *= AMMO[dother.ammo].damage
    if (dother.kind === 'ground') dmg *= GROUND_DAMAGE
    if (dv.kind === 'bug') dmg *= BUG_DAMAGE
    if (dmg < 4) return
    this.damage(victim, dv, dmg)
  }

  private damage(body: Matter.Body, d: BodyData, dmg: number) {
    if (d.hp <= 0) return
    d.hp -= dmg
    if (d.kind === 'block') {
      if (d.hp <= 0) this.destroyBlock(body, d)
      else this.listener({ type: 'blockDamaged', x: body.position.x, y: body.position.y, material: d.material! })
    } else if (d.kind === 'bug' && d.hp <= 0) {
      this.squash(body, d, false)
    }
  }

  /** First-contact specials and the SQL drill. Returns true when the normal hit was replaced. */
  private ammoContact(
    ammo: Matter.Body,
    da: BodyData,
    other: Matter.Body,
    dother: BodyData,
    pair: Matter.Pair,
    rel: number,
  ): boolean {
    const first = !da.impacted
    da.impacted = true
    if (da.ammo === 'sql' && dother.kind === 'block' && dother.hp <= SQL_MAX_HP && da.penetrations < SQL_MAX_PENETRATIONS && rel > 6) {
      da.penetrations++
      // suppress the collision response for this pair, then remove the block after the step
      pair.isSensor = true
      other.isSensor = true
      const v = Body.getVelocity(ammo)
      Body.setVelocity(ammo, { x: v.x * SQL_KEEP, y: v.y * SQL_KEEP })
      this.listener({ type: 'drill', x: other.position.x, y: other.position.y, material: dother.material! })
      this.destroyBlock(other, dother)
      return true
    }
    if (first) {
      if (da.ammo === 'css') {
        this.shockwave(ammo)
      } else if (da.ammo === 'js' && !da.specialUsed) {
        da.fuse = JS_FUSE
      }
    }
    return false
  }

  private shockwave(ammo: Matter.Body) {
    const d = dataOf(ammo)!
    d.specialUsed = true
    const cx = ammo.position.x
    const cy = ammo.position.y
    this.listener({ type: 'shockwave', x: cx, y: cy, radius: CSS_RADIUS })
    this.blast(cx, cy, CSS_RADIUS, CSS_DAMAGE, 9, ammo, 0.35)
  }

  private explode(ammo: Matter.Body) {
    const d = dataOf(ammo)!
    d.specialUsed = true
    d.fuse = -1
    const cx = ammo.position.x
    const cy = ammo.position.y
    this.listener({ type: 'explosion', x: cx, y: cy, radius: JS_RADIUS })
    this.blast(cx, cy, JS_RADIUS, JS_DAMAGE, 18, ammo, 0.15)
    this.endShot()
  }

  /** Radial damage + velocity kick, falling off with distance. */
  private blast(cx: number, cy: number, radius: number, dmg: number, kick: number, source: Matter.Body, minFalloff: number) {
    const victims: Array<{ body: Matter.Body; d: BodyData; dist: number; nx: number; ny: number }> = []
    for (const b of this.bodies()) {
      if (b === source || b.isStatic) continue
      const d = dataOf(b)
      if (!d || (d.kind !== 'block' && d.kind !== 'bug')) continue
      const dx = b.position.x - cx
      const dy = b.position.y - cy
      const dist = Math.hypot(dx, dy)
      if (dist > radius + Math.max(d.r, d.w / 2)) continue
      const len = dist || 1
      victims.push({ body: b, d, dist, nx: dx / len, ny: dy / len - 0.25 })
    }
    for (const v of victims) {
      const falloff = Math.max(minFalloff, 1 - v.dist / radius)
      Sleeping.set(v.body, false)
      const massScale = Math.min(1.5, Math.max(0.4, 3 / v.body.mass))
      const vel = Body.getVelocity(v.body)
      const k = kick * falloff * massScale
      Body.setVelocity(v.body, { x: vel.x + v.nx * k, y: vel.y + v.ny * k })
      Body.setAngularVelocity(v.body, v.body.angularVelocity + ((v.d.seed % 7) - 3) * 0.03 * falloff)
      this.damage(v.body, v.d, dmg * falloff)
    }
  }

  /* ---------------------------------------------------------------- */
  /* removal                                                           */
  /* ---------------------------------------------------------------- */

  private destroyBlock(body: Matter.Body, d: BodyData) {
    d.hp = 0
    this.score += d.score
    this.levelScore += d.score
    this.listener({
      type: 'blockDestroyed',
      x: body.position.x,
      y: body.position.y,
      w: d.w,
      h: d.h,
      material: d.material as Material,
      score: d.score,
      angle: body.angle,
    })
    this.removeBody(body)
  }

  private squash(body: Matter.Body, d: BodyData, fell: boolean) {
    d.hp = 0
    this.score += d.score
    this.levelScore += d.score
    this.listener({ type: 'bugSquashed', x: body.position.x, y: body.position.y, r: d.r, kind: d.bug as BugKind, score: d.score, fell })
    this.removeBody(body)
    // last bug? (the body is still in the world until the removal flushes)
    let left = 0
    for (const b of this.bodies()) {
      const bd = dataOf(b)
      if (bd && bd.kind === 'bug' && bd.hp > 0) left++
    }
    if (left === 0 && (this.state === 'playing' || this.state === 'settling')) {
      this.state = 'clearing'
      this.clearTimer = CLEAR_DELAY
      this.slowMo = SLOWMO_DURATION
      this.nextTimer = -1
      this.listener({ type: 'lastBug' })
    }
  }

  private removeBody(body: Matter.Body) {
    if (!this.toRemove.includes(body)) this.toRemove.push(body)
  }

  private flushRemovals() {
    if (this.toRemove.length === 0) return
    const removed = this.toRemove.splice(0)
    for (const body of removed) {
      Composite.remove(this.engine.world, body)
      if (body === this.ammoBody) this.ammoBody = null
    }
    this.cacheDirty = true
    // sleeping bodies never notice that their support vanished – wake the neighbourhood
    for (const body of removed) {
      for (const b of this.bodies()) {
        if (b.isStatic || !b.isSleeping) continue
        const dx = b.position.x - body.position.x
        const dy = b.position.y - body.position.y
        if (dx * dx + dy * dy < 220 * 220) Sleeping.set(b, false)
      }
    }
  }
}
