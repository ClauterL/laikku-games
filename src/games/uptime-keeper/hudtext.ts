/**
 * Turns simulation state into the texts of the HUD: objective rows, the
 * detail card and the three action buttons. Pure functions, no DOM.
 */
import {
  COOL_COST,
  COOL_INSTANT,
  COOL_WEAK,
  PSU_HOLD,
  REBOOT_TEMP,
  SHUTDOWN_TEMP,
  alertSeverity,
  canCool,
  powerRatio,
  repairKindFor,
  upgradeFor,
} from './sim'
import type { ActionKind, ActionView, Alert, AlertView, DetailView, Tone, World } from './types'

const key = (touch: boolean, k: string) => (touch ? '' : ` [${k}]`)
const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v)))
const deg = (v: number) => `${Math.round(v)} °C`

export function alertTitle(w: World, a: Alert): string {
  switch (a.type) {
    case 'heat':
      return 'Rack overheating'
    case 'fan':
      return 'Replace fan'
    case 'psu':
      return 'Replace PSU'
    case 'net':
      return 'Restore network'
    case 'power':
      return 'Restore power'
    case 'down':
      return 'Reboot rack'
    case 'upgrade': {
      const up = upgradeFor(w, a.targetId)
      return up ? `Upgrade ${up.kind}` : 'Upgrade available'
    }
  }
}

export function alertSubtitle(w: World, a: Alert): string {
  const r = w.rackById.get(a.targetId)
  const s = w.stationById.get(a.targetId)
  switch (a.type) {
    case 'heat':
      return r ? `Cool ${r.name} · ${deg(r.temp)}` : ''
    case 'fan':
      return r ? `${r.name} · ${deg(r.temp)}` : ''
    case 'psu':
      return r ? (r.psuTimer > 0 ? `${r.name} · ${Math.ceil(r.psuTimer)} s of backup left` : `${r.name} · lost power`) : ''
    case 'net':
      return s ? `${s.name} · ${s.affected.length} racks slow` : ''
    case 'power':
      if (!s) return ''
      return s.battery > 0 ? `${s.name} · battery ${Math.ceil(s.battery)} s` : `${s.name} · ${s.affected.length} racks dark`
    case 'down':
      return r ? (r.temp >= REBOOT_TEMP ? `${r.name} · cool it below ${REBOOT_TEMP} °C` : `${r.name} · ready to reboot`) : ''
    case 'upgrade': {
      const up = upgradeFor(w, a.targetId)
      return up ? `${s?.name ?? r?.name ?? ''} · ${up.cost} credits` : ''
    }
  }
}

export function alertView(w: World, a: Alert, selectedId: string | null): AlertView {
  const r = w.rackById.get(a.targetId)
  const s = w.stationById.get(a.targetId)
  return {
    id: a.id,
    type: a.type,
    targetId: a.targetId,
    title: alertTitle(w, a),
    subtitle: alertSubtitle(w, a),
    chip: r ? r.name : s ? (s.kind === 'switch' ? 'Switch' : s.name) : '',
    severity: alertSeverity(w, a),
    selected: selectedId === a.targetId,
  }
}

const tempBar = (temp: number, tone: Tone): DetailView['bar'] => ({ pct: pct((temp / SHUTDOWN_TEMP) * 100), label: `${Math.round(temp)} °C / ${SHUTDOWN_TEMP} °C`, tone })

