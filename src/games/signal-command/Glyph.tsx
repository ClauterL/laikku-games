import type { ReactNode } from 'react'
import type { Dir, GlyphName } from './types'

/** Inline SVG glyphs (24×24, stroke = currentColor). No emoji anywhere in the game. */
const GLYPHS: Record<GlyphName, ReactNode> = {
  mast: (
    <>
      <path d="M12 21V9.5" />
      <path d="M8.5 21l3.5-7 3.5 7" />
      <path d="M8.8 6.6a4.5 4.5 0 0 1 6.4 0" />
      <path d="M6 3.8a8.5 8.5 0 0 1 12 0" />
      <circle cx="12" cy="9.3" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  satellite: (
    <>
      <path d="M3 9a10 10 0 0 0 12 12L3 9z" />
      <path d="M11 17l-4 5" />
      <path d="M15 6a4 4 0 0 1 3 3" />
      <path d="M16.5 2.5a8 8 0 0 1 5 5" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="3.5" width="18" height="6.5" rx="1.6" />
      <rect x="3" y="14" width="18" height="6.5" rx="1.6" />
      <circle cx="7" cy="6.75" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="17.25" r="1.1" fill="currentColor" stroke="none" />
      <path d="M11 6.75h6M11 17.25h6" />
    </>
  ),
  route: (
    <>
      <circle cx="12" cy="5" r="2.4" />
      <circle cx="5.5" cy="18" r="2.4" />
      <circle cx="18.5" cy="18" r="2.4" />
      <path d="M11 7.2 6.7 15.8M13 7.2l4.3 8.6M8 18h8" />
    </>
  ),
  node: (
    <>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
      <path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  hop: (
    <>
      <path d="M3 17l4.5-9 4.5 9 4.5-9 2 4" />
      <path d="M16.5 8l3.5-1.5.5 3.8" />
    </>
  ),
  battery: (
    <>
      <rect x="2.5" y="7" width="17" height="10" rx="2" />
      <path d="M21.5 10.5v3" />
      <path d="M6 10.5v3M9.5 10.5v3M13 10.5v3" strokeWidth="2.6" />
    </>
  ),
  repeater: (
    <>
      <path d="M6 21v-9M3.5 21l2.5-5 2.5 5" />
      <path d="M18 21v-9M15.5 21l2.5-5 2.5 5" />
      <path d="M8.5 9a5 5 0 0 1 7 0" />
      <path d="M9.5 12.5a3.5 3.5 0 0 1 5 0" />
      <circle cx="6" cy="11" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="11" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  handover: (
    <>
      <path d="M3.5 8.5h14M14.5 5l3.5 3.5-3.5 3.5" />
      <path d="M20.5 15.5h-14M9.5 12 6 15.5l3.5 3.5" />
    </>
  ),
  reroute: (
    <>
      <path d="M5 21V8.5A3.5 3.5 0 0 1 8.5 5H19" />
      <path d="M15.5 1.5 19 5l-3.5 3.5" />
      <path d="M5 13h6.5a3.5 3.5 0 0 1 3.5 3.5V21" />
    </>
  ),
  patch: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="3.8" ry="9" />
      <path d="M3 12h18M4.5 7.5h15M4.5 16.5h15" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </>
  ),
  pulse: (
    <>
      <path d="M2.5 12h4l2.5-6.5 4 13 2.5-6.5h6" />
    </>
  ),
  uplink: (
    <>
      <path d="M12 21V8" />
      <path d="M6.5 13.5 12 8l5.5 5.5" />
      <path d="M4 3.5h16" />
    </>
  ),
  firewall: (
    <>
      <path d="M3 5h18M3 12h18M3 19h18" />
      <path d="M3 5v14M21 5v14" />
      <path d="M12 5v7M7.5 12v7M16.5 12v7" />
    </>
  ),
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
      <path d="M4.5 4.5a10.5 10.5 0 0 0 0 15M19.5 4.5a10.5 10.5 0 0 1 0 15" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  cell: (
    <>
      <path d="M4 20v-5M9 20v-9M14 20V7M19 20V3" strokeWidth="3" />
    </>
  ),
  audit: (
    <>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <path d="M3 6l1.2 1.2L6.5 4.8M3 12l1.2 1.2 2.3-2.4M3 18l1.2 1.2 2.3-2.4" />
    </>
  ),
  cold: (
    <>
      <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
      <path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.8 19.5 5.6v6.2c0 4.7-3.2 8.4-7.5 9.6-4.3-1.2-7.5-4.9-7.5-9.6V5.6z" />
      <path d="M8.8 12.2l2.2 2.2 4.4-4.6" />
    </>
  ),
  bolt: (
    <>
      <path d="M13.2 2.5 4.5 13.5h6.6l-1.3 8 8.7-11h-6.6z" fill="currentColor" stroke="none" />
    </>
  ),
  heart: (
    <>
      <path d="M12 20.8S3.4 15.6 3.4 9.4a4.4 4.4 0 0 1 8.6-1.3 4.4 4.4 0 0 1 8.6 1.3c0 6.2-8.6 11.4-8.6 11.4z" fill="currentColor" stroke="none" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" />
    </>
  ),
  check: (
    <>
      <path d="M4 12.5l5 5L20 6.5" strokeWidth="3" />
    </>
  ),
  cross: (
    <>
      <path d="M6 6l12 12M18 6 6 18" strokeWidth="3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.2 2.5 20h19z" />
      <path d="M12 9.5v4.5" strokeWidth="2.6" />
      <circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  pause: (
    <>
      <rect x="5.5" y="4.5" width="4.5" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4.5" height="15" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  emblem: (
    <>
      <path d="M12 2.8 19.5 5.6v6.2c0 4.7-3.2 8.4-7.5 9.6-4.3-1.2-7.5-4.9-7.5-9.6V5.6z" />
      <circle cx="12" cy="14.6" r="1.3" fill="currentColor" stroke="none" />
      <path d="M9.4 11.9a3.7 3.7 0 0 1 5.2 0" />
      <path d="M7.2 9.5a6.8 6.8 0 0 1 9.6 0" />
    </>
  ),
}

export function Glyph({ name, size = 20, className, strokeWidth = 2 }: { name: GlyphName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  )
}

const ROT: Record<Dir, number> = { up: 0, right: 90, down: 180, left: 270 }

/** A chunky direction arrow – the thing the whole game is about. */
export function Arrow({ dir, size = 32, className }: { dir: Dir; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ transform: `rotate(${ROT[dir]}deg)` }}
    >
      <path d="M12 20.5V4.5" />
      <path d="M5 11.5l7-7 7 7" />
    </svg>
  )
}

/**
 * Gold service emblem: a plain shield with a radio-wave arc. Deliberately not
 * the Finnish coat of arms – a simple signals badge for the wordmark.
 */
export function Emblem({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sc-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="0.55" stopColor="#e2a92c" />
          <stop offset="1" stopColor="#9c6b12" />
        </linearGradient>
      </defs>
      <path d="M24 3 42 9.5v13c0 10.6-7.4 19-18 22.5C13.4 41.5 6 33.1 6 22.5v-13z" fill="url(#sc-gold)" stroke="#5a3d08" strokeWidth="1.5" />
      <path d="M24 7.5 38.5 12.7v9.8c0 8.6-5.9 15.6-14.5 18.6-8.6-3-14.5-10-14.5-18.6v-9.8z" fill="none" stroke="#fff3c4" strokeOpacity="0.55" strokeWidth="1.2" />
      <circle cx="24" cy="30" r="3" fill="#3b2605" />
      <path d="M17.5 24.5a9 9 0 0 1 13 0" fill="none" stroke="#3b2605" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M13 19.5a15 15 0 0 1 22 0" fill="none" stroke="#3b2605" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M24 30v9" stroke="#3b2605" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}
