# Puolustusvoimat – Signal Command

**Slug** `signal-command` · **Component** `src/games/signal-command/SignalCommand.tsx` ·
**Replaces** the old `command-base` game (delete nothing outside your folder; the lead removes it).
**Inspired by** Helldivers 2 – the *Stratagem Hero* arcade terminal on the ship: the machine shows a
command name and its arrow code, you hammer the arrows in order as fast as you can, a wrong arrow
resets that code, rounds get longer and the codes harder, combo and perfect-round bonuses.
**Mock-up** `docs/mockups/signal-command.png` – study it first; it is the target look almost 1:1.

> You are the signals operator of the Finnish Defence Forces' command network. Incidents hit the
> network across Finland – "Northern relay – SIGNAL LOST" – and every fix is a **command code**: a
> sequence of arrows you must enter in order before the wave timer runs out. Easy codes are three or
> four arrows, hard ones seven or eight. Chain commands without mistakes for a combo, clear waves for
> time bonuses, keep the systems online. *Communications · Networks · People – a more secure Finland.*
> **Not a war game**: there are no enemies and no weapons; every command is about restoring
> communications, networks and power.

## Assets (already in your folder – use them)

- `finland.ts` – `FINLAND_RINGS` (simplified outline polygons of Finland in a normalised 0..1 square,
  largest ring first), `FINLAND_CITIES` (city anchors in the same space: Helsinki, Turku, Tampere,
  Vaasa, Oulu, Rovaniemi, Kuopio, Joensuu, Lappeenranta, Jyväskylä, Kajaani, Sodankylä, Ivalo, Kemi,
  Mikkeli) and `FINLAND_ASPECT`. Draw the map with these on a canvas or as an inline SVG path.
- `assets/bg-wide.jpg` (1920×1086) and `assets/bg-tall.jpg` (724×1280) – photoreal command-centre
  backgrounds (operator with headset in the lower centre, monitors, aurora window). Use `bg-wide` for
  landscape viewports and `bg-tall` for portrait (`import bgWide from './assets/bg-wide.jpg'`), as a
  CSS `background-image` (cover, centre) under the HUD, darkened with a gradient overlay so panels stay
  readable (the mock-up shows exactly this composition: the operator peeks out under the centre panel).
- `assets/sector-{lapland,oulu,west,turku,helsinki,east}.jpg` (640×358) – briefing photos for the six
  sectors; show the active sector's photo in the command panel header (mock-up: the small aurora photo
  top-right of "RESTORE RADIO LINK") and in the wave intro.
- Everything else (arrows, icons, map, panels, effects) is drawn with HTML/CSS/canvas – no emoji.

## Look (copy the mock-up)

- Dark tactical UI on the photo background: near-black navy panels (`rgba(6,14,24,0.86)`) with 1 px
  cyan borders (`#19c8ff` at 50 %), clipped corners (CSS `clip-path` polygon notch on two corners),
  faint scanline texture, uppercase condensed labels (`Nunito` 800, letter-spacing 0.1em), big numbers
  in `Baloo 2`. Accent colours: cyan `#19c8ff`, signal green `#36ff6a`, amber `#ffb020`, alert red
  `#ff3b3b`. Glows via `box-shadow`/`text-shadow`.
- **Top bar**: left a gold lion-free emblem (a simple shield glyph with a radio-wave arc – do **not**
  draw the Finnish coat of arms) + "PUOLUSTUSVOIMAT / SIGNAL COMMAND" wordmark + the strapline
  "Communications · Networks · People – a more secure Finland"; then chips: `MISSION WAVE 3/5
  Northern Sector` with a 5-segment bar, `SCORE 012450` with a floating `+750`, `COMBO x12` in amber,
  `TIME 00:23` with a circular gauge that turns amber then red, pause.
