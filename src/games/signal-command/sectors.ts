/** The six sectors of the command network, their map nodes and briefing photos. */
import { FINLAND_CITIES } from './finland'
import type { SectorId } from './types'
import photoEast from './assets/sector-east.jpg'
import photoHelsinki from './assets/sector-helsinki.jpg'
import photoLapland from './assets/sector-lapland.jpg'
import photoOulu from './assets/sector-oulu.jpg'
import photoTurku from './assets/sector-turku.jpg'
import photoWest from './assets/sector-west.jpg'

export interface SectorDef {
  id: SectorId
  name: string
  /** short label on the map */
  label: string
  photo: string
  /** node position in the normalised Finland square */
  pos: readonly [number, number]
  /** where the map label sits relative to the node */
  labelSide: 'left' | 'right'
  /** location names for incidents in this sector – cycled */
  locations: readonly string[]
}

const city = (name: keyof typeof FINLAND_CITIES) => FINLAND_CITIES[name]

export const SECTORS: readonly SectorDef[] = [
  {
    id: 'helsinki',
    name: 'Helsinki Sector',
    label: 'HELSINKI',
    photo: photoHelsinki,
    // nudged east of the city anchor so the node clears Turku on a small map
    pos: [0.485, 0.958],
    labelSide: 'right',
    locations: ['Capital hub', 'Harbour mast', 'HQ data hall', 'Coastal relay', 'Airport node'],
  },
  {
    id: 'turku',
    name: 'Turku Sector',
    label: 'TURKU',
    photo: photoTurku,
    pos: [0.295, 0.9],
    labelSide: 'left',
    locations: ['Archipelago mast', 'Turku relay', 'Island station', 'Naval node', 'Ferry link'],
  },
  {
    id: 'west',
    name: 'West Coast Sector',
    label: 'WEST COAST',
    photo: photoWest,
    pos: city('Vaasa'),
    labelSide: 'left',
    locations: ['Vaasa relay', 'Coastal mast', 'Western node', 'Gulf station', 'Harbour relay'],
  },
  {
    id: 'oulu',
    name: 'Oulu Sector',
    label: 'OULU',
    photo: photoOulu,
    pos: city('Oulu'),
    labelSide: 'left',
    locations: ['Northern relay', 'Oulu dish', 'River station', 'Kemi node', 'Bothnia mast'],
  },
  {
    id: 'east',
    name: 'Eastern Sector',
    label: 'EASTERN SECTOR',
    photo: photoEast,
    pos: [0.62, 0.715],
    labelSide: 'right',
    locations: ['Eastern node', 'Border relay', 'Lake station', 'Kuopio hub', 'Forest mast'],
  },
  {
    id: 'lapland',
    name: 'Lapland Sector',
    label: 'LAPLAND',
    photo: photoLapland,
    pos: [0.535, 0.2],
    labelSide: 'right',
    locations: ['Fell station', 'Arctic relay', 'Ivalo node', 'Sodankylä mast', 'Tundra link'],
  },
]

export const SECTOR_BY_ID = Object.fromEntries(SECTORS.map((s) => [s.id, s])) as Record<SectorId, SectorDef>

/** Waves 1–5 of the mission, one sector each. */
export const MISSION_ORDER: readonly SectorId[] = ['helsinki', 'turku', 'west', 'oulu', 'east']
/** Wave 6+ cycles every sector, Lapland first. */
export const ENDLESS_ORDER: readonly SectorId[] = ['lapland', 'helsinki', 'turku', 'west', 'oulu', 'east']

export function sectorForWave(wave: number): SectorDef {
  const id = wave <= 5 ? MISSION_ORDER[wave - 1] : ENDLESS_ORDER[(wave - 6) % ENDLESS_ORDER.length]
  return SECTOR_BY_ID[id]
}

/** Dotted links on the map – a simple mesh over the country. */
export const LINKS: ReadonlyArray<readonly [SectorId, SectorId]> = [
  ['helsinki', 'turku'],
  ['helsinki', 'east'],
  ['turku', 'west'],
  ['west', 'oulu'],
  ['west', 'east'],
  ['oulu', 'east'],
  ['oulu', 'lapland'],
  ['east', 'lapland'],
]

export const NEIGHBOURS: Record<SectorId, SectorId[]> = (() => {
  const n = { helsinki: [], turku: [], west: [], oulu: [], east: [], lapland: [] } as Record<SectorId, SectorId[]>
  for (const [a, b] of LINKS) {
    n[a].push(b)
    n[b].push(a)
  }
  return n
})()
