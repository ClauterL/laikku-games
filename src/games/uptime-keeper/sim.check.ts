/**
 * Headless sanity check for the simulation – not part of the app bundle.
 *
 *   /opt/npm-tools/node_modules/.bin/tsx src/games/uptime-keeper/sim.check.ts
 *
 * For every level 1–13 it checks the hall (every rack and station reachable from
 * the start pad, pipes orthogonal) and plays the shift three times with a seeded RNG:
 *   instant  – every alert is handled the moment it appears → uptime must stay at 100.00 %
 *   operator – one technician with travel time and real repair durations → must pass the SLA
 *              on levels 1–7 (REPAIRs a customer's rack, cleans malware, and catches the
 *              virus – catching is modelled as the same three seconds of walking)
 *   idle     – nobody does anything → uptime must drop and the shift must fail
 * Then targeted checks: the action rules, fault chains, the heat speed (every heat path
 * reaches 80 / 90 / 100 °C in half the time of the original model), customers (resolve,
 * TALK, timeout), and the virus (walking, infection, spread, cleaning, quarantine, caps).
 * Throws at the end when any invariant was violated so the exit code is non-zero.
 */
import { seededRng } from '../../shared/rng'
import { SLA_PASS, getLevel, isWalkable } from './levels'
import { accessCell, findPath } from './pathfind'
import {
  ESCALATION_FINE,
  ESCALATION_SLA,
  HEAT_SPEED,
  INFECT_TIME,
  PATIENCE,
  REPAIR_TIME,
  REWARD,
  SLA_WINDOW,
  SPREAD_TIME,
  TALK_BONUS,
  alertFor,
  canCool,
  catchVirus,
  createWorld,
  doCool,
  doUpgrade,
  freshCarry,
  infectRack,
  levelDone,
  neighbours,
  repairKindFor,
  spawnCustomer,
  spawnFault,
  spawnVirus,
  starsFor,
  startRepair,
  stepWorld,
  talkTo,
  upgradeFor,
  uptimeOf,
  waitingCustomers,
} from './sim'
import type { Alert, Rack, World } from './types'

const DT = 1 / 30
let failures = 0
const fail = (msg: string) => {
  failures++
  console.error(`  FAIL ${msg}`)
}
const run = (w: World, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds; t += DT) {
    stepWorld(w, DT)
    each?.()
  }
}
/** A hall with no random faults, customers or viruses – everything is staged by hand. */
const quiet = (n: number, seed: number, credits = 0) => {
  const w = createWorld(getLevel(n), { ...freshCarry(), credits }, seededRng(seed))
  w.spawnsEnabled = false
  w.nextCustomer = Infinity
  w.virusQueue.length = 0
  return w
}

function checkHall(w: World) {
  const { hall } = w
  const from = { x: Math.floor(hall.start.x), y: Math.floor(hall.start.y) }
  for (const t of [...w.racks.map((r) => ({ id: r.id, cx: r.cx, cy: r.cy, w: 1, h: 1 })), ...w.stations]) {
    const cell = accessCell(hall, t.cx, t.cy, t.w, t.h, hall.start)
    if (!cell) fail(`${t.id}: no access cell`)
    else if (!findPath(hall, from, cell)) fail(`${t.id}: unreachable from the pad`)
  }
  for (const p of hall.pipes) {
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1]
      const b = p.pts[i]
      if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) fail(`pipe of ${p.stationId} has a diagonal segment`)
    }
  }
  for (const r of w.racks) {
    for (const id of [r.cracId, r.pduId, r.switchId]) if (!w.stationById.get(id)) fail(`${r.id}: missing station ${id}`)
  }
  if (hall.door) {
    // the doorway in the left wall leads straight onto the floor
    const y = hall.door.y
    if (isWalkable(hall, 0, y)) fail('the entrance itself must stay solid for the technician')
    if (!isWalkable(hall, 1, y)) fail(`entrance row ${y}: no floor inside the door`)
    else if (!findPath(hall, from, { x: 1, y })) fail(`entrance row ${y}: unreachable from the pad`)
  } else if (w.level.customers) fail('a hall with customers needs an entrance')
}

