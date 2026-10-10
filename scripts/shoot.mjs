#!/usr/bin/env node
/**
 * Visual smoke test for a game route.
 *
 *   node scripts/shoot.mjs --route /ticket-slash --port 5181 --out shots/ticket-slash [--scenario scripts/scenarios/ticket-slash.mjs]
 *
 * - starts a Vite dev server on the given port (unless --no-serve)
 * - opens the route at desktop (1280x800) and phone (390x844) sizes
 * - screenshots the start screen, clicks the PLAY button, waits, screenshots gameplay
 * - optionally runs a scenario module: `export default async function run(page, shoot, viewport) {}`
 *   where `shoot(name)` saves `<out>/<viewport>-<name>.png`
 * - prints every console error / warning / page error and exits 1 if any page error occurred
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const flag = (name) => args.includes(`--${name}`)

const route = opt('route', '/')
const port = Number(opt('port', '5173'))
const out = resolve(opt('out', `shots${route === '/' ? '/hub' : route}`))
const scenarioPath = opt('scenario', null)
const serve = !flag('no-serve')
const onlyViewport = opt('viewport', null) // "desktop" | "mobile"
const playWait = Number(opt('wait', '1800'))

mkdirSync(out, { recursive: true })

const url = `http://localhost:${port}/#${route}`

async function waitForServer(u, ms = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(u)
      if (r.ok) return
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`dev server did not start on port ${port}`)
}

let server = null
if (serve) {
  const root = resolve(import.meta.dirname, '..')
  server = spawn(
    process.execPath,
    [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort', '--clearScreen', 'false'],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'none' },
    },
  )
  server.stdout.on('data', () => {})
  server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`))
  await waitForServer(`http://localhost:${port}/`)
}

const viewports = [
  { name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
].filter((v) => !onlyViewport || v.name === onlyViewport)

const browser = await chromium.launch()
let pageErrors = 0
try {
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
      deviceScaleFactor: vp.deviceScaleFactor ?? 1,
    })
    const page = await context.newPage()
    page.on('console', (msg) => {
      const type = msg.type()
      if (type === 'error' || type === 'warning') console.log(`[${vp.name}] console.${type}: ${msg.text()}`)
    })
    page.on('pageerror', (err) => {
      pageErrors++
      console.log(`[${vp.name}] PAGE ERROR: ${err.message}\n${err.stack ?? ''}`)
    })

    const shoot = async (name) => {
      const file = resolve(out, `${vp.name}-${name}.png`)
      await page.screenshot({ path: file })
      console.log(`saved ${file}`)
    }

    await page.goto(url, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForTimeout(400)
    await shoot('01-start')

    if (scenarioPath) {
      const mod = await import(pathToFileURL(resolve(scenarioPath)).href)
      await mod.default(page, shoot, vp)
    } else {
      const play = page.getByRole('button', { name: /play|start|continue|begin/i }).first()
      if (await play.count()) {
        await play.click()
        await page.waitForTimeout(playWait)
        await shoot('02-playing')
        // generic poke: drag across the canvas and press a few keys
        const canvas = page.locator('canvas').first()
        if (await canvas.count()) {
          const box = await canvas.boundingBox()
          if (box) {
            const cx = box.x + box.width / 2
            const cy = box.y + box.height / 2
            await page.mouse.move(cx - 80, cy + 40)
            await page.mouse.down()
            await page.mouse.move(cx + 80, cy - 60, { steps: 12 })
            await page.mouse.up()
            await page.keyboard.press('ArrowUp')
            await page.keyboard.press('ArrowRight')
          }
        }
        await page.waitForTimeout(1200)
        await shoot('03-after-input')
      } else {
        console.log(`[${vp.name}] no PLAY button found`)
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
  if (server) server.kill('SIGTERM')
}

if (pageErrors > 0) {
  console.log(`\n${pageErrors} page error(s) – fix them.`)
  process.exit(1)
}
console.log('\nOK – no page errors')
