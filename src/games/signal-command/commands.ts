/**
 * The command catalogue – fixed arrow codes, like real stratagems: players
 * memorise them. No two commands share the same first three arrows, so a
 * trained operator can tell them apart from the start of the code.
 */
import type { Dir, GlyphName, SystemId, Tier } from './types'

export interface CommandDef {
  id: string
  name: string
  glyph: GlyphName
  system: SystemId
  code: readonly Dir[]
  tier: Tier
  /** one-line briefing under the command name */
  brief: string
  /** the problem label of the incident this command fixes, e.g. "SIGNAL LOST" */
  incident: string
  /** the four phases of the fix – tick as quarters of the code are entered */
  steps: readonly [string, string, string, string]
}

const ARROW: Record<string, Dir> = { '↑': 'up', '↓': 'down', '←': 'left', '→': 'right' }

export const ARROW_CHAR: Record<Dir, string> = { up: '↑', down: '↓', left: '←', right: '→' }

function parse(s: string): readonly Dir[] {
  return Array.from(s).map((ch) => {
    const d = ARROW[ch]
    if (!d) throw new Error(`bad arrow "${ch}" in code ${s}`)
    return d
  })
}

function tierOf(len: number): Tier {
  return len <= 4 ? 'easy' : len <= 6 ? 'medium' : 'hard'
}

type Raw = [id: string, name: string, code: string, glyph: GlyphName, system: SystemId, incident: string, brief: string, steps: [string, string, string, string]]

const RAW: Raw[] = [
  ['restore-radio', 'RESTORE RADIO LINK', '↑→↓→↑←', 'mast', 'radio', 'SIGNAL LOST', 'Re-establish the encrypted link to restore network coverage.', ['ROUTE', 'SYNC', 'CALIBRATE', 'RESTORE']],
  ['sat-sync', 'SATELLITE SYNC', '→→↓↑', 'satellite', 'satellite', 'SYNC ERROR', 'Re-acquire the satellite and lock the timing reference.', ['ACQUIRE', 'TRACK', 'LOCK', 'SYNC']],
  ['reboot-server', 'REBOOT SERVER', '↑↑←→', 'server', 'servers', 'SERVER DOWN', 'Cold-restart the node and bring its services back online.', ['HALT', 'CHECK', 'BOOT', 'VERIFY']],
  ['route-data', 'ROUTE DATA', '↓→↓→', 'route', 'data', 'DATA LOSS', 'Push traffic over the backup path until the main route is repaired.', ['TRACE', 'SELECT', 'SWITCH', 'CONFIRM']],
  ['activate-node', 'ACTIVATE NODE', '↑↓↑←', 'node', 'radio', 'NODE OFFLINE', 'Power up the standby relay and join it to the network.', ['POWER', 'JOIN', 'AUTH', 'ONLINE']],
  ['encrypt', 'ENCRYPT CHANNEL', '←↑→↓↓', 'lock', 'security', 'OPEN CHANNEL', 'Rotate the keys and re-encrypt the exposed channel.', ['ISOLATE', 'KEYS', 'ENCRYPT', 'VERIFY']],
  ['freq-hop', 'FREQUENCY HOP', '↑←↑←→', 'hop', 'radio', 'INTERFERENCE', 'Jump the net to a clean frequency plan.', ['SCAN', 'PLAN', 'HOP', 'CONFIRM']],
  ['backup-power', 'BACKUP POWER', '↓↓↑←→', 'battery', 'power', 'POWER FAULT', 'Start the generators and switch the site to backup power.', ['START', 'WARM', 'SWITCH', 'STABLE']],
  ['ups-failover', 'UPS FAILOVER', '↓←↓←↑↑', 'bolt', 'power', 'UPS ALARM', 'Fail over to the second UPS string before the batteries run out.', ['ISOLATE', 'TRANSFER', 'BALANCE', 'VERIFY']],
  ['repeater', 'DEPLOY REPEATER', '↑↑→↓←', 'repeater', 'radio', 'COVERAGE GAP', 'Bring a mobile repeater on air to close the coverage gap.', ['POSITION', 'RAISE', 'TUNE', 'ON AIR']],
  ['antenna', 'CALIBRATE ANTENNA', '→↑←↑→↓', 'satellite', 'satellite', 'POINTING ERROR', 'Re-point the dish and trim the feed for full signal.', ['AZIMUTH', 'ELEVATION', 'TRIM', 'LOCK']],
  ['handover', 'RELAY HANDOVER', '←→←→↑', 'handover', 'radio', 'RELAY FAULT', 'Hand the traffic to the neighbouring relay without dropping a call.', ['PREPARE', 'MIRROR', 'HANDOVER', 'RELEASE']],
  ['reroute', 'NETWORK REROUTE', '↓←→←↓↑', 'reroute', 'data', 'LINK CUT', 'Rebuild the routing table around the cut fibre.', ['DETECT', 'COMPUTE', 'APPLY', 'VERIFY']],
  ['patch', 'PATCH DEPLOY', '↑→→↓←↑', 'patch', 'servers', 'VULNERABILITY', 'Roll the security patch across the server cluster.', ['STAGE', 'TEST', 'DEPLOY', 'RESTART']],
  ['dns-flush', 'DNS FLUSH', '↓↓←', 'globe', 'data', 'NAME ERRORS', 'Clear the poisoned resolver cache.', ['STOP', 'FLUSH', 'RELOAD', 'RESOLVE']],
  ['time-sync', 'TIME SYNC', '↑←↓', 'clock', 'data', 'CLOCK DRIFT', 'Re-sync the site clocks to the master reference.', ['QUERY', 'OFFSET', 'ADJUST', 'LOCK']],
  ['diagnostic', 'LINK DIAGNOSTIC', '→↓↑', 'pulse', 'radio', 'LINK DEGRADED', 'Run the loop test and clear the degraded link.', ['LOOP', 'MEASURE', 'ADJUST', 'CLEAR']],
  ['secure-uplink', 'SECURE UPLINK', '↑→↑→↓←↑', 'uplink', 'security', 'UPLINK EXPOSED', 'Build a hardened tunnel for the command uplink.', ['AUTH', 'TUNNEL', 'HARDEN', 'VERIFY']],
  ['firewall', 'FIREWALL LOCK', '←←↓↑→↓→', 'firewall', 'security', 'INTRUSION', 'Lock the perimeter and drop the hostile sessions.', ['DETECT', 'BLOCK', 'LOCK', 'AUDIT']],
  ['broadcast', 'EMERGENCY BROADCAST', '↑↑↑↓←→↓→', 'broadcast', 'radio', 'ALERT PENDING', 'Push the emergency message to every station in the net.', ['COMPOSE', 'AUTH', 'TRANSMIT', 'CONFIRM']],
  ['grid', 'GRID RESTORE', '↓→↑←↓→↑←', 'grid', 'power', 'GRID DOWN', 'Re-energise the site grid section by section.', ['ISOLATE', 'TEST', 'ENERGISE', 'BALANCE']],
  ['cell', 'CELL HANDOVER', '→↑↓←→', 'cell', 'data', 'CELL CONGESTED', 'Move the users to the neighbouring cell.', ['MEASURE', 'SELECT', 'HANDOVER', 'CONFIRM']],
  ['audit', 'LOG AUDIT', '←↓→↑↑↓', 'audit', 'security', 'ANOMALY', 'Trace the anomaly through the access logs.', ['COLLECT', 'FILTER', 'TRACE', 'REPORT']],
  ['cold-start', 'COLD START', '↓↓↓↑→←↑', 'cold', 'servers', 'CLUSTER HALTED', 'Bring the halted cluster up from a cold state.', ['POWER', 'STORAGE', 'SERVICES', 'VERIFY']],
]

