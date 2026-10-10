/** localStorage wrappers that never throw (private mode, blocked storage…). */

const PREFIX = 'havaida-games:'

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function getBest(game: string): number {
  return loadJSON<number>(`${game}:best`, 0)
}

/** Stores the score if it beats the previous best. Returns the new best. */
export function submitBest(game: string, score: number): number {
  const best = Math.max(getBest(game), Math.round(score))
  saveJSON(`${game}:best`, best)
  return best
}
