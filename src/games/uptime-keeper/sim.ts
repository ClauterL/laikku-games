/**
 * Uptime Keeper – pure simulation. No DOM, no canvas, no React: the engine
 * drives it with `stepWorld()` and the player's actions, and drains
 * `world.events` for sounds and particles. `sim.check.ts` runs the same code
 * headlessly.
 *
 * Thermal model (°C per second, per rack):
 *   m     = serverMult(level) × hall heat factor × 0.8^(cooling level − 1)
 *   fault = hot spot (3.4·m, faster while still below the alert threshold)
 *         + broken fan (ramps to 2.6·m – the "×2.5 heat" of a dead fan)
 *   A healthy rack rests at an idle temperature (≈ 40–44 °C at m = 1). A fault
 *   makes it climb until somebody deals with it; upgrades only slow the climb,
 *   so an ignored alert always ends in a 100 °C shutdown. Server levels raise
 *   m: the rack earns more but idles hotter, burns faster, and above m = 1.5
 *   creeps upwards on its own until the cooling level catches up.
 *   Every heating rate and ramp is scaled by HEAT_SPEED, so a rack reaches the
 *   warning, critical and shutdown temperatures in 1 / HEAT_SPEED of the time;
 *   the cooling side (COOL, boost, relaxation, pool) is not scaled.
 *
 * Level 6+ adds customers (a complaint tied to one rack with a performance
 * fault, patience timer, TALK to calm them once) and level 11+ a roaming virus
 * (infects racks it lingers next to; infections spread until cleaned).
 */
import { buildHall, isWalkable, SLA_FAIL, SLA_PASS, SLA_THREE, SLA_TWO } from './levels'
import { accessCell, findPath, smoothPath } from './pathfind'
import type { Alert, AlertType, Carry, Customer, Dir, HallLayout, LevelDef, Pt, Rack, Repair, Station, UpgradeKind, Virus, World } from './types'

export const AMBIENT = 24
export const WARN_TEMP = 80
export const CRIT_TEMP = 90
export const SHUTDOWN_TEMP = 100
export const REBOOT_TEMP = 70
export const MONITOR_TEMP = 70
const COLD_FLOOR = AMBIENT + 6

const IDLE_RISE = 16
/**
 * The owner asked for half the heating time ("speed the game up"): every
 * heat-up path – hot spots, dead fans, server-level creep, warm-up – runs at
 * this multiple of the original rates. Cooling strength is deliberately not scaled.
 */
export const HEAT_SPEED = 2
const HOT_RATE = 1.7 * HEAT_SPEED
const HOT_PREHEAT = 1.8
/** Hot-spot strength ramps 0 → 1 at this rate (per second). */
const HOT_RAMP = 0.5 * HEAT_SPEED
const FAN_RATE = 1.3 * HEAT_SPEED
const FAN_BROKEN_MULT = 2.5
/** A dead fan degrades towards ×2.5 at this rate (per second). */
const FAN_RAMP = 0.3 * HEAT_SPEED
const ORGANIC_RATE = 1 * HEAT_SPEED
const HEADROOM = 1.5
const RELAX_RATE = 1.6
const WARMUP_RATE = 1 * HEAT_SPEED
const BOOST_RATE = 2.5

/** Seconds before an ignored tutorial lesson moves on (35 s / 30 s at the original heat speed). */
const LESSON_COOL_TIME = 35 / HEAT_SPEED
const LESSON_REPAIR_TIME = 30 / HEAT_SPEED

export const COOL_INSTANT = 30
export const COOL_WEAK = 8
const COOL_BOOST_TIME = 10
export const COOL_COST = 20
const POOL_REGEN = 4
export const PSU_HOLD = 25

/**
 * The SLA is measured over a one-hour window that was clean before the shift,
 * so one rack-second of downtime moves the third decimal instead of ending the
 * run. (The literal `down / (racks × elapsed)` would breach on the first
 * incident of every level, when `elapsed` is still a handful of seconds.)
 */
export const SLA_WINDOW = 3600
/** Alerts older than this no longer hold back new faults: ignoring problems lets them pile up. */
const STALE_ALERT = 25
const DEGRADED_WEIGHT = 0.5
const HALF_DOWN_LIMIT = 15

export const UPGRADE_COSTS = [120, 200, 320]
export const MAX_UPGRADE = 4
// Tuned so the first upgrade is affordable about a minute into level 1 and the
// infrastructure is maxed around level 3 – after that credits go into server levels.
const CREDITS_PER_RACK_SEC = 0.3
export const REWARD: Record<AlertType, number> = { heat: 30, fan: 40, psu: 60, net: 80, power: 80, upgrade: 0, down: 20, customer: 60, infected: 30, virus: 50 }
export const REPAIR_TIME: Record<Repair['kind'], number> = { fan: 3, psu: 6, reboot: 3, switch: 4, pdu: 5, clean: 4, perf: 3 }
// Containment before recovery: catch the source, clean what spreads, then bring dark racks back.
const PRIORITY: Record<AlertType, number> = { virus: 6.4, infected: 6.2, down: 6, power: 5, heat: 4, net: 3, customer: 2.5, psu: 2, fan: 1, upgrade: 0 }

/* customers (level 6+) */
/** Seconds a customer waits before escalating; TALK adds TALK_BONUS once. */
export const PATIENCE = 30
export const TALK_BONUS = 15
/** How close (tile units, feet to feet) the technician must stand to talk or zap. */
export const ENTITY_REACH = 1.05
const CUSTOMER_FIRST = 12
const CUSTOMER_GAP_MIN = 35
const CUSTOMER_GAP_MAX = 55
const MAX_CUSTOMERS = 2
const CUSTOMER_SPEED = 2.1
const LEAVE_HAPPY_SPEED = 2.5
const LEAVE_ANGRY_SPEED = 3.4
/** Score per second of patience left when the fix lands. */
const HAPPY_BONUS = 2
/** An escalation is booked as an SLA credit worth this much uptime (percentage points) … */
export const ESCALATION_SLA = 0.02
/** … plus a credit penalty. */
export const ESCALATION_FINE = 40

/** Rotating complaints; `{rack}` becomes the rack's name. */
const COMPLAINTS = [
  'Our webshop is crawling – {rack}!',
  "I can't reach my VM on {rack}!",
  'Backup on {rack} failed again!',
  'Why is latency 400 ms? {rack}!',
  'Our API times out – {rack}!',
  'Checkout keeps freezing – {rack}!',
  'Our database is so slow – {rack}!',
  'Video calls keep dropping – {rack}!',
]

/* virus (level 11+) */
/** Seconds a virus has to sit next to a rack to infect it. */
export const INFECT_TIME = 2
/** An infected rack passes the malware to a neighbour about this often. */
export const SPREAD_TIME = 12
/** Touching the virus quarantines it (feet to feet, tile units). */
export const TOUCH_DIST = 0.5
const VIRUS_FIRST = 8
const TWIN_DELAY = 25
const VIRUS_RESPAWN_MIN = 45
const VIRUS_RESPAWN_MAX = 60
const VIRUS_SPAWN_TIME = 0.9

export const serverMult = (lv: number) => 1 + 0.35 * (lv - 1)
export const serverScoreMult = (lv: number) => 1 + 0.5 * (lv - 1)
export const serverDraw = (lv: number) => 1 + 0.3 * (lv - 1)
export const coolingFactor = (lv: number) => Math.pow(0.8, lv - 1)
export const netRepairFactor = (lv: number) => Math.pow(0.75, lv - 1)
export const upgradeCost = (level: number) => UPGRADE_COSTS[Math.min(UPGRADE_COSTS.length - 1, Math.max(0, level - 1))]

