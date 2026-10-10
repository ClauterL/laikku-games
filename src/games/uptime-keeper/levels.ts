/**
 * Level table + procedural hall layout.
 *
 * Every hall follows the same plan so the player always knows where things are:
 *   row 0      wall
 *   row 1      service row (PDUs, upgrade terminal) along the top wall
 *   row 2      walkway
 *   rows 3+3r  rack rows, each followed by two aisle rows (front access + walkway)
 *   col 1      cooling units (CRACs) on the left wall, switches on the right wall
 * Rack blocks are separated by a 2-tile corridor that carries the Ficolo floor pad.
 */
import {
  CELL_FLOOR,
  CELL_SOLID,
  CELL_WALL,
  type AlertType,
  type HallLayout,
  type LevelDef,
  type PipeDef,
  type PipeKind,
  type Pt,
  type RackDef,
  type StationDef,
  type StationKind,
} from './types'

export const LEVEL_DURATION = 150
export const SLA_PASS = 99.5
export const SLA_TWO = 99.9
export const SLA_THREE = 99.95
export const SLA_FAIL = 98.0

interface StationSlot {
  kind: StationKind
  side: 'left' | 'right' | 'top'
  /** left/right: aisle pair index (0 = below the first rack row). top: block index, −1 corridor, −2 top-left, −3 top-right. */
  slot: number
}

interface LevelShape {
  rows: number
  groups: number[]
  slots: StationSlot[]
}

const SHAPES: Record<number, LevelShape> = {
  1: {
    rows: 2,
    groups: [3],
    slots: [
      { kind: 'crac', side: 'left', slot: 0 },
      { kind: 'switch', side: 'right', slot: 0 },
      { kind: 'pdu', side: 'top', slot: -2 },
    ],
  },
  2: {
    rows: 2,
    groups: [3, 3],
    slots: [
      { kind: 'crac', side: 'left', slot: 0 },
      { kind: 'switch', side: 'right', slot: 0 },
      { kind: 'pdu', side: 'top', slot: -1 },
      { kind: 'terminal', side: 'top', slot: -3 },
    ],
  },
  3: {
    rows: 2,
    groups: [5, 5],
    slots: [
      { kind: 'crac', side: 'left', slot: 0 },
      { kind: 'switch', side: 'right', slot: 0 },
      { kind: 'pdu', side: 'top', slot: -1 },
      { kind: 'terminal', side: 'top', slot: -3 },
    ],
  },
  4: {
    rows: 2,
    groups: [5, 5],
    slots: [
      { kind: 'crac', side: 'left', slot: 0 },
      { kind: 'crac', side: 'right', slot: 1 },
      { kind: 'switch', side: 'right', slot: 0 },
      { kind: 'pdu', side: 'top', slot: -1 },
      { kind: 'terminal', side: 'top', slot: -3 },
    ],
  },
  5: {
    rows: 3,
    groups: [4, 4],
    slots: [
      { kind: 'crac', side: 'left', slot: 0 },
      { kind: 'crac', side: 'right', slot: 1 },
      { kind: 'switch', side: 'right', slot: 0 },
      { kind: 'pdu', side: 'top', slot: -1 },
      { kind: 'terminal', side: 'top', slot: -3 },
    ],
  },
  7: {
    rows: 4,
    groups: [4, 3],
    slots: [
      { kind: 'crac', side: 'left', slot: 0 },
      { kind: 'crac', side: 'left', slot: 2 },
      { kind: 'crac', side: 'right', slot: 1 },
      { kind: 'switch', side: 'right', slot: 0 },
      { kind: 'switch', side: 'right', slot: 3 },
      { kind: 'pdu', side: 'top', slot: 0 },
      { kind: 'pdu', side: 'top', slot: 1 },
      { kind: 'terminal', side: 'top', slot: -3 },
    ],
  },
}
SHAPES[6] = SHAPES[5]

