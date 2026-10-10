/**
 * Screenshot scenario for Hansab – Access Crossing (v2, Subway-Surfers-style runner).
 *
 * Uses the dev hook `window.__accessCrossing`:
 *   state()            → { phase, popup, speed, lane, floor, hearts, badges, nextEvents: [{type, z, lane, dodge, open}] … }
 *   skipTo(type)       → clears the corridor ahead and puts one 'gate' | 'camera' | 'pin' | 'reception' | 'elevator' ~30 units ahead
 *   openVisitorPopup() / openPinPopup() → demo popups for the gallery
 *   audit(runs)        → spawner fairness self-check
 *
 * Flow per viewport: running view (0.5 s / 3 s), lane change / jump / slide mid-action, each event
 * type approaching and resolving, both popups, pause, a crash + stumble, game over. Desktop also
 * lets a small autopilot play a stretch of the real spawner; the phone run repeats the key views
 * in landscape (844×390). Input is keyboard on desktop and pointer swipes on the phone.
 */
/**
 * Everything a scenario needs to drive the game: dev-hook access, steering input, waiting helpers
 * and a small autopilot. Exported so ad-hoc test scenarios can reuse it.
 */
export function createDriver(page, viewport) {
  const mobile = viewport.name === 'mobile'
  const log = (...a) => console.log(`[${viewport.name}]`, ...a)
  const state = () => page.evaluate(() => (window.__accessCrossing ? window.__accessCrossing.state() : null))
  const skipTo = (type) => page.evaluate((t) => window.__accessCrossing.skipTo(t), type)
  const sleep = (ms) => page.waitForTimeout(ms)

  const size = () => page.viewportSize()
  /** One steering action: arrow key on desktop, a pointer swipe on the phone. */
  const act = async (dir) => {
    if (!mobile) {
      await page.keyboard.press({ left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' }[dir])
      return
    }
    const { width, height } = size()
    const x = width / 2
    const y = height * 0.6
    const dx = dir === 'left' ? -70 : dir === 'right' ? 70 : 0
    const dy = dir === 'up' ? -70 : dir === 'down' ? 70 : 0
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx / 2, y + dy / 2)
    await page.mouse.move(x + dx, y + dy)
    await page.mouse.up()
  }

  /** Poll the dev state until `pred(state)` holds. Returns the state (or null on timeout). */
  const waitFor = async (pred, timeout = 9000, step = 40) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const s = await state()
      if (s && pred(s)) return s
      await sleep(step)
    }
    return null
  }
  const ev = (s, type) => s.nextEvents.find((e) => e.type === type)
  /** Wait until the nearest event of `type` is behind us (the next one of that type, if any, is still far). */
  const passed = (type) => waitFor((st) => !ev(st, type) || ev(st, type).z > 7.5, 6000, 30)
  const goToLane = async (target) => {
    for (let i = 0; i < 4; i++) {
      const s = await state()
      if (!s || s.lane === target) return
      await act(target > s.lane ? 'right' : 'left')
      await sleep(170)
    }
  }
  const nearest = (lanes, from) => lanes.reduce((a, b) => (Math.abs(b - from) < Math.abs(a - from) ? b : a))

  /** Answer whatever popup is open the right way (PIN from the note, visitor by the rule). */
  const answerPopup = async (s) => {
    if (s.popup === 'pin') {
      const code = await page.locator('.ac-note--big b').innerText()
      await page.keyboard.type(code, { delay: 70 })
    } else if (s.popup === 'visitor') {
      await sleep(450) // the popup ignores keys for a moment so a running key cannot answer it
      await page.keyboard.press(s.visitorValid ? 'y' : 'n')
    }
    await sleep(250)
  }

  /**
   * Small autopilot that plays like a careful human using state().nextEvents: line up with a free
   * lane, jump low obstacles, slide under barriers, use the right gate, answer popups.
   */
  const autopilot = async (ms, onTick) => {
    const t0 = Date.now()
    let lastMove = 0
    let lastVertical = 0
    let prev = null
    let prevAt = 0
    while (Date.now() - t0 < ms) {
      const s = await state()
      if (!s || s.phase !== 'playing') break
      // diagnostics: what was in front of us when a heart went missing?
      if (prev && s.hearts < prev.hearts)
        log(`autopilot lost a heart (${Date.now() - prevAt} ms after the last look). before:`, JSON.stringify({ lane: prev.lane, speed: prev.speed, jumping: prev.jumping, sliding: prev.sliding, next: prev.nextEvents.slice(0, 5) }))
      prev = s
      prevAt = Date.now()
      // a screenshot takes a while: look again before steering on stale data
      if (onTick && (await onTick(s))) continue
      if (s.popup) {
        await answerPopup(s)
        continue
      }
      // a camera zone is 5 units long: it stays relevant until its far edge is behind us
      const hazards = s.nextEvents.filter((e) => e.z > (e.type === 'camera' ? -3 : -0.4) && (e.dodge !== 'none' || ['gate', 'pin', 'elevator', 'camera'].includes(e.type)))
      const note = s.nextEvents.find((e) => e.type === 'note' && e.z > 0.5)
      const first = hazards.find((e) => e.type !== 'pin' || !note)
      let target = s.lane
      let vertical = null
      if (first) {
        const row = hazards.filter((e) => e.z - first.z < (first.type === 'camera' ? 5.4 : 2.4))
        const cost = [0, 0, 0] // per lane: 0 free, 1 needs jump/slide, 9 blocked
        const need = [null, null, null]
        for (const e of row) {
          if (e.type === 'camera') {
            // only matters while we are about to enter or are inside the zone
            if (e.z > 14) continue
            for (let l = -1; l <= 1; l++) if (!e.open.includes(l)) cost[l + 1] = 9
          } else if (e.type === 'gate' || e.type === 'elevator') {
            for (let l = -1; l <= 1; l++) if (!e.open.includes(l)) cost[l + 1] = 9
          } else if (e.type === 'barrier') {
            for (let l = -1; l <= 1; l++)
              if (!e.open.includes(l) && cost[l + 1] < 9) {
                cost[l + 1] = 1
                need[l + 1] = { kind: 'down', z: e.z }
              }
          } else if (e.dodge === 'lane') cost[e.lane + 1] = 9
          else if (e.dodge === 'jump' && cost[e.lane + 1] < 9) {
            cost[e.lane + 1] = 1
            need[e.lane + 1] = { kind: 'up', z: e.z }
          }
        }
        let best = 99
        for (let l = -1; l <= 1; l++) {
          const c = cost[l + 1] * 10 + Math.abs(l - s.lane)
          if (c < best) {
            best = c
            target = l
          }
        }
        if (target === s.lane) vertical = need[s.lane + 1]
      }
      // a PIN note ahead and nothing dangerous before it: go and fetch it
      if (note && (!first || first.z > note.z + 1)) target = note.lane
      const now = Date.now()
      if (target !== s.lane && now - lastMove > 160) {
        await act(target > s.lane ? 'right' : 'left')
        lastMove = now
      } else if (vertical && now - lastVertical > 450) {
        if (vertical.kind === 'up' && !s.jumping && vertical.z < 3.6 && vertical.z > 1.0) {
          await act('up')
          lastVertical = now
        } else if (vertical.kind === 'down' && !s.sliding && vertical.z < Math.max(3, s.speed * 0.22)) {
          await act('down')
          lastVertical = now
        }
      }
      await sleep(25)
    }
  }

  return { mobile, log, state, skipTo, sleep, act, waitFor, ev, passed, goToLane, nearest, answerPopup, autopilot }
}

