/**
 * Uptime Keeper – shared types. Plain data only, no DOM or React.
 */

export type Phase = 'start' | 'playing' | 'paused' | 'clear' | 'over'
export type Layout = 'desktop' | 'portrait' | 'landscape'

export type StationKind = 'crac' | 'pdu' | 'switch' | 'terminal'
export type PipeKind = 'cooling' | 'power' | 'network'
export type AlertType = 'heat' | 'fan' | 'psu' | 'net' | 'power' | 'upgrade' | 'down'
export type ActionKind = 'cool' | 'repair' | 'upgrade'
export type UpgradeKind = 'cooling' | 'network' | 'server'
export type Dir = 'up' | 'down' | 'left' | 'right'

/** Grid cells: 0 floor, 1 wall, 2 solid footprint (rack / station). */
export const CELL_FLOOR = 0
export const CELL_WALL = 1
export const CELL_SOLID = 2

export interface Pt {
  x: number
  y: number
}

export interface RackDef {
  id: string
  /** Display name, e.g. "Rack 07". */
  name: string
  /** Two-digit label painted on the cabinet. */
  label: string
  cx: number
  cy: number
  zone: string
  row: number
  col: number
  block: number
  cracId: string
  pduId: string
  switchId: string
}

export interface StationDef {
  id: string
  kind: StationKind
  name: string
  cx: number
  cy: number
  w: number
  h: number
  zone: string
  /** Which side the unit "faces" – pipes leave from this side. */
  facing: 'left' | 'right' | 'down'
}

export interface PipeDef {
  kind: PipeKind
  stationId: string
  /** Orthogonal polyline in tile units. */
  pts: Pt[]
}

export interface HallLayout {
  cols: number
  rows: number
  cells: Uint8Array
  racks: RackDef[]
  stations: StationDef[]
  pad: { cx: number; cy: number; w: number; h: number }
  /** Hazard-striped bands at the ends of each rack row. */
  hazards: { cx: number; cy: number; side: 'l' | 'r' }[]
  /** Floor chevrons that mark where to stand at a station. */
  decals: { x: number; y: number; dir: 'left' | 'right' | 'up'; kind: StationKind }[]
  /** Cable-tray strips behind each rack row (tile units). */
  trays: { y: number; x0: number; x1: number }[]
  pipes: PipeDef[]
  start: Pt
  zones: string[]
}

export interface LevelDef {
  n: number
  title: string
  /** Shown on the level-clear overlay of the previous level: what is new. */
  intro: string
  rows: number
  groups: number[]
  cracs: number
  pdus: number
  switches: number
  terminal: boolean
  alertTypes: AlertType[]
  spawnStart: number
  spawnEnd: number
  maxAlerts: number
  battery: number
  monitoring: boolean
  heatFactor: number
  duration: number
  ups: boolean
  tutorial: boolean
  endless: boolean
}

export interface Rack {
  id: string
  name: string
  label: string
  cx: number
  cy: number
  zone: string
  temp: number
  /** Per-rack offset so idle temperatures are not all identical. */
  idleOffset: number
  fanOk: boolean
  psuOk: boolean
  /** Derived every tick: false while the rack's switch has a fault in its zone. */
  linkOk: boolean
  /** Derived every tick: false while the PDU battery is flat or the PSU is dead. */
  powered: boolean
  /** Derived every tick: the rack's PDU tripped and it runs on battery. */
  onBattery: boolean
  serverLevel: number
  down: boolean
  downReason: 'heat' | 'power' | 'psu' | null
  /** Hot-spot strength 0…1 (ramps towards `hotspotTarget`). */
  hotspot: number
  hotspotTarget: number
  /** Heating speed of the current hot spot (the tutorial one is slow). */
  hotScale: number
  /** Seconds of cooling boost left after a COOL action. */
  boost: number
  /** Fan degradation 1 → 2.5 ramps while the fan is broken. */
  fanMult: number
  /** Redundant PSU time left while psuOk=false (−1 = n/a). */
  psuTimer: number
  cracId: string
  pduId: string
  switchId: string
  ledSeed: number
  /** Has the overheating alert for the current heat episode been raised? */
  heatAlerted: boolean
}

export interface Station {
  id: string
  kind: StationKind
  name: string
  cx: number
  cy: number
  w: number
  h: number
  zone: string
  facing: 'left' | 'right' | 'down'
  fault: boolean
  /** Zone letter hit by the current fault. */
  faultZone: string | null
  /** Racks hit by the current fault (one zone of the station's racks). */
  affected: string[]
  /** Battery seconds left for a faulted PDU (−1 = not on battery, 0 = flat). */
  battery: number
  racks: string[]
}

export interface Alert {
  id: number
  type: AlertType
  targetId: string
  priority: number
  age: number
  tutorial: boolean
  /** Resolving it pays credits (false for self-inflicted overheating). */
  reward: boolean
}

