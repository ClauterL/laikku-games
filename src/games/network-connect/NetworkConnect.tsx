import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gameBySlug } from '../../games'
import { HomeButton } from '../../shared/HomeButton'
import { MuteButton } from '../../shared/MuteButton'
import { Overlay } from '../../shared/Overlay'
import { sfx } from '../../shared/sfx'
import { getBest } from '../../shared/storage'
import { useEngine } from '../../shared/useEngine'
import { Engine, SLUG, initialHud, loadProgress, type HudState, type Phase } from './engine'
import { GlyphIcon, NodeIcon } from './GlyphIcon'
import type { GlyphKind } from './glyphs'
import { POWER_UPS, type PowerUp } from './types'
import './network-connect.css'

const PU: Record<PowerUp, { name: string; desc: string; color: string; glyph: GlyphKind }> = {
  reroute: { name: 'Reroute', desc: 'Auto-connect one path', color: '#8b4dff', glyph: 'reroute' },
  firewall: { name: 'Firewall', desc: 'Remove a firewall block', color: '#ff4a4a', glyph: 'firewall' },
  vpn: { name: 'VPN Tunnel', desc: 'Tunnel through one block (1 use)', color: '#2fa8ff', glyph: 'lock' },
  boost: { name: 'Network Boost', desc: 'Clear packet loss & repair nodes', color: '#37e36b', glyph: 'boost' },
}

function Stars({ count, size = 26 }: { count: number; size?: number }) {
  // A <span> so it can also live inside the Overlay's <p> subtitle.
  return (
    <span className="nc-stars" role="img" aria-label={`${count} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <svg key={i} className={`nc-star${i < count ? ' is-on' : ''}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
          <path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.5l-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9z" />
        </svg>
      ))}
    </span>
  )
}

function CoinChip({ coins, className }: { coins: number; className?: string }) {
  return (
    <div className={`nc-coins${className ? ` ${className}` : ''}`} title="Coins">
      <span className="nc-coins__star">
        <GlyphIcon kind="star" color="#fff6c4" size={22} />
      </span>
      <b>{coins.toLocaleString('en-US')}</b>
    </div>
  )
}

function PowerUpButton({ kind, count, armed, onClick }: { kind: PowerUp; count: number; armed: boolean; onClick: () => void }) {
  const m = PU[kind]
  return (
    <button
      type="button"
      className={`nc-pu nc-pu--${kind}${armed ? ' is-armed' : ''}`}
      style={{ '--pu': m.color } as React.CSSProperties}
      disabled={count <= 0}
      aria-pressed={armed}
      title={m.desc}
      onClick={onClick}
    >
      <span className="nc-pu__icon">
        <GlyphIcon kind={m.glyph} color="#ffffff" accent={m.color} size={34} />
      </span>
      <span className="nc-pu__text">
        <b>{m.name}</b>
        <small>{m.desc}</small>
      </span>
      <span className="nc-pu__badge">{count}</span>
    </button>
  )
}

function Legend({ row }: { row?: boolean }) {
  const size = row ? 30 : 24
  return (
    <ul className={`nc-legend${row ? ' nc-legend--row' : ''}`}>
      <li>
        <NodeIcon kind="user" color="#37e36b" size={size} /> USER
      </li>
      <li>
        <NodeIcon kind="switch" color="#2fa8ff" size={size} /> SWITCH
      </li>
      <li>
        <NodeIcon kind="firewall" color="#ff4a4a" size={size} /> FIREWALL
      </li>
      <li>
        <NodeIcon kind="server" color="#a86bff" size={size} /> SERVER
      </li>
      <li>
        <NodeIcon kind="cloud" color="#2fa8ff" size={size} /> CLOUD
      </li>
    </ul>
  )
}