/** Visitors and viruses must stay on the floor (customers may also be in the doorway). */
function checkWalkers(w: World, tag: string) {
  const hall = w.hall
  for (const v of w.viruses) {
    if (!isWalkable(hall, Math.floor(v.x), Math.floor(v.y))) fail(`${tag}: ${v.id} left the aisles at ${v.x.toFixed(2)},${v.y.toFixed(2)}`)
  }
  for (const c of w.customers) {
    const door = hall.door
    const inDoorway = !!door && c.x < 1.3 && Math.abs(c.y - (door.y + 0.5)) < 0.5
    if (!inDoorway && !isWalkable(hall, Math.floor(c.x), Math.floor(c.y))) fail(`${tag}: ${c.id} walked into a wall at ${c.x.toFixed(2)},${c.y.toFixed(2)}`)
  }
}

/** What a technician standing at the target would do about this alert. */
function handle(w: World, a: Alert, instant: boolean): boolean {
  if (a.type === 'upgrade') return doUpgrade(w, a.targetId)
  if (a.type === 'heat') return doCool(w, a.targetId)
  if (a.type === 'virus') return catchVirus(w, a.targetId)
  if (a.type === 'down') {
    if (canCool(w, a.targetId).ok && w.rackById.get(a.targetId)!.temp >= 70) doCool(w, a.targetId)
    if (!repairKindFor(w, a.targetId).kind) return false
  }
  // fan / PSU / switch / PDU, a customer's slow rack (perf) and malware (clean) are all REPAIRs
  const res = startRepair(w, a.targetId)
  if (res === 'started' && instant && w.repair) w.repair.t = w.repair.duration
  return res !== null
}

type Mode = 'instant' | 'operator' | 'idle'

function play(n: number, mode: Mode, seed: number) {
  const w = createWorld(getLevel(n), freshCarry(), seededRng(seed))
  let busyUntil = 0
  let current: Alert | null = null
  const seen: Record<string, number> = {}
  let maxWaiting = 0
  let maxViruses = 0
  let guard = 0
  while (!levelDone(w) && !w.breached && guard++ < 1e6) {
    stepWorld(w, DT)
    for (const e of w.events) if (e.kind === 'alert') seen[e.alert.type] = (seen[e.alert.type] ?? 0) + 1
    w.events.length = 0
    maxWaiting = Math.max(maxWaiting, waitingCustomers(w).length)
    maxViruses = Math.max(maxViruses, w.viruses.length)
    if (guard % 15 === 0) checkWalkers(w, `level ${n} ${mode}`)
    if (mode === 'instant') {
      for (const a of [...w.alerts]) handle(w, a, true)
    } else if (mode === 'operator') {
      if (w.repair) continue
      if (current && !w.alerts.includes(current)) current = null
      if (!current && w.alerts.length) {
        // most urgent first; walking there takes about three seconds
        current = w.alerts.find((a) => a.type !== 'upgrade') ?? w.alerts[0]
        busyUntil = w.time + 3
      }
      if (current && w.time >= busyUntil) {
        if (!handle(w, current, false) && current.type !== 'down') current = null
        else if (current.type === 'heat' || current.type === 'upgrade') current = null
      }
    }
  }
  return { w, uptime: uptimeOf(w), seen, maxWaiting, maxViruses }
}

