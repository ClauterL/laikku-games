import { memo, type ReactNode, type RefObject } from 'react'
import { formatTime } from '../../shared/math'
import { Arrow, Glyph } from './Glyph'
import { SECTOR_BY_ID } from './sectors'
import { SYSTEM_IDS, SYSTEM_META, type CommandView, type Dir, type IncidentView, type NodeState, type SectorId, type SystemId } from './types'

/** Tactical panel with notched corners – everything in the HUD sits in one of these. */
export function Panel({ title, aside, className, children, as = 'section' }: { title?: ReactNode; aside?: ReactNode; className?: string; children: ReactNode; as?: 'section' | 'aside' | 'main' }) {
  const Tag = as
  return (
    <Tag className={`sc-panel${className ? ` ${className}` : ''}`}>
      {title && (
        <header className="sc-panel__head">
          <h2>{title}</h2>
          {aside && <span className="sc-panel__aside">{aside}</span>}
        </header>
      )}
      {children}
    </Tag>
  )
}

/** Row of mini arrow boxes (NEXT COMMANDS, start screen). */
export const MiniCode = memo(function MiniCode({ code, done = 0 }: { code: readonly Dir[]; done?: number }) {
  return (
    <span className="sc-mini">
      {code.map((d, i) => (
        <i key={i} className={i < done ? 'is-done' : undefined}>
          <Arrow dir={d} size={14} />
        </i>
      ))}
    </span>
  )
})

export const Segs = memo(function Segs({ count, lit, tone }: { count: number; lit: number; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <span className={`sc-segs${tone ? ` tone-${tone}` : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i < lit ? 'on' : undefined} />
      ))}
    </span>
  )
})

export const NetworkPanel = memo(function NetworkPanel({ mapRef, counts }: { mapRef: RefObject<HTMLCanvasElement | null>; counts: { online: number; incident: number; offline: number } }) {
  return (
    <Panel title="Network status" className="sc-network">
      <ul className="sc-legend">
        <li className="is-online">
          <i />
          <span>Online</span>
          <b>{counts.online}</b>
        </li>
        <li className="is-incident">
          <i />
          <span>Incident</span>
          <b>{counts.incident}</b>
        </li>
        <li className="is-offline">
          <i />
          <span>Offline</span>
          <b>{counts.offline}</b>
        </li>
      </ul>
      <canvas ref={mapRef} className="sc-map" aria-label="Map of Finland with the six network sectors" />
    </Panel>
  )
})

export const IncidentsPanel = memo(function IncidentsPanel({ incidents, timeLeft, compact }: { incidents: IncidentView[]; timeLeft: number; compact?: boolean }) {
  const open = incidents.filter((i) => i.state !== 'solved')
  const shown = compact ? open.slice(0, 3) : open
  return (
    <Panel title="Active incidents" aside={open.length ? `${open.length} open` : 'none'} className="sc-incidents">
      <ul>
        {shown.map((i) => (
          <li key={i.id} className={`sc-incident is-${i.state}`}>
            <Glyph name={i.state === 'active' ? 'alert' : 'mast'} size={16} />
            <span className="sc-incident__text">
              <b>{i.location}</b> – {i.incident}
            </span>
            <span className="sc-incident__time">{i.state === 'active' ? formatTime(timeLeft) : `${i.arrows} ARROWS`}</span>
          </li>
        ))}
        {open.length === 0 && (
          <li className="sc-incident is-clear">
            <Glyph name="check" size={16} />
            <span className="sc-incident__text">All sectors nominal</span>
          </li>
        )}
        {compact && open.length > 3 && <li className="sc-incident is-more">+{open.length - 3} more queued</li>}
      </ul>
    </Panel>
  )
})

export const NextCommandsPanel = memo(function NextCommandsPanel({ queue, strip, limit = 4 }: { queue: CommandView[]; strip?: boolean; limit?: number }) {
  return (
    <Panel title="Next commands" className={`sc-next${strip ? ' sc-next--strip' : ''}`}>
      <ol>
        {queue.slice(0, limit).map((c, i) => (
          <li key={`${c.id}-${i}`} className="sc-next__item">
            <span className="sc-next__num">{i + 1}</span>
            <Glyph name={c.glyph} size={22} className="sc-next__glyph" />
            <span className="sc-next__body">
              <b>{c.name}</b>
              <MiniCode code={c.code} />
            </span>
          </li>
        ))}
        {queue.length === 0 && <li className="sc-next__item is-empty">Wave complete</li>}
      </ol>
    </Panel>
  )
})

const tone = (v: number) => (v >= 60 ? 'ok' : v >= 30 ? 'warn' : 'bad')

export const SystemsPanel = memo(function SystemsPanel({ systems }: { systems: Record<SystemId, number> }) {
  return (
    <Panel title="Systems" className="sc-systems">
      <ul>
        {SYSTEM_IDS.map((id) => (
          <li key={id} className={`sc-system tone-${tone(systems[id])}`}>
            <Glyph name={SYSTEM_META[id].glyph} size={18} />
            <span className="sc-system__body">
              <b>{SYSTEM_META[id].label}</b>
              <span className="sc-bar">
                <i style={{ width: `${systems[id]}%` }} />
              </span>
            </span>
            <span className="sc-system__pct">{systems[id]}%</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
})

export const NodeList = memo(function NodeList({ nodes }: { nodes: Record<SectorId, NodeState> }) {
  return (
    <ul className="sc-nodes">
      {(Object.keys(nodes) as SectorId[]).map((id) => (
        <li key={id} className={`is-${nodes[id]}`}>
          <i />
          {SECTOR_BY_ID[id].label}
        </li>
      ))}
    </ul>
  )
})
