import { Link } from 'react-router-dom'
import { GAMES, type GameMeta } from '../games'
import { getBest } from '../shared/storage'
import './Hub.css'

function GameIcon({ slug }: { slug: string }) {
  switch (slug) {
    case 'ticket-slash':
      return (
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <rect x="18" y="34" width="60" height="42" rx="8" fill="#fff" transform="rotate(-12 48 55)" />
          <rect x="24" y="44" width="30" height="5" rx="2.5" fill="#2f80ff" transform="rotate(-12 48 55)" />
          <rect x="24" y="54" width="42" height="4" rx="2" fill="#c8d2e6" transform="rotate(-12 48 55)" />
          <rect x="24" y="62" width="34" height="4" rx="2" fill="#c8d2e6" transform="rotate(-12 48 55)" />
          <path d="M10 92 108 28" stroke="#ffb020" strokeWidth="7" strokeLinecap="round" />
          <path d="M10 92 108 28" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          <rect x="70" y="70" width="36" height="30" rx="7" fill="#2f80ff" />
          <rect x="76" y="64" width="24" height="8" rx="4" fill="#5aa0ff" />
        </svg>
      )
    case 'network-connect':
      return (
        <svg viewBox="0 0 120 120" aria-hidden="true">
          {[0, 1, 2, 3].map((r) =>
            [0, 1, 2, 3].map((c) => (
              <rect key={`${r}${c}`} x={14 + c * 24} y={14 + r * 24} width="20" height="20" rx="5" fill="rgba(255,255,255,0.08)" />
            )),
          )}
          <path d="M24 24 H72 V72 H96" fill="none" stroke="#37e36b" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M24 96 H48 V48" fill="none" stroke="#ff4fd8" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="24" cy="24" r="8" fill="#37e36b" />
          <circle cx="96" cy="72" r="8" fill="#37e36b" />
          <circle cx="24" cy="96" r="8" fill="#ff4fd8" />
          <circle cx="48" cy="48" r="8" fill="#ff4fd8" />
        </svg>
      )
    case 'access-crossing':
      return (
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <rect x="10" y="80" width="100" height="26" rx="6" fill="#c9d6ea" />
          <rect x="20" y="30" width="18" height="60" rx="5" fill="#2bb673" />
          <rect x="51" y="30" width="18" height="60" rx="5" fill="#2f80ff" />
          <rect x="82" y="30" width="18" height="60" rx="5" fill="#e63946" />
          <rect x="22" y="18" width="14" height="10" rx="3" fill="#fff" />
          <rect x="53" y="18" width="14" height="10" rx="3" fill="#fff" />
          <rect x="84" y="18" width="14" height="10" rx="3" fill="#fff" />
          <rect x="38" y="52" width="13" height="6" rx="3" fill="#9adbb9" />
          <rect x="69" y="52" width="13" height="6" rx="3" fill="#9ac3ff" />
          <circle cx="60" cy="98" r="9" fill="#1b5fd1" />
          <rect x="52" y="104" width="16" height="12" rx="4" fill="#0d3b8c" />
        </svg>
      )
    case 'signal-command':
      return (
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <rect x="8" y="8" width="104" height="104" rx="14" fill="#06101a" stroke="#19c8ff" strokeWidth="2" opacity="0.9" />
          {[
            [30, 60, 'M22 60h16'],
            [60, 60, 'M60 44v32'],
            [90, 60, 'M82 60h16'],
          ].map(([x, y, d], i) => (
            <g key={i}>
              <rect x={Number(x) - 14} y={Number(y) - 14} width="28" height="28" rx="6" fill="#0b2233" stroke={i < 2 ? '#36ff6a' : '#19c8ff'} strokeWidth="2.5" />
              <path d={String(d)} stroke={i < 2 ? '#36ff6a' : '#19c8ff'} strokeWidth="4" strokeLinecap="round" />
            </g>
          ))}
          <path d="M22 60l6-6M22 60l6 6" stroke="#36ff6a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M60 44l-6 6M60 44l6 6" stroke="#36ff6a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M98 60l-6-6M98 60l-6 6" stroke="#19c8ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M28 96h64" stroke="#36ff6a" strokeWidth="6" strokeLinecap="round" />
          <path d="M28 96h40" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
          <path d="M44 22q16-12 32 0" fill="none" stroke="#ffb020" strokeWidth="3" strokeLinecap="round" />
          <path d="M50 30q10-7 20 0" fill="none" stroke="#ffb020" strokeWidth="3" strokeLinecap="round" />
          <circle cx="60" cy="36" r="3.5" fill="#ffb020" />
        </svg>
      )
    case 'bug-breaker':
      return (
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <path d="M22 100V58M22 58 10 40M22 58 34 40" stroke="#8b5a2b" strokeWidth="8" strokeLinecap="round" />
          <rect x="52" y="44" width="30" height="30" rx="7" fill="#ff4a3d" transform="rotate(-18 67 59)" />
          <text x="67" y="65" textAnchor="middle" fontSize="16" fontWeight="900" fill="#fff" transform="rotate(-18 67 59)">
            {'</>'}
          </text>
          <rect x="86" y="70" width="24" height="30" rx="4" fill="#c8893a" />
          <rect x="86" y="40" width="24" height="26" rx="4" fill="#aee8ff" />
          <circle cx="98" cy="26" r="10" fill="#e63946" />
          <circle cx="94" cy="24" r="2.4" fill="#fff" />
          <circle cx="102" cy="24" r="2.4" fill="#fff" />
          <path d="M12 40 34 28" stroke="#ffd400" strokeWidth="3" strokeDasharray="4 4" />
        </svg>
      )
    case 'uptime-keeper':
      return (
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <rect x="10" y="14" width="100" height="92" rx="10" fill="#171b24" />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={20 + i * 30} y="24" width="22" height="56" rx="3" fill="#262c38" stroke="#3a4252" strokeWidth="2" />
              {[0, 1, 2, 3, 4].map((r) => (
                <g key={r}>
                  <rect x={24 + i * 30} y={30 + r * 10} width="8" height="3" rx="1" fill={r === 2 && i === 1 ? '#ff2d3a' : '#39ff7a'} />
                  <rect x={34 + i * 30} y={30 + r * 10} width="4" height="3" rx="1" fill="#1ec8ff" />
                </g>
              ))}
            </g>
          ))}
          <rect x="48" y="20" width="26" height="64" rx="4" fill="none" stroke="#ff2d3a" strokeWidth="3" />
          <path d="M20 92h80" stroke="#1ec8ff" strokeWidth="5" strokeLinecap="round" />
          <path d="M20 100h60" stroke="#ffb020" strokeWidth="5" strokeLinecap="round" />
          <circle cx="61" cy="12" r="9" fill="#e8102a" />
          <path d="M57 12h8M61 8v8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      )
    default:
      return null
  }
}

