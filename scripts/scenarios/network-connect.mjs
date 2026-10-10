/**
 * Playwright scenario for C2 – Network Connect.
 *
 *   node scripts/shoot.mjs --route /network-connect --port 5182 --out shots/network-connect --scenario scripts/scenarios/network-connect.mjs
 *
 * Uses the dev hook `window.__networkConnect` (solution paths + cell centres)
 * to actually solve level 1 with real pointer drags, then exercises the
 * power-ups on a later level so the armed / removed states get screenshotted.
 */
const PROGRESS_KEY = 'havaida-games:network-connect:progress'

export default async function run(page, shoot, viewport) {
  const log = (msg) => console.log(`[${viewport.name}] ${msg}`)

  const hook = (fn, arg) => page.evaluate(fn, arg)
  const state = () => hook(() => window.__networkConnect.state())

  const dragCells = async (cells, { release = true } = {}) => {
    const pts = await hook((cells) => cells.map(([r, c]) => window.__networkConnect.cellCenter(r, c)), cells)
    await page.mouse.move(pts[0].x, pts[0].y)
    await page.mouse.down()
    for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 4 })
    if (release) await page.mouse.up()
  }

  // ---- start screen → level 1 ------------------------------------------------
  await page.getByRole('button', { name: /continue|play/i }).first().click()
  await page.waitForTimeout(600)
  await shoot('02-level1')

  const solution = await hook(() => window.__networkConnect.solution())
  log(`level 1 has ${solution.length} paths: ${solution.map((p) => p.cells.length).join(',')} cells`)

  // first colour
  await dragCells(solution[0].cells)
  await page.waitForTimeout(350)
  await shoot('03-first-path')
  log(`after first path: ${JSON.stringify(await state())}`)

  // half of the second colour, pointer still down → drawing head visible
  const second = solution[1].cells
  await dragCells(second.slice(0, Math.max(2, Math.ceil(second.length / 2))), { release: false })
  await page.waitForTimeout(150)
  await shoot('04-drawing')
  await page.mouse.up()

  // the rest (re-drawing the second path from its start fully)
  for (const p of solution.slice(1)) {
    await dragCells(p.cells)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(800)
  await shoot('05-all-connected')
  const solved = await state()
  log(`after solving: ${JSON.stringify(solved)}`)
  if (!solved.solved) log('WARNING: level 1 was not detected as solved')

  await page.waitForTimeout(1500)
  await shoot('06-win-overlay')

  await page.getByRole('button', { name: /next level/i }).click()
  await page.waitForTimeout(500)
  await shoot('07-level2')
  log(`level 2: ${JSON.stringify(await state())}`)

  // Reroute auto-connects one colour
  await page.locator('.nc-pu--reroute').first().click()
  await page.waitForTimeout(500)
  await shoot('08-reroute')
  log(`after reroute: ${JSON.stringify(await state())}`)

  // ---- jump to level 7 (6x6, firewall blocks + packet loss + waypoint) --------
  await hook(
    ({ key }) =>
      localStorage.setItem(key, JSON.stringify({ level: 7, coins: 1250, inventory: { reroute: 3, firewall: 3, vpn: 2, boost: 3 }, bestLevel: 7 })),
    { key: PROGRESS_KEY },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForTimeout(400)
  await shoot('09-start-continue')
  await page.getByRole('button', { name: /continue/i }).first().click()
  await page.waitForTimeout(600)
  await shoot('10-level7')

  // Firewall power-up: arm, then tap a block
  await page.locator('.nc-pu--firewall').first().click()
  await page.waitForTimeout(350)
  await shoot('11-firewall-armed')
  log(`armed: ${JSON.stringify(await state())}`)
  const grid = await hook(() => window.__networkConnect.grid())
  const blockIdx = grid.kinds.indexOf('block')
  if (blockIdx >= 0) {
    const r = Math.floor(blockIdx / grid.size)
    const c = blockIdx % grid.size
    const pt = await hook(([r, c]) => window.__networkConnect.cellCenter(r, c), [r, c])
    await page.mouse.click(pt.x, pt.y)
    await page.waitForTimeout(500)
    await shoot('12-firewall-removed')
  } else {
    log('WARNING: no firewall block on level 7')
  }

  // VPN armed → Esc disarms
  await page.locator('.nc-pu--vpn').first().click()
  await page.waitForTimeout(350)
  await shoot('13-vpn-armed')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  log(`after Esc: ${JSON.stringify(await state())}`)

  // VPN tunnel for real: find an endpoint next to a firewall block and draw into the block.
  const sol7 = await hook(() => window.__networkConnect.solution())
  const grid2 = await hook(() => window.__networkConnect.grid())
  const kindAt = (r, c) => (r < 0 || c < 0 || r >= grid2.size || c >= grid2.size ? null : grid2.kinds[r * grid2.size + c])
  let tunnelPair = null
  for (const p of sol7) {
    for (const [r, c] of [p.cells[0], p.cells[p.cells.length - 1]]) {
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (!tunnelPair && kindAt(r + dr, c + dc) === 'block') tunnelPair = { from: [r, c], to: [r + dr, c + dc] }
      }
    }
  }
  if (tunnelPair) {
    await page.locator('.nc-pu--vpn').first().click()
    await page.waitForTimeout(200)
    await dragCells([tunnelPair.from, tunnelPair.to])
    await page.waitForTimeout(400)
    const after = await hook(() => window.__networkConnect.grid())
    const kind = after.kinds[tunnelPair.to[0] * after.size + tunnelPair.to[1]]
    log(`VPN tunnel into ${tunnelPair.to}: tile is now "${kind}" (expected "tunnel"), ${JSON.stringify(await state())}`)
    await shoot('13b-vpn-tunnel')
    await page.keyboard.press('r')
    await page.waitForTimeout(200)
  } else {
    log('VPN tunnel test skipped (no endpoint next to a block)')
  }

  // Network Boost clears packet loss / broken nodes
  await page.locator('.nc-pu--boost').first().click()
  await page.waitForTimeout(500)
  await shoot('14-boost')

  // Two solution paths, then a stroke of a third colour across the first one → the cut rule
  await dragCells(sol7[0].cells)
  await dragCells(sol7[1].cells)
  await page.waitForTimeout(200)
  await shoot('15-two-paths')
  // Cut rule: find a path i with a plain interior cell next to an endpoint of another colour j
  // (waypoints legitimately block other colours, so they are excluded).
  const waypoints = new Set(sol7.flatMap((p) => p.waypoints.map((w) => `${w.r},${w.c}`)))
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  let cut = null
  for (let i = 0; i < sol7.length && !cut; i++) {
    const interior = new Set(sol7[i].cells.slice(1, -1).map(([r, c]) => `${r},${c}`).filter((k) => !waypoints.has(k)))
    for (let j = 0; j < sol7.length && !cut; j++) {
      if (j === i) continue
      for (const [r, c] of [sol7[j].cells[0], sol7[j].cells[sol7[j].cells.length - 1]]) {
        for (const [dr, dc] of DIRS) {
          if (!cut && interior.has(`${r + dr},${c + dc}`)) cut = { victim: i, color: j, from: [r, c], to: [r + dr, c + dc] }
        }
      }
    }
  }
  if (cut) {
    await page.keyboard.press('r')
    await page.waitForTimeout(150)
    await dragCells(sol7[cut.victim].cells)
    const beforeCut = await hook(() => window.__networkConnect.paths())
    await dragCells([cut.from, cut.to])
    await page.waitForTimeout(200)
    const afterCut = await hook(() => window.__networkConnect.paths())
    const ok = afterCut[cut.victim].length < beforeCut[cut.victim].length && afterCut[cut.color].length === 2
    log(
      `cut rule ${ok ? 'OK' : 'FAILED'}: path ${cut.victim} ${beforeCut[cut.victim].length} → ${afterCut[cut.victim].length} cells, ` +
        `path ${cut.color} now ${afterCut[cut.color].length} cells (expected 2)`,
    )
    await shoot('16-cut')
  } else {
    log('cut test skipped (no endpoint next to another path)')
  }
  await page.keyboard.press('r')
  await page.waitForTimeout(300)
  log(`after reset: ${JSON.stringify(await state())}`)

  // Phone landscape layout (board left, compact panels right)
  if (viewport.name === 'mobile') {
    await page.setViewportSize({ width: 844, height: 390 })
    await page.waitForTimeout(500)
    await dragCells(sol7[0].cells)
    await page.waitForTimeout(300)
    await shoot('17-landscape')
    await page.locator('.nc-pu--firewall').first().click()
    await page.waitForTimeout(300)
    await shoot('18-landscape-armed')
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
  }
}
