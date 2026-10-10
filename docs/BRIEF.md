# Havaida Games – shared brief for every game

Five small browser games, one series. Each game is themed around a company and borrows the
mechanics **and the look** of a famous casual game. They are portfolio pieces: a recruiter should
understand each game within ten seconds and it should *look* like a polished mobile game, not a
tech demo.

## Project facts

- Vite 8 + React 19 + TypeScript 6 (strict). `react-router-dom` (HashRouter), `matter-js` available.
- TypeScript settings that bite: `erasableSyntaxOnly` (**no `enum`**, no `namespace`, no constructor
  parameter properties – use `as const` objects / union string types), `verbatimModuleSyntax`
  (`import type { X }` for types), `noUnusedLocals` / `noUnusedParameters` (prefix unused params `_`).
- Type-check your folder with `npx tsc --noEmit -p tsconfig.app.json` – it must report **zero errors in
  your folder** (other games are being written at the same time; ignore errors under other
  `src/games/*` folders, never edit them).
- Do **not** run `vite build` (other agents share the directory). Use the dev server + screenshot script
  described below, on the port you were assigned.
- Only create / edit files inside **your own** `src/games/<slug>/` folder. Everything else (shared
  modules, hub, router, index.css) is read-only for you. If a shared helper is missing, write your own
  helper inside your folder.
- Your React component file already exists as a placeholder: replace it, keep the **default export**
  and the file name.

## Required structure (inside `src/games/<slug>/`)

```
<Component>.tsx   React component (default export): mounts the canvas, HUD, overlays
engine.ts         the game itself – plain TypeScript, no React imports
<slug>.css        game-specific styles (scope everything under `.game-root.<slug>`)
levels.ts / draw.ts / types.ts … as many extra modules as you like
```

Pattern for the component:

```tsx
import { useCallback, useState } from 'react'
import { useEngine } from '../../shared/useEngine'
import { Overlay } from '../../shared/Overlay'
import { HomeButton } from '../../shared/HomeButton'
import { MuteButton } from '../../shared/MuteButton'
import { sfx } from '../../shared/sfx'
import { Engine, type HudState } from './engine'
import './ticket-slash.css'

export default function TicketSlash() {
  const [hud, setHud] = useState<HudState>(initialHud)
  const [phase, setPhase] = useState<'start' | 'playing' | 'paused' | 'over'>('start')
  const create = useCallback((canvas: HTMLCanvasElement) => new Engine(canvas, { onHud: setHud, onPhase: setPhase }), [])
  const { canvasRef, engineRef } = useEngine(create)
  return (
    <div className="game-root ticket-slash" style={{ '--accent': '#2f80ff', '--accent-2': '#ffb020', '--bg': '#0f1b3d' } as React.CSSProperties}>
      <canvas ref={canvasRef} className="game-canvas" />
      <HomeButton />
      <div className="hud"> … chips … <MuteButton /> </div>
      {phase === 'start' && <Overlay …><button className="btn btn--primary" onClick={() => { sfx.unlock(); engineRef.current?.start() }}>PLAY ▶</button></Overlay>}
      …
    </div>
  )
}
```

- The engine receives callbacks and calls `onHud` **only when a HUD value actually changes** (never
  every frame – React re-renders are expensive).
- `useEngine` calls `create(canvas)` on mount and `engine.destroy()` on unmount. React StrictMode
  mounts twice in dev: the constructor and `destroy()` must be idempotent (remove every listener,
  cancel the RAF loop, dispose timers). Use `startLoop()` from `shared/canvas.ts` – it returns a disposer
  and auto-pauses when the tab is hidden.
- Canvas sizing: `fitCanvas(canvas)` from `shared/canvas.ts` sets the backing store to CSS px ×
  devicePixelRatio and applies the transform, so **all game code works in CSS pixels**. Re-run it from
  `observeResize(canvas, …)`. The canvas must fill the available area (`position:absolute; inset:0;
  width:100%; height:100%` or a flex layout); the game must be playable at 390×844 (phone portrait),
  844×390 (phone landscape) and 1280×800+ (desktop).

## Shared modules you should use (`src/shared/`)

