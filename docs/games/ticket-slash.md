# Topteam IT – Ticket Slash

**Slug** `ticket-slash` · **Component** `src/games/ticket-slash/TicketSlash.tsx` · **Inspired by** Fruit Ninja
**Mock-up** `docs/mockups/ticket-slash.png` (study it first).

> IT tickets fly across the screen. Flick each one into the bin of the matching solution. Wrong bin
> breaks your combo. Every now and then a red **P1 CRITICAL** ticket appears that you must resolve
> immediately. Understandable in ten seconds.

## Look (copy the mock-up)

- Background: a dark-blue office at night (`#0f1b3d` → `#1a2a5c`), blurred desk/monitor silhouettes,
  warm bokeh lights, a plant or two, a "Topteam IT" text wordmark with a small cloud glyph at the top
  centre (draw it, do not copy a real logo), a poster on the wall ("HAPPY USERS · BRIGHTER DAYS").
- Tickets: rounded white/pastel cards (≈ 150×90 px desktop, ≈ 118×72 on phone) with a coloured left
  edge, a category icon, a bold title ("VPN", "Outlook", "MFA" …) and a smaller problem line
  ("Not Connecting"). They rotate slowly while flying. Drop shadow.
- P1 ticket: red card, "P1 CRITICAL" ribbon, pulsing red glow, alarm-bell glyph, a shrinking timer ring
  around it, slight screen vignette pulse while it is alive.
- Six glowing bins along the bottom in this order and colour:
  `VPN #2f80ff` (globe) · `EMAIL #8a3ffc` (envelope) · `MFA #2ecc71` (shield+lock) ·
  `PRINTER #f5a623` (printer) · `BACKUP #ff4d4f` (database cylinders) · `ACTIVE DIRECTORY #4cc3ff`
  (three people). Bins are open-top glowing boxes with the icon and a label; they pulse/brighten when
  a ticket is being dragged and flash green/red on a correct/wrong delivery.
- The flick trail: a bright white-blue streak (like the Fruit Ninja blade) along the swipe, with
  sparkles. Floating `+100 ×4` texts, confetti burst on correct delivery, screen shake on P1.
- HUD (HTML chips): top-left `SCORE 3,420` with a trophy glyph; under it the combo meter
  `COMBO ×4` with a segmented yellow bar and "4 tickets in a row!"; top-right a `TIME 00:42` chip
  with a red progress bar; three heart glyphs for SLA lives; pause and mute buttons.

## Mechanics

- Round length **60 s**, **3 lives**. Game over when time is up (normal end) or lives reach 0.
- Tickets launch from just below the bottom edge (between the bins) in Fruit-Ninja arcs: random
  x, upward velocity so the apex is in the upper half, slight horizontal drift, gravity ≈ 900 px/s².
  Spawn every 1.6 s at the start → 0.7 s at 60 s; sometimes two at once after 20 s.
- **Grab & flick**: pointerdown within a ticket's (generous) bounds grabs it – it stops falling and
  follows the pointer. Track the last ~80 ms of pointer movement. On pointerup:
  - If the release speed is ≥ 600 px/s the ticket is **flicked**: it travels in a straight line at that
    speed (clamped 900–2200 px/s), no gravity, leaving the blade trail, until it enters a bin's catch
    zone (the bin rect extended upward by its height) → resolve; or it leaves the screen → it counts as
    **dropped** (lose a life, `-` combo reset, "TICKET LOST").
  - If released slowly **over a bin** → counts as delivered to that bin.
  - If released slowly elsewhere → the ticket keeps falling with gravity (can be re-grabbed).
- A ticket that falls below the bottom edge unhandled → **missed**: lose a life, combo reset, red
  flash on the edge, "MISSED".
- Correct bin → `+100 × combo`, combo += 1 (max ×8), bin flashes green, confetti, `sfx.good` (or
  `combo` every 4th). Wrong bin → `WRONG BIN`, combo reset, bin flashes red, `sfx.bad`, ticket is
  destroyed (no life lost).
- **P1 CRITICAL**: first one at ~12 s, then every 14–20 s. It rises slowly to the upper-middle of the
  screen and hovers there (gentle bob) with a **5 s** timer ring. It is worth `+500 × combo` and
  grants +1 life (max 3) when delivered correctly. If the timer expires: lose **one** life,
  "SLA BREACHED!" banner, big shake, `sfx.alarm` was playing while alive.
- Ticket catalogue (category → titles / problem lines; pick randomly, avoid ambiguity):
  - VPN: "VPN / Not Connecting", "VPN / Drops every 5 min", "VPN / No intranet access"
  - EMAIL: "Outlook / Not receiving email", "Outlook / Mailbox full", "Email / Shared mailbox missing"
  - MFA: "MFA / Not working", "MFA / New phone, no codes", "MFA / Code rejected"
  - PRINTER: "Printer / Not working", "Printer / Queue stuck", "Printer / Toner empty"
  - BACKUP: "Backup / Failed", "Backup / Restore request", "Backup / Job overdue"
  - ACTIVE DIRECTORY: "AD / Access issue", "AD / Group missing", "AD / New starter account"
  - P1 (one per category, red): "User Locked Out!" (AD), "VPN gateway down!" (VPN), "Mail server
    down!" (EMAIL), "MFA outage!" (MFA), "Backup server offline!" (BACKUP), "Print server down!" (PRINTER)
- Score display counts up smoothly. Stats on game over: score, best, tickets solved, best combo,
  accuracy %.
- Pause (Esc / P / pause button) shows the Overlay with Resume / Restart / Hub.
- Phone portrait: bins become six compact squares (icon + 2-letter/short label) in one row with 6 px
  gaps; tickets slightly smaller; HUD chips wrap to two rows. Phone landscape and desktop: the full
  labelled bins.

## Scenario for `scripts/scenarios/ticket-slash.mjs`

Click PLAY, wait 1.5 s, screenshot; then for a few iterations read ticket positions – expose a debug
hook `window.__ticketSlash = { tickets: () => [{x,y,category}], bins: () => [{x,y,w,h,category}] }`
from the engine (dev-only is fine) – and perform `page.mouse` drag-flicks from a ticket to the matching
bin; screenshot mid-flick and after. Also test a wrong flick and let the P1 appear (wait ~13 s) and
screenshot it. Verify the HUD numbers change (read them from the DOM) and no page errors occur.
