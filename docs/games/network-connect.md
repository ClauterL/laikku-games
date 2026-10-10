# C2 – Network Connect

**Slug** `network-connect` · **Component** `src/games/network-connect/NetworkConnect.tsx` ·
**Inspired by** Flow Free (with Candy-Crush-style level progression)
**Mock-up** `docs/mockups/network-connect.png` (study it first).

> Connect every USER to its CLOUD with a glowing data path of the same colour. Paths may not cross and
> every tile must carry data. Later levels add firewall blocks, packet loss and broken nodes; power-ups
> get you out of trouble. Visually it shows off real network vocabulary.

## Look (copy the mock-up)

- Deep navy background (`#0b1736`) with a faint world-map / city-skyline silhouette and dotted
  node-link decoration at the top; bubbly "C2" wordmark in blue/yellow + "NETWORK CONNECT" title.
- The board: dark slate tiles (`#13224a`, 1 px lighter borders `#1d2f5c`, rounded 8 px) on a slightly
  darker rounded board panel with a thin glowing border.
- Paths: thick neon lines (≈ 45 % of tile size) with rounded joints and an outer glow; small bright
  "packets" (dots) travel along **completed** paths. Colours (in this order as more colours are needed):
  `#37e36b` green, `#ff4a4a` red, `#2fa8ff` blue, `#ff4fd8` magenta, `#ffd43b` yellow, `#a86bff`
  purple, `#ff8c42` orange, `#4ff2ff` cyan.
- Endpoints are rounded squares filled with the path colour: **USER** (person glyph, label) at one end
  and **CLOUD** (cloud glyph, label) at the other. Waypoints are rounded squares of the path colour
  with a `SWITCH` (box with 3 ports), `FIREWALL` (brick wall + shield) or `SERVER` (rack) glyph and
  label; the path must pass through them.
- Obstacles: **firewall block** = orange-brown brick tile; **packet loss** = dark tile with a red ⊗
  and "PACKET LOSS"; **broken node** = dark tile with a white lightning bolt and "BROKEN".
- Left panel (desktop): `LEVEL 12 · Corporate Network`, GOAL text + legend (USER, SWITCH, FIREWALL,
  SERVER, CLOUD glyphs), CHALLENGES list with counts (packet loss, firewall block, broken node),
  `MOVES` big number, three stars that fill as you keep moves low. Right panel: POWER-UPS as four big
  coloured buttons with a count badge: Reroute (purple), Firewall (red), VPN Tunnel (blue), Network
  Boost (green), each with a one-line description. Top-right: coin counter (`⭐ 1,250`).
- Phone portrait: top bar (level, moves, coins), board, then the four power-ups in a row with
  short labels. Phone landscape: board left, compact panels right.
- "ALL PATHS CONNECTED!" banner with a green check when a level is solved, packets flowing, confetti,
  `sfx.win`.

## Mechanics

- Grid sizes: levels 1–3 5×5, 4–7 6×6, 8–12 7×7, 13+ 8×8. Every tile that is not an obstacle must
  be covered (classic Flow Free), waypoints included; packet-loss tiles are **optional** (passable,
  not required, but each one used adds +1 latency which costs a star).
- **Level generator (seeded by level number with `seededRng`)**: place obstacles first (firewall
  blocks from level 4, packet loss from level 6, broken nodes from level 8 – counts grow slowly),
  then cover the remaining required tiles with random self-avoiding paths (repeat: pick a random
  empty tile, random walk until stuck; merge/attach stranded single tiles to an adjacent path end;
  reject layouts with any path shorter than 3 or with more than 8 colours; retry with the next seed
  variant). Endpoints = path ends. From level 3 on, mark a middle tile of one or two paths as a
  waypoint (SWITCH / FIREWALL / SERVER). Solvable by construction. Sanity-check the generator in a
  quick node script (e.g. generate levels 1–30 and assert the invariants).
- **Drawing**: pointerdown on an endpoint, a waypoint or an existing path tile of colour C starts
  drawing C from that tile (an existing path is truncated to that tile). Moving into an adjacent empty
  tile extends the path; into another colour's path cuts that path from that tile onward (Flow Free
  behaviour); into your own path truncates back to it; into the other endpoint completes the path;
  obstacles and foreign endpoints/waypoints block. Pointerup ends the stroke. `moves` +1 for every
  stroke that changed the board.
- Win: all pairs connected + all required tiles filled. Stars: 3 if moves ≤ colours and latency 0,
  2 if moves ≤ colours + 3, otherwise 1. Coins: `100 × stars + 20 × unused power-ups`. Next level
  button; progress (`level`, `coins`, inventory) persisted with `loadJSON/saveJSON`; Start screen
  offers `CONTINUE (level N)` when progress exists plus `New game`.
- **Power-ups** (inventory starts 3 / 3 / 2 / 3, +1 to a random one per solved level, max 5 each):
  - **Reroute** – auto-connects one unsolved colour (the generator's solution for that colour).
  - **Firewall** – tap a firewall block to remove it (becomes an optional free tile).
  - **VPN Tunnel** – arm it; the next path you draw may pass through **one** obstacle (that tile becomes
    an optional tunnel tile with a lock glyph); the charge is consumed when used.
  - **Network Boost** – clears every packet-loss tile and repairs every broken node on the board
    (they become optional free tiles).
  Buttons show a count badge, disable at 0, and the active one (Firewall/VPN waiting for a tap) glows.
- Reset-level button (keeps move count), undo last stroke (optional), hint = Reroute.
- Keyboard: R reset, Esc closes an armed power-up.

## Scenario for `scripts/scenarios/network-connect.mjs`

Expose `window.__networkConnect = { solution: () => [{color, cells:[[r,c]...]}], cellCenter: (r,c) => ({x,y}) }`
from the engine (dev-only ok). Scenario: click PLAY (or CONTINUE), screenshot, then drag the first
colour's solution path with `page.mouse` (move through each cell centre), screenshot, drag the rest,
screenshot the "ALL PATHS CONNECTED" state, click Next level, screenshot level 2. Also click a
power-up once to check the armed state renders. Desktop and phone.
