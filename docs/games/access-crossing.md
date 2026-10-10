# Hansab – Access Crossing (v2 – Subway Surfers style)

**Slug** `access-crossing` · **Component** `src/games/access-crossing/AccessCrossing.tsx` ·
**Inspired by** Subway Surfers (endless 3-lane runner, behind-the-back pseudo-3D view)
**Mock-up** `docs/mockups/access-crossing.png` – the **middle panel** is the target look: camera behind the
runner, three lanes converging to the distance, a row of coloured turnstile gates with signs, people and a
guard walking the corridor, red camera cone on the floor, a reception desk, a PIN keypad; the right panel
shows the elevator wall, the IDENTIFY VISITOR popup and the "ACCESS CARD COLLECTED" badge row.

> v1 was a Crossy Road hopper. v2 is an **auto-runner**: the Hansab employee runs forward through the smart
> building by himself and keeps getting faster. You only steer: swipe left/right to change lane, swipe up to
> jump, swipe down to slide. Every gate row needs the right badge in the right lane, cameras sweep the
> corridor, PIN doors want the code from a sticky note, reception asks you to identify a visitor, and the
> elevator at the end of each floor only takes you up if your card allows it.
> "Right people. Right access. A safer tomorrow."

## Look

- **Behind-the-back pseudo-3D** drawn on 2D canvas: vanishing point slightly above centre (horizon at
  ≈ 38 % of the height), ground plane below it, side walls converging. Everything is positioned in world
  units `(lane x ∈ {-1, 0, 1} × laneWidth, y height, z depth)` and projected with
  `scale = f / (f + z)`; draw far → near. Keep one `project(x, y, z)` function for everything (player,
  obstacles, pickups, floor lines, walls, shadows).
- Corridor: light marble floor (`#eef2f8` / `#dfe6f0` tiles) with blue lane arrows and lane separators,
  floor lines moving toward the camera with the running distance; glass walls on both sides (blue tint,
  city/sky behind in parallax, steel mullions), plants and pillars at intervals, ceiling light strips
  passing overhead, "Hansab" signage on the walls. Each floor has a tint: lobby (white/blue), offices
  (warm grey + blue carpet), lab (contractor orange accents), executive (purple/dark wood), server room
  (dark + red/blue LEDs). Crossy-Road-bright saturated colours remain: Hansab blue `#1b5fd1` /
  `#0d3b8c`, access colours EMPLOYEE green `#2bb673`, VISITOR blue `#2f80ff`, CONTRACTOR orange
  `#f28c28`, VIP purple `#8e44ad`, SECURITY LEVEL 3+ red `#e63946`.
- Player: blocky "voxel" person seen from behind – brown hair, dark-navy hoodie, backpack with a white
  "H", running animation (legs alternate, arms swing, slight bob), jump arc with shrinking shadow, slide
  (squashed, lower). Invulnerable = blinking.
- Obstacles / things in lanes (all drawn as blocky 2.5D sprites scaled by depth):
  - office workers (shirts in various colours) and a security guard (dark uniform + cap) walking toward
    the camera or standing – **lane change only** (hit = crash)
  - cleaning robot (round, white, blue light), mail cart, luggage trolley – **jump** over
  - boom barrier (red/white pole at chest height) – **slide** under
  - "wet floor" sign, planter box – **jump**
  - glass partition filling a lane – lane change
  - **camera zone**: a wall camera projects a translucent **red cone** on the floor that sweeps across the
    lanes with an on/off rhythm – passing through a lit lane while it is red = caught (crash). Visible
    well in advance so the player can time it or move away.
  - **gate row**: three turnstiles (one per lane) with glowing light bars and signs above
    ("EMPLOYEE ACCESS", "VIP ACCESS", "SECURITY LEVEL 3+" …); the lane whose badge you hold is lit green
    as you approach (after the badge check), locked ones show a red padlock; running into a locked gate =
    crash + "ACCESS DENIED – VIP badge needed". At least one gate always matches the current inventory.
  - **PIN gate row**: all three turnstiles locked with keypads; a yellow PIN sticky note pickup floats in a
    lane some distance before it. Reaching the row with a note: the run pauses and an HTML keypad popup
    opens showing the note; enter the 4 digits → gates open (+30 coins); 3 wrong tries → lose a heart and
    the guard opens it for you. Without the note: crash (lose a heart) and it opens.
  - **reception checkpoint** (once per floor): a desk spanning the corridor with a receptionist and a
    visitor with a "?" bubble; reaching it pauses the run and opens **IDENTIFY VISITOR** (cartoon face,
    Name, Company, Purpose, Appointment yes/no, Photo ID matches yes/no; valid ⇔ appointment ∧ ID match;
    ✓ Let in / ✗ Deny). Correct → +50 coins + VISITOR badge; wrong → lose a heart. Invented generic names.
  - **elevator wall** at the end of each floor: three elevator doors (one per lane) with screens
    (`EMPLOYEE · FLOORS 1-8`, `ALL ACCESS · LOBBY`, `VIP · FLOORS 20-30`, later `CONTRACTOR · LAB`,
    `SECURITY · SERVER ROOM`). Run into a door you may use: doors close, fade to black, "FLOOR 2/5" banner,
    +200 score (+20 EMPLOYEE / +100 VIP / +60 CONTRACTOR / +150 SECURITY bonus), speed steps up, new floor
    tint. ALL ACCESS always works. A locked door = crash, lose a heart, and you are shifted into the open
    lane. Floors 1–5 (floor length grows: 60 s → 90 s of running), then endless "FLOOR 6", "7" …