console.log('level  racks  hall    instant    operator          idle')
for (let n = 1; n <= 13; n++) {
  const L = getLevel(n)
  const probe = createWorld(L, freshCarry(), seededRng(1))
  checkHall(probe)
  const instant = play(n, 'instant', 100 + n)
  const operator = play(n, 'operator', 100 + n)
  const idle = play(n, 'idle', 100 + n)
  // The harness reacts one tick after a fault appears, so allow that single tick of degradation per fault.
  if (instant.w.penalty > 1.5 || instant.uptime < 99.995) fail(`level ${n}: instant handling should keep 100 % (lost ${instant.w.penalty.toFixed(2)} rack-s)`)
  if (instant.w.breached) fail(`level ${n}: instant handling breached the SLA`)
  if (n <= 7) {
    if (operator.w.breached) fail(`level ${n}: a competent operator breached the SLA (${operator.w.breached})`)
    if (operator.uptime < SLA_PASS) fail(`level ${n}: a competent operator should pass (got ${operator.uptime.toFixed(3)})`)
  }
  if (!(idle.uptime < instant.uptime)) fail(`level ${n}: ignoring alerts must cost uptime`)
  if (!idle.w.breached && idle.uptime >= SLA_PASS) fail(`level ${n}: doing nothing must not pass (got ${idle.uptime.toFixed(3)})`)
  for (const r of [instant, operator, idle]) {
    if (r.maxWaiting > 2) fail(`level ${n}: ${r.maxWaiting} customers waited at once (max 2)`)
    if (r.maxViruses > L.viruses) fail(`level ${n}: ${r.maxViruses} viruses at once (max ${L.viruses})`)
  }
  if (L.customers && !operator.seen.customer) fail(`level ${n}: no customer walked in`)
  if (!L.customers && (operator.seen.customer || idle.seen.customer)) fail(`level ${n}: customers before level 6`)
  if (L.viruses && !operator.seen.virus) fail(`level ${n}: no virus appeared`)
  if (!L.viruses && (operator.seen.virus || idle.seen.virus)) fail(`level ${n}: a virus before level 11`)
  if (L.viruses && idle.w.infections === 0) fail(`level ${n}: an unchecked virus should infect racks`)
  const types = Object.entries(operator.seen)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ')
  const ow = operator.w
  const extra = L.customers ? ` · customers ${ow.happy}☺ ${ow.escalations}☹` : ''
  const bugs = L.viruses ? ` · caught ${ow.quarantined} infected ${ow.infections} cleaned ${ow.cleaned}` : ''
  console.log(
    `${String(n).padStart(5)}  ${String(probe.racks.length).padStart(5)}  ${`${probe.hall.cols}x${probe.hall.rows}`.padEnd(6)}  ${instant.uptime.toFixed(3).padStart(8)}  ` +
      `${operator.uptime.toFixed(3).padStart(8)} ${'★'.repeat(starsFor(operator.uptime)).padEnd(3)} ` +
      `${idle.uptime.toFixed(3).padStart(8)} ${idle.w.breached ? `breach @${idle.w.time.toFixed(0)}s` : 'no pass'}   ${types}` +
      `   credits ${Math.round(ow.credits)} auto ${ow.autoCools} down ${ow.shutdowns}${extra}${bugs}`,
  )
}

// actions: the rules the HUD buttons rely on
{
  const w = createWorld(getLevel(3), { ...freshCarry(), credits: 1000 }, seededRng(7))
  const rack = w.racks[0]
  if (canCool(w, rack.id).ok) fail('COOL should be refused on an idle rack')
  if (repairKindFor(w, rack.id).kind) fail('REPAIR should be refused on a healthy rack')
  const before = upgradeFor(w, rack.id)
  if (!before?.ok || before.cost !== 120) fail('server upgrade Lv1→2 should cost 120 and be affordable')
  doUpgrade(w, rack.id)
  if (rack.serverLevel !== 2 || Math.round(w.credits) !== 880) fail('server upgrade did not apply')
  if (upgradeFor(w, rack.id)?.cost !== 200) fail('second server upgrade should cost 200')
  const crac = w.stations.find((s) => s.kind === 'crac')!
  const max0 = w.coolMax
  doUpgrade(w, crac.id)
  if (w.upgrades.cooling !== 2 || Math.abs(w.coolMax - max0 * 1.25) > 1e-6) fail('cooling upgrade should add 25 % pool')
  const sw = w.stations.find((s) => s.kind === 'switch')!
  doUpgrade(w, sw.id)
  if (w.upgrades.network !== 2 || w.upgrades.spares !== 1) fail('network upgrade should grant a spare switch')
  // a spare switch swaps instantly
  spawnFault(w, 'net', sw.id)
  stepWorld(w, DT)
  if (w.racks.every((r) => r.linkOk)) fail('network fault should degrade a zone')
  if (startRepair(w, sw.id) !== 'swap') fail('spare switch should swap instantly')
  stepWorld(w, DT)
  if (!w.racks.every((r) => r.linkOk)) fail('swap should restore the links')
  // power fault: battery, then the zone goes dark and comes back with the PDU
  const pdu = w.stations.find((s) => s.kind === 'pdu')!
  spawnFault(w, 'power', pdu.id)
  for (let t = 0; t < 5; t += DT) stepWorld(w, DT)
  if (w.racks.some((r) => r.down)) fail('racks should run on battery for 10 s')
  if (!w.racks.some((r) => r.onBattery)) fail('zone should be on battery')
  for (let t = 0; t < 6; t += DT) stepWorld(w, DT)
  const dark = w.racks.filter((r) => r.down).length
  if (dark !== pdu.racks.length / 2) fail(`one zone (${pdu.racks.length / 2} racks) should be dark, got ${dark}`)
  startRepair(w, pdu.id)
  for (let t = 0; t < 5.2; t += DT) stepWorld(w, DT)
  if (w.racks.some((r) => r.down)) fail('racks should restart when the PDU is repaired')
  // heat shutdown needs cooling before the reboot
  const hot = w.racks[5]
  spawnFault(w, 'heat', hot.id)
  for (let t = 0; t < 60 && !hot.down; t += DT) stepWorld(w, DT)
  if (!hot.down || !alertFor(w, hot.id, 'down')) fail('ignored hot spot should shut the rack down')
  if (repairKindFor(w, hot.id).kind) fail('reboot should be refused while the rack is hot')
  doCool(w, hot.id)
  for (let t = 0; t < 1; t += DT) stepWorld(w, DT)
  if (repairKindFor(w, hot.id).kind !== 'reboot') fail('reboot should be offered once cooled')
  startRepair(w, hot.id)
  for (let t = 0; t < 3.2; t += DT) stepWorld(w, DT)
  if (hot.down) fail('rack should be back after the reboot')
  console.log('actions: ok')
}

