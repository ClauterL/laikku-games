import { useEffect, useRef } from 'react'

/**
 * Mounts a canvas game engine inside a React component.
 *
 * `create` must be referentially stable (wrap it in `useCallback` with an
 * empty dependency list) – it is called once per mount, and the engine is
 * destroyed on unmount. React StrictMode mounts twice in development, so the
 * engine's constructor + destroy() must be fully idempotent (no leaked
 * listeners, no leaked requestAnimationFrame).
 */
export function useEngine<E extends { destroy(): void }>(create: (canvas: HTMLCanvasElement) => E) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<E | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const engine = create(canvas)
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [create])

  return { canvasRef, engineRef }
}