- Pickups: coins (lines of coins in a lane, sometimes in jump arcs), badges (floating colour cards with
  the name), PIN notes, and two power-ups: **coin magnet** (10 s, pulls coins from all lanes) and
  **escort shield** (absorbs one crash; a guard glyph next to the hearts). Badges are permanent for the run.
- HUD (HTML): pause, ⭐ score (distance + bonuses), 🪙 coins, three hearts (+ shield glyph), `FLOOR 1/5`
  chip, bottom-left row of badge cards held (coloured cards with icon + name like the mock-up's "ACCESS
  CARD COLLECTED"), a toast area, and a swipe hint on the first run ("← → lane · ↑ jump · ↓ slide").
  Place HUD so it never covers the lane the player is in (top row + bottom-left/bottom-right).
- Start screen like the mock-up's left panel: Hansab wordmark (text only), "Access Crossing", tagline,
  how-to, PLAY; game over: "Security caught you!" with score, best, floor, coins, badges, Play again, Hub.

## Mechanics

- Lanes: 3. Lane change = 120 ms eased slide; jump = 650 ms arc (height ≈ 1.1 units) at base speed,
  scaled with speed so jump *distance* stays constant; slide = 600 ms. Inputs during an action queue one
  deep. Swipe threshold 24 px, pointer capture; keyboard ← → ↑ ↓ / A D W S / Space (jump).
- Speed: start 9 units/s, +0.35 units/s every 10 s, +1.5 per floor, cap 22. Distance → score (1 point per
  unit) shown as ⭐.
- Spawning: generate "chunks" ahead (z = 60 → 0) from a seeded RNG: safe stretch (coins), obstacle
  pattern (1–3 lanes blocked with a guaranteed free path considering jump/slide), camera zone, gate row,
  PIN row, reception, elevator. Minimum reaction distance between consecutive obstacles scales with speed
  (≥ 0.9 s of travel). Never block all three lanes with lane-change-only obstacles. Floor 1 starts with a
  10-second easy stretch (coins, one cart to jump).
- Collision: AABB in lane/z/height space – a jumping player clears "jump" obstacles, a sliding player
  clears "slide" obstacles, a standing player collides. Crash: lose a heart, stumble (speed × 0.6 for 1 s),
  2 s invulnerability, the obstacle is removed; `sfx.denied` / `sfx.hit`. 0 hearts → game over.
- Score/coins/best via `storage`; floors and badges in the game-over stats. Pause with Esc/P/button.
- Performance: cap sprites in view (~60), cache the floor/wall gradients, draw far objects smaller with
  fewer details, no per-frame allocations in the projection path.

## Keep from v1

Reuse the existing visitor generator, PIN keypad popup, IDENTIFY VISITOR popup, badge inventory rules
and toasts (`lanes.ts`, `AccessCrossing.tsx`) where they fit; rewrite the rest. Delete files that become
obsolete (e.g. `laneArt.ts`) and list them in the report. File set must stay inside
`src/games/access-crossing/` (+ the scenario `scripts/scenarios/access-crossing.mjs`).

## Scenario for `scripts/scenarios/access-crossing.mjs`

Expose `window.__accessCrossing = { state: () => ({ speed, lane, floor, hearts, badges, nextEvents:
[{type, z, lane}] }), openVisitorPopup(), openPinPopup(), skipTo(type) }` (dev-only ok). Scenario: PLAY,
screenshot the running view at 0.5 s and 3 s; perform lane changes (ArrowLeft/Right), a jump and a slide
with screenshots mid-action; use `skipTo('gate')`, `skipTo('camera')`, `skipTo('pin')`,
`skipTo('reception')`, `skipTo('elevator')` to screenshot each event type as it approaches; open both
popups; trigger a crash and screenshot the stumble; let hearts run out for the game-over screen. Desktop
1280×800, phone portrait 390×844 (touch swipes via `page.touchscreen` or pointer drags) and landscape
844×390.
