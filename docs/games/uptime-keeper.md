# Ficolo – Uptime Keeper

**Slug** `uptime-keeper` · **Component** `src/games/uptime-keeper/UptimeKeeper.tsx` ·
**Inspired by** Overcooked-style top-down arcade management (run to stations, act under pressure)
**Mock-up** `docs/mockups/uptime-keeper.png` (study it first – neon top-down data centre, HUD layout).

> A top-down data-centre arcade. You are the Ficolo technician running between the server racks and
> keeping the whole hall alive. The goal is not just points: keep **Uptime** as close to 100 % as
> possible while problems pop up all over the floor. Rack 07 is at 92 °C – get there and COOL it
> before it hits 100 °C.

Code map: `sim.ts` (pure rules, seeded RNG, headless) · `levels.ts` (level table + hall layout) ·
`pathfind.ts` (grid A*) · `engine.ts` (input, camera, effects, HUD view-model, dev hooks) ·
`render.ts` (canvas) · `drone.ts` (decorative banner drone) · `hudtext.ts` / `glyphs.ts` (texts, icons) ·
`UptimeKeeper.tsx` + `uptime-keeper.css` (React HUD) · `sim.check.ts` (headless balance + rules checks).

## Look (copy the mock-up)

- Dark industrial floor (`#1a1d24` / `#232833` tiles with a subtle grid, yellow-black hazard stripes
  at aisle ends), walls with vents and panels. **Neon pipes** run along the floor/walls and connect
  the infrastructure to the rack rows: cooling **blue** `#1ec8ff`, power **yellow/orange** `#ffb020`,
  network **green** `#39ff7a`, heat/alert **red** `#ff2d3a`. A Ficolo floor pad in the middle (text
  wordmark "Ficolo" + a simple red cube glyph – do **not** copy a real logo).
- Racks: dark cabinets seen from above/front (2.5D: visible front face with rows of tiny blinking
  LEDs green/blue/orange), a glowing status frame (green healthy, orange warning, red alert, grey off),
  a floating alert icon above (🔥 heat waves, 🔧 wrench, 🌐 wifi-off, ⚡ bolt, ⬆️ chevrons – all drawn
  as vector glyphs), temperature readout when selected/near. Overheating racks pulse red with heat
  shimmer; shut-down racks go dark with a red ✕. A *slow* rack (customer complaint) gets lazy amber
  LEDs and a snail badge; an *infected* rack glows purple with a skull badge, sick LEDs and a purple
  spill on the floor.
- Stations: **cooling station (CRAC)** – blue unit with snowflake glyph and frost mist; **PDU/UPS** –
  yellow cabinet with lightning glyph; **core switch cabinet** – green cabinet with network glyph and
  blinking link lights; **upgrade terminal** – a console with green chevrons (upgrades can also be
  done at the station they affect).
- **Entrance** (every hall from level 2): a gap in the left wall near the bottom with sliding glass
  doors, pink-lit posts, hazard stripes and a door mat with a person glyph. Customers use it.
- Player: Ficolo technician in a **red jumpsuit** with a white "F" badge, top-down blocky look, running
  animation, a small tool glow when acting. Progress ring over the head while repairing.
- **Customers** (level 6+): voxel/neon business visitors – bright suits (blue, grey, tan, burgundy,
  teal, violet), tie, skin/hair variants, carrying a coffee cup, a laptop or a phone. Upset ones tap a
  foot; a pink patience ring on the floor around them; a white speech bubble with the complaint (rack
  name in pink) and a patience gauge with the seconds left. Happy: thumbs-up bubble; angry: dark red
  bubble, shaking, steam puffs, storming out fast.
- **Virus** (level 11+): a glowing purple bug-blob with acid-green eyes, legs and antennae, an RGB-split
  glitch, a fading pixel trail and green/purple pixel particles; while it infects a rack it reaches
  out with tendrils and a progress ring. Quarantine = zap arcs, rings and a pixel burst.