| module | what |
| --- | --- |
| `Overlay.tsx` | start / pause / game-over card: `eyebrow` (company), `title`, `subtitle`, `howto`, `stats`, children = buttons (`.btn`, `.btn--primary`, `.btn--ghost`) |
| `HomeButton.tsx` | floating ⌂ link back to the hub (always include it) |
| `MuteButton.tsx` | speaker toggle for the HUD |
| `useEngine.ts` | mounts/destroys the engine |
| `canvas.ts` | `fitCanvas`, `observeResize`, `pointerPos`, `startLoop` |
| `draw.ts` | `roundRectPath`, `fillRoundRect`, `strokeRoundRect`, `outlinedText`, `withGlow`, `hexToRgba`, `shade`, particles (`burst/updateParticles/drawParticles`), float texts |
| `sfx.ts` | `sfx.unlock()` on the first user gesture, then `sfx.play('good' | 'bad' | 'combo' | 'alarm' | 'pop' | 'whoosh' | 'coin' | 'win' | 'lose' | 'launch' | 'hit' | 'explode' | 'denied' | 'connect' | 'repair' | 'click' | 'tap')` |
| `storage.ts` | `getBest(slug)`, `submitBest(slug, score)`, `loadJSON`, `saveJSON` |
| `rng.ts` | `seededRng(seed)` + `randInt/randRange/pick/shuffle`, and unseeded `rnd` |
| `math.ts` | `clamp`, `lerp`, `damp`, `dist`, easings, `formatTime`, `formatScore`, `pointInRect` |
| `games.ts` | `GAMES` metadata (company, title, tagline, howto, colours) – use `gameBySlug('<slug>')` for the texts on your start screen |

Global CSS (`src/index.css`) already provides: `.game-root`, `.overlay*`, `.btn*`, `.hud`, `.hud__row`,
`.chip`, `.chip__label`, `.chip__value`, `.home-btn`. Fonts: `var(--font-display)` = "Baloo 2" (chunky
game titles, big numbers) and `var(--font-ui)` = "Nunito" (everything else). In canvas text use
`'800 20px "Baloo 2", "Nunito", sans-serif'` style strings.

## Game feel checklist (all games)

1. **Start screen** (`Overlay`): company eyebrow, title, tagline, 1–2 line how-to, big `PLAY ▶` button.
   Show the best score from `getBest(slug)` if > 0. Keyboard: Enter/Space starts.
2. **HUD** in HTML (`.hud` + `.chip`s) or on the canvas – score, lives/moves/time, whatever the game
   needs, plus `MuteButton` and a pause button where it makes sense (Esc/P pauses).
3. **Game over / level complete** overlay with score, best (`submitBest`), stats, `Play again` and a
   `Back to hub` link (`<Link to="/" className="btn btn--ghost">`).
4. **Input**: Pointer Events (mouse + touch unified, `touch-action: none` is already set on the canvas),
   keyboard where natural. `setPointerCapture` on drag. Generous hit areas (≥ 44 px on phones).
5. **Juice**: particles, floating score text, screen shake on big events, eased animations (use
   `shared/draw.ts`), subtle idle motion in the background, sound via `sfx`.
6. **Performance**: object pools or simple arrays, no allocations in the hot path where avoidable, cap
   particle counts, draw only what is on screen. Must stay at 60 fps on a mid-range phone.
7. **No external images** – draw everything with canvas primitives (vector icons via paths), gradients,
   shadows. Emoji are allowed only in HTML text, never as game sprites.
8. **Difficulty ramps** gently; the first 10 seconds must be easy enough that anybody succeeds.
9. **No lorem ipsum, no TODOs** in shipped code. Comments explain the *why* of non-obvious logic.
10. Company names are themes. Use text wordmarks only – never copy a real company logo.

## Visual direction

Each game copies the **colour theme and art style of the classic it is inspired by**, adapted to the
company's IT theme. Reference mock-ups are in `docs/mockups/` – look at yours with the `Read` tool
before you start and match it as closely as the canvas allows (layout of HUD, colours, icon style,
proportions). `docs/mockups/pixel-collage-all-games.png` is an alternative pixel-art take; use it for
extra ideas, not the style.

## Testing (mandatory before you report back)

```
node scripts/shoot.mjs --route /<slug> --port <your port> --out shots/<slug> [--scenario scripts/scenarios/<slug>.mjs]
```

The script starts a dev server on your port, screenshots the start screen at desktop (1280×800) and
phone (390×844) sizes, clicks PLAY, screenshots gameplay, and prints console errors / page errors.
Write your own scenario file (`export default async function run(page, shoot, viewport) {}`) that
plays a few seconds of **your** game with realistic input (drags on the canvas via `page.mouse` /
`page.touchscreen`, clicks on HUD buttons, keyboard) and calls `shoot('name')` after each step.
Then **look at every screenshot with the `Read` tool** and fix what looks wrong – wrong colours,
overlapping HUD, text too small on the phone, bins off-screen, etc. Iterate until it looks like a real
mobile game and there are no console errors. Also run a final `npx tsc --noEmit -p tsconfig.app.json`.

When done, report: files created, how the mechanics work, what you verified (screenshots + tsc), and any
known limitation.
