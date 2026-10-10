/**
 * Shared types and constants for Hansab – Access Crossing (v2, Subway-Surfers style runner).
 * Plain data only – no React, no canvas.
 *
 * World units: the player is 1 unit tall. x is measured in *lane units* (lane −1 / 0 / 1,
 * multiplied by LANE_W to get world x), y is height above the floor, and every entity
 * stores its position along the track as `d` (track distance from the floor start); its
 * depth relative to the player is `z = d − dist`.
 */

export type Badge = 'EMPLOYEE' | 'VISITOR' | 'CONTRACTOR' | 'VIP' | 'SECURITY'

export const BADGE_ORDER: readonly Badge[] = ['EMPLOYEE', 'VISITOR', 'CONTRACTOR', 'VIP', 'SECURITY']

export type BadgeIcon = 'person' | 'people' | 'helmet' | 'crown' | 'shield'

export interface BadgeInfo {
  color: string
  /** Short human name used in the HUD cards and toasts. */
  name: string
  /** Two-line text on the gate sign. */
  sign: readonly [string, string]
  icon: BadgeIcon
}

export const BADGE_INFO: Record<Badge, BadgeInfo> = {
  EMPLOYEE: { color: '#2bb673', name: 'Employee', sign: ['EMPLOYEE', 'ACCESS'], icon: 'person' },
  VISITOR: { color: '#2f80ff', name: 'Visitor', sign: ['VISITOR', 'ACCESS'], icon: 'people' },
  CONTRACTOR: { color: '#f28c28', name: 'Contractor', sign: ['CONTRACTOR', 'ACCESS'], icon: 'helmet' },
  VIP: { color: '#8e44ad', name: 'VIP', sign: ['VIP', 'ACCESS'], icon: 'crown' },
  SECURITY: { color: '#e63946', name: 'Security 3+', sign: ['SECURITY', 'LEVEL 3+'], icon: 'shield' },
}

export type ElevatorReq = 'ALL' | Badge

export const ELEVATOR_INFO: Record<ElevatorReq, { line1: string; line2: string; color: string; bonus: number; icon: BadgeIcon | 'star' }> = {
  ALL: { line1: 'ALL ACCESS', line2: 'LOBBY', color: '#2f80ff', bonus: 0, icon: 'star' },
  EMPLOYEE: { line1: 'EMPLOYEE', line2: 'FLOORS 1-8', color: '#2bb673', bonus: 20, icon: 'person' },
  VISITOR: { line1: 'VISITOR', line2: 'FLOORS 1-3', color: '#2f80ff', bonus: 20, icon: 'people' },
  CONTRACTOR: { line1: 'CONTRACTOR', line2: 'LAB', color: '#f28c28', bonus: 60, icon: 'helmet' },
  VIP: { line1: 'VIP', line2: 'FLOORS 20-30', color: '#8e44ad', bonus: 100, icon: 'crown' },
  SECURITY: { line1: 'SECURITY', line2: 'SERVER ROOM', color: '#e63946', bonus: 150, icon: 'shield' },
}

/* ---------- world geometry ------------------------------------------------------------- */

/** Distance between lane centres, in world units (the player is 1 unit tall). */
export const LANE_W = 1.45
/** Half width of the corridor (inside face of the side walls). */
export const WALL_X = 2.75
/** Height of the side walls / the ceiling (a tall, airy hall: more glass and skyline, less ceiling). */
export const WALL_H = 5.6
export const PLAYER_H = 1.0
export const PLAYER_SLIDE_H = 0.48
/** How far ahead of the player the world exists (spawn horizon). */
export const SPAWN_AHEAD = 70

/* ---------- entities -------------------------------------------------------------------- */

export type ObstacleKind = 'person' | 'guard' | 'robot' | 'cart' | 'trolley' | 'barrier' | 'wetsign' | 'planter' | 'glass'
export type PickupKind = 'coin' | 'badge' | 'note' | 'magnet' | 'shield'
export type RowKind = 'gate' | 'pin' | 'reception' | 'elevator' | 'camera'
export type DecorKind = 'pillar' | 'plant' | 'wallsign' | 'bench' | 'cooler'
export type EntityKind = ObstacleKind | PickupKind | RowKind | DecorKind

