import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { gameBySlug } from '../../games'
import { HomeButton } from '../../shared/HomeButton'
import { MuteButton } from '../../shared/MuteButton'
import { Overlay } from '../../shared/Overlay'
import { sfx } from '../../shared/sfx'
import { useEngine } from '../../shared/useEngine'
import { Engine, MAX_HEARTS, floorLabel, initialHud, type HudState, type Phase, type Popup } from './engine'
import { BADGE_INFO, BADGE_ORDER, type Badge, type BadgeIcon, type FaceSpec } from './types'
import './access-crossing.css'

/* ---------- small inline icons (HTML HUD only) ---------------------------------------- */

function StarIcon() {
  return (
    <svg className="ac-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" fill="#ffd43b" stroke="#b8860b" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function CoinIcon() {
  return (
    <svg className="ac-ico" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="#f5c518" stroke="#b8860b" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="#fff3b0" strokeWidth="2" />
    </svg>
  )
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg className={`ac-heart${filled ? '' : ' ac-heart--empty'}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s-7.5-4.6-9.5-9.3C1 8 3.2 4.5 6.8 4.5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.6 0 5.8 3.5 4.3 7.2C19.5 16.4 12 21 12 21z" />
    </svg>
  )
}

/** Escort shield: a guard's cap inside a shield, shown next to the hearts while it is held. */
function ShieldIcon() {
  return (
    <svg className="ac-shield" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5z" fill="#2f80ff" stroke="#cfe3ff" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M7.5 11.5c0-2.6 2-4.3 4.5-4.3s4.5 1.7 4.5 4.3z" fill="#fff" />
      <rect x="6.3" y="11.2" width="11.4" height="2.2" rx="1.1" fill="#fff" />
    </svg>
  )
}

function MagnetIcon() {
  return (
    <svg className="ac-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4v8a7 7 0 0 0 14 0V4h-5v8a2 2 0 0 1-4 0V4z" fill="#e63946" />
      <rect x="5" y="4" width="5" height="4" fill="#eef2f8" />
      <rect x="14" y="4" width="5" height="4" fill="#eef2f8" />
    </svg>
  )
}

function BadgeGlyph({ icon }: { icon: BadgeIcon }) {
  switch (icon) {
    case 'person':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="4" fill="#fff" />
          <path d="M4 21c1-5 4-7 8-7s7 2 8 7z" fill="#fff" />
        </svg>
      )
    case 'people':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="3.2" fill="#fff" />
          <circle cx="16" cy="9" r="2.8" fill="#fff" />
          <path d="M2 20c.8-4 3.4-6 6.5-6s5.7 2 6.5 6z" fill="#fff" />
          <path d="M14 20c.4-3 2-5 4.5-5 2 0 3.3 1.6 3.5 5z" fill="#fff" opacity="0.85" />
        </svg>
      )
    case 'helmet':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 15a8 8 0 0 1 16 0z" fill="#fff" />
          <rect x="2" y="15" width="20" height="3.5" rx="1.5" fill="#fff" />
        </svg>
      )
    case 'crown':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 18 2 7l5.5 4L12 4l4.5 7L22 7l-1 11z" fill="#fff" />
        </svg>
      )
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5z" fill="#fff" />
        </svg>
      )
  }
}

/* ---------- visitor face (procedural SVG cartoon) ------------------------------------- */

function Face({ f }: { f: FaceSpec }) {
  const hair = (() => {
    switch (f.hairStyle) {
      case 0:
        return <rect x="22" y="16" width="36" height="14" rx="7" fill={f.hair} />
      case 1:
        return (
          <>
            <rect x="22" y="16" width="36" height="12" rx="6" fill={f.hair} />
            <path d="M22 28c6-6 12-8 20-6-8 2-14 6-16 10z" fill={f.hair} />
          </>
        )
      case 2:
        return (
          <>
            <rect x="21" y="16" width="38" height="14" rx="7" fill={f.hair} />
            <rect x="20" y="24" width="8" height="26" rx="4" fill={f.hair} />
            <rect x="52" y="24" width="8" height="26" rx="4" fill={f.hair} />
          </>
        )
      case 3:
        return (
          <>
            <rect x="22" y="17" width="36" height="12" rx="6" fill={f.hair} />
            <circle cx="40" cy="13" r="7" fill={f.hair} />
          </>
        )
      default:
        return <rect x="24" y="19" width="32" height="6" rx="3" fill={f.hair} opacity="0.7" />
    }
  })()
  return (
    <svg className="ac-face" viewBox="0 0 80 80" aria-hidden="true">
      <rect width="80" height="80" fill={f.bg} />
      <path d="M12 80c2-14 12-20 28-20s26 6 28 20z" fill={f.shirt} />
      <rect x="34" y="48" width="12" height="12" fill={f.skin} />
      <rect x="22" y="18" width="36" height="36" rx="9" fill={f.skin} />
      {hair}
      {f.beard && <path d="M26 44c2 8 7 12 14 12s12-4 14-12c-4 3-8 4-14 4s-10-1-14-4z" fill={f.hair} />}
      <circle cx="33" cy="36" r="2.2" fill="#1b2238" />
      <circle cx="47" cy="36" r="2.2" fill="#1b2238" />
      <path d="M34 45q6 4 12 0" fill="none" stroke="#1b2238" strokeWidth="2" strokeLinecap="round" />
      {f.glasses && (
        <g fill="none" stroke="#1b2238" strokeWidth="2">
          <circle cx="33" cy="36" r="5.5" />
          <circle cx="47" cy="36" r="5.5" />
          <path d="M38.5 36h3" />
        </g>
      )}
    </svg>
  )
}

/* ---------- popups -------------------------------------------------------------------- */

type EngineRef = RefObject<Engine | null>

/** The run pauses behind these popups; keys pressed for running must not answer them by accident. */
const POPUP_KEY_GRACE_MS = 350

function PinPopup({ popup, engineRef }: { popup: Extract<Popup, { kind: 'pin' }>; engineRef: EngineRef }) {
  const [digits, setDigits] = useState('')
  const [shake, setShake] = useState(popup.attempt > 0)
  // The typed digits also live in a ref so keyboard handlers never see a stale closure.
  const digitsRef = useRef('')

  const setTyped = useCallback((next: string) => {
    digitsRef.current = next
    setDigits(next)
  }, [])

  const submit = useCallback(
    (code: string) => {
      const engine = engineRef.current
      if (code.length !== 4 || !engine) return
      const r = engine.submitPin(code)
      if (r === 'wrong') {
        setTyped('')
        setShake(true)
      }
    },
    [engineRef, setTyped],
  )

  // The 4th digit submits on its own – the note is right there, no need for a confirm tap.
  const press = useCallback(
    (d: string) => {
      sfx.unlock()
      sfx.play('click')
      const cur = digitsRef.current
      if (cur.length >= 4) return
      const next = cur + d
      setTyped(next)
      if (next.length === 4) submit(next)
    },
    [setTyped, submit],
  )

  const erase = useCallback(() => setTyped(digitsRef.current.slice(0, -1)), [setTyped])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        press(e.key)
        e.preventDefault()
      } else if (e.key === 'Backspace') {
        erase()
        e.preventDefault()
      } else if (e.key === 'Enter') {
        submit(digitsRef.current)
        e.preventDefault()
      } else if (e.key === 'Escape') {
        engineRef.current?.dismissPopup()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, erase, submit, engineRef])

  return (
    <div className="ac-popup" role="dialog" aria-modal="true" aria-label="Enter PIN">
      <div className="ac-popup__card ac-popup__card--pin">
        <div className="ac-popup__eyebrow">Keypad gate</div>
        <h2 className="ac-popup__title">ENTER PIN</h2>
        <div className="ac-note ac-note--big">
          <span>Your note says</span>
          <b>{popup.code}</b>
        </div>
        <div className={`ac-pin-digits${shake ? ' ac-shake' : ''}`} onAnimationEnd={() => setShake(false)}>
          {[0, 1, 2, 3].map((i) => (
            <div className={`ac-pin-digit${digits[i] ? ' ac-pin-digit--filled' : ''}`} key={i}>
              {digits[i] ? '•' : ''}
            </div>
          ))}
        </div>
        <div className="ac-popup__tries">
          {popup.triesLeft} {popup.triesLeft === 1 ? 'try' : 'tries'} left · +30 coins
        </div>
        <div className="ac-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button type="button" className="ac-key" key={d} onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button type="button" className="ac-key ac-key--del" onClick={erase} aria-label="Delete">
            ⌫
          </button>
          <button type="button" className="ac-key" onClick={() => press('0')}>
            0
          </button>
          <button type="button" className="ac-key ac-key--ok" onClick={() => submit(digitsRef.current)} aria-label="Confirm">
            ✓
          </button>
        </div>
      </div>
    </div>
  )
}

function VisitorPopup({ popup, engineRef }: { popup: Extract<Popup, { kind: 'visitor' }>; engineRef: EngineRef }) {
  const v = popup.visitor
  const decide = useCallback(
    (letIn: boolean) => {
      sfx.unlock()
      engineRef.current?.decideVisitor(letIn)
    },
    [engineRef],
  )
  useEffect(() => {
    const openedAt = performance.now()
    const onKey = (e: KeyboardEvent) => {
      if (performance.now() - openedAt < POPUP_KEY_GRACE_MS) return
      if (e.key === 'y' || e.key === 'Y') decide(true)
      else if (e.key === 'n' || e.key === 'N') decide(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decide])
  return (
    <div className="ac-popup" role="dialog" aria-modal="true" aria-label="Identify visitor">
      <div className="ac-popup__card ac-popup__card--visitor">
        <div className="ac-popup__eyebrow">Reception</div>
        <h2 className="ac-popup__title">IDENTIFY VISITOR</h2>
        <div className="ac-visitor">
          <Face f={v.face} />
          <div className="ac-visitor__rows">
            <div className="ac-row">
              <span>Name</span>
              <b>{v.name}</b>
            </div>
            <div className="ac-row">
              <span>Company</span>
              <b>{v.company}</b>
            </div>
            <div className="ac-row">
              <span>Purpose</span>
              <b>{v.purpose}</b>
            </div>
            <div className="ac-row">
              <span>Appointment</span>
              <b className={`ac-pill ${v.appointment ? 'ac-pill--yes' : 'ac-pill--no'}`}>{v.appointment ? 'YES' : 'NO'}</b>
            </div>
            <div className="ac-row">
              <span>Photo ID matches</span>
              <b className={`ac-pill ${v.idMatches ? 'ac-pill--yes' : 'ac-pill--no'}`}>{v.idMatches ? 'YES' : 'NO'}</b>
            </div>
          </div>
        </div>
        <p className="ac-popup__hint">
          Let in only with an appointment <em>and</em> a matching photo ID.
        </p>
        <div className="ac-decide">
          <button type="button" className="btn btn--primary ac-btn--yes" onClick={() => decide(true)}>
            ✓ Let in
          </button>
          <button type="button" className="btn btn--primary ac-btn--no" onClick={() => decide(false)}>
            ✗ Deny
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- the game component -------------------------------------------------------- */

export default function AccessCrossing() {
  const meta = gameBySlug('access-crossing')!
  const [hud, setHud] = useState<HudState>(initialHud)
  const [phase, setPhase] = useState<Phase>('start')
  const [popup, setPopup] = useState<Popup | null>(null)
  // The score changes many times per second while running, so the engine writes it straight
  // into this node instead of re-rendering the HUD through React.
  const scoreRef = useRef<HTMLSpanElement>(null)
  const create = useCallback(
    (canvas: HTMLCanvasElement) =>
      new Engine(canvas, {
        onHud: setHud,
        onPhase: setPhase,
        onPopup: setPopup,
        onScore: (score) => {
          if (scoreRef.current) scoreRef.current.textContent = String(score)
        },
      }),
    [],
  )
  const { canvasRef, engineRef } = useEngine(create)
  const style = { '--accent': meta.accent, '--accent-2': meta.accent2, '--bg': meta.bg } as CSSProperties

  const play = () => {
    sfx.unlock()
    engineRef.current?.start()
  }

  return (
    <div className="game-root access-crossing" style={style}>
      <canvas ref={canvasRef} className="game-canvas" aria-label="Access Crossing game" />
      <HomeButton />

      <div className="hud">
        <div className="hud__row ac-hud-top">
          <div className="ac-hud-group">
            {phase === 'playing' && (
              <button type="button" className="btn btn--icon ac-tool" aria-label="Pause" title="Pause (Esc)" onClick={() => engineRef.current?.pause()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="5" y="4" width="5" height="16" rx="1.5" />
                  <rect x="14" y="4" width="5" height="16" rx="1.5" />
                </svg>
              </button>
            )}
            <div className="chip ac-chip" title="Score">
              <StarIcon />
              <span className="chip__value" ref={scoreRef}>
                0
              </span>
            </div>
            <div className="chip ac-chip" title="Coins">
              <CoinIcon />
              {/* re-mounted on every coin so the bump animation replays */}
              <span className="chip__value ac-bump" key={hud.coins}>
                {hud.coins}
              </span>
            </div>
          </div>
          <div className="ac-hud-right">
            <div
              className={`chip ac-chip ac-hearts${hud.hearts < MAX_HEARTS ? ' ac-hearts--hit' : ''}`}
              key={hud.hearts}
              title="Hearts"
              aria-label={`${hud.hearts} of ${MAX_HEARTS} hearts${hud.shield ? ', escort shield' : ''}`}
            >
              {Array.from({ length: MAX_HEARTS }, (_, i) => (
                <HeartIcon filled={i < hud.hearts} key={i} />
              ))}
              {hud.shield && <ShieldIcon />}
            </div>
            <div className="ac-hud-group">
              <div className="chip ac-chip ac-floor">
                <span className="chip__value">{floorLabel(hud.floor)}</span>
              </div>
              <MuteButton className="ac-tool" />
            </div>
          </div>
        </div>

        {hud.toast && phase === 'playing' && (
          <div className={`ac-toast ac-toast--${hud.toast.kind}`} key={hud.toast.id} role="status">
            {hud.toast.text}
          </div>
        )}

        {/* Bottom corners only: the lanes around the runner stay clear. */}
        <div className="ac-hud-bottom">
          <div className="ac-hud-group ac-hud-inventory">
            <div className="ac-badges" aria-label="Badges held">
              {hud.badges.map((b: Badge) => (
                <div className="ac-badge" key={b} style={{ '--c': BADGE_INFO[b].color } as CSSProperties} title={`${BADGE_INFO[b].name} badge`}>
                  <BadgeGlyph icon={BADGE_INFO[b].icon} />
                  <span>{BADGE_INFO[b].name}</span>
                </div>
              ))}
            </div>
            {hud.pinNote && (
              <div className="ac-note" title="PIN note">
                <span>PIN</span>
                <b>{hud.pinNote}</b>
              </div>
            )}
          </div>
          {hud.magnet > 0 && (
            <div className="chip ac-chip ac-power" title="Coin magnet">
              <MagnetIcon />
              <span className="chip__value">{hud.magnet}s</span>
            </div>
          )}
        </div>

        {hud.hint && phase === 'playing' && !popup && (
          <div className="ac-hint" aria-hidden="true">
            <b>← →</b> lane <i>·</i> <b>↑</b> jump <i>·</i> <b>↓</b> slide
          </div>
        )}
      </div>

      {phase === 'start' && (
        <Overlay
          className="ac-start"
          eyebrow={meta.company}
          title={meta.title}
          subtitle={meta.tagline}
          howto={
            <>
              <p className="ac-howto">
                <strong>Swipe ← →</strong> to change lane, <strong>↑</strong> jump, <strong>↓</strong> slide (arrows / WASD). Run through the{' '}
                <strong>gate your badge opens</strong>, dodge the red <strong>camera cone</strong>, grab <strong>PIN notes</strong>, check visitors at reception and
                take the <strong>elevator</strong> up.
              </p>
              <div className="ac-legend" aria-label="Badge colours">
                {BADGE_ORDER.map((b) => (
                  <div className="ac-legend__item" key={b} style={{ '--c': BADGE_INFO[b].color } as CSSProperties}>
                    <div className="ac-badge ac-badge--mini">
                      <BadgeGlyph icon={BADGE_INFO[b].icon} />
                    </div>
                    <small>{BADGE_INFO[b].name}</small>
                  </div>
                ))}
              </div>
            </>
          }
          stats={hud.best > 0 ? [{ label: 'Best', value: hud.best }] : undefined}
        >
          <button type="button" className="btn btn--primary" onClick={play} autoFocus>
            PLAY ▶
          </button>
        </Overlay>
      )}

      {phase === 'paused' && (
        <Overlay eyebrow={meta.company} title="Paused" subtitle={`${floorLabel(hud.floor)} · score ${hud.score}`}>
          <button type="button" className="btn btn--primary" onClick={() => engineRef.current?.resume()} autoFocus>
            Resume
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}

      {phase === 'over' && (
        <Overlay
          className="ac-over"
          eyebrow={meta.company}
          title="Security caught you!"
          subtitle={hud.score >= hud.best && hud.score > 0 ? 'New best score!' : 'Right people. Right access. Try again.'}
          stats={[
            { label: 'Score', value: hud.score },
            { label: 'Best', value: hud.best },
            { label: 'Floor', value: hud.floor },
            { label: 'Coins', value: hud.coins },
            { label: 'Badges', value: hud.badges.length },
          ]}
        >
          <button type="button" className="btn btn--primary" onClick={play} autoFocus>
            Play again
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}

      {popup?.kind === 'pin' && <PinPopup popup={popup} engineRef={engineRef} key={`pin-${popup.attempt}`} />}
      {popup?.kind === 'visitor' && <VisitorPopup popup={popup} engineRef={engineRef} />}
    </div>
  )
}
