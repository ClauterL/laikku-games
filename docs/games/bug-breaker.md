# Infomaatti – Bug Breaker

**Slug** `bug-breaker` · **Component** `src/games/bug-breaker/BugBreaker.tsx` ·
**Inspired by** Angry Birds · **Physics** `matter-js` (installed, typed via `@types/matter-js`)
**Mock-up** `docs/mockups/bug-breaker.png` (study it first).

> The funniest one of the series. Pull back the slingshot and fire code blocks at the towers the bugs
> built. HTML is the basic block, CSS smashes an area, JS explodes, Python is a heavy special attack,
> SQL drills through several layers. Squash BUG, 404, NULL and SYNTAX ERROR to clear the level.

## Look (copy the mock-up)

- Bright cartoon daytime: sky gradient `#5ec8ff` → `#bfe9ff`, puffy clouds, a Finnish lake with
  pine-covered islands and a small castle island carrying a `</>` flag in the distance, rocky cliffs,
  green rolling hills `#5ab040`, grass tufts in the foreground. The slingshot stands on a grassy ledge
  at the left; the bug structures sit on a plateau at the right. Title lock-up top-left: wooden sign
  "INFOMAATTI" (chunky yellow letters with brown outline) + "BUG BREAKER" and the strapline "Launch
  code. Break bugs. Build a cleaner world!". A small wooden sign "GOOD CODE · STRONGER WORLDS" on the
  left hill.
- Blocks (rectangles of various sizes, drawn with 2–3 px dark outline and highlights):
  **wood** `#c8893a` with grain lines (HP 40), **stone** `#9aa3ad` with cracks (HP 100), **ice/glass**
  `rgba(174,232,255,0.85)` with shine (HP 20). Damaged blocks show cracks; destroyed blocks burst into
  debris particles of their colour. Decorative **sign blocks** are wood blocks with text: "BUG",
  "404 NOT FOUND", "NULL", "SYNTAX ERROR" (a dark monitor-style block with red text).
- Bugs (circular bodies with faces, antennae, little legs, angry/scared expressions, blink animation):
  **BUG** red ladybug (HP 30, 500 pts), **404** chunky orange-red bug with a hard hat (HP 50, 700),
  **NULL** pale green-white ghostly bug (HP 40, 600), **SYNTAX ERROR** purple bug with glasses and a
  red "SYNTAX ERROR" badge (HP 70, 1000). Squashing → "SQUASHED!" / "FIXED!" float text, green splat
  particles, score.
- Ammo cubes (rounded cubes with a label and glyph, slight 3-D bevel): **HTML** red `#ff4a3d` `</>`,
  **CSS** blue `#3b8bff` `{}`, **JS** yellow `#ffd400` "JS" with spark lines, **PYTHON** blue/yellow
  snake-ish glyph `#3776ab`/`#ffd43b`, **SQL** purple `#8e44ad` "SQL" with a drill streak.
- Bottom ammo bar (like the mock-up): five cards HTML / CSS / JS / PYTHON / SQL with the current one
  highlighted (yellow outline) and its description underneath ("Basic block. Good for a start!",
  "Area-effect smash!", "Explosive destruction! Tap mid-air.", "Powerful special attack! Tap to boost.",
  "Penetrates multiple layers!"). Top-right: `SCORE 12,450`, `SHOTS LEFT 3` (slingshot glyph), pause.
  Bottom-right wooden sign "CODE YOUR WAY TO VICTORY!" on the title screen.
- Aiming: the rubber bands of the slingshot stretch to the cube; a dotted trajectory preview
  (gravity only) is drawn while aiming; after launch a dotted trail of where the cube went stays until
  the next shot. Camera: the world is 1600×900 units, scaled to fit the canvas (letterbox, min scale)
  on desktop and phone landscape; in phone portrait scale by width and let the hills fill the lower
  part – keep the slingshot and the structure both visible. Light screen shake on explosions and heavy
  impacts; slow motion (0.3×) for 0.8 s when the last bug dies.

