import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { GAMES, gameBySlug, type GameMeta } from '../games'
import { fetchBoards, fetchLeaderboard, setPlayerName, useOnline, type Board, type Boards, type Entry } from '../shared/online'
import './Leaderboard.css'

export const LIVE_SITE = 'https://havaida-games.netlify.app/'

/** Rows shown before "Show top 50". */
const COLLAPSED_ROWS = 10

type Load<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error' }

const fmt = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`
const accentStyle = (g: GameMeta | undefined) =>
  ({ '--lb-accent': g?.accent ?? '#2f80ff', '--lb-accent-2': g?.accent2 ?? '#ffd43b' }) as CSSProperties
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`
  const date = new Date(ts)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

function Row({ entry, compact = false }: { entry: Entry; compact?: boolean }) {
  const cls = ['hub-lb-row']
  if (entry.rank <= 3) cls.push(`hub-lb-row--top${entry.rank}`)
  if (entry.you) cls.push('hub-lb-row--you')
  if (compact) cls.push('hub-lb-row--compact')
  return (
    <li className={cls.join(' ')}>
      <span className="hub-lb-row__rank">{fmt(entry.rank)}</span>
      <span className="hub-lb-row__name">
        <span className="hub-lb-row__text">{entry.name}</span>
        {entry.you && <span className="hub-lb-row__you">You</span>}
      </span>
      <span className="hub-lb-row__score">{fmt(entry.score)}</span>
      {!compact && <span className="hub-lb-row__when">{timeAgo(entry.ts)}</span>}
    </li>
  )
}

function LoadingRows({ rows = 5, compact = false }: { rows?: number; compact?: boolean }) {
  return (
    <ol className="hub-lb-rows" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={`hub-lb-row hub-lb-row--skeleton${compact ? ' hub-lb-row--compact' : ''}`}>
          <span className="hub-lb-skel" style={{ width: `${70 - i * 9}%` }} />
        </li>
      ))}
    </ol>
  )
}

function Empty({ game, compact = false }: { game: GameMeta; compact?: boolean }) {
  return (
    <div className={`hub-lb-empty${compact ? ' hub-lb-empty--compact' : ''}`}>
      <p>No scores yet – be the first!</p>
      <Link to={`/${game.slug}`} className="hub-lb-empty__play">
        Play ▶
      </Link>
    </div>
  )
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="hub-lb__message">
      <p>The leaderboard could not be loaded just now.</p>
      <button type="button" className="hub-lb-board__more" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

/** "All games": the top 5 of every game from one request. */
function AllBoards({ load, onOpen, onRetry }: { load: Load<Boards>; onOpen: (slug: string) => void; onRetry: () => void }) {
  if (load.state === 'error') return <LoadError onRetry={onRetry} />
  return (
    <div className="hub-lb-grid">
      {GAMES.map((g) => {
        const board = load.state === 'ready' ? (load.data.boards[g.slug] ?? { entries: [], total: 0 }) : null
        return (
          <article key={g.slug} className="hub-lb-mini" style={accentStyle(g)}>
            <header className="hub-lb-mini__head">
              <h3 className="hub-lb-mini__title">{g.title}</h3>
              {board && <span className="hub-lb-mini__count">{plural(board.total, 'player')}</span>}
            </header>
            {!board ? (
              <LoadingRows rows={3} compact />
            ) : board.entries.length > 0 ? (
              <ol className="hub-lb-rows">
                {board.entries.map((e) => (
                  <Row key={e.rank} entry={e} compact />
                ))}
              </ol>
            ) : (
              <Empty game={g} compact />
            )}
            {board && board.total > 0 && (
              <button type="button" className="hub-lb-mini__more" onClick={() => onOpen(g.slug)}>
                Full leaderboard →
              </button>
            )}
          </article>
        )
      })}
    </div>
  )
}

/** One game: top 10 (expandable to 50) plus the viewer's own row when it is further down. */
function GameBoard({ game, load, onRetry }: { game: GameMeta; load: Load<Board>; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(false)
  if (load.state === 'loading') return <LoadingRows rows={6} />
  if (load.state === 'error') return <LoadError onRetry={onRetry} />
  const { entries, total, you } = load.data
  const visible = expanded ? entries : entries.slice(0, COLLAPSED_ROWS)
  const youBelow = you && you.rank > visible.length ? you : null
  return (
    <div className="hub-lb-board">
      <div className="hub-lb-board__bar">
        <span className="hub-lb-board__count">{plural(total, 'player')}</span>
        <Link to={`/${game.slug}`} className="hub-lb-board__play">
          Play {game.title} ▶
        </Link>
      </div>
      {entries.length === 0 ? (
        <Empty game={game} />
      ) : (
        <ol className="hub-lb-rows">
          {visible.map((e) => (
            <Row key={e.rank} entry={e} />
          ))}
          {youBelow && (
            <>
              <li className="hub-lb-rows__gap" aria-hidden="true">
                ···
              </li>
              <Row entry={youBelow} />
            </>
          )}
        </ol>
      )}
      {entries.length > COLLAPSED_ROWS && (
        <button type="button" className="hub-lb-board__more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? `Show top ${COLLAPSED_ROWS}` : `Show top ${entries.length}`}
        </button>
      )}
      {!you && entries.length > 0 && <p className="hub-lb-board__hint">Finish a round of {game.title} to get on the board.</p>}
    </div>
  )
}

function Tabs({ tab, onSelect }: { tab: string; onSelect: (key: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  // keep the selected tab visible in the horizontally scrolling strip (phones)
  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list || !active || list.scrollWidth <= list.clientWidth) return
    const left = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2
    list.scrollTo({ left: Math.max(0, left), behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [tab])
  const items = [{ key: 'all', label: 'All games', game: undefined }, ...GAMES.map((g) => ({ key: g.slug, label: g.title, game: g }))]
  return (
    <div className="hub-lb__tabs" role="tablist" aria-label="Choose a leaderboard" ref={listRef}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={tab === it.key}
          className={`hub-lb__tab${tab === it.key ? ' is-active' : ''}`}
          style={accentStyle(it.game)}
          onClick={() => onSelect(it.key)}
        >
          {it.game && <span className="hub-lb__tab-dot" aria-hidden="true" />}
          {it.label}
        </button>
      ))}
    </div>
  )
}

function Pencil() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  )
}