export interface Repair {
  targetId: string
  kind: 'fan' | 'psu' | 'reboot' | 'switch' | 'pdu'
  t: number
  duration: number
}

export type SimEvent =
  | { kind: 'alert'; alert: Alert }
  | { kind: 'resolved'; type: AlertType; targetId: string; credits: number }
  | { kind: 'shutdown'; rackId: string; reason: 'heat' | 'power' | 'psu' }
  | { kind: 'reboot'; rackId: string }
  | { kind: 'autocool'; rackId: string }
  | { kind: 'battery'; stationId: string; racks: number }
  | { kind: 'cool'; rackId: string; weak: boolean }
  | { kind: 'repairDone'; targetId: string; repairKind: Repair['kind'] }
  | { kind: 'upgrade'; upgrade: UpgradeKind; targetId: string; level: number }
  | { kind: 'swap'; stationId: string }
  | { kind: 'credits'; amount: number; targetId: string; label: string }
  | { kind: 'breach'; reason: string }

export interface Upgrades {
  cooling: number
  network: number
  spares: number
}

/** What the player carries from hall to hall. */
export interface Carry {
  upgrades: Upgrades
  /** Server level per rack id (racks keep their id in every hall). */
  servers: Record<string, number>
  credits: number
  score: number
}

export interface World {
  level: LevelDef
  hall: HallLayout
  racks: Rack[]
  stations: Station[]
  rackById: Map<string, Rack>
  stationById: Map<string, Station>
  alerts: Alert[]
  alertSeq: number
  time: number
  /** Accumulated weighted down rack-seconds for the SLA. */
  penalty: number
  /** Penalty rate of the last tick in rack-seconds per second (drives the red flash). */
  penaltyRate: number
  credits: number
  score: number
  coolPool: number
  coolMax: number
  /** 0–100, share of racks with a healthy link (smoothed). */
  network: number
  powerLoad: number
  powerCap: number
  upgrades: Upgrades
  repair: Repair | null
  nextSpawn: number
  /** 0 waiting, 1 COOL lesson, 2 pause, 3 REPAIR lesson, 4 closing tip, 5 free play. */
  tutorialStep: number
  tutorialTimer: number
  halfDownTimer: number
  downCount: number
  resolved: number
  shutdowns: number
  autoCools: number
  events: SimEvent[]
  rng: () => number
  breached: string | null
  spawnsEnabled: boolean
}

/* ---------- HUD view-models ---------- */

export type Tone = 'cooling' | 'power' | 'network' | 'alert' | 'ok' | 'upgrade'

export interface AlertView {
  id: number
  type: AlertType
  targetId: string
  title: string
  subtitle: string
  /** Short label for the phone chip row. */
  chip: string
  severity: 'info' | 'warn' | 'critical'
  selected: boolean
}

export interface DetailView {
  type: AlertType | 'rack' | 'crac' | 'pdu' | 'switch' | 'terminal' | 'nominal'
  tone: Tone
  title: string
  lines: string[]
  bar: { pct: number; label: string; tone: Tone } | null
}

export interface ActionView {
  enabled: boolean
  /** Small text under the label (cost, duration, effect). */
  sub: string
  /** Why it is disabled, or what it will do. */
  hint: string
}

export interface LevelClearView {
  level: number
  title: string
  uptime: string
  stars: number
  passed: boolean
  score: number
  credits: number
  bonus: number
  resolved: number
  shutdowns: number
  autoCools: number
  nextLevel: number
  nextTitle: string
  nextIntro: string
  bestUptime: string
  isBest: boolean
}

export interface OverView {
  reason: string
  uptime: string
  score: number
  level: number
  best: number
  isBest: boolean
}

export interface Banner {
  id: number
  text: string
  sub: string
  tone: 'alert' | 'ok' | 'power'
}

export interface HudState {
  layout: Layout
  touch: boolean
  level: number
  levelTitle: string
  score: number
  credits: number
  /** Three decimals, e.g. "99.987". */
  uptime: string
  uptimeTone: 'ok' | 'warn' | 'bad'
  /** 0–8 lit segments of the uptime bar. */
  uptimeSegs: number
  uptimeDrop: boolean
  timeLeft: number
  /** 0–100 level progress for the shift bar. */
  progress: number
  cooling: number
  power: number
  network: number
  alerts: AlertView[]
  detail: DetailView
  actions: Record<ActionKind, ActionView>
  /** 0–100 while a repair is running, −1 otherwise. */
  repairPct: number
  spares: number
  banner: Banner | null
  tip: string | null
  critical: boolean
  upgrades: { cooling: number; network: number }
  clear: LevelClearView | null
  over: OverView | null
  best: number
  savedLevel: number
  joystick: boolean
  /** The hall is larger than the screen and the camera follows the player. */
  scrolling: boolean
}
