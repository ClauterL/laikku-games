/** Deterministic PRNG (mulberry32). Same seed → same level, every time. */
export type Rng = () => number

export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

export function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Unseeded helpers for gameplay randomness. */
export const rnd = {
  range: (min: number, max: number) => min + Math.random() * (max - min),
  int: (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1)),
  pick: <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)],
  chance: (p: number) => Math.random() < p,
}
