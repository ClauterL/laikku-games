import { GLYPHS, type GlyphName } from './glyphs'

/** HUD version of the canvas glyphs: same path data, rendered as inline SVG. */
export function Glyph({ name, size = 20, className }: { name: GlyphName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {GLYPHS[name].map((part, i) =>
        part.fill ? (
          <path key={i} d={part.d} fill="currentColor" />
        ) : (
          <path key={i} d={part.d} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        ),
      )}
    </svg>
  )
}

/** Plain isometric cube used next to the "Ficolo" text wordmark. */
export function CubeMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="uk-cube" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2l9 5-9 5-9-5z" fill="#ff4a5c" />
      <path d="M3 7l9 5v10l-9-5z" fill="#e8102a" />
      <path d="M21 7l-9 5v10l9-5z" fill="#a50b1d" />
    </svg>
  )
}
