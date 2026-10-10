# Ficolo – Uptime Keeper

**Slug** `uptime-keeper` · **Component** `src/games/uptime-keeper/UptimeKeeper.tsx` ·
**Inspired by** Overcooked-style top-down arcade management (run to stations, act under pressure)
**Mock-up** `docs/mockups/uptime-keeper.png` (study it first – neon top-down data centre, HUD layout).

> A top-down data-centre arcade. You are the Ficolo technician running between the server racks and
> keeping the whole hall alive. The goal is not just points: keep **Uptime** as close to 100 % as
> possible while problems pop up all over the floor. Rack 07 is at 92 °C – get there and COOL it
> before it hits 100 °C.

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
  shimmer; shut-down racks go dark with a red ✕.
- Stations: **cooling station (CRAC)** – blue unit with snowflake glyph and frost mist; **PDU/UPS** –
  yellow cabinet with lightning glyph; **core switch cabinet** – green cabinet with network glyph and
  blinking link lights; **upgrade terminal** – a console with green chevrons (upgrades can also be
  done at the station they affect).
- Player: Ficolo technician in a **red jumpsuit** with a white "F" badge, top-down blocky look, running
  animation, a small tool glow when acting. Progress ring over the head while repairing.
- HUD (HTML, dark glass panels with neon borders):
  - top bar: `Ficolo | UPTIME KEEPER` wordmark, `SCORE 004820`, `LEVEL 03`, `UPTIME 99.7 %` with a
    green segmented bar; below it three meters **COOLING** (blue), **POWER** (yellow), **NETWORK** (green)
    as segmented bars with glyphs.
  - left: **OBJECTIVES** panel = the active alert list sorted by priority (`Rack overheating – Cool to
    safe temperature`, `Replace fan – Serv-02-B`, `Restore network – Core Switch`, `Upgrade cooling – Zone
    B`), each with its glyph and a chevron; tapping one highlights the target and, on touch devices,
    sends the technician there.
  - bottom-left: **DATACENTER MAP** mini-map with alert icons.
  - bottom-centre: three big action buttons **COOL [1]** (blue), **REPAIR [2]** (red), **UPGRADE [3]**
    (green) – enabled only when the technician is next to a valid target; UPGRADE shows the cost.
  - bottom-right: detail card for the nearest / selected alert: `RACK OVERHEATING · Temperature at 92 °C
    · Cool the rack using a nearby cooling station` with a red bar `92 °C / 100 °C`.
  - Phone portrait: top bar compact (uptime + meters), map hidden, objectives as a horizontal chip row,
    the three action buttons large at the bottom, detail card as a toast above them. Movement on touch:
    **tap-to-move** (tap a tile/rack → A* path) plus a small virtual joystick on the left as an option.
- Effects: cold mist particles on COOL, sparks on REPAIR, green rising chevrons on UPGRADE, red screen
  vignette while any rack is critical, uptime number flashes red when it drops, "SERVICE DOWN" banner on
  a shutdown. Sounds via `sfx` (`repair`, `good`, `alarm`, `bad`, `coin`, `win`, `lose`).

## Mechanics

- Grid-based hall (tile = 48 px desktop / 40 px phone). Rack rows form aisles; the technician moves
  freely (8-direction, WASD/arrows, 4.5 tiles/s) with wall/rack collision, or by tap-to-move (A*).
  Camera: whole hall fits on small levels; larger halls scroll with the player (smooth follow) and the
  mini-map shows the viewport.
- **Racks**: `temp` (°C; ambient 24), `fanOk`, `psuOk`, `linkOk`, `powered`, `serverLevel` 1–4, `down`.
  Heat per second = `baseLoad(serverLevel) × heatFactor − coolingEffect`; with a broken fan ×2.5.
  `heatFactor` shrinks 20 % per Cooling level; coolingEffect comes from the zone's cooling station
  (capacity shared by its racks). Warning ≥ 80 °C, critical ≥ 90 °C, **shutdown at 100 °C** (rack down
  until it is cooled below 70 °C and REPAIRed/rebooted).
