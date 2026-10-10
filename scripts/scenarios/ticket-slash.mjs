/**
 * Scenario for Ticket Slash: plays with realistic drag-flicks, tests a wrong
 * bin, waits for the P1 CRITICAL ticket (~12 s), pauses/resumes and lets the
 * round end. Uses the dev-only `window.__ticketSlash` hook for positions.
 *
 *   node scripts/shoot.mjs --route /ticket-slash --port 5181 --out shots/ticket-slash --scenario scripts/scenarios/ticket-slash.mjs
 */

export default async function run(page, shoot, viewport) {
  const failures = []
  const check = (ok, msg) => {
    console.log(`[${viewport.name}] ${ok ? 'ok ' : 'FAIL'} ${msg}`)
    if (!ok) failures.push(msg)
  }

  const hook = () =>
    page.evaluate(() => {
      const h = window.__ticketSlash
      return h ? { tickets: h.tickets(), bins: h.bins(), state: h.state() } : null
    })
  const readHud = async () => ({
    score: await page.locator('.ts-chip--score .chip__value').innerText(),
    combo: (await page.locator('.ts-combo__title').innerText()).replace(/\s+/g, ' '),
    time: await page.locator('.ts-chip--time .chip__value').innerText(),
    lives: await page.locator('.ts-heart.is-on').count(),
  })

  await page.getByRole('button', { name: /play/i }).first().click()
  await page.waitForTimeout(1500)
  await shoot('02-playing')

  const box = await page.locator('canvas').first().boundingBox()
  const first = await hook()
  check(!!first, 'debug hook present')
  if (!first) throw new Error('window.__ticketSlash missing')
  check(first.bins.length === 6, `six bins (${first.bins.length})`)
  const binsTop = Math.min(...first.bins.map((b) => b.y))
  check(binsTop + Math.max(...first.bins.map((b) => b.h)) <= viewport.height, 'bins fully on screen')
  const binFor = (category) => first.bins.find((b) => b.category === category)

  /** A grabbable flying ticket in the play area, slowest first. */
  async function pickTicket() {
    const a = await hook()
    if (!a || a.state.phase !== 'playing') return null
    await page.waitForTimeout(40)
    const b = await hook()
    if (!b || b.state.phase !== 'playing') return null
    const candidates = b.tickets
      .filter((t) => t.state === 'flying' && t.y > 130 && t.y < binsTop - 70)
      .map((t) => {
        const prev = a.tickets.find((p) => p.category === t.category && Math.abs(p.x - t.x) < 60 && Math.abs(p.y - t.y) < 80)
        const vy = prev ? (t.y - prev.y) / 0.04 : 0
        return { ...t, vy }
      })
      .filter((t) => Math.abs(t.vy) < 900)
      .sort((p, q) => Math.abs(p.vy) - Math.abs(q.vy))
    return candidates[0] ?? null
  }

  /** Grab `t` and flick it towards `bin` with a short, fast drag (optionally screenshot mid-flight). */
  async function flick(t, bin, midShot) {
    // lead the moving card a little (the read → mousedown round trip is a few frames)
    const sx = box.x + t.x
    const sy = box.y + t.y + (t.vy ?? 0) * 0.04
    const tx = box.x + bin.x + bin.w / 2
    const ty = box.y + bin.y + bin.h * 0.35
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    // a real flick covers ~150 px in well under 100 ms; headless Chromium paces
    // injected moves by frame, so keep the step count low and the drag long enough
    const dist = Math.hypot(tx - sx, ty - sy)
    const frac = Math.min(0.8, Math.max(0.35, 160 / dist))
    const steps = 3
    for (let i = 1; i <= steps; i++) {
      const k = (i / steps) * frac
      await page.mouse.move(sx + (tx - sx) * k, sy + (ty - sy) * k)
    }
    await page.mouse.up()
    if (midShot) {
      await page.waitForTimeout(50)
      await shoot(midShot)
    }
  }

  /** Flick whatever is in the air to its matching bin until `until()` is true or the time is up. */
  async function playUntil(until, ms) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const h = await hook()
      if (!h || h.state.phase !== 'playing' || until(h)) return h
      const t = await pickTicket()
      if (t) await flick(t, binFor(t.category), null)
      await page.waitForTimeout(t ? 120 : 100)
    }
    return hook()
  }

  // --- a few correct flicks -------------------------------------------------
  const hud0 = await readHud()
  let correct = 0
  let midShotDone = false
  for (let i = 0; i < 10 && correct < 3; i++) {
    const t = await pickTicket()
    if (!t) {
      await page.waitForTimeout(200)
      continue
    }
    await flick(t, binFor(t.category), midShotDone ? null : '03-mid-flick')
    midShotDone = true
    correct++
    if (correct === 1) {
      await page.waitForTimeout(280)
      await shoot('04-after-flick')
    }
    await page.waitForTimeout(450)
  }
  const hud1 = await readHud()
  const st1 = (await hook()).state
  check(correct >= 1, `performed ${correct} correct flick(s)`)
  check(hud1.score !== hud0.score, `score changed in the HUD (${hud0.score} → ${hud1.score})`)
  check(hud1.combo === `COMBO ×${st1.combo}`, `HUD combo matches the engine (${hud1.combo}, streak ${st1.streak})`)
  check(st1.score > 0, `engine score ${st1.score}`)

  // --- a wrong bin ----------------------------------------------------------
  let wrongDone = false
  for (let i = 0; i < 14 && !wrongDone; i++) {
    const t = await pickTicket()
    if (!t) {
      await page.waitForTimeout(200)
      continue
    }
    await flick(t, first.bins.find((b) => b.category !== t.category), null)
    await page.waitForTimeout(350)
    await shoot('05-wrong-bin')
    wrongDone = true
  }
  const st2 = (await hook()).state
  check(wrongDone, 'performed a wrong flick')
  check(st2.combo === 1 && st2.streak === 0, `wrong bin reset the combo (×${st2.combo})`)

  // --- keep playing until the P1 CRITICAL appears (first one at ~12 s) -------
  let h = await playUntil((s) => s.tickets.some((t) => t.p1), 16000)
  if (!h.tickets.some((t) => t.p1) && h.state.phase === 'playing') {
    // unlucky timing fallback so the screenshot set is complete
    await page.evaluate(() => window.__ticketSlash?.spawnP1())
    await page.waitForTimeout(100)
    h = await hook()
  }
  const p1 = h.tickets.find((t) => t.p1)
  check(!!p1, `P1 CRITICAL ticket appeared (phase ${h.state.phase}, lives ${h.state.lives})`)
  const hudP1 = await readHud()
  // keep triaging the regular tickets while the P1 rises to its hover spot
  await playUntil(() => false, 1300)
  await shoot('06-p1-critical')
  const h3 = await hook()
  const p1Now = h3.tickets.find((t) => t.p1)
  if (p1Now && h3.state.phase === 'playing') {
    const livesBefore = h3.state.lives
    await flick(p1Now, binFor(p1Now.category), null)
    await page.waitForTimeout(450)
    await shoot('07-p1-resolved')
    const h4 = await hook()
    check(h4.state.score >= h3.state.score + 500, `P1 scored (${h3.state.score} → ${h4.state.score})`)
    check(h4.state.lives >= livesBefore, `P1 kept/granted a life (${livesBefore} → ${h4.state.lives})`)
    check(!h4.tickets.some((t) => t.p1), 'P1 removed after delivery')
  }
  check(hudP1.time !== hud0.time, `timer counts down (${hud0.time} → ${hudP1.time})`)

  // --- pause / resume (restart first if the bot already lost the round) ------
  if ((await hook()).state.phase === 'over') {
    await page.getByRole('button', { name: /play again/i }).click()
    await page.waitForTimeout(600)
  }
  check((await hook()).state.phase === 'playing', 'game running before the pause test')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check((await hook()).state.phase === 'paused', 'Escape pauses')
  await shoot('08-paused')
  const resume = page.getByRole('button', { name: /resume/i })
  if (await resume.count()) await resume.click()
  await page.waitForTimeout(300)
  check((await hook()).state.phase === 'playing', 'Resume continues')
  console.log(`[${viewport.name}] fps ≈ ${(await hook()).state.fps}`)

  // --- let the lives run out → game over ---------------------------------
  const t1 = Date.now()
  while (Date.now() - t1 < 25000) {
    const s = await hook()
    if (!s || s.state.phase === 'over') break
    await page.waitForTimeout(400)
  }
  const over = (await hook()).state
  check(over.phase === 'over', `round ended (${over.phase})`)
  await page.waitForTimeout(500)
  await shoot('09-game-over')
  check((await page.locator('.overlay__stat').count()) === 5, 'five stats on the game-over card')
  check((await page.getByRole('button', { name: /play again/i }).count()) === 1, 'play again button')

  if (failures.length) throw new Error(`scenario checks failed: ${failures.join('; ')}`)
}
