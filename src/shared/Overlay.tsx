import type { ReactNode } from 'react'

export interface OverlayStat {
  label: string
  value: string | number
}

export interface OverlayProps {
  /** Small uppercase pill above the title, e.g. the company name. */
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  /** One or two sentences that explain the game in ten seconds. */
  howto?: ReactNode
  stats?: OverlayStat[]
  /** Action buttons (use .btn / .btn--primary / .btn--ghost). */
  children?: ReactNode
  className?: string
}

/**
 * Shared start / pause / game-over panel. Sits on top of the canvas,
 * inherits the game's accent colours from the game root's CSS variables.
 */
export function Overlay({ eyebrow, title, subtitle, howto, stats, children, className }: OverlayProps) {
  return (
    <div className={`overlay${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="overlay__card">
        {eyebrow && <span className="overlay__eyebrow">{eyebrow}</span>}
        <h1 className="overlay__title">{title}</h1>
        {subtitle && <p className="overlay__subtitle">{subtitle}</p>}
        {howto && <div className="overlay__howto">{howto}</div>}
        {stats && stats.length > 0 && (
          <div className="overlay__stats">
            {stats.map((s) => (
              <div className="overlay__stat" key={s.label}>
                <b>{s.value}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
        {children && <div className="overlay__actions">{children}</div>}
      </div>
    </div>
  )
}