export const freshCarry = (): Carry => ({ upgrades: { cooling: 1, network: 1, spares: 0 }, servers: {}, credits: 0, score: 0 })

export function createWorld(level: LevelDef, carry: Carry, rng: () => number): World {
  const hall = buildHall(level)
  const stations: Station[] = hall.stations.map((s) => ({ ...s, fault: false, faultZone: null, affected: [], battery: -1, racks: [] }))
  const stationById = new Map(stations.map((s) => [s.id, s]))
  const racks: Rack[] = hall.racks.map((r, i) => {
    stationById.get(r.cracId)!.racks.push(r.id)
    stationById.get(r.pduId)!.racks.push(r.id)
    stationById.get(r.switchId)!.racks.push(r.id)
    return {
      id: r.id,
      name: r.name,
      label: r.label,
      cx: r.cx,
      cy: r.cy,
      zone: r.zone,
      temp: 0,
      idleOffset: rng() * 4,
      fanOk: true,
      psuOk: true,
      linkOk: true,
      powered: true,
      onBattery: false,
      serverLevel: Math.min(MAX_UPGRADE, Math.max(1, carry.servers[r.id] ?? 1)),
      down: false,
      downReason: null,
      hotspot: 0,
      hotspotTarget: 0,
      hotScale: 1,
      boost: 0,
      fanMult: 1,
      psuTimer: -1,
      cracId: r.cracId,
      pduId: r.pduId,
      switchId: r.switchId,
      ledSeed: i * 7919 + 13,
      heatAlerted: false,
      perf: false,
      infected: false,
      spreadT: 0,
      infecting: 0,
    }
  })
  const w: World = {
    level,
    hall,
    racks,
    stations,
    rackById: new Map(racks.map((r) => [r.id, r])),
    stationById,
    alerts: [],
    alertSeq: 1,
    time: 0,
    penalty: 0,
    penaltyRate: 0,
    credits: carry.credits,
    score: carry.score,
    coolPool: 0,
    coolMax: 0,
    network: 100,
    powerLoad: 0,
    powerCap: 1,
    upgrades: { ...carry.upgrades },
    repair: null,
    nextSpawn: level.tutorial ? Infinity : 6,
    tutorialStep: level.tutorial ? 0 : 5,
    tutorialTimer: 0,
    halfDownTimer: 0,
    downCount: 0,
    resolved: 0,
    shutdowns: 0,
    autoCools: 0,
    events: [],
    rng,
    breached: null,
    spawnsEnabled: !level.tutorial,
    customers: [],
    viruses: [],
    entitySeq: 1,
    nextCustomer: Infinity,
    complaintIdx: 0,
    virusQueue: [],
    visitors: 0,
    virusSpawns: 0,
    happy: 0,
    escalations: 0,
    quarantined: 0,
    infections: 0,
    cleaned: 0,
  }
  // (halls without customers or viruses draw nothing extra from the RNG, so their fault rolls stay as they were)
  if (level.customers && hall.door) {
    w.nextCustomer = CUSTOMER_FIRST + rng() * 6
    w.complaintIdx = Math.floor(rng() * COMPLAINTS.length)
  }
  if (level.viruses > 0) {
    const first = VIRUS_FIRST + rng() * 4
    for (let i = 0; i < level.viruses; i++) w.virusQueue.push(first + i * TWIN_DELAY)
  }
  for (const r of racks) r.temp = idleTemp(w, r)
  w.coolMax = coolMaxFor(w)
  w.coolPool = w.coolMax
  let cap = 0
  for (const s of stations) if (s.kind === 'pdu') cap += (s.racks.length * 1.3 + 3) * (level.ups ? 1.3 : 1)
  w.powerCap = Math.max(1, cap)
  computePower(w)
  return w
}

export const coolMaxFor = (w: World) => 100 * (1 + 0.25 * (w.upgrades.cooling - 1)) * w.level.cracs

export const heatMult = (w: World, r: Rack) => serverMult(r.serverLevel) * w.level.heatFactor * coolingFactor(w.upgrades.cooling)

export const idleTemp = (w: World, r: Rack) => AMBIENT + (IDLE_RISE + r.idleOffset) * heatMult(w, r)

function computePower(w: World) {
  let load = w.level.cracs * 1.5
  for (const r of w.racks) load += r.powered && !r.down ? serverDraw(r.serverLevel) : 0.15
  w.powerLoad = load
}

export const powerRatio = (w: World) => w.powerLoad / w.powerCap

export const uptimeOf = (w: World) => Math.max(0, 100 * (1 - w.penalty / (w.racks.length * SLA_WINDOW)))

export const starsFor = (uptime: number) => (uptime >= SLA_THREE ? 3 : uptime >= SLA_TWO ? 2 : uptime >= SLA_PASS ? 1 : 0)

export const alertTemp = (w: World) => (w.level.monitoring ? MONITOR_TEMP : WARN_TEMP)

export const levelDone = (w: World) => w.time >= w.level.duration

/* ---------- alerts ---------- */

function addAlert(w: World, type: AlertType, targetId: string, tutorial = false, reward = true): Alert {
  const a: Alert = { id: w.alertSeq++, type, targetId, priority: PRIORITY[type], age: 0, tutorial, reward }
  w.alerts.push(a)
  w.alerts.sort((x, y) => y.priority - x.priority || x.id - y.id)
  w.events.push({ kind: 'alert', alert: a })
  return a
}

export const alertFor = (w: World, targetId: string, type?: AlertType): Alert | undefined =>
  w.alerts.find((a) => a.targetId === targetId && (!type || a.type === type))

function resolveAlert(w: World, a: Alert, reward: boolean) {
  const i = w.alerts.indexOf(a)
  if (i < 0) return
  w.alerts.splice(i, 1)
  const credits = reward && a.reward ? REWARD[a.type] : 0
  if (credits > 0) {
    w.credits += credits
    w.score += credits
    w.resolved++
  }
  w.events.push({ kind: 'resolved', type: a.type, targetId: a.targetId, credits })
  if (a.tutorial) {
    if (w.tutorialStep === 1) {
      w.tutorialStep = 2
      w.tutorialTimer = 1.6
    } else if (w.tutorialStep === 3) finishTutorial(w)
  }
}

/** A lesson the player skipped stays on the floor as an ordinary alert. */
function endLesson(w: World) {
  for (const a of w.alerts) a.tutorial = false
}

function finishTutorial(w: World) {
  endLesson(w)
  w.tutorialStep = 4
  w.tutorialTimer = 8
  w.spawnsEnabled = true
  w.nextSpawn = w.time + 7
}

/** Is the rack a sensible target for a brand-new fault (or a customer's complaint)? */
const healthyRack = (w: World, r: Rack) =>
  !r.down && r.powered && r.fanOk && r.psuOk && !r.perf && !r.infected && r.hotspotTarget === 0 && r.hotspot < 0.05 && r.temp < 66 && !alertFor(w, r.id)

/** Customer complaints and malware sit on a rack next to its hardware alerts; anything else blocks a new heat alert. */
const blocksHeatAlert = (w: World, id: string) => w.alerts.some((a) => a.targetId === id && a.type !== 'customer' && a.type !== 'infected')

/**
 * Starts a fault. Without `targetId` a random healthy target is picked.
 * Returns false when no target is free (e.g. the only switch is already down).
 */