- **Banner drone** (outside the hall, purely decorative): see *Banner drone* below.
- HUD (HTML, dark glass panels with neon borders):
  - top bar: `Ficolo | UPTIME KEEPER` wordmark, `SCORE 004820`, `LEVEL 03`, `UPTIME 99.7 %` with a
    green segmented bar; below it three meters **COOLING** (blue), **POWER** (yellow), **NETWORK** (green)
    as segmented bars with glyphs.
  - left: **OBJECTIVES** panel = the active alert list sorted by priority (`Rack overheating – Cool to
    safe temperature`, `Replace fan – Serv-02-B`, `Restore network – Core Switch`, `Upgrade cooling – Zone
    B`), each with its glyph and a chevron; tapping one highlights the target and, on touch devices,
    sends the technician there. Customer rows (person glyph) carry a patience bar; virus and infected
    rows are purple; an escalated customer stays for 4.5 s as a struck-out red "Failed" row.
  - bottom-left: **DATACENTER MAP** mini-map with alert icons, the entrance, customer dots with a
    patience arc and the virus.
  - bottom-centre: three big action buttons **COOL [1]** (blue), **REPAIR [2]** (red), **UPGRADE [3]**
    (green) – enabled only when the technician is next to a valid target; UPGRADE shows the cost. Next to
    a customer the REPAIR button becomes **TALK** (pink, `+15 S`, then `PROMISED`); next to a virus it
    becomes **ZAP** (purple, `QUARANTINE`).
  - bottom-right: detail card for the nearest / selected alert: `RACK OVERHEATING · Temperature at 92 °C
    · Cool the rack using a nearby cooling station` with a red bar `92 °C / 100 °C`. Customers and the
    virus have their own cards (complaint, patience, what to do).
  - Phone portrait: top bar compact (uptime + meters), map hidden, objectives as a horizontal chip row,
    the three action buttons large at the bottom, detail card as a toast above them. Movement on touch:
    **tap-to-move** (tap a tile/rack/customer/virus → A* path) plus a small virtual joystick on the left.
  - Off-screen alerts and waiting customers get pulsing arrows at the screen edge (bubbles of
    off-screen customers are hidden – the arrow, chip and card carry the information).
- Effects: cold mist particles on COOL, sparks on REPAIR, green rising chevrons on UPGRADE, red screen
  vignette while any rack is critical, uptime number flashes red when it drops, "SERVICE DOWN" banner on
  a shutdown; banners "HAPPY CUSTOMER", "CUSTOMER ESCALATED", "VIRUS DETECTED", "VIRUS QUARANTINED".
  Sounds via `sfx` (`repair`, `good`, `alarm`, `bad`, `coin`, `win`, `lose`, `pop`, `connect`).

## Mechanics

- Grid-based hall (tile = 48 px desktop / 40 px phone). Rack rows form aisles; the technician moves
  freely (8-direction, WASD/arrows, 4.5 tiles/s) with wall/rack collision, or by tap-to-move (A*).
  Camera: whole hall fits on small levels; larger halls scroll with the player (smooth follow) and the
  mini-map shows the viewport.
- **Racks**: `temp` (°C; ambient 24), `fanOk`, `psuOk`, `linkOk`, `powered`, `serverLevel` 1–4, `down`,
  `perf` (slow – customer complaint), `infected` (malware).
  Heat per second = `baseLoad(serverLevel) × heatFactor − coolingEffect`; with a broken fan ×2.5.
  `heatFactor` shrinks 20 % per Cooling level; coolingEffect comes from the zone's cooling station
  (capacity shared by its racks). Warning ≥ 80 °C, critical ≥ 90 °C, **shutdown at 100 °C** (rack down
  until it is cooled below 70 °C and REPAIRed/rebooted).
- **Heating speed** (owner request: half the heating time). Every heat-up path runs at
  `HEAT_SPEED = 2` × the original rate; cooling (COOL −30 °C, boost, relax, CRAC capacity, pool) is not
  scaled. Constants: hot-spot rate `HOT_RATE` 1.7 → 3.4 °C/s, hot-spot ramp 0.5 → 1.0 /s, dead-fan
  rate `FAN_RATE` 1.3 → 2.6 °C/s, dead-fan ramp 0.3 → 0.6 /s, server-level creep `ORGANIC_RATE` 1 → 2,
  idle warm-up `WARMUP_RATE` 1 → 2; the level-1 lessons move on after 17.5 s / 15 s (were 35 s / 30 s).
  Measured time to 100 °C from a healthy rack: hot spot 12.9 s (was 25.8 s), dead fan 23.4 s (46.7 s),
  tutorial hot spot 39.1 s (78.3 s), Lv4 server without cooling 44.3 s (88.7 s).
