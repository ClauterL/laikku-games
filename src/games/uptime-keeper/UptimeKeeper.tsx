import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { gameBySlug } from '../../games'
import { HomeButton } from '../../shared/HomeButton'
import { MuteButton } from '../../shared/MuteButton'
import { Overlay } from '../../shared/Overlay'
import { formatScore, formatTime } from '../../shared/math'
import { sfx } from '../../shared/sfx'
import { useEngine } from '../../shared/useEngine'
import { Engine, SLUG, initialHud } from './engine'
import { CubeMark, Glyph } from './Glyph'
import { ACTION_GLYPH, ALERT_GLYPH, type GlyphName } from './glyphs'
import { SLA_PASS } from './levels'
import type { ActionKind, DetailView, HudState, Phase, Tone } from './types'
import './uptime-keeper.css'

const ACTIONS: { kind: ActionKind; label: string; key: string }[] = [
  { kind: 'cool', label: 'COOL', key: '1' },
  { kind: 'repair', label: 'REPAIR', key: '2' },
  { kind: 'upgrade', label: 'UPGRADE', key: '3' },
]

const DETAIL_GLYPH: Record<DetailView['type'], GlyphName> = {
  heat: 'heat',
  fan: 'wrench',
  psu: 'plug',
  net: 'wifiOff',
  power: 'bolt',
  down: 'cross',
  upgrade: 'chevrons',
  rack: 'power',
  crac: 'snow',
  pdu: 'bolt',
  switch: 'wifi',
  terminal: 'chevrons',
  nominal: 'check',
}

const IconPause = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
)

/** Segmented neon bar – `lit` of `count` segments glow. */
function Segs({ count, lit }: { count: number; lit: number }) {
  return (
    <span className="uk-segs" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i < lit ? 'on' : undefined} />
      ))}
    </span>
  )
}

function Meter({ tone, glyph, label, value, tag, alarm }: { tone: Tone; glyph: GlyphName; label: string; value: number; tag: string; alarm?: boolean }) {
  return (
    <div className={`uk-meter tone-${tone}${alarm ? ' is-alarm' : ''}`} role="meter" aria-label={`${label} ${value} %, ${tag}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <Glyph name={glyph} size={26} className="uk-meter__glyph" />
      <span className="uk-meter__body">
        <span className="uk-meter__label">
          {label}
          <em>{tag}</em>
        </span>
        <Segs count={10} lit={Math.round(value / 10)} />
      </span>
    </div>
  )
}

function Stars({ n }: { n: number }) {
  return (
    <span className="uk-stars" aria-label={`${n} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? 'on' : undefined}>
          ★
        </i>
      ))}
    </span>
  )
}

