/**
 * World constants, material / bug / ammo tables and the six hand-made levels.
 * Everything is in world units (the world is 1600×900, y grows downwards).
 */
import type { AmmoType, BlockDef, BugDef, BugKind, LevelDef, Material, SignKind } from './types'

export const WORLD = {
  w: 1600,
  h: 900,
  /** grassy ledge the slingshot stands on */
  ledge: { x0: 0, x1: 430, top: 690 },
  /** dip between the ledge and the plateau */
  valley: { top: 800 },
  /** plateau the bugs build on */
  plateau: { x0: 780, x1: 1600, top: 720 },
  /** slingshot geometry: fork tips and the resting pouch position */
  sling: { x: 240, baseY: 690, forkL: { x: 212, y: 556 }, forkR: { x: 268, y: 560 }, pouchX: 242, pouchY: 566 },
  /** bodies beyond these limits are considered "off the world" */
  killY: 1000,
  killXMin: -220,
  killXMax: 1700,
} as const

export const PLATEAU = WORLD.plateau.top

/** Max pull length (world units) and launch speed per unit of pull (Matter units = px per 1/60 s). */
export const MAX_PULL = 110
export const LAUNCH_FACTOR = 0.22
export const AMMO_SIZE = 44

export interface MaterialInfo {
  hp: number
  density: number
  score: number
  color: string
  dark: string
  light: string
}

export const MATERIALS: Record<Material, MaterialInfo> = {
  wood: { hp: 40, density: 0.0012, score: 40, color: '#c8893a', dark: '#5a3414', light: '#e8b06a' },
  stone: { hp: 100, density: 0.0035, score: 80, color: '#9aa3ad', dark: '#3f474f', light: '#c9d0d6' },
  ice: { hp: 20, density: 0.0009, score: 25, color: 'rgba(174,232,255,0.85)', dark: '#4f9fd6', light: 'rgba(255,255,255,0.9)' },
}

export interface BugInfo {
  r: number
  hp: number
  score: number
  label: string
  color: string
  dark: string
}

export const BUGS: Record<BugKind, BugInfo> = {
  bug: { r: 20, hp: 30, score: 500, label: 'BUG', color: '#e5322d', dark: '#5a0f0c' },
  '404': { r: 24, hp: 50, score: 700, label: '404', color: '#e8542a', dark: '#5c1a0a' },
  null: { r: 21, hp: 40, score: 600, label: 'NULL', color: '#d9f5dd', dark: '#3f6a4a' },
  syntax: { r: 25, hp: 70, score: 1000, label: 'SYNTAX ERROR', color: '#8e44ad', dark: '#3a1250' },
}

export interface AmmoInfo {
  name: string
  desc: string
  color: string
  color2: string
  dark: string
  /** short text glyph drawn on the cube */
  glyph: string
  /** relative density (HTML = 1) */
  density: number
  /** damage multiplier */
  damage: number
}

export const AMMO: Record<AmmoType, AmmoInfo> = {
  html: { name: 'HTML', desc: 'Basic block. Good for a start!', color: '#ff4a3d', color2: '#ff8a7a', dark: '#7a1510', glyph: '</>', density: 1, damage: 1 },
  css: { name: 'CSS', desc: 'Area-effect smash!', color: '#3b8bff', color2: '#7fb4ff', dark: '#123a80', glyph: '{}', density: 1, damage: 1 },
  js: { name: 'JS', desc: 'Explosive destruction! Tap mid-air.', color: '#ffd400', color2: '#ffe866', dark: '#7a5a00', glyph: 'JS', density: 1, damage: 1 },
  python: { name: 'PYTHON', desc: 'Powerful special attack! Tap to boost.', color: '#3776ab', color2: '#ffd43b', dark: '#143a5c', glyph: 'PY', density: 2.2, damage: 2 },
  sql: { name: 'SQL', desc: 'Penetrates multiple layers!', color: '#8e44ad', color2: '#c08ad8', dark: '#3a1250', glyph: 'SQL', density: 1, damage: 1 },
}

export const AMMO_ORDER: AmmoType[] = ['html', 'css', 'js', 'python', 'sql']

/* ------------------------------------------------------------------ */
/* Level authoring helpers: positions are given by the *bottom* edge so  */
/* stacks can be written top-down without computing centres by hand.     */
/* ------------------------------------------------------------------ */

function block(x: number, bottom: number, w: number, h: number, material: Material, sign?: SignKind, angle?: number): BlockDef {
  const b: BlockDef = { x, y: bottom - h / 2, w, h, material }
  if (sign) b.sign = sign
  if (angle) b.angle = angle
  return b
}

function bug(x: number, bottom: number, kind: BugKind): BugDef {
  return { x, y: bottom - BUGS[kind].r, kind }
}

const G = PLATEAU

/* Chunky building pieces (w × h). A storey is a pair of pillars plus a beam. */
const T = 32 // beam thickness / pillar width

/** A frame storey: two pillars `span` apart standing on `bottom`, capped by a beam. */
function storey(x: number, bottom: number, span: number, height: number, pillars: Material, beam: Material, beamW = span + T + 8): BlockDef[] {
  return [
    block(x - span / 2, bottom, T, height, pillars),
    block(x + span / 2, bottom, T, height, pillars),
    block(x, bottom - height, beamW, T, beam),
  ]
}