/** "Playing as <name> ✎" – renames every leaderboard row of this player. */
function NameEditor({ name }: { name: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  if (!editing) {
    return (
      <button
        type="button"
        className="hub-lb-name"
        onClick={() => {
          setValue(name)
          setError(null)
          setEditing(true)
        }}
      >
        {name ? (
          <>
            Playing as <b>{name}</b>
          </>
        ) : (
          'Set your leaderboard name'
        )}
        <Pencil />
      </button>
    )
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await setPlayerName(value)
    setBusy(false)
    if (res.ok) setEditing(false)
    else setError(res.offline ? 'Could not reach the leaderboard – try again in a minute.' : (res.message ?? 'Please pick another name.'))
  }

  return (
    <form className="hub-lb-name-form" onSubmit={save} noValidate>
      <label className="sr-only" htmlFor="hub-lb-name-input">
        Leaderboard name
      </label>
      <input
        id="hub-lb-name-input"
        ref={inputRef}
        className="hub-lb-name-form__input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false)
        }}
        placeholder="Your name"
        maxLength={16}
        autoComplete="nickname"
        spellCheck={false}
        enterKeyHint="done"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'hub-lb-name-error' : undefined}
      />
      <button type="submit" className="hub-lb-name-form__btn hub-lb-name-form__btn--primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="hub-lb-name-form__btn" onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && (
        <p id="hub-lb-name-error" className="hub-lb-name-form__error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

function OfflineNote() {
  const onLiveSite = window.location.hostname === new URL(LIVE_SITE).hostname
  return (
    <div className="hub-lb-offline">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 18h10.5a4 4 0 0 0 .9-7.9A6 6 0 0 0 7.2 8.6 4.8 4.8 0 0 0 7 18z" />
        <path d="M4 4l16 16" />
      </svg>
      <div>
        <p className="hub-lb-offline__title">
          {onLiveSite ? 'The leaderboard is offline right now.' : 'Leaderboard and live counters work on the live site.'}
        </p>
        <p className="hub-lb-offline__text">
          Your best scores are still saved on this device.{' '}
          {!onLiveSite && (
            <a href={LIVE_SITE} target="_blank" rel="noopener">
              Open havaida-games.netlify.app ↗
            </a>
          )}
        </p>
      </div>
    </div>
  )
}

/**
 * Hub leaderboard section. Data is fetched lazily – once the section comes within ~600 px of the
 * viewport, or straight away when the route (`#/leaderboard/<slug>`) asks for it.
 */