- **Alerts** (spawn interval ramps per level, 14 s → 6.5 s over the seven halls, −0.5 s per endless
  level, min 3.5 s; max simultaneous grows 1 → 5, +1 every two endless levels, max 7):
  - 🔥 **Overheating** – a rack's heat ramps up (hot spot); needs **COOL** at the rack.
  - 🔧 **Fan / PSU failure** – `fanOk=false` (rack heats ×2.5) or `psuOk=false` (rack may lose power);
    needs **REPAIR** at the rack: hold 3 s (minor) / 6 s (major) with a progress ring.
  - 🌐 **Network fault** – at a switch cabinet; all racks in its zone are *degraded* (count against
    uptime at 50 %); needs **REPAIR** at the switch (4 s) – or an instant *swap* when the player has a
    spare switch (earned from upgrades). The detail card says "Switch 2 disconnected – 8 racks affected".
  - ⚡ **Power fault** – UPS overload / PDU trip at the power unit; racks in the zone run on battery for
    10 s (40 s from level 5 with the UPS) then go down; needs **REPAIR** at the PDU (5 s).
  - 👤 **Unhappy customer** (level 6+) – a slow rack; **REPAIR** it (3 s). See *Customers*.
  - 🦠 **Virus / infected rack** (level 11+) – catch the virus, **REPAIR** infected racks to clean
    them (4 s). See *Virus*.
  - ⬆️ **Upgrade available** – appears when credits ≥ next upgrade cost; purely optional.
  Objective order: virus → infected → down → power → heat → network → customer → PSU → fan → upgrade
  (containment before recovery).
- **Actions** (keys 1/2/3, buttons, or E for "the sensible action here"):
  - **COOL** (fast first aid): −30 °C instantly + a 10 s cooling boost on the targeted rack; costs 20 % of
    the **Cooling** meter (regenerates 4 %/s, faster with Cooling level). Empty meter → weak COOL (−8 °C).
  - **REPAIR**: fixes the physical fault at the target (rack fan/PSU, switch, PDU); duration by severity;
    interrupted if the player walks away. Also reboots a shut-down rack once it is cool, fixes a slow
    rack (3 s) and cleans malware from an infected rack (4 s, "Clean malware"). Next to a customer it
    is **TALK**, next to a virus **ZAP**.
  - **UPGRADE** (permanent, costs credits; credits come from uptime ticks + resolved alerts):
    `Cooling Lv1→Lv2` racks heat 20 % slower and the cooling meter max +25 %;
    `Network Lv2→Lv3` network faults 30 % rarer and repair faster;
    `Server Lv3→Lv4` on a rack: +50 % score/s from that rack **but +35 % heat and +power draw** – the
    trade-off that makes the game interesting. Costs: 120 / 200 / 320 … per level.
- **Meters**: Cooling = remaining capacity pool; Power = consumption / capacity (consumption grows with
  server levels; above 90 % power faults spawn twice as often; UPS level raises capacity); Network =
  infrastructure health (drops with faults, recovers on repair).
- **Uptime** = availability over a one-hour SLA window: `1 − penalty / (racks × 3600)`, where a down or
  infected rack adds 1 rack-second per second and a degraded or slow rack 0.5. Display with three
  decimals (`99.987 %`). Uptime is the main score; the SCORE counter adds credits earned. Level
  targets: pass ≥ 99.5 %, ★★ ≥ 99.9 %, ★★★ ≥ 99.95 %; fail (SLA breached) if uptime < 98.0 % or if
  more than half the racks are down for 15 s.
