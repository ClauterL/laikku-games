/**
 * Bug Breaker engine – wraps the headless `Sim` with canvas rendering, a
 * fixed-step loop, pointer / keyboard input, juice (particles, shake, slow
 * motion, float texts), sound and the HUD / phase callbacks React listens to.
 */
import { fitCanvas, observeResize, pointerPos, startLoop } from '../../shared/canvas'
import { burst, drawParticles, outlinedText, updateFloatTexts, updateParticles, type FloatText, type Particle } from '../../shared/draw'
import { clamp, damp } from '../../shared/math'
import { sfx } from '../../shared/sfx'
import { getBest, loadJSON, saveJSON, submitBest } from '../../shared/storage'
import {
  drawBand,
  drawBlock,
  drawBug,
  drawCastleFlag,
  drawClouds,
  drawCube,
  drawCubeFx,
  drawFlashes,
  drawGrassFront,
  drawLand,
  drawPouch,
  drawRings,
  drawSky,
  drawSlingshotFork,
  drawTitleSign,
  drawTrail,
  drawTrajectory,
  drawVictorySign,
  label,
  visibleRect,
  type Camera,
  type Flash,
  type Ring,
} from './draw'
import { AMMO, AMMO_SIZE, BUGS, LEVELS, LEVEL_COUNT, MATERIALS, WORLD } from './levels'
import { Sim, dataOf } from './sim'
import type { AmmoType, HudState, Phase, SimEvent } from './types'

export const SLUG = 'bug-breaker'
const PROGRESS_KEY = `${SLUG}:progress`

export interface Progress {
  /** next level to play (0-based) */
  level: number
  /** run score carried into that level */
  score: number
}

export function loadProgress(): Progress {
  const p = loadJSON<Progress>(PROGRESS_KEY, { level: 0, score: 0 })
  if (typeof p.level !== 'number' || p.level < 0 || p.level >= LEVEL_COUNT) return { level: 0, score: 0 }
  return { level: p.level, score: typeof p.score === 'number' ? p.score : 0 }
}

export interface EngineCallbacks {
  onHud: (h: HudState) => void
  onPhase: (p: Phase) => void
}

export const initialHud = (): HudState => ({
  score: 0,
  shotsLeft: 0,
  level: 1,
  levelCount: LEVEL_COUNT,
  current: null,
  queue: [],
  stars: 0,
  bonus: 0,
  levelScore: 0,
  bugsLeft: 0,
  best: getBest(SLUG),
  specialReady: false,
})

interface TestHooks {
  pouch: () => { x: number; y: number }
  bugs: () => number
  level: () => number
  loadLevel: (n: number) => void
  fire: (pullX: number, pullY: number) => boolean
  special: () => boolean
  fastForward: (seconds: number) => void
  state: () => { phase: Phase; shot: string; bugs: number; shots: number; score: number; sim: string }
}

declare global {
  interface Window {
    __bugBreaker?: TestHooks
  }
}

const MAX_PARTICLES = 420
/** phone portrait layout: px reserved for the HUD row above and the ammo bar below the world */
const PORTRAIT_HUD_TOP = 74
const PORTRAIT_BAR = 142
/** how far the portrait camera may look past the world edges (world units) */
const CAM_MARGIN = 60

export class Engine {
  private readonly sim = new Sim()
  private readonly ctx: CanvasRenderingContext2D
  private cam: Camera = { scale: 1, offX: 0, offY: 0, cw: 1, ch: 1, portrait: false, gain: 1 }
  private dpr = 1
  private land: HTMLCanvasElement | null = null
  private landKey = ''
  private phase: Phase = 'start'
  private hud: HudState = initialHud()
  private hudKey = ''
  private destroyed = false
  private readonly disposers: Array<() => void> = []

  private realTime = 0
  private particles: Particle[] = []
  private floats: FloatText[] = []
  private rings: Ring[] = []
  private flashes: Flash[] = []
  private shake = 0
  private shakeT = 0
  private trajectory: number[] = []
  private trajectoryN = 0
  private recoil = { t: 9, x: 0, y: 0 }
  private banner = { text: '', sub: '', t: 0 }
  private hint = { text: '', t: 0 }
  private lastHitSfx = 0
  private squashCount = 0

