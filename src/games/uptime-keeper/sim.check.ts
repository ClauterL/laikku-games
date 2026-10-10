/**
 * Headless sanity check for the simulation – not part of the app bundle.
 *
 *   /opt/npm-tools/node_modules/.bin/tsx src/games/uptime-keeper/sim.check.ts
 *
 * For every level it checks the hall (every rack and station reachable from the
 * start pad, pipes orthogonal) and plays the shift three times with a seeded RNG:
 *   instant  – every alert is handled the moment it appears → uptime must stay at 100.00 %
 *   operator – one technician with travel time and real repair durations → must pass the SLA
 *   idle     – nobody does anything → uptime must drop and the shift must fail
 * Throws on the first violated invariant so the exit code is non-zero.
 */
import { seededRng } from '../../shared/rng'
import { SLA_PASS, getLevel } from './levels'
import { accessCell, findPath } from './pathfind'
import {
  alertFor,
  canCool,
  createWorld,
  doCool,
  doUpgrade,
  freshCarry,
  levelDone,
  repairKindFor,
  spawnFault,
  starsFor,
  startRepair,
  stepWorld,
  upgradeFor,
  uptimeOf,
} from './sim'
import type { Alert, World } from './types'

const DT = 1 / 30
let failures = 0
const fail = (msg: string) => {
  failures++
  console.error(`  FAIL ${msg}`)
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
}