- **Progression** (each level 2.5 min; a level-clear overlay explains what the next level adds, then the
  next hall loads):
  1. **First hall – 6 racks** (2 rows × 3), 1 cooling station, 1 PDU, 1 switch – only overheating + fan faults
  2. **Second rack block – 12 racks**, network faults, upgrade terminal
  3. **Two zones – 20 racks**, power + PSU faults
  4. **Redundant cooling**: second CRAC, cooling pool ×2, racks heat 15 % slower
  5. **UPS + backup power**: 24 racks in three rows; power faults give 40 s battery instead of 10 s
  6. **Customer service**: customers walk in (see below); automated monitoring – alerts appear at
     70 °C and hot racks auto-cool while the pool is > 50 %
  7. **Large data centre**: 28 racks, 2 switches, 2 PDUs, 3 CRACs, scrolling camera
  8. – 10. **Endless shift**: same hall, faster alerts, more at once
  11. **Malware outbreak**: one virus (see below); 12 the same with a faster virus
  13. **Twin viruses**: up to two viruses at once; 14+ **Endless outbreak**
  The player should *feel* the automation: by level 6 some alerts resolve themselves.
- First seconds of level 1 are a guided tutorial: one rack overheats slowly, an arrow points to it,
  the detail card says "Walk to Rack 03 and press COOL [1]". Then a fan failure with "REPAIR [2]".
- Pause (Esc/P), restart level (R). Progress (level reached, upgrades) and best uptime/score via
  `storage`; Start screen offers CONTINUE (level N) + New game.

## Customers (level 6 and up, including endless)

- The first customer arrives 12–18 s into the shift, then one every 35–55 s; at most **2** waiting at
  once; nobody arrives in the last 38 s of a shift. A customer walks in through the entrance and along
  the aisles (A*) to a free spot 2–7 tiles from the door (never on a rack/station front or the floor
  pad, and away from the other visitor's bubble), then waits facing the hall.
- Each complaint is tied to one healthy rack, which gets a *performance fault* (slow: counts as
  degraded, 0.5) and a "Unhappy customer – Rack 12 slow · 27 s left" objective. Complaints rotate
  through eight lines ("Our webshop is crawling – Rack 12!", "I can't reach my VM on Rack 07!", …).
- **Patience** 30 s (ring + seconds in the bubble, the objective bar and the floor ring). It holds while
  the technician is repairing that rack.
- **TALK** (REPAIR button / key 2 / E next to the customer, ≤ 1.05 tiles): once per customer, +15 s
  patience. The technician says "We're on it!", the customer answers "OK – please hurry!".
- **Resolve**: REPAIR on the slow rack (3 s, "FAST AGAIN") → the customer leaves happy (thumbs-up
  bubble, "Happy customer" banner), +60 credits (+60 score) + 2 score per second of patience left.
- **Timeout**: the customer escalates – angry bubble, storms off, −40 credits (as far as the wallet
  goes) and an SLA credit worth 0.02 percentage points of uptime ("Customer escalated – SLA credit");
  the objective turns into a red "Failed" row for 4.5 s and the rack's slow fault is cleared.
- Level 6's intro explains the mechanic; the first arrival also shows a hint in the tip line.

## Virus (level 11 and up)

- The first virus crawls out of a network port (a switch cabinet) 8–12 s into the shift; on level 13+
  a second one follows 25 s later. At most 1 virus at once on levels 11–12, 2 from level 13.
- It roams the aisles by A* at 1.5 tiles/s on level 11, +0.1 per level (max 2.5), hunting racks –
  healthy racks are 4× more attractive than troubled ones, nearer ones more than far ones. After
  **2 s** next to a rack the rack is **infected** (purple glow, skull, counts as fully down); the virus
  then roams 4–7 s and hunts the next rack.
- An infected rack infects one adjacent rack (left/right in the row, or the one in the same column of
  the next rack row – running racks first) every ~12 s (±10 %) until it is cleaned. **REPAIR** on an
  infected rack = "Clean malware" (4 s, +30 credits); the spread timer holds while it is being cleaned.
- **Quarantine**: walk into the virus (≤ 0.5 tiles) or press REPAIR / ZAP / E within 1.05 tiles →
  +50 credits/score, zap effects, "VIRUS QUARANTINED". The next virus comes out of a port 45–60 s later.
- Viruses, infected racks and the catch are listed in OBJECTIVES, shown on the mini-map and in the
  detail card; level 11's intro explains the outbreak, level 13's the twin viruses.

## Banner drone

Purely decorative, drawn in screen space outside the hall: a top-down quadcopter (X frame, four
spinning rotors, red stripe, blinking red/green nav lights and a white strobe, soft shadow) towing a
fluttering banner that reads exactly **Construct, Automate, Explore & Exploit**.

- The engine measures the HTML HUD panels every frame and computes the hall's screen rectangle (plus
  its glowing shell and the entrance); twice a second – and at once when a panel changes size – the
  drone picks the free area with the most room and the most readable banner format (one line,
  two/three/four lines, or a vertical streamer for tall narrow margins) and flies a slow figure-eight
  there, the banner swinging like a pendulum underneath (wide flyers swing less). It never crosses the
  HUD panels or the hall: it flies in (at most 170 px/s) from a screen side whose way in is clear, or
  fades in on the spot; a new area on the other side of the hall is reached by fading over.