const LEVEL_TEXT: Record<number, { title: string; intro: string }> = {
  1: {
    title: 'First hall',
    intro:
      'Six racks, one cooling unit, one PDU, one switch. Racks overheat and fans fail – walk over, COOL and REPAIR before anything hits 100 °C.',
  },
  2: {
    title: 'Second rack block',
    intro:
      'The hall doubles to 12 racks and the core switch goes live. When it drops, every rack behind it is degraded and counts as half down until you REPAIR the switch. The new upgrade terminal sells Cooling and Network levels – a Network level also gives you a spare switch for an instant swap.',
  },
  3: {
    title: 'Two zones',
    intro:
      '20 racks in zones A and B. Power faults appear: a PDU breaker trip puts one zone on battery – 10 seconds to REPAIR the PDU before those racks go dark. PSU failures give a rack 25 seconds on its redundant supply. Keep the POWER meter under 90 % or power faults double.',
  },
  4: {
    title: 'Redundant cooling',
    intro:
      'A second CRAC joins the hall: the cooling pool doubles, so you can COOL twice as often, and every rack heats 15 % slower. Hot spots now leave you real time for upgrades.',
  },
  5: {
    title: 'UPS + backup power',
    intro:
      '24 racks in three rows, backed by a UPS: a power fault now gives 40 seconds of battery instead of 10, and power capacity grows 30 % – room for more server upgrades.',
  },
  6: {
    title: 'Automated monitoring',
    intro:
      'Sensors raise overheating alerts already at 70 °C and auto-cool hot racks while the cooling pool is above 50 %. Watch alerts resolve themselves – and spend the saved time on repairs and upgrades.',
  },
  7: {
    title: 'Large data centre',
    intro:
      '28 racks, three CRACs, two switches, two PDUs. The camera follows you now – the map and the arrows at the screen edge show where the alerts are.',
  },
  8: {
    title: 'Endless shift',
    intro: 'Same hall, faster alerts, more at once. Every shift is 2.5 minutes – how long can you hold the SLA?',
  },
}

export function levelTitle(n: number): string {
  return LEVEL_TEXT[Math.min(Math.max(1, n), 8)].title
}

export function levelIntro(n: number): string {
  return LEVEL_TEXT[Math.min(Math.max(1, n), 8)].intro
}

export function getLevel(n: number): LevelDef {
  const idx = Math.min(Math.max(1, n), 7)
  const shape = SHAPES[idx]
  const over = Math.max(0, n - 7)
  const types: AlertType[] = ['heat', 'fan']
  if (n >= 2) types.push('net')
  if (n >= 3) types.push('power', 'psu')
  // Spawn interval 14 s → 6 s over the seven halls, then keeps shrinking in endless mode.
  const spawnStart = Math.max(3.5, [14, 12, 10, 9, 8, 7, 6][idx - 1] - over * 0.5)
  const spawnEnd = Math.max(2.8, spawnStart * 0.75)
  const maxAlerts = Math.min(7, [1, 2, 3, 3, 4, 4, 5][idx - 1] + Math.floor(over / 2))
  return {
    n,
    title: levelTitle(n),
    intro: levelIntro(n),
    rows: shape.rows,
    groups: shape.groups,
    cracs: shape.slots.filter((s) => s.kind === 'crac').length,
    pdus: shape.slots.filter((s) => s.kind === 'pdu').length,
    switches: shape.slots.filter((s) => s.kind === 'switch').length,
    terminal: shape.slots.some((s) => s.kind === 'terminal'),
    alertTypes: types,
    spawnStart,
    spawnEnd,
    maxAlerts,
    battery: n >= 5 ? 40 : 10,
    monitoring: n >= 6,
    heatFactor: n >= 4 ? 0.85 : 1,
    duration: LEVEL_DURATION,
    ups: n >= 5,
    tutorial: n === 1,
    endless: n >= 8,
  }
}

const ZONES = ['A', 'B', 'C', 'D']
const STATION_NAMES: Record<StationKind, string> = { crac: 'CRAC', pdu: 'PDU', switch: 'Switch', terminal: 'Terminal' }

/** The cable tray runs on the floor just behind each rack row (tile units relative to the row). */
export const TRAY_Y = -0.68
export const TRAY_OFFSET: Record<PipeKind, number> = { cooling: -0.13, power: 0, network: 0.13 }
/** Where each pipe enters a rack (fraction of the tile width). */
export const STUB_X: Record<PipeKind, number> = { cooling: 0.28, power: 0.5, network: 0.72 }

export const pipeKindOf = (kind: StationKind): PipeKind | null =>
  kind === 'crac' ? 'cooling' : kind === 'pdu' ? 'power' : kind === 'switch' ? 'network' : null