export function spawnFault(w: World, type: AlertType, targetId?: string, tutorial = false): boolean {
  if (type === 'heat' || type === 'fan' || type === 'psu') {
    let rack = targetId ? w.rackById.get(targetId) : undefined
    if (targetId && !rack) return false
    if (!rack) {
      const cands = w.racks.filter((r) => healthyRack(w, r))
      if (!cands.length) return false
      rack = cands[Math.floor(w.rng() * cands.length)]
    }
    if (rack.down || alertFor(w, rack.id)) return false
    if (type === 'heat') {
      rack.hotspotTarget = 1
      rack.hotScale = tutorial ? 0.45 : 1
      // A regular hot spot stays silent until the sensors see it cross the alert temperature.
      if (tutorial) {
        rack.heatAlerted = true
        addAlert(w, 'heat', rack.id, true)
      }
      return true
    }
    if (type === 'fan') {
      if (!rack.fanOk) return false
      rack.fanOk = false
      addAlert(w, 'fan', rack.id, tutorial)
      return true
    }
    if (!rack.psuOk) return false
    rack.psuOk = false
    rack.psuTimer = PSU_HOLD
    addAlert(w, 'psu', rack.id, tutorial)
    return true
  }
  if (type === 'net' || type === 'power') {
    const kind = type === 'net' ? 'switch' : 'pdu'
    let st = targetId ? w.stationById.get(targetId) : undefined
    if (targetId && (!st || st.kind !== kind)) return false
    if (!st) {
      const cands = w.stations.filter((s) => s.kind === kind && !s.fault && s.racks.length > 0)
      if (!cands.length) return false
      st = cands[Math.floor(w.rng() * cands.length)]
    }
    if (st.fault) return false
    // A fault takes out one zone of the unit's racks (the whole hall while there is only one zone).
    const zones = [...new Set(st.racks.map((id) => w.rackById.get(id)!.zone))]
    if (!zones.length) return false
    const zone = zones[Math.floor(w.rng() * zones.length)]
    st.fault = true
    st.faultZone = zone
    st.affected = st.racks.filter((id) => w.rackById.get(id)!.zone === zone)
    if (type === 'power') st.battery = w.level.battery
    addAlert(w, type, st.id)
    return true
  }
  return false
}

function spawnRandom(w: World) {
  const weights: [AlertType, number][] = []
  for (const t of w.level.alertTypes) {
    let wt = t === 'heat' ? 4 : t === 'fan' ? 3 : t === 'psu' ? 1.5 : t === 'net' ? 2 * Math.pow(0.7, w.upgrades.network - 1) : 1.5
    if (t === 'power' && powerRatio(w) > 0.9) wt *= 2
    weights.push([t, wt])
  }
  let total = weights.reduce((a, [, v]) => a + v, 0)
  // up to three draws: a type may have no free target (e.g. the only switch already faulted)
  for (let tries = 0; tries < 3 && weights.length; tries++) {
    let roll = w.rng() * total
    let idx = 0
    for (; idx < weights.length - 1; idx++) {
      roll -= weights[idx][1]
      if (roll <= 0) break
    }
    const [type, wt] = weights[idx]
    if (spawnFault(w, type)) return
    weights.splice(idx, 1)
    total -= wt
  }
}

/** Fresh alerts + hot spots that have not been noticed yet count against the simultaneous cap. */
function activeIncidents(w: World) {
  let n = 0
  for (const a of w.alerts) if (a.type !== 'upgrade' && a.age < STALE_ALERT) n++
  for (const r of w.racks) if (r.hotspotTarget > 0 && !alertFor(w, r.id)) n++
  return n
}

/* ---------- step ---------- */