export default function NetworkConnect() {
  const meta = gameBySlug(SLUG)!
  const [hud, setHud] = useState<HudState>(initialHud)
  const [phase, setPhase] = useState<Phase>('start')
  const slotRef = useRef<HTMLDivElement>(null)
  const create = useCallback(
    (canvas: HTMLCanvasElement) => new Engine(canvas, { boardHost: slotRef.current, onHud: setHud, onPhase: setPhase }),
    [],
  )
  const { canvasRef, engineRef } = useEngine(create)

  // Enter / Space starts the game or goes to the next level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const eng = engineRef.current
      if (!eng) return
      if (phase === 'start') {
        e.preventDefault()
        sfx.unlock()
        eng.start(eng.hasProgress() ? 'continue' : 'new')
      } else if (phase === 'won') {
        e.preventDefault()
        eng.nextLevel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, engineRef])

  const act = (fn: (e: Engine) => void) => () => {
    sfx.unlock()
    const e = engineRef.current
    if (e) fn(e)
  }

  const progress = phase === 'start' ? loadProgress() : null
  const best = getBest(SLUG)
  const style = { '--accent': meta.accent, '--accent-2': meta.accent2, '--bg': meta.bg } as React.CSSProperties
  const win = hud.win

  return (
    <div className={`game-root network-connect is-${phase}`} style={style}>
      <canvas ref={canvasRef} className="game-canvas" />
      <HomeButton />
      <div className="nc-mute">
        <MuteButton />
      </div>

      <div className="nc-layout">
        <header className="nc-header">
          <div className="nc-brand">
            <span className="nc-brand__mark" aria-label="C2">
              <span className="nc-brand__c">C</span>
              <span className="nc-brand__2">2</span>
            </span>
            <svg className="nc-brand__net" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M32 8 56 32 32 56 8 32Z" fill="none" stroke="#4fa8ff" strokeWidth="2.5" strokeDasharray="4 4" />
              <circle cx="32" cy="8" r="5" fill="#ffd43b" />
              <circle cx="56" cy="32" r="5" fill="#37e36b" />
              <circle cx="32" cy="56" r="5" fill="#37e36b" />
              <circle cx="8" cy="32" r="5" fill="#2fa8ff" />
              <circle cx="32" cy="32" r="4" fill="#ffffff" />
            </svg>
            <span className="nc-brand__title">
              Network
              <br />
              Connect
            </span>
            <span className="nc-brand__tag">
              Connect
              <br />
              Secure
              <br />
              Solve
              <br />
              Level up
            </span>
          </div>
          <CoinChip coins={hud.coins} className="nc-coins--header" />
        </header>

        <section className="nc-status nc-panel">
          <div className="nc-level">
            <b>LEVEL {hud.level}</b>
            <span>{hud.name}</span>
          </div>
          <div className="nc-moves">
            <span className="nc-moves__label">Moves</span>
            <b className="nc-moves__value">{hud.moves}</b>
            <Stars count={hud.stars} />
          </div>
          <CoinChip coins={hud.coins} className="nc-coins--status" />
          <div className="nc-status__actions">
            <button type="button" className="nc-small-btn" onClick={act((e) => e.resetLevel())} title="Reset level (R)">
              Reset
            </button>
            <button type="button" className="nc-small-btn" disabled={!hud.canUndo} onClick={act((e) => e.undo())} title="Undo last stroke (Z)">
              Undo
            </button>
          </div>
          {/* compact challenge counters – phones only (the desktop info panel lists them in full) */}
          <ul className="nc-strip" aria-label="Challenges">
            <li title="Packet loss tiles">
              <GlyphIcon kind="loss" color="#ff4a4a" size={18} />
              <b>{hud.loss}</b>
            </li>
            <li title="Firewall blocks">
              <GlyphIcon kind="bricks" size={18} />
              <b>{hud.blocks}</b>
            </li>
            <li title="Broken nodes">
              <GlyphIcon kind="broken" color="#ffffff" size={18} />
              <b>{hud.broken}</b>
            </li>
            <li title="Paths connected" className="nc-strip__paths">
              <b>
                {hud.connected}/{hud.pairs}
              </b>
              <span>paths</span>
            </li>
            {hud.latency > 0 && (
              <li title="Latency" className="nc-strip__latency">
                <b>+{hud.latency}</b>
                <span>latency</span>
              </li>
            )}
          </ul>
        </section>

        <aside className="nc-info nc-panel">
          <section className="nc-card">
            <h3>Goal</h3>
            <p className="nc-goal">
              Connect all data paths from <b className="nc-c-green">USER</b> to <b className="nc-c-blue">CLOUD</b>!
            </p>
            <Legend />
          </section>
          <section className="nc-card">
            <h3>Challenges</h3>
            <ul className="nc-challenges">
              <li>
                <GlyphIcon kind="loss" color="#ff4a4a" size={22} />
                <span>Packet Loss</span>
                <em>({hud.loss})</em>
              </li>
              <li>
                <GlyphIcon kind="bricks" size={22} />
                <span>Firewall Block</span>
                <em>({hud.blocks})</em>
              </li>
              <li>
                <GlyphIcon kind="broken" color="#ffffff" size={22} />
                <span>Broken Node</span>
                <em>({hud.broken})</em>
              </li>
            </ul>
            <p className={`nc-latency${hud.latency > 0 ? ' is-hot' : ''}`}>
              {hud.latency > 0 ? `Latency +${hud.latency} – packet loss costs a star` : 'Latency 0 – avoid packet-loss tiles'}
            </p>
          </section>
          <div className="nc-progress">
            <span>
              {hud.connected} / {hud.pairs} paths connected
            </span>
            <div className="nc-progress__bar">
              <i style={{ width: `${hud.pairs ? (hud.connected / hud.pairs) * 100 : 0}%` }} />
            </div>
          </div>
        </aside>

        <div className="nc-board-slot" ref={slotRef} />

        <aside className="nc-power nc-panel">
          <h2>Power-ups</h2>
          {POWER_UPS.map((k) => (
            <PowerUpButton key={k} kind={k} count={hud.inventory[k]} armed={hud.armed === k} onClick={act((e) => e.usePowerUp(k))} />
          ))}
        </aside>
      </div>

      {phase === 'start' && (
        <Overlay
          eyebrow={meta.company}
          title={meta.title}
          subtitle={meta.tagline}
          howto={
            <>
              <p className="nc-howto">
                Drag a glowing data path from each <strong>USER</strong> to its <strong>CLOUD</strong>. Paths may not cross, every tile
                must carry data and the path has to run through its waypoints. Power-ups clear firewalls, packet loss and broken nodes.
              </p>
              <Legend row />
            </>
          }
          stats={
            best > 0
              ? [
                  { label: 'best coins', value: best.toLocaleString('en-US') },
                  { label: 'level reached', value: progress?.bestLevel ?? 1 },
                ]
              : undefined
          }
        >
          {progress ? (
            <>
              <button type="button" className="btn btn--primary" onClick={act((e) => e.start('continue'))}>
                CONTINUE (level {progress.level})
              </button>
              <button type="button" className="btn btn--ghost" onClick={act((e) => e.start('new'))}>
                New game
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" onClick={act((e) => e.start('new'))}>
              PLAY ▶
            </button>
          )}
        </Overlay>
      )}

      {phase === 'won' && win && (
        <Overlay
          className="nc-win"
          eyebrow="All paths connected"
          title={`Level ${win.level} cleared!`}
          subtitle={
            <>
              <Stars count={win.stars} size={40} />
              <span className="nc-win__note">
                {win.unused > 0 ? `${win.unused} power-up type${win.unused === 1 ? '' : 's'} untouched: +${win.bonus} bonus` : 'Every power-up type used'}
                {win.gift ? ` · gift: +1 ${PU[win.gift].name}` : ''}
              </span>
            </>
          }
          stats={[
            { label: 'moves', value: win.moves },
            { label: 'latency', value: win.latency },
            { label: 'coins', value: `+${win.earned}` },
          ]}
        >
          <button type="button" className="btn btn--primary" onClick={act((e) => e.nextLevel())}>
            NEXT LEVEL ▶
          </button>
          <button type="button" className="btn btn--ghost" onClick={act((e) => e.replayLevel())}>
            Replay
          </button>
          <Link to="/" className="btn btn--ghost">
            Back to hub
          </Link>
        </Overlay>
      )}
    </div>
  )
}