export function detailForAlert(w: World, a: Alert, touch: boolean): DetailView {
  const r = w.rackById.get(a.targetId)
  const s = w.stationById.get(a.targetId)
  switch (a.type) {
    case 'heat': {
      const how = a.tutorial
        ? touch
          ? `Tap ${r!.name}, then press COOL.`
          : `Walk to ${r!.name} and press COOL [1].`
        : `Stand next to ${r!.name} and press COOL${key(touch, '1')}.`
      return { type: 'heat', tone: 'alert', title: 'RACK OVERHEATING', lines: [`Temperature at ${deg(r!.temp)}`, how], bar: tempBar(r!.temp, 'alert') }
    }
    case 'fan': {
      const how = a.tutorial
        ? touch
          ? `Tap ${r!.name}, then press REPAIR and stay close.`
          : `Stand next to ${r!.name} and press REPAIR [2].`
        : `REPAIR${key(touch, '2')} at ${r!.name} · 3 s. COOL buys time.`
      return { type: 'fan', tone: 'alert', title: 'FAN FAILURE', lines: [`${r!.name} heats ×${r!.fanMult.toFixed(1)} · ${deg(r!.temp)}`, how], bar: tempBar(r!.temp, 'alert') }
    }
    case 'psu': {
      const alive = r!.psuTimer > 0
      return {
        type: 'psu',
        tone: 'alert',
        title: 'PSU FAILURE',
        lines: [alive ? `${r!.name} runs on its redundant PSU` : `${r!.name} has lost power`, `REPAIR${key(touch, '2')} at the rack · 6 s`],
        bar: alive ? { pct: pct((r!.psuTimer / PSU_HOLD) * 100), label: `${Math.ceil(r!.psuTimer)} s of redundancy left`, tone: 'power' } : null,
      }
    }
    case 'net':
      return {
        type: 'net',
        tone: 'alert',
        title: 'NETWORK FAULT',
        lines: [
          `${s!.name} disconnected – ${s!.affected.length} racks affected`,
          w.upgrades.spares > 0 ? `REPAIR${key(touch, '2')} swaps in your spare switch instantly.` : `REPAIR${key(touch, '2')} at the switch · degraded racks count half.`,
        ],
        bar: { pct: pct(w.network), label: `Network ${pct(w.network)} %`, tone: 'network' },
      }
    case 'power': {
      const zone = w.hall.zones.length > 1 ? `zone ${s!.faultZone}` : 'the hall'
      const live = s!.battery > 0
      return {
        type: 'power',
        tone: 'power',
        title: 'POWER FAULT',
        lines: [live ? `${s!.name} tripped – ${zone} runs on battery` : `${s!.name} tripped – ${s!.affected.length} racks are dark`, `REPAIR${key(touch, '2')} at the PDU · 5 s`],
        bar: live ? { pct: pct((s!.battery / w.level.battery) * 100), label: `Battery ${Math.ceil(s!.battery)} s`, tone: 'power' } : { pct: 0, label: 'Battery empty', tone: 'alert' },
      }
    }
    case 'down': {
      const hot = r!.temp >= REBOOT_TEMP
      return {
        type: 'down',
        tone: 'alert',
        title: 'RACK DOWN',
        lines: [
          `${r!.name} shut down at ${SHUTDOWN_TEMP} °C · now ${deg(r!.temp)}`,
          hot ? `COOL${key(touch, '1')} it below ${REBOOT_TEMP} °C, then REPAIR${key(touch, '2')} to reboot.` : `REPAIR${key(touch, '2')} to reboot · 3 s`,
        ],
        bar: tempBar(r!.temp, hot ? 'alert' : 'ok'),
      }
    }
    case 'upgrade': {
      const up = upgradeFor(w, a.targetId)
      return {
        type: 'upgrade',
        tone: 'upgrade',
        title: 'UPGRADE AVAILABLE',
        // the last line is the one compact layouts show, so it carries what to do and what it costs
        lines: up ? [`${up.effect}.`, `${up.label} · ${up.cost} cr – UPGRADE${key(touch, '3')} at the ${s?.name ?? 'unit'}`] : ['Optional'],
        bar: null,
      }
    }
  }
}