export function stepWorld(w: World, dt: number) {
  if (w.breached) return
  w.time += dt
  for (const a of w.alerts) a.age += dt
  const L = w.level

  // guided opening of level 1: one slow hot spot, then one fan failure. A lesson the
  // player ignores times out at about the same temperature whatever the heat speed.
  if (w.tutorialStep < 5) {
    if (w.tutorialStep === 0) {
      if (w.time >= 1.2) {
        spawnFault(w, 'heat', 'R03', true)
        w.tutorialStep = 1
        w.tutorialTimer = LESSON_COOL_TIME
      }
    } else {
      w.tutorialTimer -= dt
      if (w.tutorialTimer <= 0) {
        if (w.tutorialStep === 1) {
          endLesson(w)
          w.tutorialStep = 2
          w.tutorialTimer = 1.6
        } else if (w.tutorialStep === 2) {
          // fall back to any healthy rack if Rack 05 is unavailable (the first lesson went wrong)
          if (!spawnFault(w, 'fan', 'R05', true)) spawnFault(w, 'fan', undefined, true)
          w.tutorialStep = 3
          w.tutorialTimer = LESSON_REPAIR_TIME
        } else if (w.tutorialStep === 3) finishTutorial(w)
        else w.tutorialStep = 5
      }
    }
  }

  // random faults (none in the last seconds: nobody could react to them)
  if (w.spawnsEnabled && w.time >= w.nextSpawn) {
    if (activeIncidents(w) < L.maxAlerts && w.time < L.duration - 6) spawnRandom(w)
    const k = Math.min(1, w.time / L.duration)
    const interval = L.spawnStart + (L.spawnEnd - L.spawnStart) * k
    w.nextSpawn = w.time + interval * (0.75 + w.rng() * 0.5)
  }

  stepCustomers(w, dt)
  stepViruses(w, dt)

  // cooling pool regenerates (4 %/s, +1 % per cooling level)
  w.coolPool = Math.min(w.coolMax, w.coolPool + (POOL_REGEN + (w.upgrades.cooling - 1)) * (w.coolMax / 100) * dt)

  // PDU batteries
  for (const s of w.stations) {
    if (s.kind === 'pdu' && s.fault && s.battery > 0) {
      s.battery -= dt
      if (s.battery <= 0) {
        s.battery = 0
        w.events.push({ kind: 'battery', stationId: s.id, racks: s.affected.length })
      }
    }
  }

  const threshold = alertTemp(w)
  let downCount = 0
  let linked = 0
  let penalty = 0
  let income = 0
  for (const r of w.racks) {
    // power + link state follow the infrastructure
    const pdu = w.stationById.get(r.pduId)!
    const pduHit = pdu.fault && pdu.affected.includes(r.id)
    const sw = w.stationById.get(r.switchId)!
    r.linkOk = !(sw.fault && sw.affected.includes(r.id))
    r.onBattery = pduHit && pdu.battery > 0
    if (!r.psuOk && r.psuTimer > 0) r.psuTimer = Math.max(0, r.psuTimer - dt)
    const pduDead = pduHit && pdu.battery <= 0
    r.powered = !pduDead && (r.psuOk || r.psuTimer > 0)
    if (!r.powered && !r.down) shutdown(w, r, pduDead ? 'power' : 'psu')
    else if (r.powered && r.down && r.downReason !== 'heat') reboot(w, r)

    // heat
    r.fanMult = r.fanOk ? 1 : Math.min(FAN_BROKEN_MULT, r.fanMult + FAN_RAMP * dt)
    r.hotspot = r.hotspot < r.hotspotTarget ? Math.min(r.hotspotTarget, r.hotspot + HOT_RAMP * dt) : Math.max(r.hotspotTarget, r.hotspot - 1.2 * dt)
    if (r.boost > 0) r.boost = Math.max(0, r.boost - dt)
    const online = r.powered && !r.down
    const m = heatMult(w, r)
    const boost = r.boost > 0 ? BOOST_RATE : 0
    let heat = 0
    if (online) {
      const spot = r.hotspot > 0 ? HOT_RATE * r.hotspot * r.hotScale * (r.temp < threshold - 3 && r.hotScale === 1 ? HOT_PREHEAT : 1) : 0
      const fan = r.fanOk ? 0 : (FAN_RATE * (r.fanMult - 1)) / (FAN_BROKEN_MULT - 1)
      heat = spot + fan > 0 ? (spot + fan) * m : Math.max(0, ORGANIC_RATE * (m - HEADROOM))
    }
    const floor = online ? idleTemp(w, r) : COLD_FLOOR
    if (heat > 0) {
      const net = heat - boost
      if (net < 0) r.temp = Math.max(COLD_FLOOR, r.temp + net * dt)
      // below its idle temperature a rack warms up at least at the normal rate
      else r.temp += (r.temp < floor && boost === 0 ? Math.max(net, WARMUP_RATE) : net) * dt
    } else if (r.temp > floor) r.temp = Math.max(floor, r.temp - (RELAX_RATE + boost) * dt)
    else if (r.temp < floor && boost === 0) r.temp = Math.min(floor, r.temp + WARMUP_RATE * dt)

    if (online) {
      if (r.temp >= SHUTDOWN_TEMP) shutdown(w, r, 'heat')
      else if (L.monitoring && r.fanOk && r.temp >= MONITOR_TEMP + 4 && r.temp < CRIT_TEMP && w.coolPool > w.coolMax * 0.5) {
        // automated monitoring: hot spots get first aid without the technician while the pool is
        // healthy (a dead fan still needs hands – cooling it forever would hide the fault)
        const a = alertFor(w, r.id, 'heat')
        if (a) resolveAlert(w, a, false)
        applyCool(w, r)
        w.autoCools++
        w.events.push({ kind: 'autocool', rackId: r.id })
      } else if (r.temp >= threshold && !r.heatAlerted && !blocksHeatAlert(w, r.id)) {
        r.heatAlerted = true
        addAlert(w, 'heat', r.id, false, r.hotspotTarget > 0)
      }
    }
    if (r.heatAlerted && r.temp < threshold - 8) r.heatAlerted = false
    const heatAlert = alertFor(w, r.id, 'heat')
    if (heatAlert && !r.down && r.hotspotTarget === 0 && r.temp < threshold - 5) resolveAlert(w, heatAlert, true)

    // malware passes to a neighbour every SPREAD_TIME – not while the technician is cleaning it
    if (r.infected && !(w.repair && w.repair.targetId === r.id && w.repair.kind === 'clean')) {
      r.spreadT -= dt
      if (r.spreadT <= 0) spread(w, r)
    }

    if (r.linkOk) linked++
    // malware counts as down; a slow rack (performance fault) or a lost link as half
    if (r.down || r.infected) {
      downCount++
      penalty += 1
    } else {
      const earn = CREDITS_PER_RACK_SEC * serverScoreMult(r.serverLevel)
      if (r.linkOk && !r.perf) income += earn
      else {
        penalty += DEGRADED_WEIGHT
        income += earn * 0.5
      }
    }
  }
  w.downCount = downCount
  w.penalty += penalty * dt
  w.penaltyRate = penalty
  w.credits += income * dt
  w.score += income * dt
  computePower(w)
  const netTarget = (100 * linked) / w.racks.length
  w.network += (netTarget - w.network) * Math.min(1, 4 * dt)

  // repair progress (the engine cancels it when the technician walks away)
  if (w.repair) {
    w.repair.t += dt
    if (w.repair.t >= w.repair.duration) completeRepair(w)
  }

  syncUpgradeAlert(w)

  // SLA breach
  if (downCount * 2 > w.racks.length) {
    w.halfDownTimer += dt
    if (w.halfDownTimer >= HALF_DOWN_LIMIT) breach(w, `More than half of the hall was down for ${HALF_DOWN_LIMIT} seconds.`)
  } else w.halfDownTimer = Math.max(0, w.halfDownTimer - 2 * dt)
  if (uptimeOf(w) < SLA_FAIL) breach(w, `Uptime fell below ${SLA_FAIL.toFixed(1)} %.`)
}

function breach(w: World, reason: string) {
  if (w.breached) return
  w.breached = reason
  w.events.push({ kind: 'breach', reason })
}

function shutdown(w: World, r: Rack, reason: 'heat' | 'power' | 'psu') {
  if (r.down) return
  r.down = true
  r.downReason = reason
  r.hotspotTarget = 0
  r.hotspot = 0
  r.heatAlerted = false
  w.shutdowns++
  if (w.repair && w.repair.targetId === r.id && w.repair.kind === 'fan' && reason === 'heat') w.repair = null
  w.events.push({ kind: 'shutdown', rackId: r.id, reason })
  // a rack that is off has no hot spot left to cool, whatever switched it off
  const heat = alertFor(w, r.id, 'heat')
  if (heat) resolveAlert(w, heat, false)
  if (reason === 'heat') {
    // one REPAIR after cooling brings the rack back, fan included
    const fan = alertFor(w, r.id, 'fan')
    if (fan) resolveAlert(w, fan, false)
    if (!alertFor(w, r.id, 'down')) addAlert(w, 'down', r.id)
  }
}

function reboot(w: World, r: Rack) {
  r.down = false
  r.downReason = null
  w.events.push({ kind: 'reboot', rackId: r.id })
}

/* ---------- actions ---------- */

function applyCool(w: World, r: Rack): boolean {
  const weak = w.coolPool < COOL_COST
  w.coolPool = Math.max(0, w.coolPool - COOL_COST)
  r.temp = Math.max(COLD_FLOOR, r.temp - (weak ? COOL_WEAK : COOL_INSTANT))
  r.boost = weak ? COOL_BOOST_TIME * 0.4 : COOL_BOOST_TIME
  // only a full blast kills the hot spot – a weak one just buys time
  if (!weak) r.hotspotTarget = 0
  w.events.push({ kind: 'cool', rackId: r.id, weak })
  return !weak
}

export function canCool(w: World, targetId: string): { ok: boolean; why: string } {
  const r = w.rackById.get(targetId)
  if (!r) return { ok: false, why: 'COOL works on racks' }
  const hot = r.temp >= idleTemp(w, r) + 5 || r.hotspotTarget > 0 || r.hotspot > 0.05 || !r.fanOk || (r.down && r.temp > COLD_FLOOR + 6)
  if (!hot) return { ok: false, why: `${r.name} is already cool` }
  return { ok: true, why: w.coolPool < COOL_COST ? `Cooling pool low – weak COOL (−${COOL_WEAK} °C)` : `−${COOL_INSTANT} °C and 10 s of extra cooling` }
}

export function doCool(w: World, targetId: string): boolean {
  if (!canCool(w, targetId).ok) return false
  const r = w.rackById.get(targetId)!
  const early = r.hotspotTarget > 0 && !r.down && !alertFor(w, r.id)
  const full = applyCool(w, r)
  if (early && full) {
    // caught the hot spot before the sensors did
    w.credits += 15
    w.score += 15
    w.events.push({ kind: 'credits', amount: 15, targetId: r.id, label: 'PROACTIVE' })
  }
  return true
}

export type RepairPlan = { kind: Repair['kind']; duration: number; swap: boolean } | { kind: null; why: string }