// fault chains (time windows are the original ones divided by HEAT_SPEED)
{
  // PSU: redundancy runs out, the rack drops, REPAIR brings it straight back
  let w = quiet(3, 11)
  const psu = w.racks[2]
  spawnFault(w, 'psu', psu.id)
  run(w, 20)
  if (psu.down) fail('redundant PSU should hold for 25 s')
  run(w, 6)
  if (!psu.down || psu.downReason !== 'psu') fail('rack should drop when the redundant PSU gives up')
  const penaltyBefore = w.penalty
  startRepair(w, psu.id)
  run(w, 6.2)
  if (psu.down || !psu.psuOk || alertFor(w, psu.id)) fail('PSU repair should restart the rack and clear the alert')
  if (!(w.penalty > penaltyBefore)) fail('a down rack must cost uptime')

  // dead fan left alone: the rack cooks, then one cool + one longer REPAIR fixes fan and reboot together
  w = quiet(3, 12)
  const fan = w.racks[4]
  spawnFault(w, 'fan', fan.id)
  run(w, 20 / HEAT_SPEED)
  if (fan.down || fan.temp < 55) fail(`a dead fan should heat the rack without killing it at once (${fan.temp.toFixed(0)} °C after ${20 / HEAT_SPEED} s)`)
  run(w, 45 / HEAT_SPEED)
  if (!fan.down || alertFor(w, fan.id, 'fan') || !alertFor(w, fan.id, 'down')) fail('an ignored fan failure should end in a shutdown with a single "down" alert')
  doCool(w, fan.id)
  run(w, 0.5)
  const plan = repairKindFor(w, fan.id)
  if (plan.kind !== 'reboot' || plan.duration !== 6) fail('reboot of a rack with a dead fan should take 3 + 3 s')
  startRepair(w, fan.id)
  run(w, 6.2)
  if (fan.down || !fan.fanOk || alertFor(w, fan.id)) fail('reboot should also replace the fan')

  // server Lv4 without matching cooling creeps up on its own; cooling it pays nothing (no farming)
  w = quiet(3, 13, 2000)
  const srv = w.racks[7]
  const idle1 = srv.temp
  for (let i = 0; i < 3; i++) doUpgrade(w, srv.id)
  if (srv.serverLevel !== 4) fail('three server upgrades should reach Lv4')
  run(w, 12 / HEAT_SPEED)
  if (srv.temp < idle1 + 8) fail(`a Lv4 server should settle at a hotter idle temperature (${srv.temp.toFixed(0)} °C after ${12 / HEAT_SPEED} s)`)
  run(w, 60 / HEAT_SPEED)
  const organic = alertFor(w, srv.id, 'heat')
  if (!(srv.temp > idle1 + 20) || !organic) fail(`a Lv4 server on Lv1 cooling should overheat by itself (${srv.temp.toFixed(0)} °C)`)
  if (organic && organic.reward) fail('self-inflicted overheating must not pay a reward')
  const resolvedBefore = w.resolved
  doCool(w, srv.id)
  run(w, 0.3)
  if (alertFor(w, srv.id, 'heat')) fail('COOL should clear the organic heat alert')
  if (w.resolved !== resolvedBefore) fail('cooling a self-inflicted alert must not count as a rewarded resolve')

  // automated monitoring (level 6): a hot spot is cooled without the technician
  w = quiet(6, 14)
  spawnFault(w, 'heat', w.racks[3].id)
  run(w, 40)
  if (w.autoCools < 1 || w.shutdowns > 0 || w.alerts.some((a) => a.type === 'heat')) fail('level 6 monitoring should auto-cool a hot spot')
  // …but not while the cooling pool is below 50 %
  w = quiet(6, 15)
  w.coolPool = 0
  spawnFault(w, 'heat', w.racks[3].id)
  run(w, 9)
  if (w.autoCools > 0) fail('monitoring must not auto-cool while the pool is low')

  // a skipped tutorial lesson turns into an ordinary alert and the next lesson still starts
  w = createWorld(getLevel(1), freshCarry(), seededRng(16))
  run(w, 40 / HEAT_SPEED + 2)
  const lessons = w.alerts.filter((a) => a.tutorial)
  if (w.tutorialStep !== 3 || lessons.length !== 1 || lessons[0].type !== 'fan') fail('second lesson should be the only guided alert after the first one timed out')
  if (!alertFor(w, 'R03', 'heat')) fail('the skipped hot spot should still be open')

  // more than half of the hall dark for 15 s ends the run
  w = quiet(7, 17)
  spawnFault(w, 'power', 'PDU1')
  run(w, 41)
  if (w.breached) fail('battery should cover 40 s on level 7')
  run(w, 17)
  if (!w.breached) fail('16 of 28 racks dark for 15 s should breach the SLA')
  console.log('fault chains: ok')
}