## Mechanics (Matter.js)

- `Engine.create({ gravity: { y: 1.2 } })`, static ground + plateau bodies, structures from
  `levels.ts`. Custom canvas rendering – do **not** use Matter's `Render`; use `Matter.Runner`-free
  manual stepping (`Engine.update(engine, dt*1000)` with a fixed 1/60 step and an accumulator).
  Bodies carry a `plugin`/label with `{kind:'block'|'bug'|'ammo'|'ground', material, hp, maxHp, score}`.
- Slingshot: when a shot is ready, a cube sits in the pouch. Pointerdown near the pouch (≤ 80 px)
  starts aiming; drag back up to 110 px; release launches with velocity = `pull × 0.22` (tune so a
  full pull reaches the far structure), `sfx.launch`. The cube is created as a dynamic body on release
  (while aiming it is drawn only). A shot ends when the cube sleeps / leaves the world / 6 s have
  passed, then the next cube loads. Tap anywhere during flight to trigger the special.
- Damage: on `collisionStart`, impact = relative speed × min(massA, massB); damage = impact × 1.6
  (tune so a direct HTML hit at full pull breaks a wood block and damages stone). Bugs take damage
  from anything (falling blocks too); blocks at 0 HP are removed with debris; bugs at 0 HP are
  squashed. Also bugs that fall off the world die.
- Specials:
  - **HTML** – nothing special, decent mass.
  - **CSS** – on first impact: radial force + 35 damage to every body within 140 px ("area-effect
    smash" shockwave ring).
  - **JS** – tap in flight → explodes: radius 200, strong force, 60 damage falling off with distance;
    explodes automatically 0.4 s after its first impact if not tapped. `sfx.explode`.
  - **PYTHON** – density 2.2×, damage 2×; tap in flight → instant speed boost (×1.8 in its current
    direction, once) with a streak trail.
  - **SQL** – penetrates: on hitting a block with HP ≤ 60 the block is destroyed outright and the cube
    keeps 85 % of its velocity (collision response suppressed for that pair by temporarily making the
    block a sensor before removing it); up to 3 penetrations, then it behaves like HTML. Drill trail.
- Levels (`levels.ts`, 6 hand-made): each defines the ammo queue (e.g. L1 `[HTML, HTML, CSS]`), the
  structures as a list of `{x, y, w, h, material, angle?}` and bugs `{x, y, kind}`; later levels use
  all five ammo types, mixed materials, bugs sheltered behind stone, a bridge, a tall tower with a
  "404" sign, and the final one with SYNTAX ERROR on top of a glass tower. Levels must be beatable
  with the given ammo (test by playing a few of your own shots in the scenario).
- Level complete when all bugs are gone: wait 1.2 s, then overlay "LEVEL CLEARED" with stars
  (3 if ≥ 2 shots left, 2 if 1, else 1), score (+1000 per unused shot), Next level. Out of ammo and
  bugs remain (after bodies settle, ≤ 4 s): "BUILD FAILED" overlay with Retry. After level 6:
  "ALL BUGS FIXED" final overlay with total score, best, Play again, Hub. Progress saved.
- Keyboard: Space/tap = special, R = restart level.

## Scenario for `scripts/scenarios/bug-breaker.mjs`

Expose `window.__bugBreaker = { pouch: () => ({x,y}) in CSS px, bugs: () => n, level: () => n, loadLevel: (n) => void }`.
Click PLAY, screenshot; drag from the pouch down-left ~100 px with `page.mouse` (steps 10),
screenshot while aiming, release, wait 1 s, screenshot mid-flight / impact, wait 4 s, screenshot the
aftermath; fire again and press Space mid-air for the special; load level 6 and screenshot it. Desktop
and phone (landscape 844×390 too: use `page.setViewportSize`).