export function repairKindFor(w: World, targetId: string): RepairPlan {
  const r = w.rackById.get(targetId)
  if (r) {
    // malware first: it keeps spreading while anything else is fixed
    if (r.infected) return { kind: 'clean', duration: REPAIR_TIME.clean, swap: false }
    if (r.down && r.downReason === 'heat') {
      if (!r.powered) return { kind: null, why: 'No power – repair the PDU first' }
      if (r.temp >= REBOOT_TEMP) return { kind: null, why: `COOL ${r.name} below ${REBOOT_TEMP} °C first` }
      return { kind: 'reboot', duration: REPAIR_TIME.reboot + (r.fanOk ? 0 : REPAIR_TIME.fan), swap: false }
    }
    if (!r.fanOk) return { kind: 'fan', duration: REPAIR_TIME.fan, swap: false }
    if (!r.psuOk) return { kind: 'psu', duration: REPAIR_TIME.psu, swap: false }
    if (r.down) return { kind: null, why: `${r.name} is dark – repair ${w.stationById.get(r.pduId)!.name}` }
    if (r.perf) return { kind: 'perf', duration: REPAIR_TIME.perf, swap: false }
    return { kind: null, why: `${r.name} has no fault` }
  }
  const s = w.stationById.get(targetId)
  if (s) {
    if (s.kind === 'switch') {
      if (!s.fault) return { kind: null, why: `${s.name} is online` }
      return { kind: 'switch', duration: REPAIR_TIME.switch * netRepairFactor(w.upgrades.network), swap: w.upgrades.spares > 0 }
    }
    if (s.kind === 'pdu') return s.fault ? { kind: 'pdu', duration: REPAIR_TIME.pdu, swap: false } : { kind: null, why: `${s.name} is nominal` }
    return { kind: null, why: 'Nothing to repair here' }
  }
  return { kind: null, why: 'Stand next to a faulty rack, switch or PDU' }
}

/** Starts a repair. Returns 'swap' when a spare switch fixed it instantly. */
export function startRepair(w: World, targetId: string): 'started' | 'swap' | null {
  const plan = repairKindFor(w, targetId)
  if (!plan.kind) return null
  if (plan.swap) {
    w.upgrades.spares--
    const s = w.stationById.get(targetId)!
    w.events.push({ kind: 'swap', stationId: s.id })
    fixStation(w, s)
    return 'swap'
  }
  if (w.repair && w.repair.targetId === targetId) return 'started'
  w.repair = { targetId, kind: plan.kind, t: 0, duration: plan.duration }
  return 'started'
}

export function cancelRepair(w: World) {
  w.repair = null
}

function completeRepair(w: World) {
  const rep = w.repair
  if (!rep) return
  w.repair = null
  const r = w.rackById.get(rep.targetId)
  if (r) {
    if (rep.kind === 'fan') {
      r.fanOk = true
      r.fanMult = 1
      const a = alertFor(w, r.id, 'fan')
      if (a) resolveAlert(w, a, true)
    } else if (rep.kind === 'psu') {
      // power state follows on the next tick and restarts the rack if it had gone dark
      r.psuOk = true
      r.psuTimer = -1
      const a = alertFor(w, r.id, 'psu')
      if (a) resolveAlert(w, a, true)
    } else if (rep.kind === 'reboot') {
      r.fanOk = true
      r.fanMult = 1
      if (r.down && r.downReason === 'heat') reboot(w, r)
      const a = alertFor(w, r.id, 'down')
      if (a) resolveAlert(w, a, true)
    } else if (rep.kind === 'clean') {
      r.infected = false
      r.spreadT = 0
      w.cleaned++
      const a = alertFor(w, r.id, 'infected')
      if (a) resolveAlert(w, a, true)
    } else if (rep.kind === 'perf') {
      fixPerformance(w, r)
    }
  } else {
    const s = w.stationById.get(rep.targetId)
    if (s) fixStation(w, s)
  }
  w.events.push({ kind: 'repairDone', targetId: rep.targetId, repairKind: rep.kind })
}

function fixStation(w: World, s: Station) {
  s.fault = false
  s.faultZone = null
  s.affected = []
  s.battery = -1
  const a = alertFor(w, s.id, s.kind === 'switch' ? 'net' : 'power')
  if (a) resolveAlert(w, a, true)
}

/* ---------- walking (customers + viruses) ---------- */

/** Moves an entity along its waypoints at `speed` tiles/s; returns the step taken. */
function walkAlong(e: { x: number; y: number; path: Pt[] }, speed: number, dt: number): Pt {
  const x0 = e.x
  const y0 = e.y
  let budget = speed * dt
  while (budget > 1e-6 && e.path.length) {
    const wp = e.path[0]
    const dx = wp.x - e.x
    const dy = wp.y - e.y
    const d = Math.hypot(dx, dy)
    if (d <= budget) {
      e.x = wp.x
      e.y = wp.y
      e.path.shift()
      budget -= d
    } else {
      e.x += (dx / d) * budget
      e.y += (dy / d) * budget
      budget = 0
    }
  }
  return { x: e.x - x0, y: e.y - y0 }
}

const dirOf = (dx: number, dy: number, cur: Dir): Dir =>
  Math.abs(dx) > Math.abs(dy) * 1.15 ? (dx > 0 ? 'right' : 'left') : Math.abs(dy) > Math.abs(dx) * 1.15 ? (dy > 0 ? 'down' : 'up') : cur

const cellKey = (hall: HallLayout, x: number, y: number) => y * hall.cols + x
const reservedCache = new WeakMap<HallLayout, Set<number>>()

/** Cells a waiting visitor keeps clear: rack and unit fronts, the floor pad and the doorway. */
function reservedCells(hall: HallLayout): Set<number> {
  let set = reservedCache.get(hall)
  if (set) return set
  set = new Set<number>()
  for (const r of hall.racks) set.add(cellKey(hall, r.cx, r.cy + 1))
  for (const s of hall.stations) {
    if (s.facing === 'down') {
      for (let x = s.cx; x < s.cx + s.w; x++) set.add(cellKey(hall, x, s.cy + s.h))
    } else {
      const x = s.facing === 'left' ? s.cx - 1 : s.cx + s.w
      for (let y = s.cy; y < s.cy + s.h; y++) set.add(cellKey(hall, x, y))
    }
  }
  const p = hall.pad
  for (let y = p.cy; y < p.cy + p.h; y++) for (let x = p.cx; x < p.cx + p.w; x++) set.add(cellKey(hall, x, y))
  if (hall.door) set.add(cellKey(hall, 1, hall.door.y))
  reservedCache.set(hall, set)
  return set
}

/** Where a visitor stands just inside / outside the entrance (tile units). */
export const doorInside = (door: { y: number }): Pt => ({ x: 1.5, y: door.y + 0.5 })
export const DOOR_OUTSIDE_X = -0.8

function pickWeighted<T>(w: World, items: { v: T; wt: number }[]): number {
  let total = 0
  for (const it of items) total += it.wt
  let roll = w.rng() * total
  for (let i = 0; i < items.length; i++) {
    roll -= items[i].wt
    if (roll <= 0) return i
  }
  return items.length - 1
}

/* ---------- customers (level 6+) ---------- */

export const customerById = (w: World, id: string): Customer | undefined => w.customers.find((c) => c.id === id)
/** The customer still waiting for a fix on this rack. */
export const customerFor = (w: World, rackId: string): Customer | undefined => w.customers.find((c) => c.rackId === rackId && c.state !== 'leave')
/** Customers in the hall with an open complaint (not on their way out). */
export const waitingCustomers = (w: World) => w.customers.filter((c) => c.state !== 'leave')