  /** portrait camera: world x at the left edge, structure focus after a shot */
  private camX = 0
  private focusTimer = 0
  private focusX = 1200

  private aiming = false
  private pointerId = -1
  private grab = { x: 0, y: 0 }

  /** score the run had when the current level started (restored on retry) */
  private levelStartScore = 0

  private readonly canvas: HTMLCanvasElement
  private readonly cb: EngineCallbacks

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas
    this.cb = cb
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    this.ctx = ctx
    this.sim.listener = this.onSimEvent

    const progress = loadProgress()
    this.sim.loadLevel(progress.level)
    this.sim.score = progress.score
    this.sim.state = 'idle'
    this.focusX = this.sim.structureCenter()

    this.disposers.push(observeResize(canvas, this.resize))
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    window.addEventListener('keydown', this.onKeyDown)
    this.disposers.push(() => {
      canvas.removeEventListener('pointerdown', this.onPointerDown)
      canvas.removeEventListener('pointermove', this.onPointerMove)
      canvas.removeEventListener('pointerup', this.onPointerUp)
      canvas.removeEventListener('pointercancel', this.onPointerUp)
      window.removeEventListener('keydown', this.onKeyDown)
    })
    this.disposers.push(startLoop(this.update, this.render))

    const hooks: TestHooks = {
      pouch: () => this.pouchCss(),
      bugs: () => this.sim.bugsLeft(),
      level: () => this.sim.levelIndex + 1,
      loadLevel: (n: number) => this.jumpToLevel(n - 1),
      fire: (px: number, py: number) => this.sim.fire(px, py),
      special: () => this.special(),
      fastForward: (seconds: number) => {
        const n = Math.round(seconds * 60)
        for (let i = 0; i < n; i++) this.update(1 / 60)
      },
      state: () => ({
        phase: this.phase,
        shot: this.sim.shot,
        bugs: this.sim.bugsLeft(),
        shots: this.sim.shotsLeft,
        score: this.sim.score,
        sim: this.sim.state,
      }),
    }
    window.__bugBreaker = hooks
    this.disposers.push(() => {
      if (window.__bugBreaker === hooks) delete window.__bugBreaker
    })
    this.pushHud()
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const d of this.disposers.splice(0)) d()
    this.sim.destroy()
  }

  /* ---------------------------------------------------------------- */
  /* public API (React)                                                */
  /* ---------------------------------------------------------------- */

  /** Start (or continue) a run at the given 0-based level. */
  start(level = 0, score = 0) {
    sfx.unlock()
    this.sim.score = score
    this.beginLevel(level)
  }

  nextLevel() {
    if (this.sim.levelIndex + 1 >= LEVEL_COUNT) {
      this.restartRun()
      return
    }
    this.beginLevel(this.sim.levelIndex + 1)
  }

  retryLevel() {
    this.sim.score = this.levelStartScore
    this.beginLevel(this.sim.levelIndex)
  }

  restartRun() {
    saveJSON(PROGRESS_KEY, { level: 0, score: 0 })
    this.sim.score = 0
    this.beginLevel(0)
  }

  pause() {
    if (this.phase !== 'playing') return
    this.cancelAim()
    this.setPhase('paused')
    sfx.play('click')
  }

  resume() {
    if (this.phase !== 'paused') return
    this.setPhase('playing')
    sfx.play('click')
  }

  togglePause() {
    if (this.phase === 'playing') this.pause()
    else if (this.phase === 'paused') this.resume()
  }

  special(): boolean {
    if (this.phase !== 'playing') return false
    const ok = this.sim.special()
    if (!ok && this.sim.shot === 'flying') {
      const type = this.sim.flying
      if (type && type !== 'js' && type !== 'python') this.showHint(`${AMMO[type].name} has no tap special`, 0.9)
    }
    return ok
  }

  private jumpToLevel(index: number) {
    this.beginLevel(clamp(index, 0, LEVEL_COUNT - 1))
  }

  private beginLevel(index: number) {
    this.levelStartScore = this.sim.score
    this.sim.loadLevel(index)
    this.particles.length = 0
    this.floats.length = 0
    this.rings.length = 0
    this.flashes.length = 0
    this.shake = 0
    this.squashCount = 0
    this.cancelAim()
    const lv = LEVELS[index]
    this.banner = { text: `LEVEL ${index + 1} · ${lv.name.toUpperCase()}`, sub: lv.hint, t: 3.2 }
    this.focusX = this.sim.structureCenter()
    // show the target first, then pan over to the slingshot (portrait camera only)
    this.focusTimer = 1.8
    this.updateCamera(0, true)
    this.setPhase('playing')
    this.pushHud()
  }

  private setPhase(p: Phase) {
    if (this.phase === p) return
    this.phase = p
    this.cb.onPhase(p)
  }

  /* ---------------------------------------------------------------- */
  /* sim events → juice                                                */
  /* ---------------------------------------------------------------- */

  private onSimEvent = (e: SimEvent) => {
    switch (e.type) {
      case 'launch': {
        sfx.play('launch')
        this.recoil = { t: 0, x: this.sim.pull.x, y: this.sim.pull.y }
        if (e.ammo === 'js' || e.ammo === 'python') this.showHint(e.ammo === 'js' ? 'TAP to explode!' : 'TAP to boost!', 1.6)
        break
      }
      case 'impact': {
        if (e.damage > 25 && this.realTime - this.lastHitSfx > 0.08) {
          sfx.play('hit')
          this.lastHitSfx = this.realTime
        }
        if (e.damage > 70) this.addShake(5)
        break
      }
      case 'blockDamaged': {
        const m = MATERIALS[e.material]
        burst(this.particles, e.x, e.y, 4, [m.color, m.light], { speed: 140, life: 0.5, size: 5, gravity: 800 })
        break
      }
      case 'blockDestroyed': {
        const m = MATERIALS[e.material]
        const n = clamp(Math.round((e.w * e.h) / 180), 8, 22)
        burst(this.particles, e.x, e.y, n, [m.color, m.light, m.dark], { speed: 260, life: 0.9, size: 8, gravity: 900 })
        this.addFloat(`+${e.score}`, e.x, e.y - 20, '#ffffff', 18)
        sfx.play('pop')
        this.addShake(3)
        break
      }
      case 'bugSquashed': {
        const info = BUGS[e.kind]
        burst(this.particles, e.x, e.y, 18, ['#6fdc4a', '#3fa321', '#b7f28a'], { speed: 240, life: 0.8, size: 7, gravity: 700, shape: 'circle' })
        burst(this.particles, e.x, e.y, 6, [info.color], { speed: 180, life: 0.6, size: 6, gravity: 800 })
        const words = ['SQUASHED!', 'FIXED!', 'DEBUGGED!']
        const word = e.fell ? 'GONE!' : words[this.squashCount++ % words.length]
        this.addFloat(word, e.x, e.y - 30, '#8dff5a', 24)
        this.addFloat(`+${e.score}`, e.x, e.y - 4, '#ffd23f', 20)
        sfx.play(this.squashCount > 1 ? 'combo' : 'good')
        this.addShake(4)
        break
      }
      case 'shockwave': {
        this.rings.push({ x: e.x, y: e.y, r: 20, maxR: e.radius, life: 0.5, maxLife: 0.5, color: 'rgba(120,190,255,0.9)', width: 10 })
        this.rings.push({ x: e.x, y: e.y, r: 10, maxR: e.radius * 0.7, life: 0.35, maxLife: 0.35, color: 'rgba(255,255,255,0.8)', width: 5 })
        burst(this.particles, e.x, e.y, 16, ['#3b8bff', '#9fd0ff', '#ffffff'], { speed: 320, life: 0.5, size: 5, gravity: 300, shape: 'spark' })
        sfx.play('whoosh')
        sfx.play('hit')
        this.addShake(8)
        break
      }
      case 'explosion': {
        this.flashes.push({ x: e.x, y: e.y, r: e.radius * 0.85, life: 0.42, maxLife: 0.42 })
        this.rings.push({ x: e.x, y: e.y, r: 30, maxR: e.radius, life: 0.6, maxLife: 0.6, color: 'rgba(255,200,80,0.9)', width: 12 })
        burst(this.particles, e.x, e.y, 26, ['#ffd400', '#ff8a1a', '#ff4a1a', '#ffffff'], { speed: 420, life: 0.7, size: 8, gravity: 500, shape: 'spark' })
        burst(this.particles, e.x, e.y, 14, ['#555', '#777', '#999'], { speed: 160, life: 1.1, size: 12, gravity: -60, shape: 'circle' })
        sfx.play('explode')
        this.addShake(16)
        break
      }
      case 'boost': {
        burst(this.particles, e.x, e.y, 12, ['#ffd43b', '#3776ab', '#ffffff'], { speed: 220, life: 0.45, size: 5, gravity: 0, shape: 'spark' })
        sfx.play('whoosh')
        this.addShake(3)
        break
      }
      case 'drill': {
        const m = MATERIALS[e.material]
        burst(this.particles, e.x, e.y, 12, ['#c08ad8', '#8e44ad', m.color], { speed: 240, life: 0.6, size: 6, gravity: 700 })
        sfx.play('pop')
        this.addShake(3)
        break
      }
      case 'shotEnded': {
        burst(this.particles, e.x, e.y, 8, ['#ffffff', '#dddddd'], { speed: 90, life: 0.5, size: 6, gravity: -40, shape: 'circle' })
        this.focusTimer = 1.6
        break
      }
      case 'lastBug': {
        this.addShake(6)
        break
      }
      case 'levelCleared': {
        const next = this.sim.levelIndex + 1
        sfx.play('win')
        if (next >= LEVEL_COUNT) {
          saveJSON(PROGRESS_KEY, { level: 0, score: 0 })
          this.hud.best = submitBest(SLUG, this.sim.score)
          this.setPhase('final')
        } else {
          saveJSON(PROGRESS_KEY, { level: next, score: this.sim.score })
          this.setPhase('cleared')
        }
        this.pushHud(true)
        break
      }
      case 'levelFailed': {
        sfx.play('lose')
        this.hud.best = submitBest(SLUG, this.sim.score)
        this.setPhase('failed')
        this.pushHud(true)
        break
      }
    }
  }

  private addFloat(text: string, x: number, y: number, color: string, size: number) {
    this.floats.push({ x, y, text, color, life: 1.1, maxLife: 1.1, size })
  }

  private addShake(amount: number) {
    this.shake = Math.min(22, this.shake + amount)
  }

  private showHint(text: string, seconds: number) {
    this.hint = { text, t: seconds }
  }

  /* ---------------------------------------------------------------- */
  /* HUD                                                               */
  /* ---------------------------------------------------------------- */

  private pushHud(force = false) {
    const s = this.sim
    const h = this.hud
    h.score = s.score
    h.shotsLeft = s.shotsLeft
    h.level = s.levelIndex + 1
    h.current = s.current ?? s.flying
    h.queue = s.queue
    h.stars = s.stars
    h.bonus = s.bonus
    h.levelScore = s.levelScore
    h.bugsLeft = s.bugsLeft()
    h.specialReady = s.specialReady()
    const key = `${h.score}|${h.shotsLeft}|${h.level}|${h.current}|${h.queue.join(',')}|${h.stars}|${h.bonus}|${h.levelScore}|${h.bugsLeft}|${h.best}|${h.specialReady}`
    if (!force && key === this.hudKey) return
    this.hudKey = key
    this.cb.onHud({ ...h, queue: h.queue.slice() })
  }

  /* ---------------------------------------------------------------- */
  /* camera                                                            */
  /* ---------------------------------------------------------------- */

  private resize = () => {
    const size = fitCanvas(this.canvas)
    this.dpr = size.dpr
    const cw = size.width
    const ch = size.height
    const portrait = cw < ch
    let scale: number
    let offX: number
    let offY: number
    if (portrait) {
      // phone portrait: fit the world height between the HUD row and the ammo bar,
      // then pan horizontally with a real camera (see updateCamera)
      const free = Math.max(240, ch - PORTRAIT_HUD_TOP - PORTRAIT_BAR)
      scale = free / WORLD.h
      offY = PORTRAIT_HUD_TOP
      this.camX = this.clampCamX(this.camX, cw / scale)
      offX = -this.camX * scale
    } else {
      scale = Math.min(cw / WORLD.w, ch / WORLD.h)
      offX = (cw - WORLD.w * scale) / 2
      const centered = (ch - WORLD.h * scale) / 2
      // lift the world so the ammo bar never covers the plateau (only sky gets cropped)
      const reserve = ch < 520 ? 16 : 150
      offY = Math.min(centered, ch - reserve - WORLD.h * scale)
    }
    const gain = Math.max(1, 0.5 / scale)
    this.cam = { scale, offX, offY, cw, ch, portrait, gain }
  }

  private clampCamX(x: number, visW: number) {
    const min = -CAM_MARGIN
    const max = WORLD.w + CAM_MARGIN - visW
    return max < min ? (min + max) / 2 : clamp(x, min, max)
  }

  /** Where the portrait camera wants to be right now (world x of the left edge) and how fast it gets there. */
  private cameraTarget(visW: number): { x: number; lambda: number } {
    const sim = this.sim
    if (sim.shot === 'flying' && sim.ammoBody) return { x: sim.ammoBody.position.x - visW * 0.42, lambda: 7 }
    if (this.focusTimer > 0) return { x: this.focusX - visW / 2, lambda: 3.5 }
    return { x: WORLD.sling.x - visW * 0.3, lambda: 4 }
  }

  private updateCamera(dt: number, snap = false) {
    const cam = this.cam
    if (!cam.portrait) return
    const visW = cam.cw / cam.scale
    const target = this.cameraTarget(visW)
    const tx = this.clampCamX(target.x, visW)
    this.camX = snap ? tx : damp(this.camX, tx, target.lambda, dt)
    cam.offX = -this.camX * cam.scale
  }

  private toCss(x: number, y: number) {
    return { x: x * this.cam.scale + this.cam.offX, y: y * this.cam.scale + this.cam.offY }
  }

  private pouchCss() {
    const p = this.sim.pouch()
    return this.toCss(p.x, p.y)
  }

  /* ---------------------------------------------------------------- */
  /* input                                                             */
  /* ---------------------------------------------------------------- */

  private onPointerDown = (e: PointerEvent) => {
    sfx.unlock()
    if (this.phase !== 'playing') return
    // a touch while the camera lingers on the structure brings it straight back
    this.focusTimer = 0
    const p = pointerPos(this.canvas, e)
    if (this.sim.shot === 'ready') {
      const pc = this.pouchCss()
      const radius = Math.max(44, 80 * this.cam.scale)
      if (Math.hypot(p.x - pc.x, p.y - pc.y) <= radius) {
        if (this.sim.beginAim()) {
          // a moving camera would drag the pull along – settle it before the drag starts
          this.updateCamera(0, true)
          const grabbed = this.pouchCss()
          this.aiming = true
          this.pointerId = e.pointerId
          this.grab = { x: p.x - grabbed.x, y: p.y - grabbed.y }
          try {
            this.canvas.setPointerCapture(e.pointerId)
          } catch {
            /* capture is optional */
          }
          sfx.play('tap')
          this.updatePull(p)
        }
      } else {
        this.showHint('Grab the cube in the slingshot and drag it back!', 1.4)
      }
      return
    }
    if (this.sim.shot === 'flying') this.special()
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.aiming || e.pointerId !== this.pointerId) return
    this.updatePull(pointerPos(this.canvas, e))
  }

  private onPointerUp = (e: PointerEvent) => {
    if (!this.aiming || e.pointerId !== this.pointerId) return
    this.aiming = false
    this.pointerId = -1
    try {
      this.canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    this.sim.release()
    this.pushHud()
  }

  private updatePull(p: { x: number; y: number }) {
    const anchor = this.toCss(WORLD.sling.pouchX, WORLD.sling.pouchY)
    const dx = (p.x - this.grab.x - anchor.x) / (this.cam.scale * this.cam.gain)
    const dy = (p.y - this.grab.y - anchor.y) / (this.cam.scale * this.cam.gain)
    this.sim.setPull(dx, dy)
  }

  private cancelAim() {
    if (!this.aiming) return
    this.aiming = false
    this.pointerId = -1
    if (this.sim.shot === 'aiming') {
      this.sim.setPull(0, 0)
      this.sim.release()
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return
    const k = e.key
    if (this.phase === 'playing') {
      if (k === ' ') {
        e.preventDefault()
        this.special()
      } else if (k === 'r' || k === 'R') {
        this.retryLevel()
      } else if (k === 'Escape' || k === 'p' || k === 'P') {
        this.pause()
      }
    } else if (this.phase === 'paused') {
      if (k === 'Escape' || k === 'p' || k === 'P') this.resume()
    }
  }

  /* ---------------------------------------------------------------- */
  /* loop                                                              */
  /* ---------------------------------------------------------------- */

  private update = (dt: number) => {
    this.realTime += dt
    const live = this.phase === 'playing' || this.phase === 'cleared' || this.phase === 'failed' || this.phase === 'final'
    if (!live) return
    const slow = this.sim.slowMo > 0 ? 0.3 : 1
    this.sim.update(dt)
    const gdt = dt * slow
    updateParticles(this.particles, gdt)
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES)
    updateFloatTexts(this.floats, dt)
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= gdt
      if (this.rings[i].life <= 0) this.rings.splice(i, 1)
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].life -= gdt
      if (this.flashes[i].life <= 0) this.flashes.splice(i, 1)
    }
    if (this.shake > 0.1) {
      this.shake *= Math.exp(-5 * dt)
      this.shakeT += dt
    } else this.shake = 0
    this.recoil.t += dt
    if (this.focusTimer > 0) this.focusTimer -= dt
    this.updateCamera(dt)
    if (this.banner.t > 0) this.banner.t -= dt
    if (this.hint.t > 0) this.hint.t -= dt
    // python boost / sql drill streak particles
    const ammo = this.sim.ammoBody
    if (ammo && this.sim.shot === 'flying') {
      const d = dataOf(ammo)
      if (d && ((d.ammo === 'python' && d.boosted) || d.ammo === 'sql') && ammo.speed > 4) {
        burst(this.particles, ammo.position.x, ammo.position.y, 1, d.ammo === 'sql' ? ['#c08ad8', '#8e44ad'] : ['#ffd43b', '#3776ab'], {
          speed: 40,
          life: 0.35,
          size: 5,
          gravity: 0,
          shape: 'circle',
        })
      }
    }
    if (this.phase === 'playing') this.pushHud()
  }

  private render = () => {
    const ctx = this.ctx
    const cam = this.cam
    const t = this.realTime
    const cw = cam.cw
    const ch = cam.ch

    // land layer cache (sky + clouds are live). In portrait the cache spans the
    // whole world width so the camera can pan over it without re-rendering.
    const rect = this.landRect()
    const key = `${cw}x${ch}@${this.dpr}:${cam.scale.toFixed(4)}:${rect.x0.toFixed(1)}:${rect.x1.toFixed(1)}:${cam.offY.toFixed(1)}`
    if (key !== this.landKey) {
      this.landKey = key
      this.land = this.buildLand(rect)
    }

    ctx.save()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)

    let sx = 0
    let sy = 0
    if (this.shake > 0) {
      sx = Math.sin(this.shakeT * 61) * this.shake
      sy = Math.cos(this.shakeT * 47) * this.shake
    }

    // ---- world space ----
    ctx.save()
    ctx.translate(cam.offX + sx, cam.offY + sy)
    ctx.scale(cam.scale, cam.scale)
    drawSky(ctx, cam)
    drawClouds(ctx, cam, t)
    ctx.restore()

    if (this.land) ctx.drawImage(this.land, cam.offX + rect.x0 * cam.scale + sx, sy, (rect.x1 - rect.x0) * cam.scale, ch)

    ctx.save()
    ctx.translate(cam.offX + sx, cam.offY + sy)
    ctx.scale(cam.scale, cam.scale)
    drawCastleFlag(ctx, t)

    const sim = this.sim
    // dots must stay legible on phones, where a world unit is a fraction of a pixel
    const dotR = Math.max(4.5, 2.7 / cam.scale)
    if (sim.trail.length > 0 && sim.shot !== 'aiming') drawTrail(ctx, sim.trail, dotR * 0.75)
    if (sim.shot === 'aiming') {
      this.trajectoryN = sim.previewTrajectory(this.trajectory, 56)
      drawTrajectory(ctx, this.trajectory, this.trajectoryN, dotR)
    }

    // slingshot – back band, pouch + cube, front band
    const pouch = this.pouchPos()
    const loaded = sim.shot === 'ready' || sim.shot === 'aiming'
    drawSlingshotFork(ctx)
    drawBand(ctx, pouch, true, !loaded && this.recoil.t > 0.6)
    if (loaded) {
      const type = sim.current as AmmoType
      ctx.save()
      ctx.translate(pouch.x, pouch.y)
      const pullLen = Math.hypot(sim.pull.x, sim.pull.y)
      const ang = sim.shot === 'aiming' && pullLen > 4 ? Math.atan2(sim.pull.y, sim.pull.x) * 0.15 : 0
      ctx.rotate(ang)
      drawPouch(ctx, { x: 0, y: 0 }, Math.PI / 2)
      const ready = sim.specialReady()
      drawCube(ctx, type, AMMO_SIZE, { t, special: ready })
      ctx.restore()
    } else {
      drawPouch(ctx, pouch, 0)
    }

    // bodies
    const ammoBody = sim.ammoBody
    const bodies = sim.bodies()
    for (const b of bodies) {
      const d = dataOf(b)
      if (d && d.kind === 'block') drawBlock(ctx, b, d)
    }
    for (const b of bodies) {
      const d = dataOf(b)
      if (!d || d.kind !== 'bug') continue
      const scared =
        !!ammoBody && Math.hypot(ammoBody.position.x - b.position.x, ammoBody.position.y - b.position.y) < 260 && ammoBody.speed > 2
      drawBug(ctx, b, d, scared)
    }
    for (const b of bodies) {
      const d = dataOf(b)
      if (!d || d.kind !== 'ammo') continue
      drawCubeFx(ctx, b, d, t)
      ctx.save()
      ctx.translate(b.position.x, b.position.y)
      ctx.rotate(b.angle)
      drawCube(ctx, d.ammo as AmmoType, AMMO_SIZE, { t, special: !d.specialUsed && (d.ammo === 'js' || d.ammo === 'python') })
      ctx.restore()
    }

    drawBand(ctx, pouch, false, !loaded && this.recoil.t > 0.6)

    drawFlashes(ctx, this.flashes)
    drawParticles(ctx, this.particles)
    drawRings(ctx, this.rings)
    drawGrassFront(ctx, cam, t)
    ctx.restore()

    // ---- screen space ----
    this.drawScreenUi(ctx, cw, ch, t)
    ctx.restore()
  }

  /** Pouch position including the rubber-band recoil after a launch. */
  private pouchPos() {
    const p = this.sim.pouch()
    if (this.sim.shot === 'aiming' || this.recoil.t > 0.6) return p
    const k = Math.exp(-9 * this.recoil.t) * Math.cos(this.recoil.t * 34)
    return { x: p.x - this.recoil.x * 0.45 * k, y: p.y - this.recoil.y * 0.45 * k }
  }

  private drawScreenUi(ctx: CanvasRenderingContext2D, cw: number, ch: number, t: number) {
    const cam = this.cam
    const phone = cw < 700 || ch < 520
    // float texts (world → screen so they stay readable on phones)
    for (const f of this.floats) {
      const p = this.toCss(f.x, f.y)
      ctx.save()
      ctx.globalAlpha = Math.min(1, f.life / (f.maxLife * 0.5))
      const size = (f.size ?? 20) * (phone ? 0.8 : 1)
      outlinedText(ctx, f.text, p.x, p.y, {
        font: `800 ${size}px "Baloo 2", "Nunito", sans-serif`,
        fill: f.color,
        stroke: 'rgba(0,0,0,0.7)',
        strokeWidth: 5,
      })
      ctx.restore()
    }

    // title lock-up (small in portrait play – the world needs the room)
    const start = this.phase === 'start'
    const signW = start ? clamp(cw * 0.34, 220, 440) : cam.portrait ? 126 : clamp(cw * 0.19, 150, 230)
    const signX = start ? Math.max(16, cw * 0.03) : 12
    const signY = start ? (cam.portrait ? 70 : 60) : 66
    drawTitleSign(ctx, signX, signY, signW, t)

    if (start) {
      const vw = cam.portrait ? clamp(cw * 0.5, 170, 260) : clamp(cw * 0.26, 170, 330)
      drawVictorySign(ctx, cw - vw - 16, cam.portrait ? ch - PORTRAIT_BAR - vw * 0.5 : ch - vw * 0.5 - 150, vw)
    }

    const bannerY = cam.portrait ? cam.offY + 96 : Math.max(70, ch * 0.16)
    const hintY = cam.portrait ? cam.offY + 150 : Math.max(110, ch * 0.24)

    // level banner
    if (this.banner.t > 0 && this.phase === 'playing') {
      const a = Math.min(1, this.banner.t / 0.4, (3.2 - this.banner.t) / 0.3 + 0.001)
      ctx.save()
      ctx.globalAlpha = clamp(a, 0, 1)
      label(ctx, this.banner.text, cw / 2, bannerY, phone ? 22 : 30, '#ffd23f')
      label(ctx, this.banner.sub, cw / 2, bannerY + (phone ? 24 : 32), phone ? 13 : 16, '#ffffff')
      ctx.restore()
    }

    // hint (tap to explode etc.)
    if (this.hint.t > 0 && this.phase === 'playing') {
      ctx.save()
      ctx.globalAlpha = clamp(this.hint.t / 0.3, 0, 1)
      const pulse = 1 + Math.sin(t * 10) * 0.04
      label(ctx, this.hint.text, cw / 2, hintY, (phone ? 16 : 20) * pulse, '#ffffff', 'rgba(200,60,20,0.9)')
      ctx.restore()
    }

    // "TAP!" marker following a cube whose special is still available
    const ammo = this.sim.ammoBody
    if (ammo && this.phase === 'playing' && this.sim.specialReady()) {
      const p = this.toCss(ammo.position.x, ammo.position.y)
      const bob = Math.sin(t * 8) * 3
      label(ctx, 'TAP!', p.x, p.y - AMMO_SIZE * cam.scale - 14 + bob, phone ? 14 : 17, '#ffd23f')
    }

    // settling / out of ammo notice
    if (this.sim.state === 'settling' && this.phase === 'playing') {
      label(ctx, 'OUT OF CODE… settling', cw / 2, hintY, phone ? 15 : 18, '#ffffff', 'rgba(120,30,20,0.9)')
    }
  }

  /** World rect covered by the cached land layer (full world width in portrait). */
  private landRect() {
    const cam = this.cam
    const v = visibleRect(cam)
    if (!cam.portrait) return { x0: v.x0, x1: v.x1, y0: v.y0, y1: v.y1 }
    return { x0: -CAM_MARGIN - 40, x1: WORLD.w + CAM_MARGIN + 40, y0: v.y0, y1: v.y1 }
  }

  private buildLand(rect: { x0: number; x1: number; y0: number; y1: number }): HTMLCanvasElement {
    const cam = this.cam
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round((rect.x1 - rect.x0) * cam.scale * this.dpr))
    c.height = Math.max(1, Math.round(cam.ch * this.dpr))
    const g = c.getContext('2d')
    if (!g) return c
    g.setTransform(this.dpr * cam.scale, 0, 0, this.dpr * cam.scale, -rect.x0 * cam.scale * this.dpr, cam.offY * this.dpr)
    drawLand(g, rect)
    return c
  }
}