export function buildHall(level: LevelDef): HallLayout {
  const shape = SHAPES[Math.min(Math.max(1, level.n), 7)]
  const R = shape.rows
  const groups = shape.groups
  const blocks = groups.map((g, b) => {
    const x0 = 3 + groups.slice(0, b).reduce((a, v) => a + v + 2, 0)
    return { x0, x1: x0 + g - 1 }
  })
  const lastX1 = blocks[blocks.length - 1].x1
  const cols = lastX1 + 4
  const rows = 3 * R + 4
  const rowY = (r: number) => 3 + 3 * r
  // Zones only exist from level 3 on ("two zones"); before that a fault hits the whole hall.
  const zoned = level.n >= 3 && blocks.length > 1
  const cells = new Uint8Array(cols * rows).fill(CELL_FLOOR)
  for (let x = 0; x < cols; x++) {
    cells[x] = CELL_WALL
    cells[(rows - 1) * cols + x] = CELL_WALL
  }
  for (let y = 0; y < rows; y++) {
    cells[y * cols] = CELL_WALL
    cells[y * cols + cols - 1] = CELL_WALL
  }

  const stations: StationDef[] = []
  const decals: HallLayout['decals'] = []
  const counts: Partial<Record<StationKind, number>> = {}
  for (const s of shape.slots) {
    counts[s.kind] = (counts[s.kind] ?? 0) + 1
    const idx = counts[s.kind]!
    const total = shape.slots.filter((o) => o.kind === s.kind).length
    const name = total > 1 ? `${STATION_NAMES[s.kind]} ${idx}` : s.kind === 'switch' ? 'Core Switch' : STATION_NAMES[s.kind]
    let cx = 1
    let cy = 1
    let w = 1
    let h = 2
    let facing: StationDef['facing'] = 'right'
    if (s.side === 'left') {
      cx = 1
      cy = 4 + 3 * s.slot
      facing = 'right'
      decals.push({ x: cx + 1.5, y: cy + 1, dir: 'left', kind: s.kind })
    } else if (s.side === 'right') {
      cx = cols - 2
      cy = 4 + 3 * s.slot
      facing = 'left'
      decals.push({ x: cx - 0.5, y: cy + 1, dir: 'right', kind: s.kind })
    } else {
      w = 2
      h = 1
      cy = 1
      facing = 'down'
      if (s.slot >= 0) {
        const b = blocks[s.slot]
        cx = b.x0 + Math.floor((b.x1 - b.x0 + 1) / 2) - 1
      } else if (s.slot === -1) {
        cx = blocks[0].x1 + 1
      } else if (s.slot === -2) {
        cx = 1
      } else {
        cx = cols - 3
      }
      decals.push({ x: cx + 1, y: cy + 1.5, dir: 'up', kind: s.kind })
    }
    const centre = cx + w / 2
    let zoneIdx = 0
    if (zoned) {
      let bd = Infinity
      blocks.forEach((b, bi) => {
        const d = Math.abs((b.x0 + b.x1 + 1) / 2 - centre)
        if (d < bd) {
          bd = d
          zoneIdx = bi
        }
      })
    }
    stations.push({ id: `${s.kind.toUpperCase()}${idx}`, kind: s.kind, name, cx, cy, w, h, zone: ZONES[zoneIdx], facing })
    for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) cells[y * cols + x] = CELL_SOLID
  }

  const nearest = (kind: StationKind, x: number, y: number): StationDef => {
    let best: StationDef | null = null
    let bd = Infinity
    for (const s of stations) {
      if (s.kind !== kind) continue
      const d = Math.hypot(s.cx + s.w / 2 - x, s.cy + s.h / 2 - y)
      if (d < bd) {
        bd = d
        best = s
      }
    }
    return best!
  }

  const racks: RackDef[] = []
  let n = 0
  for (let r = 0; r < R; r++) {
    blocks.forEach((b, bi) => {
      for (let x = b.x0; x <= b.x1; x++) {
        n++
        const label = String(n).padStart(2, '0')
        const mx = x + 0.5
        const my = rowY(r) + 0.5
        racks.push({
          id: `R${label}`,
          name: `Rack ${label}`,
          label,
          cx: x,
          cy: rowY(r),
          zone: zoned ? ZONES[bi] : 'A',
          row: r,
          col: x - b.x0,
          block: bi,
          cracId: nearest('crac', mx, my).id,
          pduId: nearest('pdu', mx, my).id,
          switchId: nearest('switch', mx, my).id,
        })
        cells[rowY(r) * cols + x] = CELL_SOLID
      }
    })
  }

  // Ficolo pad: in the corridor between the first two blocks, or centred in the single block
  // (one row high there, so it does not cover the cable tray of the rack row below).
  const padY = 4 + 3 * Math.floor((R - 1) / 2)
  let pad: HallLayout['pad']
  if (blocks.length > 1) pad = { cx: blocks[0].x1 + 1, cy: padY, w: 2, h: 2 }
  else {
    const w = Math.min(3, groups[0])
    pad = { cx: blocks[0].x0 + Math.floor((groups[0] - w) / 2), cy: padY, w, h: 1 }
  }

  const hazards: HallLayout['hazards'] = []
  const trays: HallLayout['trays'] = []
  for (let r = 0; r < R; r++) {
    for (const b of blocks) {
      hazards.push({ cx: b.x0 - 1, cy: rowY(r), side: 'r' }, { cx: b.x1 + 1, cy: rowY(r), side: 'l' })
    }
    trays.push({ y: rowY(r) + TRAY_Y, x0: blocks[0].x0 - 0.1, x1: lastX1 + 1.1 })
  }

  // Pipes: every station feeds the tray of each rack row it serves, as far as its racks reach.
  const pipes: PipeDef[] = []
  const laneLeft: Record<PipeKind, number> = { cooling: 2.24, power: 2.5, network: 2.76 }
  const laneRight: Record<PipeKind, number> = { cooling: cols - 2.24, power: cols - 2.5, network: cols - 2.76 }
  const servedBy = (st: StationDef, rd: RackDef) => rd.cracId === st.id || rd.pduId === st.id || rd.switchId === st.id
  for (const st of stations) {
    const kind = pipeKindOf(st.kind)
    if (!kind) continue
    for (let r = 0; r < R; r++) {
      const served = racks.filter((rd) => rd.row === r && servedBy(st, rd))
      if (!served.length) continue
      const minX = Math.min(...served.map((rd) => rd.cx))
      const maxX = Math.max(...served.map((rd) => rd.cx)) + 1
      const ty = rowY(r) + TRAY_Y + TRAY_OFFSET[kind]
      const add = (pts: Pt[]) => pipes.push({ kind, stationId: st.id, pts })
      if (st.facing === 'right') {
        const lx = laneLeft[kind]
        add([{ x: st.cx + st.w, y: st.cy + 1 }, { x: lx, y: st.cy + 1 }, { x: lx, y: ty }, { x: maxX, y: ty }])
      } else if (st.facing === 'left') {
        const lx = laneRight[kind]
        add([{ x: st.cx, y: st.cy + 1 }, { x: lx, y: st.cy + 1 }, { x: lx, y: ty }, { x: minX, y: ty }])
      } else if (st.cx === 1) {
        // top-left corner unit: step out to the left service lane, then down
        const lx = laneLeft[kind]
        const sx = st.cx + 1
        const sy = st.cy + st.h
        add([{ x: sx, y: sy }, { x: sx, y: sy + 0.3 }, { x: lx, y: sy + 0.3 }, { x: lx, y: ty }, { x: maxX, y: ty }])
      } else {
        // top-row unit: straight down, then both ways along the tray
        const sx = st.cx + 1
        const sy = st.cy + st.h
        if (minX < sx) add([{ x: sx, y: sy }, { x: sx, y: ty }, { x: minX, y: ty }])
        if (maxX > sx) add([{ x: sx, y: sy }, { x: sx, y: ty }, { x: maxX, y: ty }])
      }
    }
  }

  return {
    cols,
    rows,
    cells,
    racks,
    stations,
    pad,
    hazards,
    decals,
    trays,
    pipes,
    // on the pad, and (for the one-row pad) just out of reach of the rack row behind it
    start: { x: pad.cx + pad.w / 2, y: pad.cy + pad.h / 2 + (pad.h === 1 ? 0.22 : 0) },
    zones: zoned ? blocks.map((_, i) => ZONES[i]) : ['A'],
  }
}

export const cellAt = (hall: HallLayout, x: number, y: number): number =>
  x < 0 || y < 0 || x >= hall.cols || y >= hall.rows ? CELL_WALL : hall.cells[y * hall.cols + x]

export const isWalkable = (hall: HallLayout, x: number, y: number) => cellAt(hall, x, y) === CELL_FLOOR