/** What a technician standing at the target would do about this alert. */
function handle(w: World, a: Alert, instant: boolean): boolean {
  if (a.type === 'upgrade') return doUpgrade(w, a.targetId)
  if (a.type === 'heat') return doCool(w, a.targetId)
  if (a.type === 'down') {
    if (canCool(w, a.targetId).ok && w.rackById.get(a.targetId)!.temp >= 70) doCool(w, a.targetId)
    if (!repairKindFor(w, a.targetId).kind) return false
  }
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
  let guard = 0
  while (!levelDone(w) && !w.breached && guard++ < 1e6) {
    stepWorld(w, DT)
    for (const e of w.events) if (e.kind === 'alert') seen[e.alert.type] = (seen[e.alert.type] ?? 0) + 1
    w.events.length = 0
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
  return { w, uptime: uptimeOf(w), seen }
}

console.log('level  racks  hall    instant    operator          idle')
for (let n = 1; n <= 9; n++) {
  const probe = createWorld(getLevel(n), freshCarry(), seededRng(1))
  checkHall(probe)
  const instant = play(n, 'instant', 100 + n)
  const operator = play(n, 'operator', 100 + n)
  const idle = play(n, 'idle', 100 + n)
  // The harness reacts one tick after a fault appears, so allow that single tick of degradation per fault.
  if (instant.w.penalty > 1.5 || instant.uptime < 99.995) fail(`level ${n}: instant handling should keep 100 % (lost ${instant.w.penalty.toFixed(2)} rack-s)`)
  if (instant.w.breached) fail(`level ${n}: instant handling breached the SLA`)
  if (operator.w.breached) fail(`level ${n}: a competent operator breached the SLA (${operator.w.breached})`)
  if (operator.uptime < SLA_PASS) fail(`level ${n}: a competent operator should pass (got ${operator.uptime.toFixed(3)})`)
  if (!(idle.uptime < instant.uptime)) fail(`level ${n}: ignoring alerts must cost uptime`)
  if (!idle.w.breached && idle.uptime >= SLA_PASS) fail(`level ${n}: doing nothing must not pass (got ${idle.uptime.toFixed(3)})`)
  const types = Object.entries(operator.seen)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ')
  console.log(
    `${String(n).padStart(5)}  ${String(probe.racks.length).padStart(5)}  ${`${probe.hall.cols}x${probe.hall.rows}`.padEnd(6)}  ${instant.uptime.toFixed(3).padStart(8)}  ` +
      `${operator.uptime.toFixed(3).padStart(8)} ${'★'.repeat(starsFor(operator.uptime)).padEnd(3)} ` +
      `${idle.uptime.toFixed(3).padStart(8)} ${idle.w.breached ? `breach @${idle.w.time.toFixed(0)}s` : 'no pass'}   ${types}` +
      `   credits ${Math.round(operator.w.credits)} auto ${operator.w.autoCools} down ${operator.w.shutdowns}`,
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

// fault chains
{
  const run = (w: World, seconds: number) => {
    for (let t = 0; t < seconds; t += DT) stepWorld(w, DT)
  }
  // PSU: redundancy runs out, the rack drops, REPAIR brings it straight back
  let w = createWorld(getLevel(3), freshCarry(), seededRng(11))
  w.spawnsEnabled = false
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
  w = createWorld(getLevel(3), freshCarry(), seededRng(12))
  w.spawnsEnabled = false
  const fan = w.racks[4]
  spawnFault(w, 'fan', fan.id)
  run(w, 20)
  if (fan.down || fan.temp < 55) fail(`a dead fan should heat the rack without killing it at once (${fan.temp.toFixed(0)} °C after 20 s)`)
  run(w, 45)
  if (!fan.down || alertFor(w, fan.id, 'fan') || !alertFor(w, fan.id, 'down')) fail('an ignored fan failure should end in a shutdown with a single "down" alert')
  doCool(w, fan.id)
  run(w, 0.5)
  const plan = repairKindFor(w, fan.id)
  if (plan.kind !== 'reboot' || plan.duration !== 6) fail('reboot of a rack with a dead fan should take 3 + 3 s')
  startRepair(w, fan.id)
  run(w, 6.2)
  if (fan.down || !fan.fanOk || alertFor(w, fan.id)) fail('reboot should also replace the fan')

  // server Lv4 without matching cooling creeps up on its own; cooling it pays nothing (no farming)
  w = createWorld(getLevel(3), { ...freshCarry(), credits: 2000 }, seededRng(13))
  w.spawnsEnabled = false
  const srv = w.racks[7]
  const idle1 = srv.temp
  for (let i = 0; i < 3; i++) doUpgrade(w, srv.id)
  if (srv.serverLevel !== 4) fail('three server upgrades should reach Lv4')
  run(w, 12)
  if (srv.temp < idle1 + 8) fail(`a Lv4 server should settle at a hotter idle temperature (${srv.temp.toFixed(0)} °C after 12 s)`)
  run(w, 60)
  const organic = alertFor(w, srv.id, 'heat')
  if (!(srv.temp > idle1 + 20) || !organic) fail(`a Lv4 server on Lv1 cooling should overheat by itself (${srv.temp.toFixed(0)} °C)`)
  if (organic && organic.reward) fail('self-inflicted overheating must not pay a reward')
  const resolvedBefore = w.resolved
  doCool(w, srv.id)
  run(w, 0.3)
  if (alertFor(w, srv.id, 'heat')) fail('COOL should clear the organic heat alert')
  if (w.resolved !== resolvedBefore) fail('cooling a self-inflicted alert must not count as a rewarded resolve')

  // automated monitoring (level 6): a hot spot is cooled without the technician
  w = createWorld(getLevel(6), freshCarry(), seededRng(14))
  w.spawnsEnabled = false
  spawnFault(w, 'heat', w.racks[3].id)
  run(w, 40)
  if (w.autoCools < 1 || w.shutdowns > 0 || w.alerts.some((a) => a.type === 'heat')) fail('level 6 monitoring should auto-cool a hot spot')
  // …but not while the cooling pool is below 50 %
  w = createWorld(getLevel(6), freshCarry(), seededRng(15))
  w.spawnsEnabled = false
  w.coolPool = 0
  spawnFault(w, 'heat', w.racks[3].id)
  run(w, 9)
  if (w.autoCools > 0) fail('monitoring must not auto-cool while the pool is low')

  // a skipped tutorial lesson turns into an ordinary alert and the next lesson still starts
  w = createWorld(getLevel(1), freshCarry(), seededRng(16))
  run(w, 40)
  const lessons = w.alerts.filter((a) => a.tutorial)
  if (w.tutorialStep !== 3 || lessons.length !== 1 || lessons[0].type !== 'fan') fail('second lesson should be the only guided alert after the first one timed out')
  if (!alertFor(w, 'R03', 'heat')) fail('the skipped hot spot should still be open')

  // more than half of the hall dark for 15 s ends the run
  w = createWorld(getLevel(7), freshCarry(), seededRng(17))
  w.spawnsEnabled = false
  spawnFault(w, 'power', 'PDU1')
  run(w, 41)
  if (w.breached) fail('battery should cover 40 s on level 7')
  run(w, 17)
  if (!w.breached) fail('16 of 28 racks dark for 15 s should breach the SLA')
  console.log('fault chains: ok')
}

// An uncaught error gives the non-zero exit code without needing node typings in the app config.
if (failures) throw new Error(`${failures} simulation check(s) failed`)
console.log('\nall simulation checks passed')