export const LEVELS: LevelDef[] = [
  {
    name: 'Hello World',
    hint: 'Drag the cube back, aim with the dots and let go!',
    ammo: ['html', 'html', 'css'],
    blocks: [
      // two-storey wooden frame with a BUG sign on the roof
      ...storey(1200, G, 160, 120, 'wood', 'wood'),
      ...storey(1200, G - 152, 160, 100, 'wood', 'wood'),
      block(1200, G - 284, 92, 52, 'wood', 'bug'),
    ],
    bugs: [bug(1200, G, 'bug'), bug(1200, G - 152, 'bug'), bug(1200, G - 336, 'bug')],
  },
  {
    name: 'Glass House',
    hint: 'Glass shatters easily. CSS smashes everything around it.',
    ammo: ['html', 'css', 'html', 'js'],
    blocks: [
      // two-storey glass house
      ...storey(1040, G, 150, 120, 'ice', 'ice'),
      ...storey(1040, G - 152, 150, 96, 'ice', 'ice'),
      // chunky wood tower
      block(1330, G, 64, 64, 'wood'),
      block(1330, G - 64, 64, 64, 'wood'),
      block(1330, G - 128, 64, 64, 'wood'),
      block(1330, G - 192, 48, 48, 'wood'),
      // glass wall sheltering a bug
      block(1420, G, T, 90, 'ice'),
    ],
    bugs: [bug(1040, G, 'bug'), bug(1040, G - 152, 'bug'), bug(1040, G - 280, 'null'), bug(1330, G - 240, 'bug'), bug(1472, G, 'bug')],
  },
  {
    name: 'Stone Shelter',
    hint: 'SQL drills through wood and glass. PYTHON cracks stone.',
    ammo: ['html', 'sql', 'js', 'python'],
    blocks: [
      // shelter: stone front pillar, wood back pillar, wood beam – then a wooden storey on top
      block(1000, G, T, 120, 'stone'),
      block(1120, G, T, 120, 'wood'),
      block(1060, G - 120, 180, T, 'wood'),
      ...storey(1060, G - 152, 120, 90, 'wood', 'wood'),
      block(1060, G - 274, 92, 52, 'wood', 'null'),
      // wood tower on the right with a stone cap
      ...storey(1350, G, 110, 120, 'wood', 'wood'),
      block(1350, G - 152, 48, 48, 'stone'),
    ],
    bugs: [bug(1060, G, '404'), bug(1060, G - 152, 'bug'), bug(1060, G - 326, 'null'), bug(1350, G, 'bug'), bug(1350, G - 200, 'bug')],
  },
  {
    name: 'The Bridge',
    hint: 'Knock the bridge down – falling blocks squash bugs too.',
    ammo: ['css', 'html', 'js', 'sql', 'python'],
    blocks: [
      // stone piers with a long wooden deck
      block(980, G, T, 150, 'stone'),
      block(1260, G, T, 150, 'stone'),
      block(1120, G - 150, 312, T, 'wood'),
      block(1225, G - 182, 110, 64, 'wood', '404'),
      // under the deck
      block(1050, G, 64, 64, 'ice'),
      block(1190, G, 64, 64, 'ice'),
      // right-hand stack
      block(1440, G, 56, 56, 'wood'),
      block(1440, G - 56, 56, 56, 'ice'),
      block(1440, G - 112, 56, 56, 'wood'),
    ],
    bugs: [bug(1020, G - 182, 'bug'), bug(1120, G - 182, '404'), bug(1225, G - 246, 'bug'), bug(1120, G, 'null'), bug(1440, G - 168, 'bug')],
  },
  {
    name: 'Tower 404',
    hint: 'Hit the tower low and let gravity do the rest.',
    ammo: ['sql', 'python', 'js', 'css', 'html'],
    blocks: [
      // three-storey tower: stone, wood, glass – with the 404 sign on the roof
      ...storey(1200, G, 160, 120, 'stone', 'stone'),
      ...storey(1200, G - 152, 160, 100, 'wood', 'wood'),
      ...storey(1200, G - 284, 160, 80, 'ice', 'ice'),
      block(1200, G - 396, 110, 64, 'wood', '404'),
      // side shelter
      ...storey(1450, G, 90, 90, 'stone', 'wood'),
    ],
    bugs: [bug(1200, G, '404'), bug(1200, G - 152, 'bug'), bug(1200, G - 284, 'null'), bug(1200, G - 460, '404'), bug(1450, G, 'bug')],
  },
  {
    name: 'Syntax Error',
    hint: 'The final boss sits on a glass tower. Bring the house down!',
    ammo: ['html', 'css', 'sql', 'python', 'js', 'js'],
    blocks: [
      // glass wall + stone bunker on the left
      block(912, G, T, 120, 'ice'),
      ...storey(1060, G, 120, 120, 'stone', 'stone'),
      block(1060, G - 152, 48, 48, 'wood'),
      // glass tower on stone legs, monitor + boss on top
      ...storey(1380, G, 160, 120, 'stone', 'ice'),
      ...storey(1380, G - 152, 160, 100, 'ice', 'ice'),
      block(1380, G - 284, 64, 64, 'ice'),
      block(1380, G - 348, 100, 76, 'stone', 'syntax'),
    ],
    bugs: [
      bug(956, G, 'bug'),
      bug(1060, G, '404'),
      bug(1060, G - 200, '404'),
      bug(1380, G, 'null'),
      bug(1380, G - 152, 'bug'),
      bug(1380, G - 424, 'syntax'),
    ],
  },
]

export const LEVEL_COUNT = LEVELS.length
