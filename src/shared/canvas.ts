/**
 * Canvas sizing helpers shared by all games.
 *
 * Every game draws in CSS pixels: call `fitCanvas()` whenever the element
 * resizes, then `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` is already applied,
 * so the game logic can use `width`/`height` in CSS pixels directly.
 */

export interface CanvasSize {
  /** CSS pixel width */
  width: number
  /** CSS pixel height */
  height: number
  dpr: number
}

/** Resize the backing store to the element's CSS size × devicePixelRatio (capped). */
export function fitCanvas(canvas: HTMLCanvasElement, maxDpr = 2): CanvasSize {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const bw = Math.round(width * dpr)
  const bh = Math.round(height * dpr)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { width, height, dpr }
}

/** Observe an element's size; returns a disposer. Fires once immediately. */
export function observeResize(el: Element, cb: () => void): () => void {
  let raf = 0
  const schedule = () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(cb)
  }
  const ro = new ResizeObserver(schedule)
  ro.observe(el)
  window.addEventListener('orientationchange', schedule)
  cb()
  return () => {
    cancelAnimationFrame(raf)
    ro.disconnect()
    window.removeEventListener('orientationchange', schedule)
  }
}

/** Pointer position relative to the canvas, in CSS pixels. */
export function pointerPos(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

/**
 * Standard game loop: calls `update(dt)` with dt in seconds (clamped so a
 * backgrounded tab never produces a giant step) and `render()` every frame.
 * Automatically pauses while the document is hidden. Returns a disposer.
 */
export function startLoop(update: (dt: number) => void, render: () => void): () => void {
  let raf = 0
  let last = performance.now()
  let running = true
  const frame = (now: number) => {
    if (!running) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    update(dt)
    render()
    raf = requestAnimationFrame(frame)
  }
  const onVis = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf)
    } else {
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
  }
  document.addEventListener('visibilitychange', onVis)
  raf = requestAnimationFrame(frame)
  return () => {
    running = false
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', onVis)
  }
}