// heat speed: every heat path reaches warning / critical / shutdown in 1 / HEAT_SPEED of the original time
{
  // Seconds to 80 / 90 / 100 °C in the original model (HEAT_SPEED 1), measured with exactly these setups.
  const REFERENCE: Record<string, [number, number, number]> = {
    'hot spot': [14.03, 19.92, 25.8],
    'dead fan': [31.35, 39.05, 46.73],
    'tutorial hot spot': [52.13, 65.22, 78.28],
    'server Lv4 creep': [52.3, 70.48, 88.67],
  }
  const STEP = 1 / 60
  const measure = (level: number, setup: (w: World) => Rack): [number, number, number] => {
    const w = createWorld(getLevel(level), { ...freshCarry(), credits: 5000 }, seededRng(5))
    w.spawnsEnabled = false
    w.tutorialStep = 5
    const r = setup(w)
    const out: number[] = []
    for (let t = 0; t < 300 && out.length < 3; t += STEP) {
      stepWorld(w, STEP)
      while (out.length < 3 && (r.temp >= [80, 90, 100][out.length] || r.down)) out.push(w.time)
    }
    return [out[0] ?? Infinity, out[1] ?? Infinity, out[2] ?? Infinity]
  }
  const got: Record<string, [number, number, number]> = {
    'hot spot': measure(3, (w) => (spawnFault(w, 'heat', 'R04'), w.rackById.get('R04')!)),
    'dead fan': measure(3, (w) => (spawnFault(w, 'fan', 'R04'), w.rackById.get('R04')!)),
    'tutorial hot spot': measure(1, (w) => (spawnFault(w, 'heat', 'R03', true), w.rackById.get('R03')!)),
    'server Lv4 creep': measure(3, (w) => {
      const r = w.rackById.get('R04')!
      for (let i = 0; i < 3; i++) doUpgrade(w, r.id)
      return r
    }),
  }
  const lines: string[] = []
  for (const [name, ref] of Object.entries(REFERENCE)) {
    const t = got[name]
    ref.forEach((orig, i) => {
      const want = orig / HEAT_SPEED
      if (Math.abs(t[i] - want) > want * 0.03 + 0.05) fail(`${name}: ${[80, 90, 100][i]} °C after ${t[i].toFixed(2)} s, expected ${want.toFixed(2)} s (original ${orig} s ÷ ${HEAT_SPEED})`)
    })
    lines.push(`${name} 100 °C in ${t[2].toFixed(1)} s (was ${ref[2]} s)`)
  }
  if (HEAT_SPEED !== 2) fail(`the owner asked for half the heating time (HEAT_SPEED is ${HEAT_SPEED})`)
  console.log(`heat speed ×${HEAT_SPEED}: ${lines.join(' · ')}`)
}