/** A free aisle cell a few steps from the entrance, away from the other visitor. */
function pickSpot(w: World): Pt | null {
  const hall = w.hall
  const door = hall.door
  if (!door) return null
  const reserved = reservedCells(hall)
  const { x: ix, y: iy } = doorInside(door)
  const taken = waitingCustomers(w).map((c) => c.spot)
  const cands: { v: Pt; wt: number }[] = []
  for (let y = 1; y < hall.rows - 1; y++) {
    for (let x = 1; x < hall.cols - 1; x++) {
      if (!isWalkable(hall, x, y) || reserved.has(cellKey(hall, x, y))) continue
      const d = Math.abs(x + 0.5 - ix) + Math.abs(y + 0.5 - iy)
      if (d < 2 || d > 7) continue
      // keep the two speech bubbles apart
      if (taken.some((t) => Math.abs(t.y - y) < 2 && Math.abs(t.x - x) < 5)) continue
      cands.push({ v: { x, y }, wt: 1 / d })
    }
  }
  if (!cands.length) return null
  return cands[pickWeighted(w, cands)].v
}

/** In through the doorway, then A* along the aisles to the waiting cell. */
function routeIn(w: World, c: Customer): Pt[] | null {
  const hall = w.hall
  const inside = doorInside(hall.door!)
  const cells = findPath(hall, { x: 1, y: hall.door!.y }, c.spot)
  if (!cells) return null
  return [{ x: inside.x, y: c.y }, ...smoothPath(hall, { x: inside.x, y: c.y }, cells)]
}

/** Back to the doorway and out of the hall. */
function routeOut(w: World, c: Customer): Pt[] {
  const hall = w.hall
  const door = hall.door!
  const inside = doorInside(door)
  const cx = Math.floor(c.x)
  const cy = Math.floor(c.y)
  // still in the doorway: straight back out
  if (c.x < 1 || !isWalkable(hall, cx, cy)) return [{ x: DOOR_OUTSIDE_X - 0.15, y: c.y }]
  const pts: Pt[] = []
  const cells = findPath(hall, { x: cx, y: cy }, { x: 1, y: door.y })
  if (cells) pts.push(...smoothPath(hall, c, cells))
  pts.push(inside, { x: DOOR_OUTSIDE_X - 0.15, y: inside.y })
  return pts
}

/**
 * A customer walks in with a complaint about one rack, which gets a
 * performance fault. Without `rackId` a healthy rack is picked.
 */
export function spawnCustomer(w: World, rackId?: string): boolean {
  const door = w.hall.door
  if (!door || waitingCustomers(w).length >= MAX_CUSTOMERS) return false
  let rack = rackId ? w.rackById.get(rackId) : undefined
  if (rackId && (!rack || rack.perf || rack.infected || rack.down || alertFor(w, rack.id, 'customer'))) return false
  if (!rack) {
    const cands = w.racks.filter((r) => healthyRack(w, r))
    if (!cands.length) return false
    rack = cands[Math.floor(w.rng() * cands.length)]
  }
  const spot = pickSpot(w)
  if (!spot) return false
  const c: Customer = {
    id: `CUST${w.entitySeq++}`,
    rackId: rack.id,
    complaint: COMPLAINTS[w.complaintIdx++ % COMPLAINTS.length].replace('{rack}', rack.name),
    look: Math.floor(w.rng() * 100000),
    x: DOOR_OUTSIDE_X,
    y: door.y + 0.5 + (w.rng() - 0.5) * 0.3,
    dir: 'right',
    path: [],
    state: 'enter',
    mood: 'upset',
    moodT: 0,
    patience: PATIENCE,
    patienceMax: PATIENCE,
    talked: false,
    spot,
    speed: CUSTOMER_SPEED,
    walk: 0,
    moving: false,
    age: 0,
  }
  const route = routeIn(w, c)
  if (!route) return false
  c.path = route
  rack.perf = true
  w.customers.push(c)
  w.visitors++
  addAlert(w, 'customer', rack.id)
  w.events.push({ kind: 'customerIn', id: c.id, rackId: rack.id, first: w.visitors === 1 })
  return true
}

function stepCustomers(w: World, dt: number) {
  const L = w.level
  if (L.customers && w.spawnsEnabled && w.hall.door && w.time >= w.nextCustomer) {
    // nobody arrives when there is no time left to help them
    if (w.time >= L.duration - (PATIENCE + 8)) w.nextCustomer = Infinity
    else if (waitingCustomers(w).length >= MAX_CUSTOMERS || !spawnCustomer(w)) w.nextCustomer = w.time + 4
    else w.nextCustomer = w.time + CUSTOMER_GAP_MIN + w.rng() * (CUSTOMER_GAP_MAX - CUSTOMER_GAP_MIN)
  }
  for (let i = w.customers.length - 1; i >= 0; i--) {
    const c = w.customers[i]
    c.age += dt
    c.moodT += dt
    const step = walkAlong(c, c.speed, dt)
    c.moving = Math.hypot(step.x, step.y) > 1e-5
    if (c.moving) {
      c.walk += dt * 11
      c.dir = dirOf(step.x, step.y, c.dir)
    }
    if (c.state === 'leave') {
      if (!c.path.length) w.customers.splice(i, 1)
      continue
    }
    if (c.state === 'enter' && !c.path.length) {
      c.state = 'wait'
      c.dir = 'down'
    }
    // patience holds while the technician is working on their rack
    if (!(w.repair && w.repair.targetId === c.rackId)) c.patience = Math.max(0, c.patience - dt)
    if (c.patience <= 0) escalate(w, c)
  }
}

function leave(w: World, c: Customer, mood: 'happy' | 'angry') {
  c.state = 'leave'
  c.mood = mood
  c.moodT = 0
  c.speed = mood === 'happy' ? LEAVE_HAPPY_SPEED : LEAVE_ANGRY_SPEED
  c.path = routeOut(w, c)
}

/** Patience ran out: the customer storms off and the incident is booked as an SLA credit. */
function escalate(w: World, c: Customer) {
  const rack = w.rackById.get(c.rackId)
  if (rack) rack.perf = false
  const a = alertFor(w, c.rackId, 'customer')
  if (a) resolveAlert(w, a, false)
  if (w.repair && w.repair.targetId === c.rackId && w.repair.kind === 'perf') w.repair = null
  const fine = Math.min(ESCALATION_FINE, Math.max(0, Math.floor(w.credits)))
  w.credits -= fine
  w.penalty += (ESCALATION_SLA / 100) * w.racks.length * SLA_WINDOW
  w.escalations++
  leave(w, c, 'angry')
  w.events.push({ kind: 'customerAngry', id: c.id, rackId: c.rackId, credits: fine, sla: ESCALATION_SLA })
}

/** REPAIR finished on a slow rack: its customer (if still here) leaves happy. */
function fixPerformance(w: World, r: Rack) {
  r.perf = false
  const a = alertFor(w, r.id, 'customer')
  if (a) resolveAlert(w, a, true)
  const c = customerFor(w, r.id)
  if (!c) return
  const bonus = Math.round(c.patience) * HAPPY_BONUS
  w.score += bonus
  w.happy++
  leave(w, c, 'happy')
  w.events.push({ kind: 'customerHappy', id: c.id, rackId: r.id, credits: REWARD.customer, bonus })
}

