/**
 * Visitor generator for the IDENTIFY VISITOR checkpoint (kept from v1).
 * Invented, generic names and companies only.
 */
import { pick, randInt, type Rng } from '../../shared/rng'
import type { FaceSpec, Visitor } from './types'

export const SHIRTS = ['#e74c3c', '#3498db', '#f1c40f', '#1abc9c', '#e67e22', '#9b59b6', '#2ecc71', '#ff6b9d', '#34495e', '#16a085']
export const HAIRS = ['#2c1b0e', '#6b3f22', '#b5651d', '#d9a441', '#1a1a1a', '#8b4513', '#c0392b', '#efe3c6']
export const SKINS = ['#f6d3b8', '#e9b996', '#d39a6f', '#b97a52', '#8d5a3b', '#f1dcc8']

const FIRST_NAMES = ['Alex', 'Maya', 'Jonas', 'Elena', 'Sami', 'Nora', 'Leo', 'Iris', 'Oskar', 'Mila', 'Tomas', 'Hanna', 'Rami', 'Vera', 'Nils', 'Ada', 'Kai', 'Lotta', 'Eero', 'Sofia']
const LAST_NAMES = ['Brown', 'Lind', 'Novak', 'Reyes', 'Kowal', 'Berg', 'Tanaka', 'Moreau', 'Salo', 'Weber', 'Okafor', 'Virtanen', 'Haas', 'Rossi', 'Park', 'Dahl']
const COMPANIES = ['BrightBuild', 'NordTech', 'CloudNine Ltd', 'Pixel & Pine', 'GreenGrid', 'Lumo Logistics', 'Vektor Oy', 'Blue Harbor', 'Quantiq', 'Sunline Media', 'Orbit Works', 'Mintra Group']
const PURPOSES = ['Meeting', 'Interview', 'Delivery', 'Maintenance', 'Site audit', 'Workshop', 'Sales demo', 'Consulting']
const FACE_BG = ['#dbe7f5', '#fde2c8', '#e3f3d8', '#f6d9e6', '#e4dcf7']

export function makeVisitor(rng: Rng): Visitor {
  const face: FaceSpec = {
    skin: pick(rng, SKINS),
    hair: pick(rng, HAIRS),
    hairStyle: randInt(rng, 0, 4),
    glasses: rng() < 0.4,
    beard: rng() < 0.25,
    bg: pick(rng, FACE_BG),
    shirt: pick(rng, SHIRTS),
  }
  return {
    name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
    company: pick(rng, COMPANIES),
    purpose: pick(rng, PURPOSES),
    appointment: rng() < 0.62,
    idMatches: rng() < 0.66,
    face,
  }
}

/** Valid ⇔ appointment ∧ photo ID matches (the badge inventory rule from v1). */
export function visitorIsValid(v: Visitor): boolean {
  return v.appointment && v.idMatches
}
