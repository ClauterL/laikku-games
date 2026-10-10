/** Shared types for Bug Breaker (plain data – no DOM, no React). */

export type Material = 'wood' | 'stone' | 'ice'
export type BugKind = 'bug' | '404' | 'null' | 'syntax'
export type AmmoType = 'html' | 'css' | 'js' | 'python' | 'sql'
/** Decorative text painted on a block. */
export type SignKind = 'bug' | '404' | 'null' | 'syntax'

export interface BlockDef {
  /** centre, world units */
  x: number
  y: number
  w: number
  h: number
  material: Material
  angle?: number
  sign?: SignKind
}

export interface BugDef {
  x: number
  y: number
  kind: BugKind
}

export interface LevelDef {
  name: string
  hint: string
  ammo: AmmoType[]
  blocks: BlockDef[]
  bugs: BugDef[]
}

/** Game data attached to every Matter body (`body.plugin.bb`). */
export interface BodyData {
  kind: 'block' | 'bug' | 'ammo' | 'ground'
  hp: number
  maxHp: number
  score: number
  /** rectangle size for blocks / ammo */
  w: number
  h: number
  /** radius for bugs */
  r: number
  material?: Material
  sign?: SignKind
  bug?: BugKind
  ammo?: AmmoType
  /** stable per-body random seed (crack pattern, blink phase…) */
  seed: number
  /** seconds until the next blink / remaining blink time */
  blink: number
  blinking: boolean
  /** seconds since the body was created (spawn pop animation) */
  age: number
  /* ---- ammo state ---- */
  impacted: boolean
  specialUsed: boolean
  penetrations: number
  /** JS: seconds until auto-explosion after the first impact (-1 = not armed) */
  fuse: number
  boosted: boolean
}

export type ShotState = 'none' | 'ready' | 'aiming' | 'flying' | 'done'

export type Phase = 'start' | 'playing' | 'paused' | 'cleared' | 'failed' | 'final'

export interface HudState {
  score: number
  shotsLeft: number
  level: number
  levelCount: number
  /** ammo loaded in the pouch (null between shots) */
  current: AmmoType | null
  /** remaining ammo queue (current one first) */
  queue: AmmoType[]
  /** level-complete stats */
  stars: number
  bonus: number
  levelScore: number
  bugsLeft: number
  best: number
  /** true while the loaded cube still has its special available */
  specialReady: boolean
}

/** Events emitted by the simulation; the engine turns them into juice. */
export type SimEvent =
  | { type: 'launch'; x: number; y: number; ammo: AmmoType }
  | { type: 'impact'; x: number; y: number; damage: number; ammo: AmmoType | null }
  | { type: 'blockDamaged'; x: number; y: number; material: Material }
  | { type: 'blockDestroyed'; x: number; y: number; w: number; h: number; material: Material; score: number; angle: number }
  | { type: 'bugSquashed'; x: number; y: number; r: number; kind: BugKind; score: number; fell: boolean }
  | { type: 'shockwave'; x: number; y: number; radius: number }
  | { type: 'explosion'; x: number; y: number; radius: number }
  | { type: 'boost'; x: number; y: number }
  | { type: 'drill'; x: number; y: number; material: Material }
  | { type: 'shotEnded'; x: number; y: number }
  | { type: 'lastBug' }
  | { type: 'levelCleared'; stars: number; bonus: number; levelScore: number }
  | { type: 'levelFailed' }