export function Leaderboard({ focus, scrollRoot }: { focus: string | null; scrollRoot: RefObject<HTMLElement | null> }) {
  const { status, name } = useOnline()
  const [tab, setTab] = useState(focus ?? 'all')
  // without IntersectionObserver (very old browsers) the data simply loads right away
  const [near, setNear] = useState(() => focus !== null || typeof IntersectionObserver === 'undefined')
  const [seenFocus, setSeenFocus] = useState(focus)
  const [boards, setBoards] = useState<Load<Boards>>({ state: 'loading' })
  const [games, setGames] = useState<Record<string, Load<Board>>>({})
  const [mountedAt] = useState(() => performance.now())
  const [attempt, setAttempt] = useState(0)
  const sectionRef = useRef<HTMLElement>(null)
  /** Set by a deep link to one game: once its board is in, make sure the viewer's row is visible. */
  const revealYou = useRef(false)

  // a new deep link selects its board (state adjusted during render, as React recommends)
  if (focus !== seenFocus) {
    setSeenFocus(focus)
    if (focus !== null) {
      setTab(focus)
      setNear(true)
    }
  }

  const scrollIntoView = (smooth: boolean) =>
    sectionRef.current?.scrollIntoView({ behavior: smooth && !reducedMotion() ? 'smooth' : 'auto', block: 'start' })

  useEffect(() => {
    if (focus === null) return
    revealYou.current = focus !== 'all'
    // arriving from another page jumps; a link clicked on the hub itself glides
    const smooth = performance.now() - mountedAt > 400
    const raf = requestAnimationFrame(() => scrollIntoView(smooth))
    return () => cancelAnimationFrame(raf)
  }, [focus, mountedAt])

  useEffect(() => {
    const el = sectionRef.current
    if (near || !el) return
    const io = new IntersectionObserver((list) => list.some((e) => e.isIntersecting) && setNear(true), {
      root: scrollRoot.current,
      rootMargin: '0px 0px 200px 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [near, scrollRoot])

  useEffect(() => {
    if (!near || status !== 'online') return
    let cancelled = false
    if (tab === 'all') {
      void fetchBoards(5).then((res) => {
        if (cancelled || (!res.ok && res.offline)) return
        setBoards(res.ok ? { state: 'ready', data: res.data } : { state: 'error' })
      })
    } else {
      void fetchLeaderboard(tab, 50).then((res) => {
        if (cancelled || (!res.ok && res.offline)) return
        setGames((prev) => ({ ...prev, [tab]: res.ok ? { state: 'ready', data: res.data } : { state: 'error' } }))
      })
    }
    return () => {
      cancelled = true
    }
    // `name`: a rename changes the rows, so reload; `attempt`: "Try again"
  }, [near, status, tab, name, attempt])

  const selected = tab === 'all' ? undefined : gameBySlug(tab)
  const waiting = !near || status === 'unknown'
  const board = selected ? games[selected.slug] : undefined

  // "Leaderboard →" from the score toast: the player wants to see their own row, which may sit
  // below the top 10 – glide it into view once the board has arrived (after the section jump).
  useEffect(() => {
    if (!revealYou.current || board?.state !== 'ready') return
    revealYou.current = false
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const row = sectionRef.current?.querySelector<HTMLElement>('.hub-lb-row--you')
        const view = scrollRoot.current?.getBoundingClientRect()
        if (!row || !view) return
        const r = row.getBoundingClientRect()
        if (r.top < view.top || r.bottom > view.bottom) row.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [board, scrollRoot])
  const retry = () => {
    if (tab === 'all') setBoards({ state: 'loading' })
    else setGames((prev) => ({ ...prev, [tab]: { state: 'loading' } }))
    setAttempt((n) => n + 1)
  }

  return (
    <section id="leaderboard" ref={sectionRef} className="hub-lb" aria-labelledby="hub-lb-title">
      <div className="hub-lb__head">
        <div>
          <h2 id="hub-lb-title" className="hub-lb__title">
            Leaderboard
          </h2>
          <p className="hub-lb__sub">Every player's best score, live from all six games.</p>
        </div>
        {status === 'online' && <NameEditor name={name} />}
      </div>

      {status === 'offline' ? (
        <OfflineNote />
      ) : (
        <>
          <Tabs tab={tab} onSelect={setTab} />
          <div
            className={`hub-lb__panel${selected ? '' : ' hub-lb__panel--grid'}`}
            role="tabpanel"
            aria-label={selected ? `${selected.title} leaderboard` : 'All games'}
            style={accentStyle(selected)}
          >
            {!selected ? (
              <AllBoards
                load={waiting ? { state: 'loading' } : boards}
                onOpen={(slug) => {
                  setTab(slug)
                  scrollIntoView(true)
                }}
                onRetry={retry}
              />
            ) : (
              <GameBoard
                key={selected.slug}
                game={selected}
                load={waiting ? { state: 'loading' } : (games[selected.slug] ?? { state: 'loading' })}
                onRetry={retry}
              />
            )}
          </div>
        </>
      )}
    </section>
  )
}
