import { useState } from 'react'
import { sfx } from './sfx'

/** Small speaker toggle for the HUD. Place it inside `.hud`. */
export function MuteButton({ className }: { className?: string }) {
  const [muted, setMuted] = useState(sfx.muted)
  return (
    <button
      type="button"
      className={`btn btn--icon${className ? ` ${className}` : ''}`}
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      title={muted ? 'Unmute' : 'Mute'}
      onClick={() => {
        sfx.unlock()
        setMuted(sfx.toggle())
        sfx.play('click')
      }}
    >
      {muted ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5 6 9H3v6h3l5 4z" />
          <path d="m22 9-6 6M16 9l6 6" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5 6 9H3v6h3l5 4z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      )}
    </button>
  )
}
