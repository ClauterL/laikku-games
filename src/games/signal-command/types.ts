/** Shared types for Puolustusvoimat – Signal Command. */

export const DIRS = ['up', 'down', 'left', 'right'] as const
export type Dir = (typeof DIRS)[number]

export type SystemId = 'radio' | 'satellite' | 'data' | 'servers' | 'power' | 'security'
export type SectorId = 'helsinki' | 'turku' | 'west' | 'oulu' | 'east' | 'lapland'
export type Tier = 'easy' | 'medium' | 'hard'
export type NodeState = 'online' | 'incident' | 'offline'

export type Phase = 'start' | 'playing' | 'interlude' | 'paused' | 'complete' | 'failed'

export type GlyphName =
  | 'mast'
  | 'satellite'
  | 'server'
  | 'route'
  | 'node'
  | 'lock'
  | 'hop'
  | 'battery'
  | 'repeater'
  | 'handover'
  | 'reroute'
  | 'patch'
  | 'globe'
  | 'clock'
  | 'pulse'
  | 'uplink'
  | 'firewall'
  | 'broadcast'
  | 'grid'
  | 'cell'
  | 'audit'
  | 'cold'
  | 'shield'
  | 'bolt'
  | 'heart'
  | 'target'
  | 'check'
  | 'cross'
  | 'alert'
  | 'pause'
  | 'emblem'

export const SYSTEM_IDS: readonly SystemId[] = ['radio', 'satellite', 'data', 'servers', 'power', 'security']

export const SYSTEM_META: Record<SystemId, { label: string; glyph: GlyphName; restored: string }> = {
  radio: { label: 'Radio network', glyph: 'mast', restored: 'LINK RESTORED' },
  satellite: { label: 'Satellite link', glyph: 'satellite', restored: 'SATELLITE SYNCED' },
  data: { label: 'Data network', glyph: 'route', restored: 'DATA ROUTED' },
  servers: { label: 'Server systems', glyph: 'server', restored: 'SERVER ONLINE' },
  power: { label: 'Power supply', glyph: 'bolt', restored: 'POWER RESTORED' },
  security: { label: 'Security', glyph: 'shield', restored: 'CHANNEL SECURED' },
}

/** One command as the HUD sees it. */
export interface CommandView {
  id: string
  name: string
  glyph: GlyphName
  system: SystemId
  code: readonly Dir[]
  brief: string
  steps: readonly [string, string, string, string]
}

export interface CurrentView extends CommandView {
  /** unique per incident – keys the arrow row so a new code animates in */
  incidentId: number
  progress: number
  /** "NORTHERN RELAY" – where the incident is */
  location: string
  incident: string
  sectorId: SectorId
}

export interface IncidentView {
  id: number
  location: string
  incident: string
  sectorId: SectorId
  arrows: number
  state: 'active' | 'queued' | 'solved'
}

export interface FeedbackView {
  id: number
  kind: 'perfect' | 'good' | 'miss' | 'clear' | 'timeout'
  text: string
  sub: string
}

export interface ToastView {
  id: number
  kind: 'ok' | 'bad' | 'info'
  text: string
  sub: string
}

export interface InterludeView {
  kind: 'next' | 'retry' | 'complete'
  wave: number
  sectorId: SectorId
  sectorName: string
  count: number
  /** retry only: how much integrity was lost */
  loss: number
}

export interface DebriefView {
  won: boolean
  reason: string
  score: number
  best: number
  isBest: boolean
  waves: number
  accuracy: number
  bestCombo: number
  perfectWaves: number
}

export interface HudState {
  phase: Phase
  wave: number
  endless: boolean
  sectorId: SectorId
  sectorName: string
  waveCount: number
  waveSolved: number
  wavesCleared: number
  score: number
  /** latest score gain – floats up next to the score chip */
  gain: { id: number; amount: number } | null
  combo: number
  bestCombo: number
  /** seconds, quantised to 0.1 s */
  timeLeft: number
  waveTime: number
  lives: number
  integrity: number
  accuracy: number
  systems: Record<SystemId, number>
  current: CurrentView | null
  queue: CommandView[]
  incidents: IncidentView[]
  nodes: Record<SectorId, NodeState>
  counts: { online: number; incident: number; offline: number }
  feedback: FeedbackView | null
  toast: ToastView | null
  /** increments on every wrong arrow – keys the red flash + shake animation */
  missSeq: number
  /** increments on every completed code – keys the white flash */
  solveSeq: number
  /** the code that was just completed (for the flash ghost row) */
  solvedCode: readonly Dir[] | null
  interlude: InterludeView | null
  debrief: DebriefView | null
  best: number
  hint: string | null
  waveFlawless: boolean
}
