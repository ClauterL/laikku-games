/**
 * Scenario for Ficolo – Uptime Keeper.
 *
 * Plays the guided opening with real input (keyboard on desktop, taps on the
 * phone), then uses the dev hook `window.__uptimeKeeper` to stage the
 * situations worth looking at: the (twice as fast) heat ramp, four alerts at
 * once, the big halls with camera follow + mini-map, a 100 °C shutdown, the
 * level-clear overlay, an SLA breach and the CONTINUE start screen. Then the
 * newer mechanics: the level-6 intro and a customer (arrival, complaint, TALK,
 * fix → happy, ignored → escalated), the level-11 intro and the virus (roaming,
 * infection + spread, cleaning, quarantine, twin viruses at level 13), and the
 * banner drone outside the hall (desktop patrol, phone fly-by, landscape patrol,
 * frozen while paused). Phone run also checks the joystick and the landscape layout.
 */
export default async function run(page, shoot, viewport) {
  const mobile = viewport.name === 'mobile'
  const tag = `[${viewport.name}]`
  const state = () => page.evaluate(() => window.__uptimeKeeper.state())
  const hook = (fn, ...args) => page.evaluate(([f, a]) => window.__uptimeKeeper[f](...a), [fn, args])
  const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout })
  const atTarget = (id, timeout) => until((t) => window.__uptimeKeeper.state().targetId === t, id, timeout)
  const tap = async (x, y) => {
    if (mobile) await page.touchscreen.tap(x, y)
    else await page.mouse.click(x, y)
  }
  const check = (cond, msg) => console.log(`${tag} ${cond ? 'ok  ' : 'FAIL'} ${msg}`)
  const pressAction = async (kind, key) => {
    if (mobile) await page.locator(`[data-action="${kind}"]`).click()
    else await page.keyboard.press(key)
  }
  /** Clears a level as if the shift had ended well, then loads the next one from the overlay. */
  const clearInto = async (from, name) => {
    await hook('setLevel', from)
    await page.waitForTimeout(400)
    await hook('finish')
    await until(() => window.__uptimeKeeper.state().phase === 'clear', null, 5000)
    await page.waitForTimeout(500)
    await shoot(name)
    const text = await page.locator('.overlay__howto').innerText()
    await page.getByRole('button', { name: /next level/i }).first().click()
    await page.waitForTimeout(700)
    return text
  }

  await page.getByRole('button', { name: /play/i }).first().click()
  await page.waitForTimeout(900)
  await shoot('02-playing')

  // ---- guided opening: slow hot spot on Rack 03 -------------------------------
  await until(() => window.__uptimeKeeper.state().alerts.some((a) => a.type === 'heat'))
  await page.waitForTimeout(700)
  await shoot('03-tutorial-alert')

  if (!mobile) {
    // keyboard movement must actually move the technician
    const before = (await state()).player
    await page.keyboard.down('ArrowLeft')
    await page.waitForTimeout(350)
    await page.keyboard.up('ArrowLeft')
    await page.keyboard.down('w')
    await page.waitForTimeout(200)
    await page.keyboard.up('w')
    const after = (await state()).player
    check(after.x < before.x - 0.8 && after.y < before.y - 0.2, `keyboard walk ${before.x.toFixed(2)},${before.y.toFixed(2)} → ${after.x.toFixed(2)},${after.y.toFixed(2)}`)
    await hook('moveTo', 'R03')
  } else {
    // tap-to-move: tap the rack itself
    const pos = await hook('screenPos', 'R03')
    await tap(pos.x, pos.y)
    await page.waitForTimeout(250)
    await shoot('03b-tap-route')
  }
  await atTarget('R03')
  await page.waitForTimeout(150)
  const hotBefore = (await state()).racks.find((r) => r.id === 'R03').temp
  await pressAction('cool', '1')
  await page.waitForTimeout(260)
  await shoot('04-cool-mist')
  const afterCool = await state()
  check(afterCool.racks.find((r) => r.id === 'R03').temp < hotBefore, `COOL lowered Rack 03 from ${hotBefore} °C to ${afterCool.racks.find((r) => r.id === 'R03').temp} °C`)
  // 20 % per COOL; the pool regenerates 4 %/s, so allow for the time since the press
  check(afterCool.meters.cooling < 92, `cooling pool spent (${afterCool.meters.cooling} %)`)

  // ---- fan failure → REPAIR with the progress ring -----------------------------
  await until(() => window.__uptimeKeeper.state().alerts.some((a) => a.type === 'fan'), null, 10000).catch(() => hook('spawn', 'fan', 'R05'))
  const fan = (await state()).alerts.find((a) => a.type === 'fan')
  await page.waitForTimeout(400)
  if (mobile) await page.locator('.uk-obj[data-alert="fan"]').first().click()
  else {
    await page.locator('.uk-obj[data-alert="fan"]').first().click()
    await hook('moveTo', fan.target)
  }
  await atTarget(fan.target)
  await pressAction('repair', '2')
  await page.waitForTimeout(1500)
  await shoot('05-repair-ring')
  const mid = await state()
  check(mid.repair !== null && mid.repair > 0.3, `repair in progress (${mid.repair === null ? 'none' : Math.round(mid.repair * 100) + ' %'})`)
  await until(() => !window.__uptimeKeeper.state().alerts.some((a) => a.type === 'fan'), null, 8000)
  await page.waitForTimeout(350)
  await shoot('06-repaired')
  const afterFix = await state()
  check(afterFix.uptime > 99.999, `uptime still ${afterFix.uptime.toFixed(3)} % after handling both alerts in time`)

  // ---- the heat ramp: a fresh hot spot climbs from idle to the 80 °C alert twice as fast as it used to
  {
    const target = 'R02'
    const t0 = (await state()).time
    const idle = (await state()).racks.find((r) => r.id === target).temp
    await hook('spawn', 'heat', target, 0)
    let warnAt = null
    for (let i = 0; i < 60 && warnAt === null; i++) {
      await page.waitForTimeout(200)
      const s = await state()
      const r = s.racks.find((x) => x.id === target)
      if (r.temp >= 80) warnAt = s.time - t0
      if (i === 15) await shoot('06b-heat-ramp')
    }
    await page.waitForTimeout(350)
    await shoot('06c-heat-alert')
    // the original model needed ~14 s from idle to 80 °C at this hall's heat factor
    check(warnAt !== null && warnAt < 9, `heat ramp: ${target} ${idle} °C → 80 °C in ${warnAt?.toFixed(1)} s (was ~14 s before the speed-up)`)
    await hook('moveTo', target)
    await atTarget(target)
    await hook('act', 'cool')
    await page.waitForTimeout(400)
  }

  // ---- walking away interrupts a repair ----------------------------------------
  await hook('spawn', 'fan', 'R01')
  await hook('moveTo', 'R01')
  await atTarget('R01')
  await hook('act', 'repair')
  await page.waitForTimeout(600)
  await hook('moveTo', 'R06')
  await page.waitForTimeout(900)
  const walked = await state()
  check(walked.repair === null && walked.alerts.some((a) => a.type === 'fan'), 'repair is interrupted when the technician walks away')

  // ---- four alerts at once: objectives list + detail card ----------------------
  await hook('spawn', 'heat', 'R04', 88)
  await hook('spawn', 'net')
  await hook('spawn', 'power')
  await page.waitForTimeout(900)
  await page.locator('.uk-obj[data-alert="net"]').first().click()
  await page.waitForTimeout(500)
  await shoot('07-four-alerts')
  const four = await state()
  check(four.alerts.filter((a) => a.type !== 'upgrade').length >= 4, `objectives: ${four.alerts.map((a) => a.type).join(', ')}`)
  check(four.meters.network < 100, `network meter dropped (${four.meters.network} %)`)

  // ---- level 3: two zones, upgrade at the terminal ------------------------------
  await hook('setLevel', 3)
  await page.waitForTimeout(700)
  await hook('spawn', 'upgrade')
  await hook('spawn', 'power')
  await hook('spawn', 'heat', 'R14', 91)
  await page.waitForTimeout(1200)
  await shoot('08-level3-zones')
  const pdu = (await state()).stations.find((s) => s.kind === 'pdu')
  await hook('moveTo', pdu.id)
  await atTarget(pdu.id)
  await hook('act', 'repair')
  await page.waitForTimeout(2200)
  await shoot('09-pdu-repair')
  await until(() => !window.__uptimeKeeper.state().alerts.some((a) => a.type === 'power'), null, 8000)
  await hook('moveTo', 'TERMINAL1')
  await atTarget('TERMINAL1')
  await page.waitForTimeout(200)
  await pressAction('upgrade', '3')
  await page.waitForTimeout(450)
  await shoot('10-upgrade')
  const upgraded = await state()
  check(upgraded.upgrades.cooling === 2, `cooling upgraded to Lv${upgraded.upgrades.cooling}`)

  // ---- level 7: big hall, camera follow, mini-map, edge arrows -------------------
  await hook('setLevel', 7)
  await page.waitForTimeout(900)
  await shoot('11-level7')
  const big = await state()
  check(big.camera.scrolling, `level 7 scrolls (tile ${big.camera.tile} px, ${big.racks.length} racks)`)
  await hook('spawn', 'heat', 'R02', 90)
  await hook('spawn', 'net', 'SWITCH2')
  await hook('moveTo', 'R27')
  await atTarget('R27', 20000)
  await page.waitForTimeout(500)
  await shoot('12-level7-follow')
  const far = await state()
  check(Math.abs(far.camera.y - big.camera.y) > 40, `camera followed the technician (${Math.round(big.camera.y)} → ${Math.round(far.camera.y)})`)

  // ---- a rack hits 100 °C: SERVICE DOWN ------------------------------------------
  await hook('spawn', 'down', 'R26')
  await page.waitForTimeout(900)
  await shoot('13-service-down')
  check((await state()).racks.find((r) => r.id === 'R26').down, 'Rack 26 shut down at 100 °C')
  // cool it and reboot it
  await hook('moveTo', 'R26')
  await atTarget('R26')
  await hook('act', 'cool')
  await page.waitForTimeout(600)
  await hook('act', 'repair')
  await page.waitForTimeout(3600)
  check(!(await state()).racks.find((r) => r.id === 'R26').down, 'Rack 26 is back after COOL + REPAIR')

  if (mobile) {
    // ---- virtual joystick (synthetic touch pointer on the canvas) -----------------
    const before = (await state()).player
    await page.evaluate(() => {
      const c = document.querySelector('.game-canvas')
      const r = c.getBoundingClientRect()
      const x = r.left + 64
      const y = r.bottom - 178 - 14 - 46
      const ev = (type, dx) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x + dx, clientY: y, bubbles: true }))
      ev('pointerdown', 0)
      ev('pointermove', 30)
      window.__stickUp = () => ev('pointerup', 30)
    })
    await page.waitForTimeout(700)
    await shoot('13b-joystick')
    await page.evaluate(() => window.__stickUp())
    const after = (await state()).player
    check(after.x > before.x + 1, `joystick moved the technician ${before.x.toFixed(2)} → ${after.x.toFixed(2)}`)

    // ---- phone landscape -----------------------------------------------------------
    await page.setViewportSize({ width: 844, height: 390 })
    await page.waitForTimeout(700)
    await hook('spawn', 'psu', 'R20')
    await page.waitForTimeout(500)
    await shoot('13c-landscape')
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.waitForTimeout(600)
  }

  // ---- pause ------------------------------------------------------------------------
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await shoot('14-paused')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // ---- end of the shift: level-clear overlay ------------------------------------------
  await hook('finish')
  await until(() => window.__uptimeKeeper.state().phase === 'clear', null, 5000)
  await page.waitForTimeout(600)
  await shoot('15-level-clear')
  const done = await state()
  console.log(`${tag} level ${done.level} ended with ${done.uptime.toFixed(3)} % uptime, score ${done.score}`)

  const nextBtn = page.getByRole('button', { name: /next level|retry level/i }).first()
  await nextBtn.click()
  await page.waitForTimeout(900)
  await shoot('16-next-level')

  // ---- a sloppy shift: nine racks left down for a minute → SLA missed, retry -----------
  for (let i = 1; i <= 9; i++) await hook('spawn', 'down', `R${String(i).padStart(2, '0')}`)
  await hook('skip', 62)
  await page.waitForTimeout(400)
  const sloppy = await state()
  if (sloppy.phase === 'playing') {
    await hook('finish')
    await until(() => window.__uptimeKeeper.state().phase !== 'playing', null, 5000)
  }
  await page.waitForTimeout(600)
  await shoot('17-sla-missed')
  const missed = await state()
  check(missed.uptime < 99.5 && missed.phase !== 'playing', `shift with ${missed.racks.filter((r) => r.down).length} racks down ends at ${missed.uptime.toFixed(3)} % (${missed.phase})`)
  await page.getByRole('button', { name: /retry level/i }).first().click()
  await page.waitForTimeout(700)
  const retried = await state()
  check(retried.phase === 'playing' && retried.level === missed.level && retried.uptime === 100, `retry restarts level ${retried.level} with a clean SLA`)

  // ---- ignored power fault: zone goes dark, then the SLA is breached --------------------
  await hook('spawn', 'power', 'PDU1')
  await hook('skip', 44)
  await page.waitForTimeout(500)
  await shoot('18-zone-dark')
  await hook('skip', 30)
  await until(() => window.__uptimeKeeper.state().phase === 'over', null, 8000)
  await page.waitForTimeout(600)
  await shoot('18b-sla-breached')

  // ---- progress is saved: the start screen offers CONTINUE -----------------------------
  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForTimeout(500)
  await shoot('19-continue')
  const cont = page.getByRole('button', { name: /continue/i })
  check((await cont.count()) > 0, 'start screen offers CONTINUE after a cleared level')
  if (await cont.count()) {
    await cont.first().click()
    await page.waitForTimeout(900)
    const resumed = await state()
    check(resumed.level === done.level + 1 && resumed.phase === 'playing', `CONTINUE resumes at level ${resumed.level} with cooling Lv${resumed.upgrades.cooling}`)
    await shoot('20-continued')
  }

  // ================= customers (level 6+) =================================================
  const intro6 = await clearInto(5, '21-level6-intro')
  check(/customer/i.test(intro6) && /TALK/.test(intro6), 'level-6 intro explains customers and TALK')
  check((await state()).level === 6, 'next level is 6')
  // the first one would walk in by itself 12–18 s into the shift – the hook brings it now
  check(await hook('spawn', 'customer', 'R12'), 'a customer walks in, complaining about Rack 12')
  await page.waitForTimeout(700)
  await shoot('22-customer-arrives')
  await until(() => window.__uptimeKeeper.state().customers.some((c) => c.state === 'wait'), null, 8000)
  await page.waitForTimeout(400)
  await shoot('23-customer-complaint')
  let st = await state()
  const visitor = st.customers[0]
  check(/Rack 12/.test(visitor.complaint), `complaint names the rack: "${visitor.complaint}"`)
  check(st.racks.find((r) => r.id === 'R12').perf && st.alerts.some((a) => a.type === 'customer' && a.target === 'R12'), 'Rack 12 has a performance fault and an objective')
  check((await page.locator('.uk-obj[data-alert="customer"]').count()) === 1, 'the customer is listed in OBJECTIVES with patience')
  check(/patience/i.test(await page.locator('.uk-detail').innerText()) || mobile, 'detail card shows the patience bar')
  // TALK: walk up to the customer and use the context action (the TALK button on the phone, E on desktop)
  await hook('moveTo', visitor.id)
  await atTarget(visitor.id, 10000)
  await page.waitForTimeout(250)
  const label = await page.locator('[data-action="repair"]').getAttribute('data-label')
  check(label === 'TALK', `the REPAIR button turns into ${label} next to the customer`)
  await shoot('24-customer-talk-ready')
  const patienceBefore = (await state()).customers[0].patience
  await pressAction('repair', mobile ? '2' : 'e')
  await page.waitForTimeout(450)
  await shoot('24a-customer-talk')
  const talked = (await state()).customers[0]
  check(talked.talked && talked.patience > patienceBefore + 13, `TALK bought time (${patienceBefore} → ${talked.patience} s, "We're on it!")`)
  await page.waitForTimeout(1400)
  await shoot('24b-customer-calm')
  // the fix: REPAIR the slow rack (3 s) – the customer leaves happy
  if (mobile) await page.locator('.uk-obj[data-alert="customer"]').first().click()
  else await hook('moveTo', 'R12')
  await atTarget('R12', 10000)
  const creditsBefore = (await state()).credits
  await pressAction('repair', '2')
  await page.waitForTimeout(1700)
  await shoot('25-customer-fixing')
  await until(() => window.__uptimeKeeper.state().stats.happy === 1, null, 6000)
  await page.waitForTimeout(450)
  await shoot('26-customer-happy')
  st = await state()
  check(st.credits >= creditsBefore + 55 && !st.racks.find((r) => r.id === 'R12').perf, `happy customer: +${st.credits - creditsBefore} credits, Rack 12 fast again`)
  // nobody helps the next one: patience runs out → escalation
  check(await hook('spawn', 'customer', 'R03'), 'a second customer walks in (Rack 03)')
  await until(() => window.__uptimeKeeper.state().customers.some((c) => c.rackId === 'R03' && c.state === 'wait'), null, 8000)
  const angry = (await state()).customers.find((c) => c.rackId === 'R03')
  const upBefore = (await state()).uptime
  await hook('patience', angry.id, 0.25)
  await page.waitForTimeout(700)
  await shoot('27-customer-angry')
  st = await state()
  check(st.stats.escalations === 1 && upBefore - st.uptime >= 0.019, `escalation: SLA credit −${(upBefore - st.uptime).toFixed(3)} %`)
  check((await page.locator('.uk-obj.is-failed').count()) === 1, 'the escalated customer shows as a failed objective')
  // two may wait at once, a third is turned away
  await hook('spawn', 'customer')
  await hook('spawn', 'customer')
  const third = await hook('spawn', 'customer')
  const waiting = (await state()).customers.filter((c) => c.state !== 'leave').length
  check(!third && waiting === 2, `never more than two customers at once (${waiting} waiting, a third was turned away)`)

  // ================= virus (level 11+) =====================================================
  const intro11 = await clearInto(10, '28-level11-intro')
  check(/virus/i.test(intro11) && /quarantine/i.test(intro11), 'level-11 intro explains the virus')
  check((await state()).level === 11, 'next level is 11')
  check(await hook('spawn', 'virus'), 'a virus crawls out of a network port')
  await page.waitForTimeout(2600)
  await shoot('29-virus-roaming')
  st = await state()
  check(st.viruses.length === 1 && st.alerts.some((a) => a.type === 'virus'), `the virus roams (${st.viruses[0]?.mode}) and is an objective`)
  // quarantine: run into it (the technician chases it along the aisles)
  const bug = st.viruses[0]
  await hook('moveTo', bug.id)
  await until((id) => !window.__uptimeKeeper.state().viruses.some((v) => v.id === id), bug.id, 15000).catch(() => {})
  await page.waitForTimeout(160)
  await shoot('30-quarantine')
  st = await state()
  check(st.stats.quarantined === 1 && st.viruses.length === 0, `the virus was quarantined by touching it (${st.stats.quarantined} caught)`)
  // an infected rack counts as down and passes the malware to a neighbour about every 12 s
  await hook('spawn', 'infected', 'R10')
  await page.waitForTimeout(500)
  await shoot('31-infected-rack')
  await hook('skip', 10.4)
  for (let i = 0; i < 40 && (await state()).infected.length < 2; i++) await hook('skip', 0.1)
  await page.waitForTimeout(140)
  await shoot('32-infection-spreads')
  st = await state()
  const neighbours = ['R03', 'R09', 'R11', 'R17']
  check(st.infected.includes('R10') && st.infected.some((id) => neighbours.includes(id)), `malware spread from Rack 10 to its neighbour (${st.infected.join(', ')})`)
  // clean it: REPAIR on an infected rack (4 s)
  await hook('moveTo', 'R10')
  await atTarget('R10', 12000)
  const sub = await page.locator('[data-action="repair"] .uk-act__sub').innerText()
  check(/CLEAN/i.test(sub), `REPAIR offers "${sub}" on the infected rack`)
  await pressAction('repair', '2')
  await page.waitForTimeout(1900)
  await shoot('33-cleaning')
  await until(() => !window.__uptimeKeeper.state().infected.includes('R10'), null, 6000)
  await page.waitForTimeout(300)
  check(!(await state()).infected.includes('R10'), 'Rack 10 is clean again')
  // level 13: two viruses may roam at once
  await hook('setLevel', 13)
  await page.waitForTimeout(400)
  await hook('spawn', 'virus', 'SWITCH1')
  await hook('spawn', 'virus', 'SWITCH2')
  await page.waitForTimeout(2200)
  await shoot('34-twin-viruses')
  check((await state()).viruses.length === 2, 'level 13: two viruses roam at once')

  // ================= the banner drone outside the hall =====================================
  await hook('setLevel', 1)
  await page.waitForTimeout(400)
  if (!mobile) {
    await page.waitForTimeout(2600)
    const d = await hook('drone')
    check(d.visible && d.mode === 'patrol' && d.onScreen && d.overHud === 0 && !d.overHall, `drone patrols the free margin (${d.format} banner, ${d.font} px) clear of HUD and hall`)
    await shoot('35-drone')
  } else {
    // portrait: the hall fills the width – the drone passes along the hall's top edge
    const ok = await hook('drone', { flyby: true })
    await page.waitForTimeout(1700)
    const d = await hook('drone')
    check(ok && d.mode === 'flyby' && d.onScreen && d.overHud === 0, `portrait: the drone tows its banner across the top edge (${d.mode})`)
    await shoot('35-drone-portrait')
    // landscape: a narrow strip beside the hall
    await page.setViewportSize({ width: 844, height: 390 })
    await page.waitForTimeout(3000)
    const dl = await hook('drone')
    check(dl.visible && dl.onScreen && dl.overHud === 0 && (dl.mode === 'flyby' || !dl.overHall), `landscape: drone ${dl.mode} (${dl.format}, ${dl.font} px) clear of the HUD`)
    await shoot('35b-drone-landscape')
  }
  // the drone stops with the game
  const d0 = await hook('drone')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  const p1 = await hook('drone')
  await page.waitForTimeout(700)
  const p2 = await hook('drone')
  check(Math.abs(p2.x - p1.x) < 0.01 && Math.abs(p2.y - p1.y) < 0.01, `the drone holds still while paused (${d0.mode})`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  if (mobile) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.waitForTimeout(600)
  }

  if (!mobile) {
    // ---- collision fuzz: mash direction keys and make sure the technician never ends inside anything
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']
    let bad = 0
    let travelled = 0
    let last = (await state()).player
    for (let i = 0; i < 40; i++) {
      const k1 = keys[(i * 5 + 3) % 8]
      const k2 = keys[(i * 3 + 1) % 8]
      await page.keyboard.down(k1)
      if (i % 2) await page.keyboard.down(k2)
      await page.waitForTimeout(130)
      await page.keyboard.up(k1)
      if (i % 2) await page.keyboard.up(k2)
      const now = (await state()).player
      if (now.blocked) bad++
      travelled += Math.hypot(now.x - last.x, now.y - last.y)
      last = now
    }
    check(bad === 0 && travelled > 6, `random keyboard walk stayed out of walls and cabinets (${travelled.toFixed(1)} tiles walked)`)

    // ---- leaving for the hub tears the engine down; coming back starts clean ---------------
    await page.locator('.home-btn').click()
    await page.waitForTimeout(600)
    const gone = await page.evaluate(() => typeof window.__uptimeKeeper === 'undefined' && !document.querySelector('.uptime-keeper'))
    check(gone, 'engine is destroyed when leaving for the hub')
    await page.goBack()
    await page.waitForTimeout(700)
    const back = await page.evaluate(() => ({ hook: typeof window.__uptimeKeeper, phase: window.__uptimeKeeper?.state().phase, overlay: !!document.querySelector('.overlay') }))
    check(back.hook === 'object' && back.phase === 'start' && back.overlay, 'coming back shows the start screen again')
  }
}
