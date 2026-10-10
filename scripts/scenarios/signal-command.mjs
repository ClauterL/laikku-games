/**
 * Scenario for Puolustusvoimat – Signal Command.
 *
 * Plays wave 1 with real keyboard input (two correct arrows, a wrong one for
 * the red flash), finishes the wave through the dev hook `window.__signalCommand`
 * (PERFECT! feedback + wave interlude), enters one code on the D-pad with the
 * mouse / touch, jumps to wave 5 for a hard code and the full map, fails waves
 * for the lives/integrity drop and the debrief, and checks pause. The phone run
 * also taps the D-pad with the touchscreen, swipes on the panel, opens the
 * STATUS sheet and switches to landscape.
 */
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
const OTHER = { up: 'down', down: 'left', left: 'right', right: 'up' }

export default async function run(page, shoot, viewport) {
  const mobile = viewport.name === 'mobile'
  const tag = `[${viewport.name}]`
  const state = () => page.evaluate(() => window.__signalCommand.state())
  const hook = (fn, ...args) => page.evaluate(([f, a]) => window.__signalCommand[f](...a), [fn, args])
  const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout })
  const check = (cond, msg) => console.log(`${tag} ${cond ? 'ok  ' : 'FAIL'} ${msg}`)
  const pressKey = async (dir, gap = 120) => {
    await page.keyboard.press(KEY[dir])
    await page.waitForTimeout(gap)
  }
  const tapEl = async (locator) => {
    const box = await locator.boundingBox()
    if (!box) throw new Error('element not visible')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    if (mobile) await page.touchscreen.tap(x, y)
    else await page.mouse.click(x, y)
  }
  const dpad = (dir) => page.locator(`.sc-dpad__btn.sc-dpad__${dir}`)
  const waitPlaying = () => until(() => window.__signalCommand.state().phase === 'playing')

  // ---- start ----------------------------------------------------------------
  await page.getByRole('button', { name: /play/i }).first().click()
  await waitPlaying()
  await page.waitForTimeout(500)
  await shoot('02-first-command')
  let s = await state()
  check(s.wave === 1 && s.current && s.current.code.length === 3, `wave 1 opens with a 3-arrow code: ${s.current?.name} ${s.current?.arrows} (${s.waveTime}s for ${s.waveCount} commands)`)

  // ---- two correct arrows with the keyboard ----------------------------------
  const code = s.current.code
  await pressKey(code[0])
  await pressKey(code[1])
  await page.waitForTimeout(80)
  await shoot('03-two-entered')
  s = await state()
  check(s.current.progress === 2, `two correct arrows entered (progress ${s.current.progress})`)

  // ---- a wrong arrow: red flash + shake, progress resets --------------------
  await page.keyboard.press(KEY[OTHER[code[2]]])
  await page.waitForTimeout(70)
  await shoot('04-miss-flash')
  s = await state()
  check(s.current.progress === 0 && s.misses === 1 && s.combo === 1, `wrong arrow reset the code (progress ${s.current.progress}, misses ${s.misses})`)

  // ---- finish the code with keys, the rest of the wave through the hook ------
  for (const d of s.current.code) await pressKey(d)
  await page.waitForTimeout(150)
  s = await state()
  check(s.waveSolved === 1 && s.score > 0, `first code solved, score ${s.score}`)
  let lastPerfectShot = false
  const playingWithCode = async () => {
    const st = await state()
    return st.phase === 'playing' && st.current !== null
  }
  while (await playingWithCode()) {
    const before = await state()
    await hook('solveCurrent')
    await page.waitForTimeout(60)
    const after = await state()
    if (after.current && !lastPerfectShot && after.waveSolved === before.waveSolved + 1) {
      await shoot('05-perfect-code')
      lastPerfectShot = true
      const fb = await page.locator('.sc-feedback b').first().textContent().catch(() => '')
      check(/PERFECT/i.test(fb || ''), `fast flawless code shows PERFECT! (${fb})`)
    }
    await page.waitForTimeout(260)
  }
  s = await state()
  check(s.phase === 'playing' && s.clearing && s.waveSolved === s.waveCount, 'last code solved → short celebration hold before the interlude')
  await page.waitForTimeout(350)
  await shoot('05b-wave-clear')
  await until(() => window.__signalCommand.state().phase === 'interlude', null, 5000)
  s = await state()
  check(s.interlude?.kind === 'next' && s.interlude.wave === 2, `wave 1 cleared → interlude to wave 2 (${s.interlude?.sectorName})`)
  await page.waitForTimeout(350)
  await shoot('06-wave-interlude')

  // ---- wave 2: one code on the D-pad -------------------------------------------
  await until(() => window.__signalCommand.state().phase === 'playing' && window.__signalCommand.state().wave === 2)
  await page.waitForTimeout(300)
  s = await state()
  const dcode = s.current.code
  for (let i = 0; i < dcode.length; i++) {
    await tapEl(dpad(dcode[i]))
    if (i === dcode.length - 2) {
      await page.waitForTimeout(80)
      await shoot('07-dpad-code')
    }
    await page.waitForTimeout(110)
  }
  await page.waitForTimeout(150)
  s = await state()
  check(s.waveSolved === 1 && s.wave === 2, `D-pad ${mobile ? 'taps' : 'clicks'} solved a ${dcode.length}-arrow code (${dcode.join(' ')})`)

  if (mobile) {
    // ---- swipe on the command panel enters an arrow -------------------------------
    const expected = (await state()).current.code[0]
    const before = (await state()).current.progress
    await page.evaluate((dir) => {
      const panel = document.querySelector('.sc-centre')
      const r = panel.getBoundingClientRect()
      const x = r.left + r.width * 0.5
      const y = r.top + r.height * 0.58
      const delta = { up: [0, -70], down: [0, 70], left: [-70, 0], right: [70, 0] }[dir]
      const ev = (type, dx, dy) =>
        panel.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: y + dy, bubbles: true }))
      ev('pointerdown', 0, 0)
      ev('pointermove', delta[0] * 0.4, delta[1] * 0.4)
      ev('pointermove', delta[0], delta[1])
      ev('pointerup', delta[0], delta[1])
    }, expected)
    await page.waitForTimeout(80)
    await shoot('07b-swipe')
    s = await state()
    check(s.current.progress === before + 1, `swipe ${expected} entered an arrow (progress ${before} → ${s.current.progress})`)

    // ---- STATUS sheet with the map, incidents and systems ------------------------
    await page.getByRole('button', { name: /status/i }).first().click()
    await page.waitForTimeout(500)
    await shoot('07c-status-sheet')
    await page.getByRole('button', { name: /close/i }).first().click()
    await page.waitForTimeout(200)
  }

  // ---- a flawless wave through the hook → PERFECT! +500 ---------------------------
  while (await playingWithCode()) {
    await hook('solveCurrent')
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(300)
  await shoot('08-perfect-wave')
  const banner = await page.locator('.sc-feedback b').first().textContent().catch(() => '')
  check(/PERFECT/i.test(banner || ''), `flawless wave shows the PERFECT! banner (${banner})`)
  await until(() => window.__signalCommand.state().phase === 'interlude', null, 5000)
  s = await state()
  check(s.interlude?.wave === 3, `wave 2 cleared flawlessly → wave 3 (score ${s.score})`)

  // ---- wave 5: a hard 8-arrow code and the full map --------------------------------
  let tries = 0
  do {
    await hook('skipToWave', 5)
    await page.waitForTimeout(60)
    s = await state()
    tries++
  } while (s.current.code.length < 8 && tries < 12)
  await page.waitForTimeout(400)
  await shoot('09-wave5-hard-code')
  check(s.wave === 5 && s.current.code.length >= 7, `wave 5: ${s.current.name} ${s.current.arrows} (${s.current.code.length} arrows, ${s.waveTime}s for ${s.waveCount} commands)`)

  if (mobile) {
    // ---- phone landscape --------------------------------------------------------------
    await page.setViewportSize({ width: 844, height: 390 })
    await page.waitForTimeout(700)
    await shoot('09b-landscape')
    const landscapeDpad = await dpad('up').boundingBox()
    check(landscapeDpad && landscapeDpad.width >= 40, `landscape D-pad buttons are ${Math.round(landscapeDpad?.width ?? 0)} px`)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.waitForTimeout(600)
  }

  // ---- pause ---------------------------------------------------------------------------
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await shoot('10-paused')
  s = await state()
  check(s.phase === 'paused', 'Esc pauses')
  await page.keyboard.press('Escape')
  await waitPlaying()

  // ---- two timeouts: lives and integrity drop ------------------------------------------
  const integrityBefore = (await state()).integrity
  await hook('failWave')
  await page.waitForTimeout(90)
  await shoot('11-timeout')
  s = await state()
  check(s.lives === 2 && s.integrity < integrityBefore, `wave timeout: lives ${s.lives}, integrity ${integrityBefore} → ${s.integrity} %`)
  await page.waitForTimeout(500)
  await shoot('12-retry-interlude')
  await waitPlaying()
  await hook('failWave')
  await page.waitForTimeout(100)
  s = await state()
  check(s.lives === 1, `second timeout: lives ${s.lives}, integrity ${s.integrity} %`)
  await waitPlaying()
  await page.waitForTimeout(300)
  await shoot('13-one-life-left')

  // ---- lives out → mission failed debrief -----------------------------------------------
  await hook('failWave')
  await until(() => window.__signalCommand.state().phase === 'failed', null, 5000)
  await page.waitForTimeout(600)
  await shoot('14-debrief')
  s = await state()
  check(s.phase === 'failed' && s.lives === 0, `mission failed with score ${s.score}, accuracy ${s.accuracy} %`)

  // ---- play again from the debrief, best score on the start screen -----------------------
  await page.getByRole('button', { name: /play again/i }).first().click()
  await waitPlaying()
  s = await state()
  check(s.wave === 1 && s.lives === 3 && s.score === 0, 'Play again restarts the mission')

  if (!mobile) {
    // ---- complete the mission through the hook: MISSION COMPLETE + continue -----------------
    for (let w = 1; w <= 5; w++) {
      if (w > 1) await hook('skipToWave', w)
      await page.waitForTimeout(50)
      while (await playingWithCode()) {
        await hook('solveCurrent')
        await page.waitForTimeout(30)
      }
      await until(() => window.__signalCommand.state().phase !== 'playing', null, 5000)
      const st = await state()
      if (st.phase === 'interlude' && st.interlude?.kind === 'next') await waitPlaying()
    }
    await until(() => window.__signalCommand.state().phase === 'complete', null, 8000)
    await page.waitForTimeout(500)
    await shoot('15-mission-complete')
    await page.getByRole('button', { name: /continue/i }).first().click()
    await until(() => window.__signalCommand.state().phase === 'playing' && window.__signalCommand.state().wave === 6, null, 8000)
    await page.waitForTimeout(300)
    await shoot('16-endless-wave6')
    s = await state()
    check(s.wave === 6 && s.sector === 'lapland', `endless wave 6 in ${s.sector} (${s.waveTime}s for ${s.waveCount} commands)`)

    // ---- leaving for the hub tears the engine down ----------------------------------------------
    await page.locator('.home-btn').click()
    await page.waitForTimeout(600)
    const gone = await page.evaluate(() => typeof window.__signalCommand === 'undefined' && !document.querySelector('.signal-command'))
    check(gone, 'engine is destroyed when leaving for the hub')
    await page.goBack()
    await page.waitForTimeout(700)
    const back = await page.evaluate(() => ({ hook: typeof window.__signalCommand, phase: window.__signalCommand?.state().phase, best: !!document.querySelector('.overlay__stat') }))
    check(back.hook === 'object' && back.phase === 'start' && back.best, 'coming back shows the start screen with the best score')
    await shoot('17-start-with-best')
  }
}
