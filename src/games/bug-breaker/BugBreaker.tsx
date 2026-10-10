import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { gameBySlug } from '../../games'
import { HomeButton } from '../../shared/HomeButton'
import { MuteButton } from '../../shared/MuteButton'
import { Overlay } from '../../shared/Overlay'
import { formatScore } from '../../shared/math'
import { sfx } from '../../shared/sfx'
import { useEngine } from '../../shared/useEngine'
import { Engine, initialHud, loadProgress, SLUG } from './engine'
import { AMMO, AMMO_ORDER, LEVEL_COUNT } from './levels'
import type { AmmoType, HudState, Phase } from './types'
import './bug-breaker.css'

/** Rounded code cube icon for the ammo bar (vector only). */
function AmmoIcon({ type }: { type: AmmoType }) {
  const info = AMMO[type]
  const id = `bb-grad-${type}`
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={info.color2} />
          <stop offset="0.45" stopColor={info.color} />
          <stop offset="1" stopColor={info.dark} />
        </linearGradient>
      </defs>
      {type === 'js' && (
        <g stroke="#ffe14a" strokeWidth="2.5" strokeLinecap="round">
          <path d="M6 14l5 5M58 14l-5 5M6 50l5-5M58 50l-5-5M32 3v6M32 55v6" />
        </g>
      )}
      {type === 'sql' && (
        <g stroke="#d9a8ff" strokeWidth="3" strokeLinecap="round" opacity="0.8">
          <path d="M3 24h12M1 32h10M3 40h12" />
        </g>
      )}
      <rect x="9" y="9" width="46" height="46" rx="10" fill={`url(#${id})`} stroke={info.dark} strokeWidth="3" />
      <rect x="12" y="12" width="40" height="15" rx="7" fill="rgba(255,255,255,0.28)" />
      <rect x="12" y="47" width="40" height="5" fill="rgba(0,0,0,0.2)" />
      {type === 'python' ? (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 22c14-2 14 6 6 7s-10 9 6 9" stroke="#1d3a5c" strokeWidth="8" />
          <path d="M22 22c14-2 14 6 6 7s-10 9 6 9" stroke="#ffd43b" strokeWidth="4.5" />
          <circle cx="22" cy="22" r="3.6" fill="#ffd43b" />
          <circle cx="20.8" cy="21" r="1" fill="#1d3a5c" />
        </g>
      ) : (
        <text
          x="32"
          y="36"
          textAnchor="middle"
          fontFamily="'Baloo 2', 'Nunito', sans-serif"
          fontWeight="800"
          fontSize={type === 'sql' ? 17 : 21}
          fill={type === 'js' ? '#1d1a00' : '#fff'}
          stroke={type === 'js' ? 'none' : 'rgba(0,0,0,0.45)'}
          strokeWidth="2.5"
          paintOrder="stroke"
        >
          {info.glyph}
        </text>
      )}
    </svg>
  )
}

function SlingGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#c98a3e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22V12M12 12 5 4M12 12l7-8" />
      <path d="M5 4h14" stroke="#3a2418" strokeWidth="2" />
    </svg>
  )
}