- **Left column**: `NETWORK STATUS` – the Finland map (dark fill, cyan outline glow, faint grid) with
  six sector nodes connected by dotted links: Lapland (Sodankylä/Ivalo area), Oulu, West Coast (Vaasa),
  Turku, Helsinki, Eastern Sector (Joensuu/Kuopio). Node states: online (green ring + mast glyph),
  incident (red pulsing triangle), offline (grey). Counters ONLINE / INCIDENT / OFFLINE. Below it
  `ACTIVE INCIDENTS`: the current wave's remaining commands as incident rows ("Northern relay –
  SIGNAL LOST  00:42"), the active one highlighted red.
- **Centre panel** (the game): header with the command's glyph + name (`RESTORE RADIO LINK`), the
  incident subtitle ("NORTHERN RELAY – Re-establish encrypted link to restore network coverage"), the
  sector photo; a 4-step strip (`1 ROUTE · 2 SYNC · 3 CALIBRATE · 4 RESTORE`) whose steps tick as
  quarters of the code are entered; the **arrow row**: one big bevelled box per arrow (≥ 72 px on
  desktop, ≥ 48 px on phones; wrap to two rows for 7–8 arrows on phones), entered arrows glow green,
  the next one pulses cyan, a wrong input flashes all boxes red and shakes the row; the wave **time
  bar** with the remaining seconds; feedback text (`PERFECT!`, `GOOD`, `MISS`) and `COMBO x12 +750`;
  the **D-pad** (↑ ← ● → ↓, large octagonal buttons) for touch/mouse input; speed-line burst behind the
  arrows on each correct input.
- **Right column**: `NEXT COMMANDS` – the next four commands of the wave with their arrow codes in
  small boxes (numbered 1–4, glyph, name). `SYSTEMS` – six bars: Radio network, Satellite link, Data
  network, Server systems, Power supply, Security, each with a glyph and a percentage.
- **Bottom bar**: `OPERATIONAL INTEGRITY` segmented bar, `LIVES` three hearts, `ACCURACY 98 %`,
  result toast `✓ LINK RESTORED +750 XP`.
- Phone portrait: top bar → two compact rows (wordmark + wave/time; score/combo); the centre panel
  fills the width with the arrow row and D-pad; NEXT COMMANDS as a horizontal strip under it; map,
  incidents and systems collapse into a swipeable/tabbed bottom sheet or a `STATUS` toggle. Phone
  landscape: three columns with the map small. Everything must stay playable one-handed.

## Mechanics (Stratagem Hero rules, themed)

- **Command catalogue** (`commands.ts`): ~24 commands with **fixed codes** (players memorise them,
  like real stratagems). Arrows only ↑ ↓ ← →. Tiers by length: *easy* 3–4, *medium* 5–6, *hard*
  7–8. Each has a name, a glyph id, a short incident subtitle, the system it restores and a four-step
  label set. Examples (final codes are yours – avoid two commands sharing the same first three arrows):
  `RESTORE RADIO LINK ↑→↓→↑←` (radio), `SATELLITE SYNC →→↓↑` (satellite), `REBOOT SERVER ↑↑←→`
  (servers), `ROUTE DATA ↓→↓→` (data), `ACTIVATE NODE ↑↓↑←` (radio), `ENCRYPT CHANNEL ←↑→↓↓`
  (security), `FREQUENCY HOP ↑←↑←→` (radio), `BACKUP POWER ↓↓↑←→` (power), `UPS FAILOVER ↓←↓←↑↑`
  (power), `DEPLOY REPEATER ↑↑→↓←` (radio), `CALIBRATE ANTENNA →↑←↑→↓` (satellite), `RELAY HANDOVER
  ←→←→↑` (radio), `NETWORK REROUTE ↓←→←↓↑` (data), `PATCH DEPLOY ↑→→↓←↑` (servers), `DNS FLUSH ↓↓←`
  (data), `TIME SYNC ↑←↓` (data), `LINK DIAGNOSTIC →↓↑` (radio), `SECURE UPLINK ↑→↑→↓←↑` (security),
  `FIREWALL LOCK ←←↓↑→↓→` (security), `EMERGENCY BROADCAST ↑↑↑↓←→↓→` (radio), `GRID RESTORE
  ↓→↑←↓→↑←` (power), `CELL HANDOVER →↑↓←→` (data), `LOG AUDIT ←↓→↑↑↓` (security), `COLD START
  ↓↓↓↑→←↑` (servers).