function GameCard({ game, index }: { game: GameMeta; index: number }) {
  const best = getBest(game.slug)
  const style = {
    '--accent': game.accent,
    '--accent-2': game.accent2,
    '--card-bg': game.bg,
    animationDelay: `${index * 70}ms`,
  } as React.CSSProperties
  return (
    <Link to={`/${game.slug}`} className="hub-card" style={style}>
      <div className="hub-card__art">
        <GameIcon slug={game.slug} />
      </div>
      <div className="hub-card__body">
        <span className="hub-card__company">{game.company}</span>
        <h2 className="hub-card__title">{game.title}</h2>
        <p className="hub-card__inspired">Inspired by {game.inspiredBy}</p>
        <p className="hub-card__howto">{game.howto}</p>
        <div className="hub-card__footer">
          <span className="hub-card__best">{best > 0 ? `Best: ${best.toLocaleString('en-US')}` : 'Not played yet'}</span>
          <span className="btn btn--primary hub-card__play">PLAY ▶</span>
        </div>
      </div>
    </Link>
  )
}

export function Hub() {
  return (
    <main className="hub">
      <div className="hub__bg" aria-hidden="true" />
      <header className="hub__header">
        <span className="hub__brand">Havaida</span>
        <h1 className="hub__title">
          Havaida <span>Games</span>
        </h1>
        <p className="hub__subtitle">
          Six tiny browser games with an IT twist – ticket triage, network puzzles, building access, signal
          command codes, bug breaking and data-centre uptime. Each one is playable in ten seconds, on desktop or phone.
        </p>
      </header>

      <section className="hub__grid" aria-label="Games">
        {GAMES.map((g, i) => (
          <GameCard game={g} index={i} key={g.slug} />
        ))}
      </section>

      <footer className="hub__footer">
        <p>
          Built with React, TypeScript and HTML canvas by <strong>Havaida Oy</strong>. Fan-made portfolio project – the
          companies named are themes, not sponsors or affiliates.
        </p>
      </footer>
    </main>
  )
}