export function canTalk(w: World, id: string): { ok: boolean; why: string } {
  const c = customerById(w, id)
  if (!c || c.state === 'leave') return { ok: false, why: 'Nobody to talk to' }
  const rack = w.rackById.get(c.rackId)
  if (c.talked) return { ok: false, why: `Already promised a fix – REPAIR ${rack?.name ?? 'the rack'}` }
  return { ok: true, why: `+${TALK_BONUS} s patience – then REPAIR ${rack?.name ?? 'the rack'}` }
}

/** TALK: calms a customer once – more patience while the fix is on its way. */
export function talkTo(w: World, id: string): boolean {
  if (!canTalk(w, id).ok) return false
  const c = customerById(w, id)!
  c.patience += TALK_BONUS
  c.patienceMax = Math.max(c.patienceMax, c.patience)
  c.talked = true
  c.mood = 'calm'
  c.moodT = 0
  w.events.push({ kind: 'customerTalk', id: c.id, added: TALK_BONUS })
  return true
}

/* ---------- virus (level 11+) ---------- */

export const virusById = (w: World, id: string): Virus | undefined => w.viruses.find((v) => v.id === id)

const neighbourCache = new WeakMap<World, Map<string, Rack[]>>()

/** Racks that touch: the cabinets left and right in the row, and the ones in front and behind. */
export function neighbours(w: World, r: Rack): Rack[] {
  let map = neighbourCache.get(w)
  if (!map) {
    map = new Map()
    for (const a of w.racks) {
      map.set(
        a.id,
        w.racks.filter((b) => (b.cy === a.cy && Math.abs(b.cx - a.cx) === 1) || (b.cx === a.cx && Math.abs(b.cy - a.cy) === 3)),
      )
    }
    neighbourCache.set(w, map)
  }
  return map.get(r.id) ?? []
}

function infect(w: World, r: Rack, source: 'virus' | 'spread', from: string): boolean {
  if (r.infected) return false
  r.infected = true
  r.spreadT = SPREAD_TIME * (0.9 + w.rng() * 0.2)
  w.infections++
  addAlert(w, 'infected', r.id)
  w.events.push({ kind: 'infect', rackId: r.id, source, from, first: w.infections === 1 })
  return true
}

/** Puts malware on a rack directly (dev hook and tests). */
export const infectRack = (w: World, rackId: string): boolean => {
  const r = w.rackById.get(rackId)
  return !!r && infect(w, r, 'virus', 'dev')
}

function spread(w: World, r: Rack) {
  r.spreadT = SPREAD_TIME * (0.9 + w.rng() * 0.2)
  const cands = neighbours(w, r).filter((n) => !n.infected)
  if (!cands.length) return
  // a running rack is a juicier target than a dark one
  const live = cands.filter((n) => !n.down)
  const pool = live.length ? live : cands
  infect(w, pool[Math.floor(w.rng() * pool.length)], 'spread', r.id)
}

/** A virus crawls out of a network port (switch). */
export function spawnVirus(w: World, stationId?: string): boolean {
  const switches = w.stations.filter((s) => s.kind === 'switch')
  const st = stationId ? switches.find((s) => s.id === stationId) : switches[Math.floor(w.rng() * switches.length)]
  if (!st) return false
  const cell = accessCell(w.hall, st.cx, st.cy, st.w, st.h, { x: st.cx + st.w / 2, y: st.cy + st.h }, st.facing)
  if (!cell) return false
  const v: Virus = {
    id: `VIRUS${w.entitySeq++}`,
    x: cell.x + 0.5,
    y: cell.y + 0.5,
    path: [],
    mode: 'spawn',
    rackId: null,
    dwell: 0,
    roam: 0,
    spawnT: VIRUS_SPAWN_TIME,
    speed: w.level.virusSpeed,
    vx: 0,
    vy: 0,
    age: 0,
    trail: [],
    trailT: 0,
    stationId: st.id,
  }
  w.viruses.push(v)
  w.virusSpawns++
  addAlert(w, 'virus', v.id)
  w.events.push({ kind: 'virusSpawn', id: v.id, stationId: st.id, first: w.virusSpawns === 1 })
  return true
}

/** Picks the next rack to infect – healthy and nearby ones first – and routes there. */
function huntRack(w: World, v: Virus): boolean {
  const taken = new Set<string>()
  for (const o of w.viruses) if (o !== v && o.rackId) taken.add(o.rackId)
  const vx = Math.floor(v.x)
  const vy = Math.floor(v.y)
  const cands: { v: Rack; wt: number }[] = []
  for (const r of w.racks) {
    if (r.infected || taken.has(r.id)) continue
    const d = Math.abs(r.cx - vx) + Math.abs(r.cy + 1 - vy)
    const healthy = !r.down && !r.perf && !w.alerts.some((a) => a.targetId === r.id)
    cands.push({ v: r, wt: (healthy ? 4 : 1) / (1 + d / 5) })
  }
  while (cands.length) {
    const i = pickWeighted(w, cands)
    const r = cands[i].v
    const cell = accessCell(w.hall, r.cx, r.cy, 1, 1, v)
    const cells = cell ? findPath(w.hall, { x: vx, y: vy }, cell) : null
    if (cells) {
      v.mode = 'seek'
      v.rackId = r.id
      v.dwell = 0
      v.path = smoothPath(w.hall, v, cells)
      return true
    }
    cands.splice(i, 1)
  }
  return false
}

/** Wanders to a random aisle cell a few steps away. */
function wander(w: World, v: Virus) {
  const hall = w.hall
  const vx = Math.floor(v.x)
  const vy = Math.floor(v.y)
  for (let tries = 0; tries < 16; tries++) {
    const x = 1 + Math.floor(w.rng() * (hall.cols - 2))
    const y = 1 + Math.floor(w.rng() * (hall.rows - 2))
    const d = Math.abs(x - vx) + Math.abs(y - vy)
    if (d < 3 || d > 8 || !isWalkable(hall, x, y)) continue
    const cells = findPath(hall, { x: vx, y: vy }, { x, y })
    if (cells) {
      v.path = smoothPath(hall, v, cells)
      return
    }
  }
  v.path = []
}

function startRoam(w: World, v: Virus) {
  v.mode = 'roam'
  v.rackId = null
  v.dwell = 0
  v.roam = 4 + w.rng() * 3
  wander(w, v)
}

function stepViruses(w: World, dt: number) {
  const L = w.level
  for (const r of w.racks) r.infecting = 0
  if (w.spawnsEnabled && w.virusQueue.length && w.time < L.duration - 5) {
    for (let i = w.virusQueue.length - 1; i >= 0; i--) {
      if (w.time < w.virusQueue[i] || w.viruses.length >= L.viruses) continue
      if (spawnVirus(w)) w.virusQueue.splice(i, 1)
      else w.virusQueue[i] = w.time + 3
    }
  }
  for (const v of w.viruses) {
    v.age += dt
    v.trailT -= dt
    if (v.trailT <= 0) {
      v.trailT = 0.05
      v.trail.unshift({ x: v.x, y: v.y })
      if (v.trail.length > 10) v.trail.pop()
    }
    if (v.mode === 'spawn') {
      v.spawnT -= dt
      if (v.spawnT <= 0 && !huntRack(w, v)) startRoam(w, v)
      continue
    }
    const target = v.rackId ? w.rackById.get(v.rackId) : undefined
    if (v.mode !== 'roam' && (!target || target.infected)) {
      // somebody else got there first (or it was cleaned and re-infected): next rack
      if (!huntRack(w, v)) startRoam(w, v)
      continue
    }
    if (v.mode === 'dwell') {
      v.vx = 0
      v.vy = 0
      v.dwell += dt
      target!.infecting = Math.max(target!.infecting, Math.min(1, v.dwell / INFECT_TIME))
      if (v.dwell >= INFECT_TIME) {
        infect(w, target!, 'virus', v.id)
        startRoam(w, v)
      }
      continue
    }
    if (v.mode === 'roam') v.roam -= dt
    const step = walkAlong(v, v.speed, dt)
    v.vx = dt > 0 ? step.x / dt : 0
    v.vy = dt > 0 ? step.y / dt : 0
    if (v.path.length) continue
    if (v.mode === 'seek') {
      v.mode = 'dwell'
      v.dwell = 0
    } else if (v.roam > 0) wander(w, v)
    else if (!huntRack(w, v)) startRoam(w, v)
  }
}