/** Card for whatever the technician is standing next to when it has no open alert. */
export function detailForTarget(w: World, id: string, touch: boolean): DetailView | null {
  const r = w.rackById.get(id)
  if (r) {
    const up = upgradeFor(w, id)
    const state = r.down ? 'down' : !r.linkOk ? 'degraded – no network' : r.onBattery ? 'on battery' : r.hotspotTarget > 0 ? 'running hot' : 'nominal'
    const second =
      r.hotspotTarget > 0 && !r.down
        ? `Hot spot building – COOL${key(touch, '1')} now for a proactive bonus.`
        : up && up.from < up.to
          ? `UPGRADE${key(touch, '3')} · ${up.cost} cr: +50 % score, +35 % heat`
          : 'Server at max level.'
    return {
      type: 'rack',
      tone: r.down ? 'alert' : 'ok',
      title: `${r.name.toUpperCase()}${w.hall.zones.length > 1 ? ` · ZONE ${r.zone}` : ''}`,
      lines: [`${deg(r.temp)} · Server Lv${r.serverLevel} · ${state}`, second],
      bar: tempBar(r.temp, r.temp >= 80 ? 'alert' : r.temp >= 68 ? 'power' : 'ok'),
    }
  }
  const s = w.stationById.get(id)
  if (!s) return null
  const up = upgradeFor(w, id)
  const upLine = up ? (up.from < up.to ? `UPGRADE${key(touch, '3')} · ${up.cost} cr: ${up.label}` : `${up.label}`) : ''
  if (s.kind === 'crac') {
    const pool = (w.coolPool / w.coolMax) * 100
    return {
      type: 'crac',
      tone: 'cooling',
      title: `${s.name.toUpperCase()} · COOLING UNIT`,
      lines: [`Cooling Lv${w.upgrades.cooling} · every COOL uses ${COOL_COST} % of one unit's pool`, upLine],
      bar: { pct: pct(pool), label: `Cooling pool ${pct(pool)} %`, tone: 'cooling' },
    }
  }
  if (s.kind === 'switch') {
    return {
      type: 'switch',
      tone: 'network',
      title: `${s.name.toUpperCase()} · NETWORK`,
      lines: [`Network Lv${w.upgrades.network} · ${w.upgrades.spares} spare ${w.upgrades.spares === 1 ? 'switch' : 'switches'}`, upLine],
      bar: { pct: pct(w.network), label: `Network ${pct(w.network)} %`, tone: 'network' },
    }
  }
  if (s.kind === 'pdu') {
    const load = powerRatio(w) * 100
    return {
      type: 'pdu',
      tone: 'power',
      title: `${s.name.toUpperCase()} · POWER${w.level.ups ? ' + UPS' : ''}`,
      lines: [`Battery backup ${w.level.battery} s per fault · server upgrades add load`, 'Above 90 % load, power faults double.'],
      bar: { pct: pct(load), label: `Load ${pct(load)} % of capacity`, tone: load > 90 ? 'alert' : 'power' },
    }
  }
  return {
    type: 'terminal',
    tone: 'upgrade',
    title: 'UPGRADE TERMINAL',
    lines: [`Cooling Lv${w.upgrades.cooling} · Network Lv${w.upgrades.network} · ${Math.floor(w.credits)} credits`, upLine || 'Everything is at max level.'],
    bar: null,
  }
}

export function nominalDetail(touch: boolean): DetailView {
  return {
    type: 'nominal',
    tone: 'ok',
    title: 'ALL SYSTEMS NOMINAL',
    lines: ['No open alerts – every rack is serving.', touch ? 'Tap a rack or the floor to walk there.' : 'Walk with WASD / arrow keys, or click where you want to go.'],
    bar: null,
  }
}

/** Button states while the technician is not standing next to anything. */
export function idleActions(weak: boolean): Record<ActionKind, ActionView> {
  return {
    cool: { enabled: false, sub: weak ? `WEAK −${COOL_WEAK} °C` : `−${COOL_INSTANT} °C`, hint: 'Stand next to a hot rack' },
    repair: { enabled: false, sub: 'STAY CLOSE', hint: 'Stand next to a faulty rack, switch or PDU' },
    upgrade: { enabled: false, sub: 'CREDITS', hint: 'Upgrades: racks, CRAC, switch or terminal' },
  }
}

export function actionViews(w: World, targetId: string | null): Record<ActionKind, ActionView> {
  const weak = w.coolPool < COOL_COST
  const coolSub = weak ? `WEAK −${COOL_WEAK} °C` : `−${COOL_INSTANT} °C`
  if (!targetId) return idleActions(weak)
  const cool = canCool(w, targetId)
  const plan = repairKindFor(w, targetId)
  const working = w.repair !== null && w.repair.targetId === targetId
  const up = upgradeFor(w, targetId)
  return {
    cool: { enabled: cool.ok, sub: coolSub, hint: cool.why },
    repair: {
      enabled: plan.kind !== null,
      sub: working ? 'WORKING…' : plan.kind ? (plan.swap ? 'SPARE SWAP' : `${Math.ceil(plan.duration)} s`) : 'NO FAULT',
      hint: plan.kind ? (plan.swap ? 'Swap in the spare switch' : 'Stay close until the ring is full') : plan.why,
    },
    upgrade: {
      enabled: !!up && up.ok,
      sub: up ? (up.from < up.to ? `${up.cost} CR` : 'MAX') : 'NOT HERE',
      hint: up ? `${up.label} – ${up.why}` : 'Upgrades: racks, CRAC, switch or terminal',
    },
  }
}
