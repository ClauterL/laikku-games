import { useCallback, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { gameBySlug } from '../../games'
import { HomeButton } from '../../shared/HomeButton'
import { MuteButton } from '../../shared/MuteButton'
import { Overlay } from '../../shared/Overlay'
import { formatScore, formatTime } from '../../shared/math'
import { sfx } from '../../shared/sfx'
import { getBest } from '../../shared/storage'
import { useEngine } from '../../shared/useEngine'
import { RULES } from './catalogue'
import { Engine, SLUG } from './engine'
import { INITIAL_HUD, type EndStats, type HudState, type Phase } from './types'
import './ticket-slash.css'

const COMBO_SEGMENTS = Array.from({ length: RULES.comboMax }, (_, i) => i)
const HEARTS = Array.from({ length: RULES.lives }, (_, i) => i)

function TrophyIcon() {
  return (
    <svg className="ts-chip__icon ts-chip__icon--gold" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 3h10a1 1 0 0 1 1 1v1h2.5a1 1 0 0 1 1 1v1.5a4.5 4.5 0 0 1-4.2 4.5A5.5 5.5 0 0 1 13 15.9V18h2.5a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1H11v-2.1a5.5 5.5 0 0 1-4.3-3.9A4.5 4.5 0 0 1 2.5 7.5V6a1 1 0 0 1 1-1H6V4a1 1 0 0 1 1-1Zm-1 4H4.5v.5a2.5 2.5 0 0 0 1.6 2.3A6 6 0 0 1 6 8.5V7Zm12 0v1.5c0 .6-.1 1.2-.1 1.3a2.5 2.5 0 0 0 1.6-2.3V7H18Z"
      />
    </svg>
  )
}

function StopwatchIcon() {
  return (
    <svg className="ts-chip__icon ts-chip__icon--red" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 1.8M10 2.5h4M12 2.5V6M18.5 7l1.5-1.5" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <rect x="5" y="4" width="5" height="16" rx="1.6" />
      <rect x="14" y="4" width="5" height="16" rx="1.6" />
    </svg>
  )
}

function Heart({ on }: { on: boolean }) {
  return (
    <svg className={`ts-heart${on ? ' is-on' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s-7.2-4.7-9.4-8.7C.8 9.1 2.6 4.8 6.6 4.8c2 0 3.5 1.1 4.2 2.2l1.2 1.4 1.2-1.4c.7-1.1 2.2-2.2 4.2-2.2 4 0 5.8 4.3 4 7.5C19.2 16.3 12 21 12 21Z" />
    </svg>
  )
}

export default function TicketSlash() {
  const meta = gameBySlug(SLUG)!
  const [hud, setHud] = useState<HudState>(INITIAL_HUD)
  const [phase, setPhase] = useState<Phase>('start')
  const [stats, setStats] = useState<EndStats | null>(null)
  const [best, setBest] = useState(() => getBest(SLUG))

  const create = useCallback(
    (canvas: HTMLCanvasElement) =>
      new Engine(canvas, {
        onHud: setHud,
        onPhase: setPhase,
        onOver: (s) => {
          setStats(s)
          setBest(s.best)
        },
      }),
    [],
  )
  const { canvasRef, engineRef } = useEngine(create)

  const play = () => {
    sfx.unlock()
    sfx.play('click')
    engineRef.current?.start()
  }

  const style = { '--accent': meta.accent, '--accent-2': meta.accent2, '--bg': meta.bg } as CSSProperties
  const comboActive = hud.combo > 1
  const timeLow = phase === 'playing' && hud.time <= 10

  return (
    <div className={`game-root ticket-slash${hud.p1 && phase === 'playing' ? ' is-p1' : ''}`} style={style}>
      <canvas ref={canvasRef} className="game-canvas" aria-label="Ticket Slash play area" />
      <HomeButton />

      <div className="hud ts-hud">
        <div className="ts-hud__left">
          <div className="ts-hud__row">
            <button
              type="button"
              className="btn btn--icon ts-pause"
              aria-label="Pause"
              title="Pause (Esc)"
              disabled={phase !== 'playing'}
              onClick={() => {
                sfx.unlock()
                sfx.play('click')
                engineRef.current?.togglePause()
              }}
            >
              <PauseIcon />
            </button>
            <div className="chip ts-chip ts-chip--score">
              <TrophyIcon />
              <div className="ts-chip__text">
                <span className="chip__label">Score</span>
                <span className="chip__value" key={hud.solved}>
                  {formatScore(hud.score)}
                </span>
              </div>
            </div>
          </div>
          <div className={`ts-combo${comboActive ? ' is-active' : ''}`}>
            <div className="ts-combo__title" key={hud.combo}>
              Combo <span>×{hud.combo}</span>
            </div>
            <div className="ts-combo__bar" role="meter" aria-valuemin={1} aria-valuemax={RULES.comboMax} aria-valuenow={hud.combo} aria-label="Combo">
              {COMBO_SEGMENTS.map((i) => (
                <i key={i} className={i < hud.combo ? 'is-on' : undefined} />
              ))}
            </div>
            <div className="ts-combo__sub">{hud.streak >= 2 ? `${hud.streak} tickets in a row!` : 'Chain for combos'}</div>
          </div>
        </div>

        <div className="ts-hud__right">
          <div className={`chip ts-chip ts-chip--time${timeLow ? ' is-low' : ''}`}>
            <StopwatchIcon />
            <div className="ts-chip__text">
              <span className="chip__label">Time</span>
              <span className="chip__value">{formatTime(hud.time)}</span>
              <div className="ts-time__bar">
                <i style={{ width: `${(hud.time / RULES.roundSeconds) * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="ts-hud__row">
            <div className="ts-lives" role="img" aria-label={`${hud.lives} of ${RULES.lives} SLA lives`}>
              <span className="chip__label">SLA</span>
              {HEARTS.map((i) => (
                <Heart key={`${i}-${i < hud.lives}`} on={i < hud.lives} />
              ))}
            </div>
            <MuteButton />
          </div>
        </div>
      </div>

      {phase === 'start' && (
        <Overlay
          eyebrow={meta.company}
          title={meta.title}
          subtitle={meta.tagline}
          howto={
            <>
              <strong>Grab</strong> a flying ticket and <strong>flick</strong> it into the matching bin – or drag it there. Chain correct
              deliveries for combos, and resolve every red <strong>P1 CRITICAL</strong> before its SLA ring runs out. 60 seconds, 3 lives.
            </>
          }
          stats={best > 0 ? [{ label: 'Best score', value: formatScore(best) }] : undefined}
        >
          <button type="button" className="btn btn--primary" onClick={play}>
            PLAY ▶
          </button>
        </Overlay>
      )}

      {phase === 'paused' && (
        <Overlay eyebrow={meta.company} title="Paused" subtitle="The queue can wait a second.">
          <button type="button" className="btn btn--primary" onClick={() => engineRef.current?.resume()}>
            Resume ▶
          </button>
          <button type="button" className="btn" onClick={() => engineRef.current?.restart()}>
            Restart
          </button>
          <Link to="/" className="btn btn--ghost">
            Hub
          </Link>
        </Overlay>
      )}

      {phase === 'over' && stats && (
        <Overlay
          className="ts-over"
          eyebrow={stats.newBest ? 'New best score!' : meta.company}
          title={stats.reason === 'time' ? "Time's up!" : 'SLA exhausted'}
          subtitle={
            stats.reason === 'time'
              ? `Shift over – ${stats.solved} ticket${stats.solved === 1 ? '' : 's'} solved. Nice triage!`
              : 'Three tickets slipped through. The users are not happy.'
          }
          stats={[
            { label: 'Score', value: formatScore(stats.score) },
            { label: 'Best', value: formatScore(stats.best) },
            { label: 'Solved', value: stats.solved },
            { label: 'Best combo', value: `×${stats.bestCombo}` },
            { label: 'Accuracy', value: `${stats.accuracy}%` },
          ]}
        >
          <button type="button" className="btn btn--primary" onClick={play}>
            Play again ▶
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}
    </div>
  )
}
