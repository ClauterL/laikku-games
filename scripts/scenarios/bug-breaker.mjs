/**
 * Bug Breaker scenario for scripts/shoot.mjs.
 *
 * Plays level 1 with realistic pointer drags (aim → release → flight → camera
 * focus → aftermath), fires a second cube and presses Space mid-air,
 * demonstrates a JS explosion, the level-cleared / pause (button + Esc) /
 * build-failed / final overlays, loads level 6 and – on the phone – repeats
 * the aiming in landscape (844×390).
 *
 * The game exposes `window.__bugBreaker` (pouch/bugs/level/loadLevel plus
 * fire/special/fastForward/state test hooks) so the scenario can skip ahead
 * deterministically.
 */
export default async function run(page, shoot, viewport) {
  const phone = viewport.name === 'mobile'
  const pouch = () => page.evaluate(() => window.__bugBreaker.pouch())
  const state = () => page.evaluate(() => window.__bugBreaker.state())

  // wait until a cube sits in the pouch and the (portrait) camera has settled on the slingshot
  const waitReady = async () => {
    for (let i = 0; i < 80; i++) {
      if ((await state()).shot === 'ready') break
      await page.waitForTimeout(150)
    }
    let last = await pouch()
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150)
      const p = await pouch()
      const width = page.viewportSize().width
      if (Math.abs(p.x - last.x) < 0.5 && p.x > 0 && p.x < width) break
      last = p
    }
    await page.waitForTimeout(200)
  }

  // realistic slingshot drag: grab the cube, pull back down-left, hold, release
  const dragShot = async (name, dx = -100, dy = 40) => {
    await waitReady()
    const p = await pouch()
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 10 })
    await page.waitForTimeout(200)
    if (name) await shoot(`${name}-aiming`)
    await page.mouse.up()
  }

  // beat a level with a list of [angle°, pull, tap-seconds] shots through the test hooks
  const playSequence = (level, seq) =>
    page.evaluate(
      ([lvl, shots]) => {
        const h = window.__bugBreaker
        h.loadLevel(lvl)
        for (const [angle, power, tap] of shots) {
          let guard = 0
          while (h.state().shot !== 'ready' && h.state().sim === 'playing' && guard++ < 1200) h.fastForward(1 / 60)
          if (h.state().sim !== 'playing') break
          const rad = (angle * Math.PI) / 180
          h.fire(-Math.cos(rad) * power, Math.sin(rad) * power)
          let t = 0
          let tapped = false
          while (h.state().shot === 'flying' && t < 7) {
            h.fastForward(1 / 60)
            t += 1 / 60
            if (!tapped && tap > 0 && t >= tap) {
              h.special()
              tapped = true
            }
          }
          h.fastForward(1)
        }
        h.fastForward(4)
        return h.state()
      },
      [level, seq],
    )

  const play = page.getByRole('button', { name: /play|continue/i }).first()
  await play.click()
  await page.waitForTimeout(900)
  await shoot('02-playing')

  // --- shot 1: aim, fly, camera focus, aftermath
  await dragShot('03')
  await page.waitForTimeout(900)
  await shoot('04-flight')
  await page.waitForTimeout(2200)
  await shoot('05-focus')
  await page.waitForTimeout(2200)
  await shoot('06-aftermath')
  console.log(`[${viewport.name}] after shot 1:`, JSON.stringify(await state()))

  // --- shot 2 + Space mid-air (special key)
  await dragShot(null, -95, 20)
  await page.waitForTimeout(500)
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  await shoot('07-second-shot')
  await page.waitForTimeout(4500)

  // --- JS explosion demo: level 2's last cube is JS – burn the first three via hooks
  await page.evaluate(() => {
    const h = window.__bugBreaker
    h.loadLevel(2)
    h.fastForward(0.5)
    for (let i = 0; i < 3; i++) {
      h.fire(-85, 5)
      h.fastForward(7.5)
    }
    h.fastForward(2)
  })
  await page.waitForTimeout(300)
  await shoot('08-js-loaded')
  await dragShot(null, -100, 30)
  await page.waitForTimeout(650)
  await page.keyboard.press('Space')
  await page.waitForTimeout(140)
  await shoot('09-js-explosion')
  await page.waitForTimeout(1800)
  await shoot('10-js-aftermath')

  // --- level cleared overlay (level 1, a known winning shot)
  console.log(`[${viewport.name}] level 1 solved:`, JSON.stringify(await playSequence(1, [[20, 110, 0]])))
  await page.waitForTimeout(500)
  await shoot('11-level-cleared')

  // --- level 6 + pause overlay (button and Esc)
  await page.evaluate(() => window.__bugBreaker.loadLevel(6))
  await page.waitForTimeout(700)
  await shoot('12-level6')
  await page.getByRole('button', { name: /pause/i }).click()
  await page.waitForTimeout(400)
  await shoot('13-paused')
  await page.getByRole('button', { name: /resume/i }).click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  const pausedByKey = (await state()).phase
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  console.log(`[${viewport.name}] Esc pause/resume:`, pausedByKey, '->', (await state()).phase)

  // --- build failed overlay: waste level 1's three cubes straight up
  await page.evaluate(() => {
    const h = window.__bugBreaker
    h.loadLevel(1)
    h.fastForward(0.5)
    for (let i = 0; i < 3; i++) {
      h.fire(10, 60)
      h.fastForward(7.5)
    }
    h.fastForward(5)
  })
  await page.waitForTimeout(400)
  await shoot('14-build-failed')

  // --- final overlay: beat level 6 with the greedy solver's sequence
  console.log(
    `[${viewport.name}] level 6 sequence:`,
    JSON.stringify(
      await playSequence(6, [
        [50, 110, 0],
        [25, 95, 0],
        [25, 95, 0],
      ]),
    ),
  )
  await page.waitForTimeout(500)
  await shoot('15-final')

  if (phone) {
    // --- phone landscape
    await page.setViewportSize({ width: 844, height: 390 })
    await page.getByRole('button', { name: /play again|retry/i }).click()
    await page.waitForTimeout(800)
    await shoot('16-landscape')
    await dragShot('17-landscape', -70, 25)
    await page.waitForTimeout(900)
    await shoot('18-landscape-flight')
    await page.waitForTimeout(3500)
    await page.evaluate(() => window.__bugBreaker.loadLevel(5))
    await page.waitForTimeout(600)
    await shoot('19-landscape-level5')
  }
}