export default function UptimeKeeper() {
  const meta = gameBySlug(SLUG)!
  const [hud, setHud] = useState<HudState>(initialHud)
  const [phase, setPhase] = useState<Phase>('start')
  const mapRef = useRef<HTMLCanvasElement>(null)
  const create = useCallback((canvas: HTMLCanvasElement) => new Engine(canvas, { onHud: setHud, onPhase: setPhase }), [])
  const { canvasRef, engineRef } = useEngine(create)

  // The mini-map canvas only exists in some layouts; hand the engine whatever is mounted right now.
  useEffect(() => {
    engineRef.current?.attachMap(mapRef.current)
  })

  const begin = useCallback(
    (mode: 'new' | 'continue') => {
      sfx.unlock()
      sfx.play('click')
      engineRef.current?.start(mode)
    },
    [engineRef],
  )
  const next = useCallback(() => {
    sfx.unlock()
    sfx.play('click')
    engineRef.current?.nextLevel()
  }, [engineRef])
  const retry = useCallback(() => {
    sfx.unlock()
    sfx.play('click')
    engineRef.current?.retryLevel()
  }, [engineRef])

  const canContinue = hud.savedLevel > 1
  const passed = hud.clear?.passed ?? false

  // Enter / Space trigger the primary button of whichever overlay is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      // a focused button or link handles the key itself
      if (e.target instanceof Element && e.target.closest('button, a')) return
      if (phase === 'start') begin(canContinue ? 'continue' : 'new')
      else if (phase === 'clear') {
        if (passed) next()
        else retry()
      } else if (phase === 'over') retry()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, begin, next, retry, canContinue, passed])

  const press = (kind: ActionKind) => (e: ReactMouseEvent<HTMLButtonElement>) => {
    sfx.unlock()
    engineRef.current?.act(kind)
    // keep keyboard focus on the game: Space / Enter must not re-trigger the button
    e.currentTarget.blur()
  }

  const pickAlert = (id: number) => (e: ReactMouseEvent<HTMLButtonElement>) => {
    sfx.unlock()
    const type = (e.nativeEvent as PointerEvent).pointerType
    engineRef.current?.selectAlert(id, hud.touch || type === 'touch' || type === 'pen')
    e.currentTarget.blur()
  }

  const tapMap = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    sfx.unlock()
    engineRef.current?.mapTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  const style = {
    '--accent': meta.accent,
    '--accent-2': meta.accent2,
    '--bg': meta.bg,
    '--panel': 'rgba(10, 13, 19, 0.92)',
    '--panel-border': 'rgba(255, 70, 85, 0.34)',
  } as CSSProperties
  const d = hud.detail
  const clear = hud.clear
  const over = hud.over
  const openAlerts = hud.alerts.filter((a) => a.type !== 'upgrade').length
  const playing = phase === 'playing'

  return (
    <div
      className={`game-root uptime-keeper layout-${hud.layout} phase-${phase}${hud.touch ? ' is-touch' : ''}${hud.critical && playing ? ' is-critical' : ''}`}
      style={style}
    >
      <canvas ref={canvasRef} className="game-canvas" />
      <div className="uk-vignette" aria-hidden="true" />
      <HomeButton />

      <div className="hud uk-hud">
        <header className="uk-top">
          <div className="uk-brand">
            <CubeMark size={26} />
            <span className="uk-brand__name">Ficolo</span>
            <span className="uk-brand__sep" />
            <span className="uk-brand__title">
              UPTIME <b>KEEPER</b>
            </span>
          </div>
          <div className="uk-stats">
            <div className="uk-stat uk-stat--score">
              <span>Score</span>
              <b>{String(hud.score).padStart(6, '0')}</b>
            </div>
            <div className="uk-stat uk-stat--level" title={hud.levelTitle}>
              <span>Level</span>
              <b>{String(hud.level).padStart(2, '0')}</b>
            </div>
            <div className="uk-stat uk-stat--time">
              <span>Shift</span>
              <b>{formatTime(hud.timeLeft)}</b>
            </div>
            <div className={`uk-stat uk-stat--uptime is-${hud.uptimeTone}${hud.uptimeDrop ? ' is-drop' : ''}`} aria-live="off">
              <span>Uptime</span>
              <b>
                {hud.uptime}
                <small> %</small>
              </b>
              <Segs count={8} lit={hud.uptimeSegs} />
            </div>
          </div>
          <div className="uk-top__btns">
            <button
              type="button"
              className="btn btn--icon"
              aria-label={phase === 'paused' ? 'Resume' : 'Pause'}
              title="Pause (Esc)"
              onClick={(e) => {
                sfx.unlock()
                sfx.play('click')
                engineRef.current?.togglePause()
                e.currentTarget.blur()
              }}
            >
              <IconPause />
            </button>
            <MuteButton />
          </div>
          <span className="uk-shift" aria-hidden="true">
            <i style={{ width: `${hud.progress}%` }} />
          </span>
        </header>

        <div className="uk-meters">
          <Meter tone="cooling" glyph="snow" label="Cooling" value={hud.cooling} tag={`Lv ${hud.upgrades.cooling}`} alarm={hud.cooling < 20} />
          <Meter tone="power" glyph="bolt" label="Power" value={hud.power} tag={`${hud.power} %`} alarm={hud.power >= 90} />
          <Meter
            tone="network"
            glyph="wifi"
            label="Network"
            value={hud.network}
            tag={hud.spares > 0 ? `Lv ${hud.upgrades.network} · ${hud.spares} spare` : `Lv ${hud.upgrades.network}`}
            alarm={hud.network < 99}
          />
          <div className="uk-credits" title="Credits pay for upgrades – earned by uptime and resolved alerts">
            <span>Credits</span>
            <b>{hud.credits}</b>
          </div>
        </div>

        <aside className="uk-objectives" aria-label="Objectives">
          <div className="uk-panel__head">
            <h2>Objectives</h2>
            <span className={openAlerts ? 'has-alerts' : undefined}>{openAlerts} open</span>
          </div>
          <ul>
            {hud.alerts.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`uk-obj type-${a.type} is-${a.severity}${a.selected ? ' is-selected' : ''}`}
                  data-alert={a.type}
                  data-target={a.targetId}
                  onClick={pickAlert(a.id)}
                >
                  <span className="uk-obj__icon">
                    <Glyph name={ALERT_GLYPH[a.type]} size={24} />
                  </span>
                  <span className="uk-obj__text">
                    <b>{a.title}</b>
                    <small>{a.subtitle}</small>
                    <em>{a.chip}</em>
                  </span>
                  <span className="uk-obj__chev" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
            {hud.alerts.length === 0 && (
              <li className="uk-obj-empty">
                <Glyph name="check" size={20} />
                <span>All systems nominal</span>
              </li>
            )}
          </ul>
        </aside>

        <section className="uk-map" aria-label="Datacenter map">
          <div className="uk-panel__head">
            <h2>Datacenter map</h2>
            {hud.scrolling && <span>tap to walk</span>}
          </div>
          <canvas ref={mapRef} onPointerDown={tapMap} />
        </section>

        <div className="uk-actions">
          {ACTIONS.map(({ kind, label, key }) => {
            const a = hud.actions[kind]
            const busy = kind === 'repair' && hud.repairPct >= 0
            return (
              <button
                key={kind}
                type="button"
                className={`uk-act uk-act--${kind}${a.enabled ? '' : ' is-off'}${busy ? ' is-busy' : ''}`}
                aria-disabled={!a.enabled}
                aria-label={`${label} – ${a.hint}`}
                title={a.hint}
                data-action={kind}
                onClick={press(kind)}
              >
                <Glyph name={ACTION_GLYPH[kind]} size={38} className="uk-act__glyph" />
                <span className="uk-act__label">{label}</span>
                <span className="uk-act__sub">{a.sub}</span>
                <span className="uk-act__key">{key}</span>
                {busy && (
                  <span className="uk-act__bar">
                    <i style={{ width: `${hud.repairPct}%` }} />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <aside className={`uk-detail tone-${d.tone} type-${d.type}`} aria-live="polite">
          <div className="uk-detail__icon">
            <Glyph name={DETAIL_GLYPH[d.type]} size={44} />
          </div>
          <div className="uk-detail__body">
            <h3>{d.title}</h3>
            {d.lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
            {d.bar && (
              <div className={`uk-bar tone-${d.bar.tone}`}>
                <span>
                  <i style={{ width: `${d.bar.pct}%` }} />
                </span>
                <b>{d.bar.label}</b>
              </div>
            )}
          </div>
        </aside>

        <div className="uk-toasts">
          {hud.banner && playing && (
            <div key={hud.banner.id} className={`uk-banner tone-${hud.banner.tone}`} role="alert">
              <b>{hud.banner.text}</b>
              <span>{hud.banner.sub}</span>
            </div>
          )}
        </div>
        <div className="uk-tips">
          {hud.tip && playing && (
            <div className="uk-tip" role="status">
              {hud.tip}
            </div>
          )}
        </div>
      </div>

      {phase === 'start' && (
        <Overlay
          className="uk-overlay"
          eyebrow={meta.company}
          title={meta.title}
          subtitle={meta.tagline}
          howto={
            <>
              You are the technician. {hud.touch ? 'Tap a rack to run there' : 'Run to the rack in trouble (WASD / arrows or click)'}: <strong>COOL</strong> what overheats,{' '}
              <strong>REPAIR</strong> fans, PSUs, switches and PDUs, and spend credits on <strong>UPGRADE</strong>. Every second a rack is down costs <strong>uptime</strong> – finish each
              2.5-minute shift above {SLA_PASS.toFixed(1)} %.
            </>
          }
          stats={hud.best > 0 ? [{ label: 'Best score', value: formatScore(hud.best) }] : undefined}
        >
          {canContinue ? (
            <>
              <button type="button" className="btn btn--primary" onClick={() => begin('continue')} autoFocus>
                CONTINUE · LEVEL {hud.savedLevel} ▶
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => begin('new')}>
                New game
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => begin('new')} autoFocus>
              PLAY ▶
            </button>
          )}
        </Overlay>
      )}

      {phase === 'paused' && (
        <Overlay
          className="uk-overlay"
          eyebrow={`Level ${hud.level} · ${hud.levelTitle}`}
          title="Paused"
          subtitle={
            hud.touch
              ? 'The hall keeps humming. Tap a rack or the floor to walk there, or use the joystick · the three buttons act on whatever you stand next to.'
              : 'The hall keeps humming. WASD / arrows or click to move · 1 2 3 or the buttons to act · E does the sensible thing · R restarts the level.'
          }
          stats={[
            { label: 'Uptime', value: `${hud.uptime} %` },
            { label: 'Shift left', value: formatTime(hud.timeLeft) },
          ]}
        >
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              sfx.unlock()
              sfx.play('click')
              engineRef.current?.resume()
            }}
            autoFocus
          >
            Resume
          </button>
          <button type="button" className="btn" onClick={retry}>
            Restart level
          </button>
          {hud.touch && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                sfx.unlock()
                sfx.play('click')
                engineRef.current?.setJoystick(!hud.joystick)
              }}
            >
              Joystick: {hud.joystick ? 'on' : 'off'}
            </button>
          )}
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}

      {phase === 'clear' && clear && (
        <Overlay
          className={`uk-overlay uk-clear${clear.passed ? '' : ' is-missed'}`}
          eyebrow={clear.passed ? `Level ${clear.level} clear · ${clear.title}` : `Level ${clear.level} · SLA missed`}
          title={`${clear.uptime} % uptime`}
          subtitle={
            clear.passed ? (
              <>
                <Stars n={clear.stars} />
                <span className="uk-clear__note">
                  {clear.stars === 3 ? 'Outstanding shift.' : clear.stars === 2 ? 'Solid shift.' : 'SLA met – just.'} +{clear.bonus} bonus credits
                  {clear.isBest ? ' · new best for this hall' : ''}
                </span>
              </>
            ) : (
              <>The shift ended below the {SLA_PASS.toFixed(1)} % target. Same hall, same upgrades – get to the alerts sooner.</>
            )
          }
          howto={
            clear.passed ? (
              <>
                <strong>
                  Next · Level {clear.nextLevel} – {clear.nextTitle}
                </strong>
                <br />
                {clear.nextIntro}
              </>
            ) : (
              <>
                <strong>Tip</strong> – red badges first: a dark zone or a dead switch costs far more uptime than a single hot rack.
              </>
            )
          }
          stats={[
            { label: 'Score', value: formatScore(clear.score) },
            { label: 'Resolved', value: clear.resolved },
            { label: clear.autoCools > 0 ? 'Auto-cooled' : 'Credits', value: clear.autoCools > 0 ? clear.autoCools : clear.credits },
            { label: 'Shutdowns', value: clear.shutdowns },
          ]}
        >
          {clear.passed ? (
            <button type="button" className="btn btn--primary" onClick={next} autoFocus>
              Next level ▶
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={retry} autoFocus>
              Retry level
            </button>
          )}
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}

      {phase === 'over' && over && (
        <Overlay
          className="uk-overlay uk-over"
          eyebrow="SLA breached"
          title="Service down"
          subtitle={over.reason}
          stats={[
            { label: 'Uptime', value: `${over.uptime} %` },
            { label: 'Score', value: formatScore(over.score) },
            { label: 'Level', value: over.level },
            { label: over.isBest ? 'New best!' : 'Best', value: formatScore(over.best) },
          ]}
        >
          <button type="button" className="btn btn--primary" onClick={retry} autoFocus>
            Retry level
          </button>
          <button type="button" className="btn" onClick={() => begin('new')}>
            New game
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}
    </div>
  )
}