export default async function run(page, shoot, viewport) {
  const { mobile, log, state, skipTo, sleep, act, waitFor, ev, passed, goToLane, nearest, answerPopup, autopilot } = createDriver(page, viewport)

  /* ---------- the running view ------------------------------------------------------ */

  await page.getByRole('button', { name: /play/i }).first().click()
  await sleep(500)
  await shoot('02-running-0.5s')
  await sleep(2500)
  await shoot('03-running-3s')

  // The first ten seconds are the easy stretch: room for the steering demos.
  await act('left')
  await sleep(60)
  await shoot('04-lane-change')
  await sleep(250)
  await act('up')
  await sleep(mobile ? 220 : 280)
  await shoot('05-jump')
  await sleep(600)
  await act('down')
  await sleep(200)
  await shoot('06-slide')
  await sleep(500)
  log('after steering demo:', JSON.stringify({ ...(await state()), nextEvents: undefined }))

  /* ---------- each event type, as it approaches -------------------------------------- */

  // gate row
  await skipTo('gate')
  let s = await waitFor((st) => ev(st, 'gate') && ev(st, 'gate').z < 15)
  if (s) {
    log('gate row:', JSON.stringify(ev(s, 'gate')))
    await shoot('07-gate-approach')
    await goToLane(nearest(ev(s, 'gate').open, s.lane))
    s = await waitFor((st) => !ev(st, 'gate') || ev(st, 'gate').z < 4.2)
    const tClose = Date.now()
    await shoot('08-gate-close')
    // the moment after the turnstile: green flash, zoom kick and the ACCESS GRANTED label. The
    // row leaves nextEvents once it is resolved, so the timing comes from the state captured
    // before the (slow) screenshot, minus the time the screenshot took.
    const g = s && ev(s, 'gate')
    const remain = g ? (Math.max(0, g.z - 0.5) / s.speed) * 1000 - (Date.now() - tClose) : 0
    await sleep(Math.max(0, remain) + 160)
    await shoot('08b-access-granted')
    // whatever the spawner put right after the row: let the autopilot deal with it
    await autopilot(1200)
    await passed('gate')
  }

  // camera zone
  await skipTo('camera')
  s = await waitFor((st) => ev(st, 'camera') && ev(st, 'camera').z < 14)
  if (s) {
    await shoot('09-camera-approach')
    // keep re-checking the predicted safe lanes until we are through
    let coneShot = false
    await autopilot(2600, async (st) => {
      const c = ev(st, 'camera')
      if (coneShot || !c || c.z > 5.5) return false
      coneShot = true
      await shoot('10-camera-cone')
      return true
    })
  }

  // PIN row: fetch the note, then the keypad popup opens at the row
  await skipTo('pin')
  s = await waitFor((st) => ev(st, 'note') && ev(st, 'note').z < 11)
  if (s) {
    await goToLane(ev(s, 'note').lane)
    await shoot('11-pin-note')
    await waitFor((st) => st.pinNote !== null || !ev(st, 'note'))
    s = await waitFor((st) => ev(st, 'pin') && ev(st, 'pin').z < 9)
    await shoot('12-pin-row')
    s = await waitFor((st) => st.popup === 'pin', 5000)
    if (s) {
      await sleep(350)
      await shoot('13-pin-popup')
      await answerPopup(s)
      await sleep(200)
      await shoot('14-pin-opened')
    } else log('PIN popup did not open:', JSON.stringify(await state()))
  }

  // reception checkpoint
  await skipTo('reception')
  s = await waitFor((st) => ev(st, 'reception') && ev(st, 'reception').z < 12)
  if (s) {
    await shoot('15-reception-approach')
    s = await waitFor((st) => st.popup === 'visitor', 6000)
    if (s) {
      await sleep(350)
      await shoot('16-visitor-popup')
      await answerPopup(s)
      await sleep(150)
      await shoot('17-reception-opened')
    } else log('visitor popup did not open:', JSON.stringify(await state()))
  }

  // elevator wall → next floor
  await skipTo('elevator')
  s = await waitFor((st) => ev(st, 'elevator') && ev(st, 'elevator').z < 16)
  if (s) {
    log('elevator:', JSON.stringify(ev(s, 'elevator')), 'badges', s.badges.join(','))
    await shoot('18-elevator-approach')
    await goToLane(nearest(ev(s, 'elevator').open, s.lane))
    await waitFor((st) => !ev(st, 'elevator') || ev(st, 'elevator').z < 4)
    await shoot('19-elevator-doors')
    await waitFor((st) => !ev(st, 'elevator') || ev(st, 'elevator').z < 1.0, 4000, 20)
    await sleep(380)
    await shoot('20-elevator-closing')
    s = await waitFor((st) => st.floor === 2, 4000)
    await sleep(500)
    await shoot('21-floor-2-banner')
    // the first obstacle rows of the new floor arrive in about three seconds: keep steering
    await autopilot(1800)
    await shoot('22-floor-2-running')
  }

  /* ---------- a stretch of the real spawner (desktop: autopilot) ------------------------ */

  if (!mobile) {
    const before = await state()
    let shots = 0
    let nextShot = Date.now() + 5000
    await autopilot(26000, async (st) => {
      if (shots >= 3 || Date.now() < nextShot || st.popup) return false
      shots++
      nextShot = Date.now() + 7000
      await shoot(`23-autopilot-${shots}`)
      return true
    })
    const after = await state()
    log(`autopilot: ${before.hearts} → ${after.hearts} hearts, floor ${after.floor}, coins ${after.coins}, score ${after.score}, speed ${after.speed}`)
    const issues = await page.evaluate(() => window.__accessCrossing.audit(60))
    log(`spawner audit: ${issues.length} issue(s)`, issues.slice(0, 8).join(' | '))
  }

  /* ---------- pause + demo popups ------------------------------------------------------- */

  s = await state()
  if (s && s.phase === 'playing') {
    await skipTo('gate') // clear the corridor so nothing hits us meanwhile
    if (s.popup) await answerPopup(s)
    await page.keyboard.press('Escape')
    await sleep(350)
    await shoot('24-paused')
    await page.keyboard.press('Escape')
    await sleep(150)
    await page.evaluate(() => window.__accessCrossing.openVisitorPopup())
    await sleep(400)
    await shoot('25-visitor-popup-demo')
    await page.keyboard.press('n')
    await sleep(250)
    await page.evaluate(() => window.__accessCrossing.openPinPopup())
    await sleep(300)
    await page.keyboard.type('48', { delay: 80 })
    await sleep(200)
    await shoot('26-pin-popup-demo')
    await page.keyboard.press('Escape')
    await sleep(200)
  }

  /* ---------- crash, stumble, game over ------------------------------------------------ */

  // Run into locked gates on purpose (and anything else that comes) until the hearts are gone.
  let hearts = (await state())?.hearts ?? 0
  let stumbleShot = false
  const tEnd = Date.now() + 70000
  while (Date.now() < tEnd) {
    s = await state()
    if (!s || s.phase === 'over') break
    if (s.popup) {
      // wrong answers cost hearts too
      if (s.popup === 'visitor') {
        await sleep(450)
        await page.keyboard.press(s.visitorValid ? 'n' : 'y')
      } else await page.keyboard.type('0000', { delay: 40 })
      await sleep(200)
      continue
    }
    if (s.hearts < hearts) {
      hearts = s.hearts
      if (!stumbleShot && s.hearts > 0) {
        stumbleShot = true
        await sleep(120)
        await shoot('27-crash-stumble')
      }
    }
    const g = ev(s, 'gate')
    if (!g && !s.invulnerable) await skipTo('gate')
    else if (g && g.z < 12) {
      const locked = [-1, 0, 1].filter((l) => !g.open.includes(l))
      if (locked.length) await goToLane(nearest(locked, s.lane))
    }
    await sleep(60)
  }
  await sleep(700)
  log('final state:', JSON.stringify({ ...(await state()), nextEvents: undefined }))
  await shoot('28-game-over')

  /* ---------- phone landscape (844×390) --------------------------------------------------- */

  if (mobile) {
    await page.setViewportSize({ width: 844, height: 390 })
    await sleep(400)
    await shoot('30-landscape-game-over')
    await page.getByRole('button', { name: /play again/i }).first().click()
    await sleep(1500)
    await shoot('31-landscape-running')
    await act('right')
    await sleep(300)
    await act('up')
    await sleep(250)
    await shoot('32-landscape-jump')
    await sleep(500)
    await skipTo('gate')
    s = await waitFor((st) => ev(st, 'gate') && ev(st, 'gate').z < 12)
    if (s) {
      await shoot('33-landscape-gate')
      await goToLane(nearest(ev(s, 'gate').open, s.lane))
      await waitFor((st) => !ev(st, 'gate') || ev(st, 'gate').z < 3)
      await passed('gate')
    }
    await skipTo('camera')
    s = await waitFor((st) => ev(st, 'camera') && ev(st, 'camera').z < 9)
    if (s) {
      await shoot('34-landscape-camera')
      await autopilot(2200)
    }
    await skipTo('elevator')
    s = await waitFor((st) => ev(st, 'elevator') && ev(st, 'elevator').z < 11)
    if (s) {
      await shoot('35-landscape-elevator')
      await goToLane(nearest(ev(s, 'elevator').open, s.lane))
      await waitFor((st) => st.floor >= 2, 6000)
      await sleep(600)
      await shoot('36-landscape-floor-2')
    }
    await skipTo('gate')
    await page.evaluate(() => window.__accessCrossing.openVisitorPopup())
    await sleep(400)
    await shoot('37-landscape-visitor-popup')
    await page.keyboard.press('y')
    await sleep(250)
    await page.evaluate(() => window.__accessCrossing.openPinPopup())
    await sleep(300)
    await shoot('38-landscape-pin-popup')
    await page.keyboard.type('4821', { delay: 60 })
    await sleep(250)
    await page.keyboard.press('Escape')
    await sleep(300)
    await shoot('39-landscape-paused')
    // the start screen in landscape
    await page.reload({ waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts?.ready)
    await sleep(500)
    await shoot('40-landscape-start')
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
  }
}
