/** Shared types for Ticket Slash (plain TypeScript, no React). */

export type Category = 'vpn' | 'email' | 'mfa' | 'printer' | 'backup' | 'ad'

export type IconName = 'globe' | 'envelope' | 'shield' | 'printer' | 'database' | 'people' | 'bell'

export type Phase = 'start' | 'playing' | 'paused' | 'over'

export type TicketState = 'flying' | 'held' | 'flicked' | 'p1'

export interface BinDef {
  category: Category
  /** Full label for desktop / landscape bins (a `\n` splits it into two lines). */
  label: string
  /** Short label for the compact phone-portrait squares. */
  short: string
  color: string
  icon: IconName
}

export interface TicketDef {
  category: Category
  title: string
  problem: string
  p1: boolean
}

export interface TrailPoint {
  x: number
  y: number
  t: number
}

export interface Ticket {
  id: number
  def: TicketDef
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  w: number
  h: number
  state: TicketState
  /** Offset between the grab point and the card centre, so the card does not jump under the finger. */
  grabDx: number
  grabDy: number
  /** 0 → 1 "lifted" amount while held (scale + bigger shadow). */
  lift: number
  /** Blade trail left behind while flicked. */
  trail: TrailPoint[]
  // --- P1 only ---
  /** Seconds left on the SLA ring (counts down once the card has arrived at its hover spot). */
  timer: number
  hoverX: number
  hoverY: number
  /** Tween from (riseFromX, riseFromY) to the hover spot over riseDur seconds. */
  riseFromX: number
  riseFromY: number
  riseT: number
  riseDur: number
  rising: boolean
  /** The SLA timer runs from the first arrival onwards, even while re-rising or held. */
  arrived: boolean
  bob: number
}

export interface Bin {
  def: BinDef
  x: number
  y: number
  w: number
  h: number
  /** 1 → 0 flash intensity after a delivery. */
  flash: number
  flashColor: string
  /** 0 → 1 highlight while a held ticket hovers above the bin. */
  hover: number
}

export interface HudState {
  /** Displayed (smoothly counting) score. */
  score: number
  /** Current multiplier ×1 … ×8. */
  combo: number
  /** Correct deliveries in a row. */
  streak: number
  /** Seconds left (ceil). */
  time: number
  lives: number
  /** A P1 critical ticket is alive. */
  p1: boolean
  /** Number of solved tickets (used by the HUD to restart the score pop animation). */
  solved: number
}

export interface EndStats {
  score: number
  best: number
  newBest: boolean
  solved: number
  bestCombo: number
  /** 0 – 100 */
  accuracy: number
  reason: 'time' | 'lives'
}

export interface EngineCallbacks {
  onHud: (hud: HudState) => void
  onPhase: (phase: Phase) => void
  onOver: (stats: EndStats) => void
}

export const INITIAL_HUD: HudState = { score: 0, combo: 1, streak: 0, time: 60, lives: 3, p1: false, solved: 0 }
