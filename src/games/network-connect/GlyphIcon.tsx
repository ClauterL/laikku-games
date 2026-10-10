import { useEffect, useRef } from 'react'
import { drawGlyph, drawNodeBox, type GlyphKind, type NodeKind } from './glyphs'

/**
 * Tiny canvases that reuse the board's vector glyphs for the HTML panels, so
 * the legend and the power-up buttons look exactly like the tiles.
 */
export function GlyphIcon({
  kind,
  color = '#ffffff',
  accent = '#2fa8ff',
  size = 28,
  className,
}: {
  kind: GlyphKind
  color?: string
  accent?: string
  size?: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    drawGlyph(ctx, kind, size / 2, size / 2, size * 0.84, color, accent)
  }, [kind, color, accent, size])
  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />
}

/** A coloured node box (USER / CLOUD / SWITCH / FIREWALL / SERVER) as used on the board. */
export function NodeIcon({ kind, color, size = 30, className }: { kind: NodeKind; color: string; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    drawNodeBox(ctx, 1, 1, size - 2, color, kind, null)
  }, [kind, color, size])
  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />
}