- When no margin is big enough (phones, the widest halls) it makes a quick pass along the hall's top
  edge every 16–24 s, towing the banner on a rope behind it – above the back wall, under the alert
  badges, only while that edge is on screen and its flight band is clear of HUD panels (it fades out
  if a panel grows into the band or the camera scrolls the edge away).
- It pauses with the game (own clock), and stays cheap: the banner is a cached texture drawn in thin
  slices for the flutter.

## Scenario for `scripts/scenarios/uptime-keeper.mjs`

Dev hooks on `window.__uptimeKeeper` (dev only):
`state()` → `{ phase, level, time, uptime, score, credits, alerts:[{id, type, target, value}], player,
meters, racks:[{id, temp, down, level, perf, infected}], stations, customers:[{id, rackId, complaint,
state, mood, patience, talked, x, y}], viruses:[{id, mode, rackId, x, y, dwell}], infected:[rackId],
stats:{happy, escalations, quarantined, infections, cleaned}, hall:{cols, rows, door}, drone, … }`,
`moveTo(targetId)` (racks, stations, customers, viruses), `act(action | 'smart')`,
`spawn(type, targetId?, value?)` (alert types plus `'customer'` (rack id), `'virus'` (switch id),
`'infected'` (rack id); `spawn('heat', id, 0)` keeps the natural heat ramp), `setLevel(n)`,
`patience(customerId, seconds)`, `drone({ flyby? })` (mode, bounding box, HUD/hall overlap counts),
`screenPos(id)`, `skip(seconds)`, `finish()`, `bench(n)`.

Scenario (desktop 1280×800 and phone 390×844, tap-to-move via `page.touchscreen.tap`): PLAY, tutorial
COOL + REPAIR, the level-1 heating ramp (natural hot spot reaches 80 °C in < 9 s), objectives with four
alerts, zones, PDU repair, upgrade, level 7 camera follow, SERVICE DOWN, joystick, landscape 844×390,
pause, level clear / SLA missed / breached, continue; then level 6 – intro, customer arriving, complaint
bubble + objective, TALK ready / talking / calm, fixing, happy, angry (failed row), the 2-customer cap;
level 11 – intro, virus roaming, quarantine, infected rack, spread to a neighbour, cleaning, level 13
twin viruses; the drone patrol on desktop (no HUD or hall overlap), a forced fly-by on the phone, the
flyer in landscape, and the drone freezing while paused. Run:

`node scripts/shoot.mjs --route /uptime-keeper --port 5186 --out shots/uptime-keeper --scenario scripts/scenarios/uptime-keeper.mjs`

Headless rules/balance checks: `npx tsx src/games/uptime-keeper/sim.check.ts` – hall layouts and the
entrance, walkers never inside racks, every action, fault chains, an instant-response bot (≈ 100 %),
a one-technician bot that must pass levels 1–7, an idle run that must fail, the ×2 heating times,
customers (arrival timing and cap, TALK once, patience hold, happy vs escalated) and the virus
(infect after 2 s, spread ~12 s, clean 4 s, quarantine + respawn 45–60 s, caps per level, speed).