- **Mission** = 5 waves, one sector each in order Helsinki → Turku → West Coast → Oulu → Eastern
  Sector; wave 6+ (endless) cycles sectors with Lapland and raises difficulty. Wave `n` has
  `4 + n` commands (wave 1: 5, wave 5: 9), drawn from tiers by wave: w1 easy only, w2 easy+medium,
  w3 mixed, w4 medium+hard, w5+ hard-weighted; no immediate repeats. Each command is one incident on
  the map (sector node turns red with a timer until it is solved).
- **Wave timer**: `time = Σ(arrows) × 0.9 s + 4 s` (wave 1 ≈ 20 s), shown on the bar and the gauge.
  Entering the arrows: keyboard ← ↑ → ↓ / WASD, on-screen D-pad (pointer), and swipes on the centre
  panel (Helldivers feel). Correct arrow: box lights green, click `sfx.tap`, speed lines. Wrong arrow:
  the current code's progress resets, red flash + shake, `sfx.bad`, combo resets, `misses++`.
  Completing a code: boxes flash white, `sfx.good` (every 4th combo `sfx.combo`), score
  `+ (50 × arrows) × multiplier`, the incident on the map turns green, the system bar heals +8 %, toast
  `✓ LINK RESTORED +750 XP`. Multiplier = `min(12, 1 + flawlessStreak)` shown as `COMBO x12`.
- **Wave clear**: remaining time × 25 bonus, `PERFECT!` (+500) if no misses in the wave, systems all
  +5 %, 1.5 s interlude with the next sector's photo and name, then the next wave starts (timer
  resets). **Wave timeout**: the unsolved incidents hit their systems (−15 % each), lose **one life**,
  `MISSION INTEGRITY` drops, the wave restarts with fresh codes of the same wave number. 0 lives →
  **mission failed** debrief. Operational integrity = average of the six systems; systems also decay
  slowly (−0.5 %/s) while any incident is open, so speed matters; if integrity < 20 % the mission
  fails too.
- **Scoring display**: score counts up smoothly; accuracy = correct arrows / all arrows; the debrief
  after a failed mission or after wave 5 ("MISSION COMPLETE – continue?") shows score, best (via
  `storage`), waves cleared, accuracy, best combo, perfect waves; buttons Continue (endless), Play again,
  Hub. Pause (Esc/P) and the start screen (Overlay: emblem, title, how-to with the arrow keys, PLAY;
  show the best score). First wave shows a hint "Type the arrows in order – wrong arrow resets the
  code" and starts with a 3-arrow code.
- Keep a dev hook `window.__signalCommand = { state: () => ({ wave, sector, score, combo, lives,
  timeLeft, current: { name, code, progress }, queue, systems, accuracy }), press: (dir) => void,
  solveCurrent: () => void, failWave: () => void, skipToWave: (n) => void }`.

## Scenario for `scripts/scenarios/signal-command.mjs`

Click PLAY, screenshot the first command; press the correct arrows one by one with 120 ms gaps
(screenshot after two), press a wrong arrow (screenshot the red flash), solve the rest of the wave
through the hook/keys (screenshot `PERFECT!` and the wave interlude), use the D-pad with mouse clicks
for one code, `skipToWave(5)` to screenshot a hard 8-arrow code and the full map state, `failWave()`
twice for the lives/integrity drop, run lives out for the debrief, and pause. Desktop 1280×800, phone
portrait 390×844 (tap the D-pad with `page.touchscreen.tap`, test a swipe), landscape 844×390.