// customers (level 6+): resolve, TALK, timeout, arrivals
{
  // resolved: the complaint degrades the rack, TALK works once, REPAIR makes the customer happy
  let w = quiet(6, 21, 100)
  if (!spawnCustomer(w, 'R05')) fail('a customer should walk in for a healthy rack')
  const c = w.customers[0]
  const rack = w.rackById.get('R05')!
  if (!c || !rack.perf || !alertFor(w, 'R05', 'customer')) fail('the complaint should put a performance fault and an objective on Rack 05')
  if (c && !c.complaint.includes('Rack 05')) fail(`the complaint should name the rack ("${c?.complaint}")`)
  if (spawnCustomer(w, 'R05')) fail('a second customer for the same rack should be refused')
  const p0 = w.penalty
  run(w, 2, () => checkWalkers(w, 'customer'))
  if (Math.abs(w.penalty - p0 - 0.5 * 2) > 0.05) fail(`a slow rack should count as half down (${(w.penalty - p0).toFixed(2)} rack-s in 2 s)`)
  run(w, 5, () => checkWalkers(w, 'customer'))
  if (c.state !== 'wait') fail(`the customer should be waiting in the aisle after 7 s (state ${c.state})`)
  const before = c.patience
  if (!talkTo(w, c.id) || Math.abs(c.patience - before - TALK_BONUS) > 1e-6) fail('TALK should add 15 s of patience')
  if (talkTo(w, c.id)) fail('TALK should only work once')
  const credits = w.credits
  const score = w.score
  if (repairKindFor(w, 'R05').kind !== 'perf' || startRepair(w, 'R05') !== 'started') fail('REPAIR should start on the slow rack')
  const held = c.patience
  run(w, 1)
  if (c.patience !== held) fail('patience should hold while the technician works on the rack')
  w.events.length = 0
  run(w, 2.2)
  const happy = w.events.find((e) => e.kind === 'customerHappy')
  if (c.state !== 'leave' || c.mood !== 'happy' || rack.perf || alertFor(w, 'R05', 'customer') || !happy) fail('the fix should send the customer away happy')
  if (w.credits - credits < REWARD.customer - 1) fail(`a happy customer should pay ${REWARD.customer} credits (got ${(w.credits - credits).toFixed(0)})`)
  if (!(w.score - score > REWARD.customer + 10)) fail('a happy customer should add score beyond the credits (patience bonus)')
  run(w, 15, () => checkWalkers(w, 'leaving customer'))
  if (w.customers.length) fail('the happy customer should have walked out through the entrance')
  if (w.happy !== 1 || w.escalations !== 0) fail('one happy customer, no escalation expected')

  // timeout: nobody helps – the customer storms off, credits are fined and the SLA takes a hit
  w = quiet(6, 22, 300)
  spawnCustomer(w, 'R10')
  const angryRack = w.rackById.get('R10')!
  const pen0 = w.penalty
  const up0 = uptimeOf(w)
  let fined = -1
  let creditsAtFine = 0
  run(w, PATIENCE + 0.5, () => {
    const e = w.events.find((x) => x.kind === 'customerAngry')
    if (e && e.kind === 'customerAngry' && fined < 0) {
      fined = e.credits
      creditsAtFine = w.credits
    }
    w.events.length = 0
  })
  const gone = w.customers[0]
  if (!gone || gone.mood !== 'angry' || gone.state !== 'leave' || w.escalations !== 1) fail('an ignored customer should escalate after 30 s')
  if (fined !== ESCALATION_FINE) fail(`an escalation should cost ${ESCALATION_FINE} credits (got ${fined})`)
  if (creditsAtFine < 0) fail('credits must not go negative')
  const sla = (ESCALATION_SLA / 100) * w.racks.length * SLA_WINDOW
  const expected = 0.5 * PATIENCE + sla
  if (Math.abs(w.penalty - pen0 - expected) > 0.6) fail(`escalation should book the slow time + an SLA credit (${(w.penalty - pen0).toFixed(1)} rack-s, expected ${expected.toFixed(1)})`)
  if (!(up0 - uptimeOf(w) >= ESCALATION_SLA)) fail('the SLA credit should show in the uptime')
  if (angryRack.perf || alertFor(w, 'R10', 'customer')) fail('the escalated complaint should leave the objectives')
  run(w, 10, () => checkWalkers(w, 'storming off'))
  if (w.customers.length) fail('the angry customer should storm out')

  // arrivals: the first one within 12–18 s, never more than two waiting, nobody in the last stretch
  w = createWorld(getLevel(6), freshCarry(), seededRng(23))
  const arrivals: number[] = []
  let most = 0
  run(w, 150, () => {
    for (const e of w.events) if (e.kind === 'customerIn') arrivals.push(w.time)
    w.events.length = 0
    most = Math.max(most, waitingCustomers(w).length)
    // keep every visitor waiting forever so the cap is what limits them
    for (const v of w.customers) v.patience = Math.max(v.patience, 5)
  })
  if (!arrivals.length || arrivals[0] < 12 || arrivals[0] > 18.1) fail(`first customer should arrive 12–18 s into the shift (got ${arrivals[0]?.toFixed(1)})`)
  for (let i = 1; i < arrivals.length; i++) if (arrivals[i] - arrivals[i - 1] < 34.9) fail(`customers arrived ${(arrivals[i] - arrivals[i - 1]).toFixed(1)} s apart (min 35)`)
  if (most > 2) fail(`${most} customers waited at once (max 2)`)
  if (arrivals.some((t) => t > 150 - PATIENCE - 8)) fail('no customer should arrive when the shift is almost over')
  if (most !== 2) fail('with nobody helping, a second customer should join the first one')
  console.log(`customers: ok (arrivals at ${arrivals.map((t) => t.toFixed(0)).join(', ')} s; resolve +${REWARD.customer} cr, escalation −${ESCALATION_FINE} cr and −${ESCALATION_SLA} % SLA)`)
}

