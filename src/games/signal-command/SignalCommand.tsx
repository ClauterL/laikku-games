import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { gameBySlug } from '../../games'
import { HomeButton } from '../../shared/HomeButton'
import { MuteButton } from '../../shared/MuteButton'
import { Overlay } from '../../shared/Overlay'
import { easeOutCubic, formatScore, formatTime } from '../../shared/math'
import { sfx } from '../../shared/sfx'
import { useEngine } from '../../shared/useEngine'
import bgTall from './assets/bg-tall.jpg'
import bgWide from './assets/bg-wide.jpg'
import { Engine, MISSION_WAVES, SLUG, START_LIVES, initialHud } from './engine'
import { Arrow, Emblem, Glyph } from './Glyph'
import { IncidentsPanel, NetworkPanel, NextCommandsPanel, Segs, SystemsPanel } from './panels'
import { SECTOR_BY_ID } from './sectors'
import type { Dir, HudState, Phase } from './types'
import './signal-command.css'

type Layout = 'desktop' | 'landscape' | 'portrait'

function detectLayout(): Layout {
  const w = window.innerWidth
  const h = window.innerHeight
  if (w >= 1000 && h >= 560) return 'desktop'
  return w >= h * 1.2 ? 'landscape' : 'portrait'
}

/** Smooth score counter – the engine emits the target, the chip rolls towards it. */
function useCountUp(target: number, duration = 500) {
  const [value, setValue] = useState(target)
  const shown = useRef(target)
  useEffect(() => {
    const from = shown.current
    if (from === target) return
    if (target < from) {
      shown.current = target
      setValue(target)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration)
      const v = Math.round(from + (target - from) * easeOutCubic(p))
      shown.current = v
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

const DPAD: { dir: Dir; label: string; cls: string }[] = [
  { dir: 'up', label: 'Up', cls: 'sc-dpad__up' },
  { dir: 'left', label: 'Left', cls: 'sc-dpad__left' },
  { dir: 'right', label: 'Right', cls: 'sc-dpad__right' },
  { dir: 'down', label: 'Down', cls: 'sc-dpad__down' },
]

const SWIPE_PX = 26

export default function SignalCommand() {
  const meta = gameBySlug(SLUG)!
  const [hud, setHud] = useState<HudState>(initialHud)
  const [layout, setLayout] = useState<Layout>(() => (typeof window === 'undefined' ? 'desktop' : detectLayout()))
  const [sheet, setSheet] = useState(false)
  const [touch, setTouch] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  // the red flash + shake runs for half a second after each wrong arrow
  const [seenMiss, setSeenMiss] = useState(0)
  const mapRef = useRef<HTMLCanvasElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const swipe = useRef<{ id: number; x: number; y: number; fired: boolean } | null>(null)
  const create = useCallback((canvas: HTMLCanvasElement) => new Engine(canvas, { onHud: setHud }), [])
  const { canvasRef, engineRef } = useEngine(create)
  const phase: Phase = hud.phase

  useEffect(() => {
    const onResize = () => setLayout(detectLayout())
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  // the map canvas moves between the left column and the phone status sheet
  useEffect(() => {
    engineRef.current?.attachMap(mapRef.current)
  })

  // the miss flash is "every missSeq we have not yet acknowledged": the wrap's
  // onAnimationEnd marks it seen, so no timers or effects are needed

  // speed lines radiate from the centre of the arrow row
  useEffect(() => {
    const row = rowRef.current
    const canvas = canvasRef.current
    if (!row || !canvas) return
    const report = () => {
      const r = row.getBoundingClientRect()
      const c = canvas.getBoundingClientRect()
      engineRef.current?.setBurstOrigin(r.left - c.left + r.width / 2, r.top - c.top + r.height / 2)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(row)
    ro.observe(canvas)
    return () => ro.disconnect()
    // the strip remounts on every new code and on every miss – re-observe the fresh element
  }, [layout, canvasRef, engineRef, hud.current?.incidentId, hud.missSeq])

  const begin = useCallback(() => {
    sfx.unlock()
    sfx.play('click')
    setSheet(false)
    engineRef.current?.start()
  }, [engineRef])

  // Enter / Space trigger the primary button of whichever overlay is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (e.target instanceof Element && e.target.closest('button, a')) return
      if (phase === 'start' || phase === 'failed') begin()
      else if (phase === 'complete') {
        sfx.unlock()
        engineRef.current?.continueEndless()
      } else if (phase === 'paused') {
        sfx.unlock()
        engineRef.current?.resume()
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, begin, engineRef])

  const press = (dir: Dir) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.pointerType === 'touch' || e.pointerType === 'pen') setTouch(true)
    sfx.unlock()
    engineRef.current?.press(dir)
  }

  // Helldivers feel: swipe anywhere on the command panel to enter an arrow
  const onPanelDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.target instanceof Element && e.target.closest('button, a')) return
    if (e.pointerType === 'touch' || e.pointerType === 'pen') setTouch(true)
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // synthetic pointers (automation) have no capture target – the swipe still works via bubbling
    }
  }
  const onPanelMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = swipe.current
    if (!s || s.id !== e.pointerId || s.fired) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (Math.hypot(dx, dy) < SWIPE_PX) return
    s.fired = true
    const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    sfx.unlock()
    engineRef.current?.press(dir)
  }
  const onPanelUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (swipe.current?.id === e.pointerId) swipe.current = null
  }

  const togglePause = () => {
    sfx.unlock()
    sfx.play('click')
    engineRef.current?.togglePause()
  }

  const score = useCountUp(hud.score)
  const cur = hud.current
  // after the last code of a wave the row keeps showing it fully lit while the banner plays
  const clearing = !cur && hud.phase === 'playing' && hud.waveCount > 0 && hud.waveSolved === hud.waveCount && hud.solvedCode
  const code = cur?.code ?? (clearing ? hud.solvedCode : null)
  const progress = cur?.progress ?? (clearing && code ? code.length : 0)
  const frac = hud.waveTime > 0 ? Math.max(0, Math.min(1, hud.timeLeft / hud.waveTime)) : 0
  const timeTone = frac > 0.5 ? 'ok' : frac > 0.25 ? 'warn' : 'bad'
  const playing = phase === 'playing'
  const inMission = phase !== 'start'
  const sector = SECTOR_BY_ID[cur?.sectorId ?? hud.sectorId]
  const waveSector = SECTOR_BY_ID[hud.sectorId]
  const portrait = layout === 'portrait'
  const landscape = layout === 'landscape'
  const stepsDone = code ? [1, 2, 3, 4].map((q) => progress >= Math.ceil((code.length * q) / 4)) : [false, false, false, false]
  const activeStep = stepsDone.indexOf(false)
  const gaugeLen = 2 * Math.PI * 13

  const style = {
    '--accent': meta.accent,
    '--accent-2': meta.accent2,
    '--bg': meta.bg,
    '--panel': 'rgba(6, 14, 24, 0.82)',
    '--panel-border': 'rgba(25, 200, 255, 0.35)',
  } as CSSProperties

  const miss = hud.missSeq > seenMiss
  const arrowRow = (
    <div
      className={`sc-arrows-wrap${miss ? ' is-miss' : ''}`}
      key={hud.missSeq}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setSeenMiss(hud.missSeq)
      }}
    >
      <div
        ref={rowRef}
        key={cur ? `inc-${cur.incidentId}` : clearing ? 'clearing' : 'idle'}
        className={`sc-arrows${miss ? ' is-miss' : ''}${cur ? ' is-live' : ''}`}
        style={{ '--n': code?.length ?? 4 } as CSSProperties}
        aria-label={code ? `Code: ${code.join(' ')}` : 'Awaiting command'}
      >
        {code
          ? code.map((d, i) => (
              <div key={i} className={`sc-box${i < progress ? ' is-done' : i === progress && playing ? ' is-next' : ''}`}>
                <Arrow dir={d} size={38} />
              </div>
            ))
          : [0, 1, 2, 3].map((i) => (
              <div key={i} className="sc-box is-idle">
                <span />
              </div>
            ))}
      </div>
      {hud.solvedCode && hud.solveSeq > 0 && (
        <div className="sc-ghost" key={hud.solveSeq} style={{ '--n': hud.solvedCode.length } as CSSProperties} aria-hidden="true">
          {hud.solvedCode.map((d, i) => (
            <div key={i} className="sc-box is-flash">
              <Arrow dir={d} size={38} />
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const dpad = (
    <div className="sc-dpad" role="group" aria-label="Direction pad">
      {DPAD.map((b) => (
        <button key={b.dir} type="button" className={`sc-dpad__btn ${b.cls}`} aria-label={b.label} onPointerDown={press(b.dir)} onContextMenu={(e) => e.preventDefault()}>
          <Arrow dir={b.dir} size={34} />
        </button>
      ))}
      <span className="sc-dpad__core" aria-hidden="true">
        <i />
      </span>
    </div>
  )

  const bottomStats = (
    <>
      <div className="sc-stat sc-stat--integrity">
        <Glyph name="shield" size={20} />
        <span className="sc-stat__body">
          <span className="sc-stat__label">{portrait ? 'Integrity' : 'Operational integrity'}</span>
          <Segs count={10} lit={Math.round(hud.integrity / 10)} tone={hud.integrity >= 60 ? 'ok' : hud.integrity >= 35 ? 'warn' : 'bad'} />
        </span>
        <b className="sc-stat__value">{hud.integrity}%</b>
      </div>
      <div className="sc-stat sc-stat--lives" aria-label={`${hud.lives} lives`}>
        <span className="sc-stat__label">Lives</span>
        <span className="sc-hearts">
          {Array.from({ length: START_LIVES }, (_, i) => (
            <Glyph key={i} name="heart" size={20} className={i < hud.lives ? 'on' : 'off'} />
          ))}
        </span>
      </div>
      <div className="sc-stat sc-stat--accuracy">
        <Glyph name="target" size={20} />
        <span className="sc-stat__body">
          <span className="sc-stat__label">Accuracy</span>
          <b className="sc-stat__value">{hud.accuracy}%</b>
        </span>
      </div>
    </>
  )

  const toast = hud.toast && inMission && (
    <div key={hud.toast.id} className={`sc-toast tone-${hud.toast.kind}`} role="status">
      <Glyph name={hud.toast.kind === 'bad' ? 'cross' : 'check'} size={26} />
      <span>
        <b>{hud.toast.text}</b>
        <small>{hud.toast.sub}</small>
      </span>
    </div>
  )

  return (
    <div className={`game-root signal-command layout-${layout} phase-${phase}${touch ? ' is-touch' : ''}${sheet ? ' sheet-open' : ''}`} style={style}>
      <div className="sc-bg" style={{ backgroundImage: `url(${portrait ? bgTall : bgWide})` }} aria-hidden="true" />
      <HomeButton />

      <div className="sc-shell">
        <header className="sc-top">
          <div className="sc-brand">
            <Emblem size={layout === 'desktop' ? 46 : 32} className="sc-brand__emblem" />
            <div className="sc-brand__text">
              <b>Puolustusvoimat</b>
              <span>Signal Command</span>
            </div>
            <p className="sc-strap">
              Communications
              <br />
              Networks
              <br />
              People
              <br />
              <em>A more secure Finland</em>
            </p>
          </div>

          <div className="sc-chips">
            <div className="sc-chip sc-chip--wave">
              <span className="sc-chip__label">{hud.endless ? 'Endless wave' : 'Mission wave'}</span>
              <span className="sc-chip__row">
                <b className="sc-chip__value">{hud.endless ? hud.wave : `${hud.wave}/${MISSION_WAVES}`}</b>
                <Segs count={MISSION_WAVES} lit={Math.min(MISSION_WAVES, hud.wavesCleared)} tone="ok" />
              </span>
              <span className="sc-chip__sub">{waveSector.name}</span>
            </div>
            <div className="sc-chip sc-chip--score">
              <span className="sc-chip__label">Score</span>
              <b className="sc-chip__value">{String(score).padStart(6, '0')}</b>
              {hud.gain && inMission && (
                <span key={hud.gain.id} className="sc-gain">
                  +{hud.gain.amount}
                </span>
              )}
            </div>
            <div className={`sc-chip sc-chip--combo${hud.combo >= 8 ? ' is-hot' : ''}`}>
              <span className="sc-chip__label">Combo</span>
              <b className="sc-chip__value">x{hud.combo}</b>
            </div>
            <div className={`sc-chip sc-chip--time tone-${timeTone}`}>
              <span className="sc-chip__label">Time</span>
              <span className="sc-chip__row">
                <b className="sc-chip__value">{formatTime(hud.timeLeft)}</b>
                <svg className="sc-gauge" viewBox="0 0 32 32" aria-hidden="true">
                  <circle cx="16" cy="16" r="13" className="sc-gauge__track" />
                  <circle cx="16" cy="16" r="13" className="sc-gauge__fill" style={{ strokeDasharray: `${frac * gaugeLen} ${gaugeLen}` }} />
                </svg>
              </span>
            </div>
            <div className="sc-chip sc-chip--mini sc-chip--lives">
              <span className="sc-chip__label">Lives</span>
              <span className="sc-hearts">
                {Array.from({ length: START_LIVES }, (_, i) => (
                  <Glyph key={i} name="heart" size={14} className={i < hud.lives ? 'on' : 'off'} />
                ))}
              </span>
            </div>
            <div className="sc-chip sc-chip--mini sc-chip--acc">
              <span className="sc-chip__label">Acc</span>
              <b className="sc-chip__value">{hud.accuracy}%</b>
            </div>
            <div className="sc-top__btns">
              <button type="button" className="btn btn--icon sc-iconbtn" aria-label={phase === 'paused' ? 'Resume' : 'Pause'} title="Pause (Esc)" onClick={togglePause}>
                <Glyph name="pause" size={20} />
              </button>
              <MuteButton className="sc-iconbtn" />
            </div>
          </div>
        </header>

        {!portrait && (
          <aside className="sc-left">
            <NetworkPanel mapRef={mapRef} counts={hud.counts} />
            <IncidentsPanel incidents={hud.incidents} timeLeft={hud.timeLeft} compact={landscape} />
          </aside>
        )}

        <main className="sc-centre sc-panel" onPointerDown={onPanelDown} onPointerMove={onPanelMove} onPointerUp={onPanelUp} onPointerCancel={onPanelUp}>
          <canvas ref={canvasRef} className="sc-fx" aria-hidden="true" />
          <div className="sc-cmd">
            <header className="sc-cmd__head">
              <span className="sc-cmd__glyph">
                <Glyph name={cur?.glyph ?? 'node'} size={44} strokeWidth={1.8} />
              </span>
              <div className="sc-cmd__title">
                <h1>{cur ? cur.name : clearing ? 'WAVE CLEAR' : inMission ? 'STAND BY' : 'AWAITING COMMAND'}</h1>
                <span className="sc-cmd__rule" />
                <div className="sc-cmd__brief">
                  <b>{cur ? `${cur.location} – ${cur.incident}` : inMission ? waveSector.name : 'Signals operator on duty'}</b>
                  <span>{cur ? cur.brief : inMission ? 'Sector secured – next wave incoming.' : 'Enter each command code before the wave timer runs out.'}</span>
                </div>
              </div>
              <div className="sc-cmd__photo" style={{ backgroundImage: `url(${sector.photo})` }} aria-label={sector.name}>
                <span>{sector.label}</span>
              </div>
            </header>

            <ol className="sc-steps">
              {(cur?.steps ?? ['ROUTE', 'SYNC', 'CALIBRATE', 'RESTORE']).map((label, i) => (
                <li key={i} className={stepsDone[i] ? 'is-done' : i === activeStep && playing ? 'is-active' : undefined}>
                  <span className="sc-steps__num">{stepsDone[i] ? <Glyph name="check" size={12} /> : i + 1}</span>
                  <span className="sc-steps__label">{label}</span>
                </li>
              ))}
            </ol>

            {arrowRow}

            <div className={`sc-timebar tone-${timeTone}`} role="progressbar" aria-label="Wave time" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
              <span className="sc-timebar__track">
                <i style={{ width: `${frac * 100}%` }} />
              </span>
              <b>{inMission ? `${hud.timeLeft.toFixed(1)}s` : '--'}</b>
            </div>

            <div className="sc-feedback-zone">
              {hud.feedback && inMission && (
                <div key={hud.feedback.id} className={`sc-feedback kind-${hud.feedback.kind}`} aria-live="polite">
                  <b>{hud.feedback.text}</b>
                  <span>{hud.feedback.sub}</span>
                </div>
              )}
              {hud.hint && playing && (!hud.feedback || hud.feedback.kind === 'miss') && <p className="sc-hint">{hud.hint}</p>}
              {portrait && toast}
            </div>

            {dpad}

            <p className="sc-slogan sc-slogan--l" aria-hidden="true">
              Reaction
              <br />
              speed
              <br />
              keeps
              <br />
              Finland
              <br />
              connected
            </p>
            <p className="sc-slogan sc-slogan--r" aria-hidden="true">
              Communications
              <br />
              enables
              <br />
              readiness
            </p>
          </div>

          {hud.interlude && phase === 'interlude' && (
            <div className={`sc-interlude kind-${hud.interlude.kind}`} style={{ backgroundImage: `url(${SECTOR_BY_ID[hud.interlude.sectorId].photo})` }} role="status">
              <div className="sc-interlude__card">
                <span className="sc-interlude__eyebrow">
                  {hud.interlude.kind === 'complete' ? 'Mission complete' : hud.interlude.kind === 'retry' ? `Wave ${hud.interlude.wave} – restart` : hud.interlude.wave > MISSION_WAVES ? `Endless wave ${hud.interlude.wave}` : `Wave ${hud.interlude.wave} / ${MISSION_WAVES}`}
                </span>
                <h2>{hud.interlude.kind === 'complete' ? 'All sectors secured' : hud.interlude.sectorName}</h2>
                <p>
                  {hud.interlude.kind === 'complete'
                    ? 'Preparing debrief'
                    : hud.interlude.kind === 'retry'
                      ? `Integrity -${hud.interlude.loss} % · fresh codes incoming`
                      : `${hud.interlude.count} incoming incidents`}
                </p>
              </div>
            </div>
          )}
        </main>

        {!portrait && (
          <aside className="sc-right">
            <NextCommandsPanel queue={hud.queue} limit={landscape ? 3 : 4} />
            <SystemsPanel systems={hud.systems} />
          </aside>
        )}
        {portrait && (
          <div className="sc-strip">
            <NextCommandsPanel queue={hud.queue} strip />
          </div>
        )}

        <footer className="sc-bottom">
          {bottomStats}
          {!portrait && toast}
          {portrait && (
            <button type="button" className={`sc-statusbtn${hud.counts.incident > 0 ? ' has-incidents' : ''}`} onClick={() => setSheet((s) => !s)} aria-expanded={sheet}>
              <Glyph name="alert" size={16} />
              Status
              <b>{hud.counts.incident}</b>
            </button>
          )}
        </footer>
      </div>

      {portrait && sheet && (
        <div className="sc-sheet" role="dialog" aria-label="Network status">
          <div className="sc-sheet__scrim" onClick={() => setSheet(false)} />
          <div className="sc-sheet__body">
            <header className="sc-sheet__head">
              <h2>Network status</h2>
              <button type="button" className="btn btn--icon sc-iconbtn" aria-label="Close" onClick={() => setSheet(false)}>
                <Glyph name="cross" size={18} />
              </button>
            </header>
            <div className="sc-sheet__scroll">
              <NetworkPanel mapRef={mapRef} counts={hud.counts} />
              <IncidentsPanel incidents={hud.incidents} timeLeft={hud.timeLeft} />
              <SystemsPanel systems={hud.systems} />
            </div>
          </div>
        </div>
      )}

      {phase === 'start' && (
        <Overlay
          className="sc-overlay"
          eyebrow={meta.company}
          title={meta.title}
          subtitle={
            <span className="sc-overlay__sub">
              <Emblem size={56} />
              <span>{meta.tagline} A more secure Finland.</span>
            </span>
          }
          howto={
            <>
              <strong>Enter the command codes.</strong> Each incident on the network is fixed by a code – a sequence of arrows. Type them in order with{' '}
              <span className="sc-keys">
                <i>
                  <Arrow dir="left" size={12} />
                </i>
                <i>
                  <Arrow dir="up" size={12} />
                </i>
                <i>
                  <Arrow dir="down" size={12} />
                </i>
                <i>
                  <Arrow dir="right" size={12} />
                </i>
              </span>{' '}
              / WASD, the D-pad or swipes before the wave timer runs out. A wrong arrow resets the code; flawless chains build the <strong>combo</strong> up to x12.
            </>
          }
          stats={hud.best > 0 ? [{ label: 'Best score', value: formatScore(hud.best) }] : undefined}
        >
          <button type="button" className="btn btn--primary" onClick={begin} autoFocus>
            PLAY ▶
          </button>
        </Overlay>
      )}

      {phase === 'paused' && (
        <Overlay
          className="sc-overlay"
          eyebrow={`Wave ${hud.wave} · ${hud.sectorName}`}
          title="Paused"
          subtitle="The network holds its breath. Arrow keys / WASD, the D-pad or swipes enter the code · Esc resumes."
          stats={[
            { label: 'Score', value: formatScore(hud.score) },
            { label: 'Time left', value: formatTime(hud.timeLeft) },
            { label: 'Lives', value: hud.lives },
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
          <button type="button" className="btn" onClick={begin}>
            Restart mission
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}

      {(phase === 'complete' || phase === 'failed') && hud.debrief && (
        <Overlay
          className={`sc-overlay sc-debrief${hud.debrief.won ? ' is-won' : ' is-lost'}`}
          eyebrow={hud.debrief.won ? 'Mission complete' : 'Mission failed'}
          title="Debrief"
          subtitle={hud.debrief.reason}
          stats={[
            { label: 'Score', value: formatScore(hud.debrief.score) },
            { label: hud.debrief.isBest ? 'New best!' : 'Best', value: formatScore(hud.debrief.best) },
            { label: 'Waves cleared', value: hud.debrief.waves },
            { label: 'Accuracy', value: `${hud.debrief.accuracy} %` },
            { label: 'Best combo', value: `x${hud.debrief.bestCombo}` },
            { label: 'Perfect waves', value: hud.debrief.perfectWaves },
          ]}
        >
          {hud.debrief.won && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                sfx.unlock()
                sfx.play('click')
                engineRef.current?.continueEndless()
              }}
              autoFocus
            >
              Continue · endless ▶
            </button>
          )}
          <button type="button" className={`btn${hud.debrief.won ? '' : ' btn--primary'}`} onClick={begin} autoFocus={!hud.debrief.won}>
            Play again
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}
    </div>
  )
}