/** How the player avoids an obstacle. */
export type Dodge = 'lane' | 'jump' | 'slide' | 'none'

export interface FaceSpec {
  skin: string
  hair: string
  hairStyle: number
  glasses: boolean
  beard: boolean
  bg: string
  shirt: string
}

export interface Visitor {
  name: string
  company: string
  purpose: string
  appointment: boolean
  idMatches: boolean
  face: FaceSpec
}

/**
 * One flat record for everything in the corridor. Kind-specific fields are simply unused
 * by the other kinds; keeping one shape lets the hot loops stay monomorphic.
 */
export interface Entity {
  kind: EntityKind
  /** Lane position in lane units (−1 / 0 / 1; decor sits outside at ±1.9…). */
  lane: number
  /** Track distance of the entity's centre. */
  d: number
  /** Extent along the track (collision depth). */
  depth: number
  /** Base height above the floor (pickups float, coins in arcs). */
  y: number
  /** Collision height range for obstacles. */
  y0: number
  y1: number
  dodge: Dodge
  alive: boolean
  /** Rows: the event has fired / been resolved; pickups: collected. */
  done: boolean
  variant: number
  phase: number
  /** Walking speed toward the camera (people). */
  walk: number
  /** Generic 0..1 animation (gate bar opening, elevator doors, reception desk sliding). */
  anim: number
  /** Gate rows: which badge each lane's turnstile wants (index = lane + 1). Badge pickups: the badge. */
  gates: Badge[]
  badge: Badge | null
  /** PIN note / PIN row code. */
  code: string
  /** Elevator doors per lane (index = lane + 1). */
  doors: ElevatorReq[]
  visitor: Visitor | null
  /** Camera zones: sweep clock + rhythm, and which wall it hangs on. */
  t: number
  period: number
  onDur: number
  offDur: number
  side: 1 | -1
  /** People: colours. */
  shirt: string
  hair: string
  skin: string
  /** Crash feedback: seconds remaining of the "denied" shake / red flash. */
  hitT: number
  /** Which lane was hit / opened (rows). */
  hitLane: number
}

export function makeEntity(kind: EntityKind, lane: number, d: number): Entity {
  return {
    kind,
    lane,
    d,
    depth: 0.8,
    y: 0,
    y0: 0,
    y1: 1,
    dodge: 'none',
    alive: true,
    done: false,
    variant: 0,
    phase: 0,
    walk: 0,
    anim: 0,
    gates: [],
    badge: null,
    code: '',
    doors: [],
    visitor: null,
    t: 0,
    period: 3.6,
    onDur: 2.0,
    offDur: 1.2,
    side: 1,
    shirt: '#3498db',
    hair: '#2c1b0e',
    skin: '#f6d3b8',
    hitT: 0,
    hitLane: 0,
  }
}

export type Dir = 'up' | 'down' | 'left' | 'right'

/* ---------- floor themes ---------------------------------------------------------------- */

export interface FloorTheme {
  name: string
  /** Alternating floor bands (warm marble on the light floors). */
  floorA: string
  floorB: string
  /** Carpet runner drawn in each lane (null = bare floor). */
  carpet: string | null
  /** Lane separator lines and the glowing chevrons. */
  line: string
  arrow: string
  /** Glass side walls: a deep tinted gradient over the city, with white frames. */
  glassTop: string
  glassBottom: string
  glassAlpha: number
  frame: string
  /** LED strip under the handrail. */
  led: string
  /** Solid wall colour instead of glass (dark floors). */
  solidWall: string | null
  /** Lit meeting rooms behind the glass and the dark floor out there. */
  room: string
  outside: string
  /** Ceiling plane and its light strips. */
  ceiling: string
  light: string
  /** Sky gradient and the city silhouette behind the glass. */
  sky0: string
  sky1: string
  city: string
  cityFar: string
  /** Depth fog (also the far end of the corridor). */
  fog: string
  accent: string
  /** Dark themes get bright LED trims instead of white marble highlights. */
  dark: boolean
}