// virus (level 11+): walking, infection, spread, cleaning, quarantine, caps
{
  let w = quiet(11, 31, 0)
  if (!spawnVirus(w) || !alertFor(w, w.viruses[0]?.id ?? '', 'virus')) fail('a virus should crawl out of a switch with an objective')
  const v = w.viruses[0]
  let dwellAt = -1
  let infectedAt = -1
  for (let t = 0; t < 40 && infectedAt < 0; t += DT) {
    stepWorld(w, DT)
    checkWalkers(w, 'virus')
    if (v.mode === 'dwell' && dwellAt < 0) dwellAt = w.time
    if (w.racks.some((r) => r.infected)) infectedAt = w.time
  }
  if (infectedAt < 0) fail('an unchecked virus should infect a rack')
  else if (Math.abs(infectedAt - dwellAt - INFECT_TIME) > 0.1) fail(`infection should take ${INFECT_TIME} s next to the rack (took ${(infectedAt - dwellAt).toFixed(2)} s)`)
  const sick = w.racks.find((r) => r.infected)!
  if (!alertFor(w, sick.id, 'infected')) fail('an infected rack should be an objective')
  const p1 = w.penalty
  // quarantine: the virus is gone, pays out, and a new one is queued 45–60 s later
  const credits = w.credits
  const caughtAt = w.time
  if (!catchVirus(w, v.id) || w.viruses.length || alertFor(w, v.id, 'virus')) fail('catching should quarantine the virus')
  if (Math.abs(w.credits - credits - REWARD.virus) > 1e-6) fail(`a quarantine should pay ${REWARD.virus} credits`)
  if (w.virusQueue.length !== 1 || w.virusQueue[0] < caughtAt + 45 || w.virusQueue[0] > caughtAt + 60) fail('a new virus should be queued 45–60 s after the quarantine')
  run(w, 1)
  if (w.penalty - p1 < 0.95) fail('an infected rack should count as down')
  // spread: the infected rack passes it on to a neighbour about every 12 s
  let spreadAt = -1
  let victim: Rack | undefined
  for (let t = 0; t < 20 && spreadAt < 0; t += DT) {
    stepWorld(w, DT)
    victim = w.racks.find((r) => r.infected && r !== sick)
    if (victim) spreadAt = w.time
  }
  if (!victim) fail('malware should spread to a neighbour when nobody cleans it')
  else {
    if (!neighbours(w, sick).includes(victim)) fail(`malware jumped from ${sick.id} to ${victim.id}, which is not adjacent`)
    const gap = spreadAt - infectedAt
    if (gap < SPREAD_TIME * 0.9 - 0.1 || gap > SPREAD_TIME * 1.1 + 0.1) fail(`malware spread after ${gap.toFixed(1)} s (expected ~${SPREAD_TIME} s)`)
  }
  // cleaning: REPAIR takes 4 s and holds the spread timer meanwhile
  const plan = repairKindFor(w, sick.id)
  if (plan.kind !== 'clean' || plan.duration !== 4) fail('REPAIR on an infected rack should be a 4 s clean')
  startRepair(w, sick.id)
  const timer = sick.spreadT
  run(w, 2)
  if (sick.spreadT !== timer) fail('the spread timer should hold while the rack is being cleaned')
  const c0 = w.credits
  run(w, 2.2)
  if (sick.infected || alertFor(w, sick.id, 'infected') || w.cleaned !== 1) fail('cleaning should remove the malware and the objective')
  if (w.credits - c0 < REWARD.infected - 1) fail(`cleaning should pay ${REWARD.infected} credits`)
  // the queued virus comes back on time once spawns are on
  w.spawnsEnabled = true
  const due = w.virusQueue[0]
  for (let t = 0; t < 70 && !w.viruses.length; t += DT) stepWorld(w, DT)
  if (!w.viruses.length || Math.abs(w.time - due) > 0.1) fail(`the next virus should arrive at ${due.toFixed(1)} s (got ${w.viruses.length ? w.time.toFixed(1) : 'none'})`)

  // an infected rack also accepts other faults' repairs afterwards; dev infection works on any rack
  w = quiet(11, 32)
  if (!infectRack(w, 'R01') || infectRack(w, 'R01')) fail('a rack can only be infected once at a time')

  // caps per level, ignoring every virus for a whole shift
  for (const n of [11, 12, 13]) {
    w = createWorld(getLevel(n), freshCarry(), seededRng(40 + n))
    let most = 0
    let firstAt = -1
    run(w, 150, () => {
      most = Math.max(most, w.viruses.length)
      if (firstAt < 0 && w.viruses.length) firstAt = w.time
    })
    const cap = getLevel(n).viruses
    if (most !== cap) fail(`level ${n}: expected up to ${cap} virus(es) at once, saw ${most}`)
    if (firstAt < 8 || firstAt > 12.1) fail(`level ${n}: first virus should appear 8–12 s into the shift (got ${firstAt.toFixed(1)})`)
  }
  if (!(getLevel(14).virusSpeed > getLevel(12).virusSpeed && getLevel(12).virusSpeed > getLevel(11).virusSpeed)) fail('the virus should speed up per level')
  console.log(`virus: ok (infects after ${INFECT_TIME} s next to a rack, spreads every ~${SPREAD_TIME} s, clean ${REPAIR_TIME.clean} s, respawn 45–60 s)`)
}

// An uncaught error gives the non-zero exit code without needing node typings in the app config.
if (failures) throw new Error(`${failures} simulation check(s) failed`)
console.log('\nall simulation checks passed')
