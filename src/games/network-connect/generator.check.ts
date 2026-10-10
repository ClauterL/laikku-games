/**
 * Sanity check for the level generator – not part of the app bundle.
 *
 *   /opt/npm-tools/node_modules/.bin/tsx src/games/network-connect/generator.check.ts [maxLevel]
 *
 * Generates every level up to `maxLevel` (default 30), asserts the invariants
 * (every required tile covered exactly once, no path shorter than 3, at most 8
 * colours, waypoints interior, obstacles untouched) and prints a one-line
 * summary per level. Throws when any level is invalid so the exit code is non-zero.
 */
import { generateLevel, validateLevel } from './generator'
import { MIN_PATH_LEN } from './types'

const maxLevel = Number(globalThis.process?.argv?.[2] ?? 30)
let failures = 0

for (let level = 1; level <= maxLevel; level++) {
  const lv = generateLevel(level)
  const errors = validateLevel(lv)
  const lengths = lv.paths.map((p) => p.cells.length)
  const obstacles = { block: 0, loss: 0, broken: 0 }
  for (const k of lv.kinds) if (k !== 'tile') obstacles[k]++
  const waypoints = lv.paths.flatMap((p) => p.waypoints.map((w) => w.kind))
  const summary =
    `level ${String(level).padStart(2)}  ${lv.size}x${lv.size}  variant ${String(lv.variant).padStart(3)}  ` +
    `${lv.paths.length} colours  lengths [${lengths.join(',')}]  min ${Math.min(...lengths)}  ` +
    `blocks ${obstacles.block} loss ${obstacles.loss} broken ${obstacles.broken}  waypoints [${waypoints.join(',')}]  "${lv.name}"`
  if (errors.length || Math.min(...lengths) < MIN_PATH_LEN) {
    failures++
    console.log(`FAIL ${summary}\n   ${errors.join('\n   ')}`)
  } else {
    console.log(`ok   ${summary}`)
  }
}

// Determinism: the same level must come out identical on a second call.
const a = JSON.stringify(generateLevel(12))
const b = JSON.stringify(generateLevel(12))
if (a !== b) {
  failures++
  console.log('FAIL level 12 is not deterministic')
}

if (failures > 0) throw new Error(`${failures} level(s) failed validation`)
console.log(`\nall ${maxLevel} levels valid`)

declare global {
  // Minimal typing for node's argv without pulling in @types/node for the app config.
  var process: { argv?: string[] } | undefined
}