function Star({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path
        d="M24 3l6.2 13.2 14.3 1.6-10.6 9.8 2.9 14.2L24 34.7 11.2 41.8l2.9-14.2L3.5 17.8l14.3-1.6z"
        fill={on ? '#ffd23f' : 'rgba(255,255,255,0.14)'}
        stroke={on ? '#8a4a14' : 'rgba(255,255,255,0.25)'}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function BugBreaker() {
  const meta = gameBySlug(SLUG)!
  const [hud, setHud] = useState<HudState>(initialHud)
  const [phase, setPhase] = useState<Phase>('start')
  const create = useCallback((canvas: HTMLCanvasElement) => new Engine(canvas, { onHud: setHud, onPhase: setPhase }), [])
  const { canvasRef, engineRef } = useEngine(create)
  // saved progress is only needed by the start screen, which exists once per mount
  const [progress] = useState(loadProgress)

  const startNew = useCallback(() => {
    sfx.unlock()
    sfx.play('click')
    engineRef.current?.restartRun()
  }, [engineRef])
  const continueRun = useCallback(() => {
    sfx.unlock()
    sfx.play('click')
    engineRef.current?.start(progress.level, progress.score)
  }, [engineRef, progress])

  // Enter / Space drive the overlays; the engine owns the keyboard while playing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const engine = engineRef.current
      if (!engine) return
      if (phase === 'start') {
        e.preventDefault()
        if (progress.level > 0) continueRun()
        else startNew()
      } else if (phase === 'cleared') {
        e.preventDefault()
        engine.nextLevel()
      } else if (phase === 'failed') {
        e.preventDefault()
        engine.retryLevel()
      } else if (phase === 'final') {
        e.preventDefault()
        engine.restartRun()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, progress, engineRef, startNew, continueRun])

  const counts = useMemo(() => {
    const c: Record<AmmoType, number> = { html: 0, css: 0, js: 0, python: 0, sql: 0 }
    for (const a of hud.queue) c[a]++
    return c
  }, [hud.queue])

  const style = { '--accent': meta.accent, '--accent-2': meta.accent2, '--bg': meta.bg } as React.CSSProperties
  const current = hud.current
  const showHud = phase !== 'start'

  return (
    <div className={`game-root ${SLUG}`} style={style}>
      <canvas ref={canvasRef} className="game-canvas" />
      <HomeButton />

      {showHud && (
        // blur clicked HUD buttons so Space (= special) never re-triggers them
        <div className="hud" onClick={(e) => (e.target as HTMLElement).closest('button')?.blur()}>
          <div className="hud__row bb-top">
            <div className="chip bb-chip bb-chip--level">
              <span className="chip__label">Level</span>
              <span className="chip__value">
                {hud.level}/{hud.levelCount}
              </span>
            </div>
            <div className="bb-top__right">
              <div className="chip bb-chip">
                <span className="chip__label">Score</span>
                <span className="chip__value" key={hud.score}>
                  {formatScore(hud.score)}
                </span>
              </div>
              <div className="chip bb-chip">
                <span className="chip__label">Shots left</span>
                <span className="chip__value">
                  <SlingGlyph />
                  {hud.shotsLeft}
                </span>
              </div>
              <button
                type="button"
                className="btn btn--icon bb-iconbtn"
                aria-label="Pause"
                title="Pause (Esc)"
                onClick={() => engineRef.current?.pause()}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="5" y="4" width="5" height="16" rx="1.5" />
                  <rect x="14" y="4" width="5" height="16" rx="1.5" />
                </svg>
              </button>
              <MuteButton className="bb-iconbtn" />
            </div>
          </div>

          <div className="bb-ammo" aria-label="Ammo">
            <div className="bb-ammo__cards">
              {AMMO_ORDER.map((type) => {
                const n = counts[type]
                const isCurrent = current === type
                return (
                  <div key={type} className={`bb-card${isCurrent ? ' is-current' : ''}${n === 0 && !isCurrent ? ' is-empty' : ''}`}>
                    {n > 0 && <span className="bb-card__count">×{n}</span>}
                    <div className="bb-card__icon">
                      <AmmoIcon type={type} />
                    </div>
                    <span className="bb-card__name">{AMMO[type].name}</span>
                    <span className="bb-card__desc">{AMMO[type].desc}</span>
                  </div>
                )
              })}
            </div>
            <div className="bb-ammo__desc">
              {current ? (
                <>
                  <b>{AMMO[current].name}</b> · {AMMO[current].desc}
                </>
              ) : hud.shotsLeft > 0 ? (
                'Loading the next cube…'
              ) : (
                'No code left!'
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'start' && (
        <Overlay
          eyebrow={meta.company}
          title={meta.title}
          subtitle={meta.tagline}
          howto={
            <>
              <strong>Drag</strong> the code cube back in the slingshot, aim with the dots and release. <strong>Tap</strong> mid-air to trigger{' '}
              <strong>JS</strong> explosions and <strong>PYTHON</strong> boosts. Squash every bug to clear the level.
              <div className="bb-ammo-preview" aria-hidden="true">
                {AMMO_ORDER.map((t) => (
                  <AmmoIcon key={t} type={t} />
                ))}
              </div>
            </>
          }
          stats={hud.best > 0 ? [{ label: 'Best', value: formatScore(hud.best) }] : undefined}
        >
          {progress.level > 0 ? (
            <>
              <button type="button" className="btn btn--primary" onClick={continueRun}>
                CONTINUE · LEVEL {progress.level + 1} ▶
              </button>
              <button type="button" className="btn btn--ghost" onClick={startNew}>
                New game
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" onClick={startNew}>
              PLAY ▶
            </button>
          )}
          <div className="bb-keys">
            <kbd>Space</kbd> special · <kbd>R</kbd> retry · <kbd>Esc</kbd> pause
          </div>
        </Overlay>
      )}

      {phase === 'paused' && (
        <Overlay
          eyebrow={meta.company}
          title="PAUSED"
          stats={[
            { label: 'Level', value: `${hud.level}/${hud.levelCount}` },
            { label: 'Score', value: formatScore(hud.score) },
          ]}
        >
          <button type="button" className="btn btn--primary" onClick={() => engineRef.current?.resume()}>
            RESUME ▶
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              sfx.play('click')
              engineRef.current?.retryLevel()
            }}
          >
            Retry level
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}

      {phase === 'cleared' && (
        <Overlay
          eyebrow={`Level ${hud.level} of ${hud.levelCount}`}
          title="LEVEL CLEARED"
          subtitle={
            <span className="bb-stars" aria-label={`${hud.stars} of 3 stars`}>
              <Star on={hud.stars >= 1} />
              <Star on={hud.stars >= 2} />
              <Star on={hud.stars >= 3} />
            </span>
          }
          stats={[
            { label: 'Level', value: formatScore(hud.levelScore) },
            { label: 'Unused shots', value: `+${formatScore(hud.bonus)}` },
            { label: 'Total', value: formatScore(hud.score) },
          ]}
        >
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              sfx.play('click')
              engineRef.current?.nextLevel()
            }}
          >
            NEXT LEVEL ▶
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}

      {phase === 'failed' && (
        <Overlay
          eyebrow={`Level ${hud.level} of ${hud.levelCount}`}
          title="BUILD FAILED"
          subtitle={`${hud.bugsLeft} bug${hud.bugsLeft === 1 ? '' : 's'} still crawling around. Out of code!`}
          stats={[
            { label: 'Score', value: formatScore(hud.score) },
            { label: 'Best', value: formatScore(hud.best) },
          ]}
        >
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              sfx.play('click')
              engineRef.current?.retryLevel()
            }}
          >
            RETRY ▶
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}

      {phase === 'final' && (
        <Overlay
          eyebrow={`All ${LEVEL_COUNT} levels cleared`}
          title="ALL BUGS FIXED"
          subtitle="Clean code, cleaner world. The towers are history!"
          stats={[
            { label: 'Total score', value: formatScore(hud.score) },
            { label: 'Best', value: formatScore(hud.best) },
          ]}
        >
          <button type="button" className="btn btn--primary" onClick={startNew}>
            PLAY AGAIN ▶
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}
    </div>
  )
}
