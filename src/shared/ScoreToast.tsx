import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { gameBySlug } from '../games'
import { checkName, getOnlineState, listenForScores, onReportedScore, submitScore, type ScoreResult } from './online'
import './ScoreToast.css'

type Toast =
  | { kind: 'prompt'; game: string; score: number }
  | { kind: 'result'; game: string; score: number; result: ScoreResult }

const RESULT_MS = 6_000
/** The name prompt needs reading and typing, so it waits a little longer. */
const PROMPT_MS = 10_000
/** While the toast is hovered or focused, look again after this long instead of hiding. */
const RECHECK_MS = 1_500
const SKIP_KEY = 'havaida-games:online:skip-prompt'

const fmt = (n: number) => n.toLocaleString('en-US')

function promptSkipped(): boolean {
  try {
    return sessionStorage.getItem(SKIP_KEY) === '1'
  } catch {
    return false
  }
}

function rememberSkip(): void {
  try {
    sessionStorage.setItem(SKIP_KEY, '1')
  } catch {
    /* the prompt simply comes back next time */
  }
}

function Trophy() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M16 6h3v1.5A3.5 3.5 0 0 1 15.5 11M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11" />
      <path d="M12 13v4M8.5 20h7M10 17h4l.5 3h-5z" />
    </svg>
  )
}

/**
 * Leaderboard toast, mounted once in App. Games never talk to it directly: `submitBest()`
 * dispatches `havaida:score`, `online.ts` debounces it, and this card either asks for a name
 * (first time) or submits and shows the rank. Sits above game overlays, top centre.
 */
export function ScoreToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  /**
   * Is the player using the toast right now? Read from the DOM rather than tracked with
   * enter/leave events: those never fire when the card shrinks away from a resting pointer.
   * Phones keep `:hover` on whatever was tapped last, so hover only counts with a real pointer.
   */
  const engaged = () => {
    const el = rootRef.current
    if (!el) return false
    const canHover = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches
    return el.contains(document.activeElement) || (canHover && el.matches(':hover'))
  }

  const close = () => {
    setToast(null)
    setBusy(false)
    setError(null)
  }

  const showResult = (game: string, score: number, result: ScoreResult) => {
    // the result card should auto-hide even though the Save button had the focus
    if (document.activeElement instanceof HTMLElement && rootRef.current?.contains(document.activeElement)) {
      document.activeElement.blur()
    }
    setError(null)
    setToast({ kind: 'result', game, score, result })
  }

  useEffect(() => {
    const stopListening = listenForScores()
    const stopReports = onReportedScore(async ({ game, score }) => {
      // the player is typing a name for an earlier score – don't pull the form away
      if (rootRef.current?.contains(document.activeElement) || getOnlineState().status === 'offline') return
      if (!getOnlineState().name) {
        if (promptSkipped()) return
        setError(null)
        setBusy(false)
        setToast({ kind: 'prompt', game, score })
        return
      }
      const res = await submitScore(game, score)
      if (res.ok) {
        showResult(game, score, res.data)
      } else if (!res.offline && (res.error === 'invalid-name' || res.error === 'blocked-name')) {
        // the saved name no longer passes the server's rules – ask for a new one
        setName(getOnlineState().name)
        setError(res.message ?? 'Please pick another name.')
        setToast({ kind: 'prompt', game, score })
      }
    })
    return () => {
      stopListening()
      stopReports()
    }
  }, [])

  // Auto-hide after ~6 s (prompt: 10 s) – unless the player is hovering or typing at that moment.
  useEffect(() => {
    if (!toast || busy) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (engaged()) timer = setTimeout(tick, RECHECK_MS)
      else close()
    }
    timer = setTimeout(tick, toast.kind === 'prompt' ? PROMPT_MS : RESULT_MS)
    return () => clearTimeout(timer)
  }, [toast, busy])

  if (!toast) return null

  const meta = gameBySlug(toast.game)
  const title = meta?.title ?? toast.game
  const style = { '--accent': meta?.accent ?? '#2f80ff', '--accent-2': meta?.accent2 ?? '#ffd43b' } as CSSProperties

  // Games listen for keys on window – keep typing in the toast from steering the game.
  const isolateKeys = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') close()
  }
  const shared = {
    ref: rootRef,
    style,
    onKeyDown: isolateKeys,
    onKeyUp: (e: KeyboardEvent) => e.stopPropagation(),
  }

  if (toast.kind === 'prompt') {
    const save = async (e: FormEvent) => {
      e.preventDefault()
      if (busy) return
      const checked = checkName(name)
      if (!checked.ok) {
        setError(checked.message)
        return
      }
      setBusy(true)
      setError(null)
      const res = await submitScore(toast.game, toast.score, checked.name)
      setBusy(false)
      if (res.ok) showResult(toast.game, toast.score, res.data)
      else if (res.offline) setError('Could not reach the leaderboard – try again in a minute.')
      else setError(res.message ?? 'That did not work – please try again.')
    }
    return (
      <div className="score-toast score-toast--prompt" role="dialog" aria-label="Save your score to the leaderboard" {...shared}>
        <span className="score-toast__icon">
          <Trophy />
        </span>
        <form className="score-toast__body" onSubmit={save} noValidate>
          <p className="score-toast__title">
            Save <b>{fmt(toast.score)}</b> to the leaderboard
          </p>
          <p className="score-toast__sub">{title} · pick a name other players will see</p>
          <div className="score-toast__form">
            <input
              className="score-toast__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              aria-label="Your name"
              aria-invalid={error ? true : undefined}
              maxLength={16}
              autoComplete="nickname"
              autoCapitalize="words"
              spellCheck={false}
              enterKeyHint="done"
            />
            <button type="submit" className="score-toast__btn score-toast__btn--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="score-toast__btn"
              onClick={() => {
                rememberSkip()
                close()
              }}
            >
              Skip
            </button>
          </div>
          {error && (
            <p className="score-toast__error" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    )
  }

  const { rank, total, best, improved } = toast.result
  return (
    <div className="score-toast" role="status" aria-live="polite" {...shared}>
      <span className={`score-toast__icon${rank <= 3 ? ` score-toast__icon--top${rank}` : ''}`}>
        <Trophy />
      </span>
      <div className="score-toast__body">
        <p className="score-toast__title">
          #{fmt(rank)} of {fmt(total)} · {title}
        </p>
        <p className="score-toast__sub">
          <b>{fmt(toast.score)}</b>
          {' · '}
          {improved ? <span className="score-toast__new">New best!</span> : <>Your best {fmt(best)}</>}
        </p>
      </div>
      <div className="score-toast__side">
        <button type="button" className="score-toast__close" aria-label="Close" onClick={close}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <Link className="score-toast__link" to={`/leaderboard/${toast.game}`} onClick={close}>
          Leaderboard →
        </Link>
      </div>
    </div>
  )
}
