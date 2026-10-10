/** Shared types and constants for Network Connect (no DOM, no React). */

export interface Cell {
  r: number
  c: number
}

/** Static tile kinds produced by the generator. */
export type CellKind = 'tile' | 'block' | 'loss' | 'broken'

/** Runtime tile kinds: `free` = obstacle removed by a power-up, `tunnel` = VPN tunnel through an obstacle. */
export type TileKind = CellKind | 'free' | 'tunnel'

export type WaypointKind = 'switch' | 'firewall' | 'server'

export interface Waypoint extends Cell {
  kind: WaypointKind
}

export interface SolutionPath {
  /** Index into PALETTE – equals the index of the path in `Level.paths`. */
  color: number
  /** Ordered cells from the USER endpoint to the CLOUD endpoint. */
  cells: Cell[]
  waypoints: Waypoint[]
}

export interface Level {
  level: number
  seed: number
  variant: number
  size: number
  name: string
  /** Flat `size × size` grid, row-major. */
  kinds: CellKind[]
  paths: SolutionPath[]
}

export type PowerUp = 'reroute' | 'firewall' | 'vpn' | 'boost'
export const POWER_UPS: readonly PowerUp[] = ['reroute', 'firewall', 'vpn', 'boost'] as const
export type Inventory = Record<PowerUp, number>

/** Path colours, used in this order as a level needs more pairs. */
export const PALETTE = [
  '#37e36b', // green
  '#ff4a4a', // red
  '#2fa8ff', // blue
  '#ff4fd8', // magenta
  '#ffd43b', // yellow
  '#a86bff', // purple
  '#ff8c42', // orange
  '#4ff2ff', // cyan
] as const

export const MAX_COLORS = PALETTE.length
export const MIN_PATH_LEN = 3

export const sameCell = (a: Cell, b: Cell) => a.r === b.r && a.c === b.c
export const adjacent = (a: Cell, b: Cell) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1