export const canCatch = (w: World, id: string) => !!virusById(w, id)

/** Quarantines a virus (the technician touched it or zapped it). A new one comes 45–60 s later. */
export function catchVirus(w: World, id: string): boolean {
  const i = w.viruses.findIndex((v) => v.id === id)
  if (i < 0) return false
  const v = w.viruses[i]
  w.viruses.splice(i, 1)
  w.quarantined++
  const a = alertFor(w, v.id, 'virus')
  if (a) resolveAlert(w, a, true)
  w.virusQueue.push(w.time + VIRUS_RESPAWN_MIN + w.rng() * (VIRUS_RESPAWN_MAX - VIRUS_RESPAWN_MIN))
  w.events.push({ kind: 'quarantine', id: v.id, x: v.x, y: v.y, credits: REWARD.virus })
  return true
}

/* ---------- upgrades ---------- */

export interface UpgradeOption {
  kind: UpgradeKind
  cost: number
  from: number
  to: number
  label: string
  ok: boolean
  why: string
  effect: string
}

type InfraKind = 'cooling' | 'network'
const INFRA_NAME: Record<InfraKind, string> = { cooling: 'Cooling', network: 'Network' }
const INFRA_EFFECT: Record<InfraKind, string> = {
  cooling: 'Racks heat 20 % slower, cooling pool +25 %',
  network: 'Network faults 30 % rarer, faster repair, +1 spare switch',
}

/** The next infrastructure upgrade the player could buy (cooling first on a tie). */
export function cheapestUpgrade(w: World): { kind: InfraKind; cost: number } | null {
  let best: { kind: InfraKind; cost: number } | null = null
  for (const kind of ['cooling', 'network'] as const) {
    if (w.upgrades[kind] >= MAX_UPGRADE) continue
    const cost = upgradeCost(w.upgrades[kind])
    if (!best || cost < best.cost) best = { kind, cost }
  }
  return best
}

export function upgradeFor(w: World, targetId: string): UpgradeOption | null {
  const credits = Math.floor(w.credits)
  const r = w.rackById.get(targetId)
  if (r) {
    const effect = '+50 % score/s, +35 % heat, more power draw'
    if (r.serverLevel >= MAX_UPGRADE) return { kind: 'server', cost: 0, from: r.serverLevel, to: r.serverLevel, label: 'Server Lv4 · max', ok: false, why: 'Server is at max level', effect }
    const cost = upgradeCost(r.serverLevel)
    const extra = serverDraw(r.serverLevel + 1) - serverDraw(r.serverLevel)
    const overload = (w.powerLoad + extra) / w.powerCap > 1
    const why = r.down ? `${r.name} is down` : overload ? 'Power capacity exceeded' : credits < cost ? `Need ${cost} credits` : effect
    return { kind: 'server', cost, from: r.serverLevel, to: r.serverLevel + 1, label: `Server Lv${r.serverLevel}→${r.serverLevel + 1}`, ok: !r.down && !overload && credits >= cost, why, effect }
  }
  const s = w.stationById.get(targetId)
  if (!s) return null
  let kind: InfraKind | null = null
  if (s.kind === 'crac') kind = 'cooling'
  else if (s.kind === 'switch') kind = 'network'
  else if (s.kind === 'terminal') kind = cheapestUpgrade(w)?.kind ?? 'cooling'
  if (!kind) return null
  const lv = w.upgrades[kind]
  const effect = INFRA_EFFECT[kind]
  if (lv >= MAX_UPGRADE) return { kind, cost: 0, from: lv, to: lv, label: `${INFRA_NAME[kind]} Lv${lv} · max`, ok: false, why: `${INFRA_NAME[kind]} is at max level`, effect }
  const cost = upgradeCost(lv)
  const ok = credits >= cost
  return { kind, cost, from: lv, to: lv + 1, label: `${INFRA_NAME[kind]} Lv${lv}→${lv + 1}`, ok, why: ok ? effect : `Need ${cost} credits`, effect }
}

export function doUpgrade(w: World, targetId: string): boolean {
  const opt = upgradeFor(w, targetId)
  if (!opt || !opt.ok) return false
  w.credits -= opt.cost
  if (opt.kind === 'server') {
    w.rackById.get(targetId)!.serverLevel++
    computePower(w)
  } else if (opt.kind === 'cooling') {
    w.upgrades.cooling++
    const ratio = w.coolPool / w.coolMax
    w.coolMax = coolMaxFor(w)
    w.coolPool = w.coolMax * Math.min(1, ratio + 0.2)
  } else {
    w.upgrades.network++
    w.upgrades.spares++
  }
  w.events.push({ kind: 'upgrade', upgrade: opt.kind, targetId, level: opt.to })
  syncUpgradeAlert(w)
  return true
}

/** Keeps the optional "upgrade available" objective in step with the wallet. */
function syncUpgradeAlert(w: World) {
  const up = w.tutorialStep >= 4 ? cheapestUpgrade(w) : null
  let want: string | null = null
  if (up && Math.floor(w.credits) >= up.cost) {
    const term = w.stations.find((s) => s.kind === 'terminal')
    const own = w.stations.find((s) => s.kind === (up.kind === 'cooling' ? 'crac' : 'switch'))
    want = (term ?? own)?.id ?? null
  }
  const cur = w.alerts.find((a) => a.type === 'upgrade')
  if (cur && cur.targetId !== want) resolveAlert(w, cur, false)
  if (want && (!cur || cur.targetId !== want)) addAlert(w, 'upgrade', want, false, false)
}

/* ---------- queries for the HUD and the renderer ---------- */

export function targetName(w: World, id: string): string {
  if (customerById(w, id)) return 'the customer'
  if (virusById(w, id)) return 'the virus'
  return w.rackById.get(id)?.name ?? w.stationById.get(id)?.name ?? id
}

export const alertSeverity = (w: World, a: Alert): 'info' | 'warn' | 'critical' => {
  if (a.type === 'upgrade') return 'info'
  if (a.type === 'down' || a.type === 'infected' || a.type === 'virus') return 'critical'
  if (a.type === 'customer') {
    const c = customerFor(w, a.targetId)
    return c && c.patience < 10 ? 'critical' : 'warn'
  }
  const s = w.stationById.get(a.targetId)
  if (a.type === 'power') return !s || s.battery <= Math.min(8, w.level.battery * 0.5) ? 'critical' : 'warn'
  const r = w.rackById.get(a.targetId)
  if (r && (r.temp >= CRIT_TEMP || r.down)) return 'critical'
  if (a.type === 'psu' && r && r.psuTimer < 8) return 'critical'
  return 'warn'
}

export const anyCritical = (w: World) => {
  for (const r of w.racks) if (r.down || r.temp >= CRIT_TEMP) return true
  for (const s of w.stations) if (s.kind === 'pdu' && s.fault && s.battery <= 5) return true
  return false
}