export const COMMANDS: readonly CommandDef[] = RAW.map(([id, name, code, glyph, system, incident, brief, steps]) => {
  const parsed = parse(code)
  return { id, name, glyph, system, code: parsed, tier: tierOf(parsed.length), brief, incident, steps }
})

export const COMMAND_BY_ID: Record<string, CommandDef> = Object.fromEntries(COMMANDS.map((c) => [c.id, c]))

export const BY_TIER: Record<Tier, readonly CommandDef[]> = {
  easy: COMMANDS.filter((c) => c.tier === 'easy'),
  medium: COMMANDS.filter((c) => c.tier === 'medium'),
  hard: COMMANDS.filter((c) => c.tier === 'hard'),
}

/** Wave 1 opens with one of these – a three-arrow code anybody can solve. */
export const OPENERS: readonly CommandDef[] = COMMANDS.filter((c) => c.code.length === 3)

/** Tier weights per wave – wave 1 easy only, wave 5+ hard-weighted. */
export function tierWeights(wave: number): Record<Tier, number> {
  if (wave <= 1) return { easy: 1, medium: 0, hard: 0 }
  if (wave === 2) return { easy: 0.55, medium: 0.45, hard: 0 }
  if (wave === 3) return { easy: 0.3, medium: 0.5, hard: 0.2 }
  if (wave === 4) return { easy: 0, medium: 0.55, hard: 0.45 }
  if (wave === 5) return { easy: 0, medium: 0.3, hard: 0.7 }
  return { easy: 0, medium: 0.2, hard: 0.8 }
}

/** Seconds the wave timer grants per arrow – 0.9 s on the mission, tighter in endless waves. */
export function secondsPerArrow(wave: number): number {
  return wave <= 5 ? 0.9 : Math.max(0.65, 0.9 - 0.04 * (wave - 5))
}

export const WAVE_BASE_SECONDS = 4