- **Alerts** (spawn interval ramps per level, e.g. 14 s → 6 s; max simultaneous grows 1 → 5):
  - 🔥 **Overheating** – a rack's heat ramps up (hot spot); needs **COOL** at the rack.
  - 🔧 **Fan / PSU failure** – `fanOk=false` (rack heats ×2.5) or `psuOk=false` (rack may lose power);
    needs **REPAIR** at the rack: hold 3 s (minor) / 6 s (major) with a progress ring.
  - 🌐 **Network fault** – at a switch cabinet; all racks in its zone are *degraded* (count against
    uptime at 50 %); needs **REPAIR** at the switch (4 s) – or an instant *swap* when the player has a
    spare switch (earned from upgrades). The detail card says "Switch 2 disconnected – 8 racks affected".
  - ⚡ **Power fault** – UPS overload / PDU trip at the power unit; racks in the zone run on battery for
    20 s (10 s on level 1–4, 40 s with UPS upgrade) then go down; needs **REPAIR** at the PDU (5 s).
  - ⬆️ **Upgrade available** – appears when credits ≥ next upgrade cost; purely optional.
- **Actions** (keys 1/2/3, buttons, or E for "the sensible action here"):
  - **COOL** (fast first aid): −30 °C instantly + a 10 s cooling boost on the targeted rack; costs 20 % of
    the **Cooling** meter (regenerates 4 %/s, faster with Cooling level). Empty meter → weak COOL (−8 °C).
  - **REPAIR**: fixes the physical fault at the target (rack fan/PSU, switch, PDU); duration by severity;
    interrupted if the player walks away. Also reboots a shut-down rack once it is cool.
  - **UPGRADE** (permanent, costs credits; credits come from uptime ticks + resolved alerts):
    `Cooling Lv1→Lv2` racks heat 20 % slower and the cooling meter max +25 %;
    `Network Lv2→Lv3` network faults 30 % rarer and repair faster;
    `Server Lv3→Lv4` on a rack: +50 % score/s from that rack **but +35 % heat and +power draw** – the
    trade-off that makes the game interesting. Costs: 120 / 200 / 320 … per level.
- **Meters**: Cooling = remaining capacity pool; Power = consumption / capacity (consumption grows with
  server levels; above 90 % power faults spawn twice as often; UPS level raises capacity); Network =
  infrastructure health (drops with faults, recovers on repair).
- **Uptime** = rolling availability of the level: `1 − downRackSeconds / (racks × elapsed)` where
  degraded racks count 0.5. Display with three decimals (`99.987 %`). Uptime is the main score; the
  SCORE counter adds credits earned. Level targets: pass ≥ 99.5 %, ★★ ≥ 99.9 %, ★★★ ≥ 99.95 %; fail
  (SLA breached) if uptime < 98.0 % or if more than half the racks are down for 15 s.
- **Progression** (each level ≈ 2.5 min; a level-clear overlay explains what the new infrastructure
  does, then the next hall loads):
  1. **Level 1 – 6 racks** (2 rows × 3), 1 cooling station, 1 PDU, 1 switch – only overheating + fan faults
  2. **Level 2 – 12 racks**, network faults appear
  3. **Level 3 – 20 racks**, power faults appear, two zones
  4. **Level 4 – redundant cooling**: second CRAC, cooling pool ×2, racks heat slower
  5. **Level 5 – UPS + backup power**: power faults give 40 s battery instead of 10 s
  6. **Level 6 – automated monitoring**: alerts appear earlier (at 70 °C) and minor overheating
     auto-cools when the pool is > 50 %
  7. **Level 7 – large data centre**: 28 racks, 2 switches, 2 PDUs, 3 CRACs; after it, endless mode with
     rising alert rate ("Level 8+").
  The player should *feel* the automation: by level 6 some alerts resolve themselves.
- First 15 seconds of level 1 are a guided tutorial: one rack overheats slowly, an arrow points to it,
  the detail card says "Walk to Rack 03 and press COOL [1]". Then a fan failure with "REPAIR [2]".
- Pause (Esc/P), restart level (R). Progress (level reached, upgrades) and best uptime/score via
  `storage`; Start screen offers CONTINUE (level N) + New game.

## Scenario for `scripts/scenarios/uptime-keeper.mjs`

Expose `window.__uptimeKeeper = { state: () => ({ level, uptime, score, alerts:[{type, target, value}],
player:{x,y}, meters }), moveTo(targetId), act(action), spawn(type, targetId?), setLevel(n) }` (dev
only). Scenario: PLAY, screenshot; wait for the tutorial alert, `moveTo(rack)`, `act('cool')`, screenshot
the mist; spawn a fan failure, move, `act('repair')`, screenshot the progress ring; spawn network + power
faults, screenshot the objectives list with 4 alerts and the detail card; `setLevel(3)` and `setLevel(7)`
for the big halls (camera follow + mini-map); let a rack hit 100 °C for the SERVICE DOWN banner; level
clear overlay. Desktop 1280×800 and phone 390×844 (tap-to-move via `page.touchscreen.tap`).