export const THEMES: readonly FloorTheme[] = [
  {
    name: 'Lobby',
    floorA: '#f0ebe2',
    floorB: '#e1dacd',
    carpet: null,
    line: '#8aa2c9',
    arrow: '#3db4ff',
    glassTop: '#2f74e4',
    glassBottom: '#0d3b8c',
    glassAlpha: 0.74,
    frame: '#f3f7fd',
    led: '#5fd0ff',
    solidWall: null,
    room: '#ffe7b8',
    outside: '#163a7a',
    ceiling: '#f4f7fc',
    light: '#fff5df',
    sky0: '#2a74dd',
    sky1: '#b9dcff',
    city: '#4e84cf',
    cityFar: '#86b0e8',
    fog: '#d8e8fb',
    accent: '#1b5fd1',
    dark: false,
  },
  {
    name: 'Offices',
    floorA: '#e8dfd1',
    floorB: '#d9cebe',
    carpet: '#2d6cdf',
    line: '#b09e86',
    arrow: '#9ad6ff',
    glassTop: '#8aa4c8',
    glassBottom: '#4f6b99',
    glassAlpha: 0.66,
    frame: '#fbf7f0',
    led: '#8fd0ff',
    solidWall: null,
    room: '#fff0cf',
    outside: '#23407a',
    ceiling: '#f5f1ea',
    light: '#fff3d8',
    sky0: '#4f9bf0',
    sky1: '#dcefff',
    city: '#7898c4',
    cityFar: '#a9c1e2',
    fog: '#e7e3dc',
    accent: '#2d6cdf',
    dark: false,
  },
  {
    name: 'Lab',
    floorA: '#eceef1',
    floorB: '#dde2e8',
    carpet: null,
    line: '#f28c28',
    arrow: '#ffae55',
    glassTop: '#dce6f2',
    glassBottom: '#9fb4cf',
    glassAlpha: 0.6,
    frame: '#f28c28',
    led: '#ffb05a',
    solidWall: null,
    room: '#ffe4c2',
    outside: '#5a3a2a',
    ceiling: '#f6f6f6',
    light: '#fff3e0',
    sky0: '#ff9d47',
    sky1: '#ffe4c4',
    city: '#b47856',
    cityFar: '#dcae90',
    fog: '#f3ebe3',
    accent: '#f28c28',
    dark: false,
  },
  {
    name: 'Executive',
    floorA: '#6c4a36',
    floorB: '#593b29',
    carpet: '#6d3fa0',
    line: '#a57fcf',
    arrow: '#e5c8ff',
    glassTop: '#5d3f86',
    glassBottom: '#33214e',
    glassAlpha: 0.7,
    frame: '#8e44ad',
    led: '#d6a7ff',
    solidWall: '#3b2a2f',
    room: '#ffd9a8',
    outside: '#2a1e2a',
    ceiling: '#2a2127',
    light: '#ffd9a8',
    sky0: '#2a1e3a',
    sky1: '#5a4070',
    city: '#3a2a4a',
    cityFar: '#5a4470',
    fog: '#3a2c38',
    accent: '#8e44ad',
    dark: true,
  },
  {
    name: 'Server room',
    floorA: '#1d2435',
    floorB: '#262f44',
    carpet: null,
    line: '#e63946',
    arrow: '#3fa6ff',
    glassTop: '#1a2a4d',
    glassBottom: '#0f1830',
    glassAlpha: 0.7,
    frame: '#2a3350',
    led: '#2f80ff',
    solidWall: '#141a28',
    room: '#2f80ff',
    outside: '#0b1020',
    ceiling: '#0f1422',
    light: '#4da3ff',
    sky0: '#0b1020',
    sky1: '#162040',
    city: '#101829',
    cityFar: '#1c2742',
    fog: '#141b2c',
    accent: '#e63946',
    dark: true,
  },
]

export function themeForFloor(floor: number): FloorTheme {
  return THEMES[(Math.max(1, floor) - 1) % THEMES.length]
}
