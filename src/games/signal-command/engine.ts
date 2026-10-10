/**
 * Puolustusvoimat – Signal Command: the game itself (no React in here).
 *
 * Stratagem Hero rules, themed as the Defence Forces' signals network: a wave
 * is a list of incidents, each fixed by a command code (a sequence of arrows).
 * Enter the arrows in order before the wave timer runs out; a wrong arrow
 * resets the current code and the combo. Clear five waves over the five
 * mission sectors, then keep going in endless waves.
 *
 * The engine owns the effects canvas inside the centre panel, the map canvas
 * (attached by the component, it moves between layouts), the timers and the
 * keyboard. It emits a HUD snapshot only when something visible changed.
 */
import { fitCanvas, observeResize, startLoop } from '../../shared/canvas'
import { clamp } from '../../shared/math'
import { pick, seededRng, type Rng } from '../../shared/rng'
import { sfx } from '../../shared/sfx'
import { getBest, submitBest } from '../../shared/storage'
import { ARROW_CHAR, BY_TIER, OPENERS, WAVE_BASE_SECONDS, secondsPerArrow, tierWeights, type CommandDef } from './commands'
import { Fx } from './fx'
import { MapRenderer, type MapState } from './map'
import { NEIGHBOURS, SECTOR_BY_ID, sectorForWave, type SectorDef } from './sectors'
import {
  SYSTEM_IDS,
  SYSTEM_META,
  type CommandView,
  type CurrentView,
  type DebriefView,
  type Dir,
  type FeedbackView,
  type HudState,
  type IncidentView,
  type InterludeView,
  type NodeState,
  type Phase,
  type SectorId,
  type SystemId,
  type Tier,
  type ToastView,
} from './types'

export const SLUG = 'signal-command'
export const MAX_COMBO = 12
export const START_LIVES = 3
export const MISSION_WAVES = 5
const INTERLUDE_SECONDS = 1.5
const CLEAR_HOLD_SECONDS = 1.0
const HEAL_PER_CODE = 8
const HEAL_PER_WAVE = 5
const HIT_PER_TIMEOUT = 15
const DECAY_PER_SECOND = 0.5
const FAIL_INTEGRITY = 20
const PERFECT_PACE = 0.6
const HINT = 'Type the arrows in order – a wrong arrow resets the code.'

const CYAN = '#19c8ff'
const GREEN = '#36ff6a'
const AMBER = '#ffb020'
const WHITE = '#ffffff'

export interface EngineCallbacks {
  onHud: (hud: HudState) => void
}

interface Incident {
  id: number
  def: CommandDef
  sectorId: SectorId
  location: string
  solved: boolean
}

interface HookState {
  phase: Phase
  wave: number
  sector: SectorId
  score: number
  combo: number
  lives: number
  timeLeft: number
  waveTime: number
  current: { name: string; code: Dir[]; arrows: string; progress: number } | null
  /** true during the short celebration after the last code of a wave */
  clearing: boolean
  queue: string[]
  systems: Record<SystemId, number>
  accuracy: number
  integrity: number
  misses: number
  waveCount: number
  waveSolved: number
  interlude: InterludeView | null
}

export interface HookApi {
  state: () => HookState
  press: (dir: Dir) => void
  solveCurrent: () => void
  failWave: () => void
  skipToWave: (n: number) => void
  start: () => void
}

declare global {
  interface Window {
    __signalCommand?: HookApi
  }
}

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
  W: 'up',
  A: 'left',
  S: 'down',
  D: 'right',
}

const freshSystems = (): Record<SystemId, number> => ({ radio: 100, satellite: 100, data: 100, servers: 100, power: 100, security: 100 })

export const initialHud: HudState = {
  phase: 'start',
  wave: 1,
  endless: false,
  sectorId: 'helsinki',
  sectorName: 'Helsinki Sector',
  waveCount: 0,
  waveSolved: 0,
  wavesCleared: 0,
  score: 0,
  gain: null,
  combo: 1,
  bestCombo: 1,
  timeLeft: 0,
  waveTime: 1,
  lives: START_LIVES,
  integrity: 100,
  accuracy: 100,
  systems: freshSystems(),
  current: null,
  queue: [],
  incidents: [],
  nodes: { helsinki: 'online', turku: 'online', west: 'online', oulu: 'online', east: 'online', lapland: 'online' },
  counts: { online: 6, incident: 0, offline: 0 },
  feedback: null,
  toast: null,
  missSeq: 0,
  solveSeq: 0,
  solvedCode: null,
  interlude: null,
  debrief: null,
  best: 0,
  hint: null,
  waveFlawless: true,
}

function commandView(def: CommandDef): CommandView {
  return { id: def.id, name: def.name, glyph: def.glyph, system: def.system, code: def.code, brief: def.brief, steps: def.steps }
}

export class Engine {
  private ctx: CanvasRenderingContext2D | null
  private cb: EngineCallbacks
  private fx = new Fx()
  private map: MapRenderer | null = null
  private mapCanvas: HTMLCanvasElement | null = null
  private unobserveMap: (() => void) | null = null
  private disposers: (() => void)[] = []
  private destroyed = false
  private originSet = false
  private t = 0
  private rng: Rng = seededRng((Math.random() * 2 ** 32) >>> 0)

  // ---- mission state ------------------------------------------------------
  private phase: Phase = 'start'
  private pausedFrom: Phase = 'playing'
  private wave = 1
  private sector: SectorDef = sectorForWave(1)
  private incidents: Incident[] = []
  private index = 0
  private progress = 0
  private codeHadMiss = false
  private codeStart = 0
  private timeLeft = 0
  private waveTime = 1
  private score = 0
  private gain: HudState['gain'] = null
  private gainSeq = 0
  private streak = 0
  private bestCombo = 1
  private lives = START_LIVES
  private systems = freshSystems()
  private totalArrows = 0
  private correctArrows = 0
  private misses = 0
  private waveMisses = 0
  private wavesCleared = 0
  private perfectWaves = 0
  private offline = new Set<SectorId>()
  private feedback: FeedbackView | null = null
  private toast: ToastView | null = null
  private feedbackSeq = 0
  private toastSeq = 0
  private missSeq = 0
  private solveSeq = 0
  private solvedCode: readonly Dir[] | null = null
  private interlude: (InterludeView & { timer: number; nextWave: number }) | null = null
  /** seconds of celebration after a wave clear before the interlude covers the panel */
  private clearHold = 0
  private debrief: DebriefView | null = null
  private best = 0
  private hint: string | null = null
  private incidentSeq = 0
  private locationCounter = 0
  private lastCommandId: string | null = null

  // ---- cached HUD views ---------------------------------------------------
  private dirty = true
  private lastTimeQ = -1
  private currentView: CurrentView | null = null
  private queueView: CommandView[] = []
  private incidentsView: IncidentView[] = []
  private nodesView: Record<SectorId, NodeState> = { ...initialHud.nodes }
  private countsView = { online: 6, incident: 0, offline: 0 }
  private systemsView: Record<SystemId, number> = freshSystems()
  private mapState: MapState = { nodes: this.nodesView, active: null, pending: {} }

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.ctx = canvas.getContext('2d')
    this.cb = cb
    this.best = getBest(SLUG)

    this.disposers.push(
      observeResize(canvas, () => {
        const s = fitCanvas(canvas)
        this.fx.width = s.width
        this.fx.height = s.height
        if (!this.originSet) this.fx.origin = { x: s.width / 2, y: s.height * 0.42 }
      }),
    )
    this.disposers.push(startLoop((dt) => this.update(dt), () => this.render()))

    const onKey = (e: KeyboardEvent) => this.onKey(e)
    window.addEventListener('keydown', onKey)
    this.disposers.push(() => window.removeEventListener('keydown', onKey))

    const onHide = () => {
      if (document.hidden && this.phase === 'playing') this.pause()
    }
    document.addEventListener('visibilitychange', onHide)
    this.disposers.push(() => document.removeEventListener('visibilitychange', onHide))
    const onBlur = () => {
      if (this.phase === 'playing') this.pause()
    }
    window.addEventListener('blur', onBlur)
    this.disposers.push(() => window.removeEventListener('blur', onBlur))

    this.installHook()
    this.emit()
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const d of this.disposers) d()
    this.disposers = []
    this.attachMap(null)
  }

  /* ---------------------------------------------------------------- */
  /* public API for the component                                      */
  /* ---------------------------------------------------------------- */

  /** The map canvas lives in different places per layout – hand over whatever is mounted. */
  attachMap(canvas: HTMLCanvasElement | null) {
    if (canvas === this.mapCanvas) return
    this.unobserveMap?.()
    this.unobserveMap = null
    this.mapCanvas = canvas
    this.map = null
    if (!canvas) return
    const map = new MapRenderer(canvas)
    this.map = map
    this.unobserveMap = observeResize(canvas, () => map.resize())
  }

  /** Where the speed lines radiate from – the centre of the arrow row, in canvas CSS pixels. */
  setBurstOrigin(x: number, y: number) {
    this.originSet = true
    this.fx.origin = { x, y }
  }

  /** New mission from wave 1. */
  start() {
    this.score = 0
    this.gain = null
    this.streak = 0
    this.bestCombo = 1
    this.lives = START_LIVES
    this.systems = freshSystems()
    this.totalArrows = 0
    this.correctArrows = 0
    this.misses = 0
    this.wavesCleared = 0
    this.perfectWaves = 0
    this.offline.clear()
    this.debrief = null
    this.toast = null
    this.feedback = null
    this.lastCommandId = null
    this.fx.clear()
    this.startWave(1)
    sfx.play('launch')
  }

  /** From the MISSION COMPLETE debrief: on into endless waves. */
  continueEndless() {
    if (this.phase !== 'complete') return
    this.debrief = null
    this.beginInterlude('next', this.wave + 1, 0)
    sfx.play('whoosh')
  }

  togglePause() {
    if (this.phase === 'paused') this.resume()
    else if (this.phase === 'playing' || this.phase === 'interlude') this.pause()
  }

  pause() {
    if (this.phase !== 'playing' && this.phase !== 'interlude') return
    this.pausedFrom = this.phase
    this.setPhase('paused')
  }

  resume() {
    if (this.phase !== 'paused') return
    this.setPhase(this.pausedFrom)
  }

  /** One arrow from the keyboard, the D-pad or a swipe. */
  press(dir: Dir) {
    if (this.phase !== 'playing') return
    const inc = this.incidents[this.index]
    if (!inc) return
    const expected = inc.def.code[this.progress]
    this.totalArrows++
    if (dir === expected) {
      this.correctArrows++
      this.progress++
      sfx.play('tap')
      this.fx.speedBurst(14, [CYAN, GREEN, WHITE], 1)
      if (this.progress >= inc.def.code.length) this.complete(inc)
      else this.rebuildCurrent()
    } else {
      this.misses++
      this.waveMisses++
      this.codeHadMiss = true
      this.progress = 0
      this.streak = 0
      this.missSeq++
      this.setFeedback('miss', 'MISS', 'CODE RESET · COMBO LOST')
      sfx.play('bad')
      this.rebuildCurrent()
    }
    this.dirty = true
  }

  /* ---------------------------------------------------------------- */
  /* waves                                                              */
  /* ---------------------------------------------------------------- */

  private startWave(n: number) {
    this.wave = n
    this.sector = sectorForWave(n)
    this.offline.delete(this.sector.id)
    this.incidents = this.buildWave(n)
    this.index = 0
    this.progress = 0
    this.codeHadMiss = false
    this.codeStart = this.t
    this.waveMisses = 0
    const arrows = this.incidents.reduce((sum, i) => sum + i.def.code.length, 0)
    this.waveTime = Math.round((arrows * secondsPerArrow(n) + WAVE_BASE_SECONDS) * 10) / 10
    this.timeLeft = this.waveTime
    this.hint = n === 1 ? HINT : null
    this.interlude = null
    this.clearHold = 0
    this.feedback = null
    this.rebuildWave()
    this.setPhase('playing')
  }

  private buildWave(n: number): Incident[] {
    const count = Math.min(12, 4 + n)
    const weights = tierWeights(n)
    const picks: CommandDef[] = []
    const recent: string[] = this.lastCommandId ? [this.lastCommandId] : []
    for (let i = 0; i < count; i++) {
      let def: CommandDef
      if (n === 1 && i === 0) {
        def = pick(this.rng, OPENERS)
      } else {
        const tier = this.pickTier(weights)
        // avoid immediate repeats and, where the pool allows, anything from the last three codes
        const base: readonly CommandDef[] = BY_TIER[tier]
        let pool: readonly CommandDef[] = base.filter((c) => !recent.includes(c.id))
        if (pool.length === 0) pool = base.filter((c) => c.id !== recent[recent.length - 1])
        if (pool.length === 0) pool = base
        def = pick(this.rng, pool)
      }
      picks.push(def)
      recent.push(def.id)
      if (recent.length > 3) recent.shift()
    }
    this.lastCommandId = picks[picks.length - 1].id
    const neighbours = NEIGHBOURS[this.sector.id]
    return picks.map((def, i) => {
      // every third incident spills over to a neighbouring sector so the map lights up
      const spill = i % 3 === 2 && neighbours.length > 0
      const sectorId = spill ? neighbours[Math.floor(i / 3) % neighbours.length] : this.sector.id
      const sec = SECTOR_BY_ID[sectorId]
      const location = sec.locations[this.locationCounter++ % sec.locations.length]
      return { id: ++this.incidentSeq, def, sectorId, location, solved: false }
    })
  }

  private pickTier(weights: Record<Tier, number>): Tier {
    const r = this.rng() * (weights.easy + weights.medium + weights.hard)
    if (r < weights.easy) return 'easy'
    if (r < weights.easy + weights.medium) return 'medium'
    return 'hard'
  }

  private complete(inc: Incident) {
    const len = inc.def.code.length
    const mult = Math.min(MAX_COMBO, 1 + this.streak)
    const gain = 50 * len * mult
    this.score += gain
    this.gain = { id: ++this.gainSeq, amount: gain }
    const flawless = !this.codeHadMiss
    if (flawless) this.streak++
    else this.streak = 0
    this.bestCombo = Math.max(this.bestCombo, Math.min(MAX_COMBO, 1 + this.streak))
    const pace = (this.t - this.codeStart) / len
    const perfect = flawless && pace <= PERFECT_PACE
    this.setFeedback(perfect ? 'perfect' : 'good', perfect ? 'PERFECT!' : 'GOOD', `COMBO x${mult} · +${gain}`)
    this.systems[inc.def.system] = Math.min(100, this.systems[inc.def.system] + HEAL_PER_CODE)
    inc.solved = true
    this.setToast('ok', SYSTEM_META[inc.def.system].restored, `+${gain} XP`)
    sfx.play(this.streak > 0 && this.streak % 4 === 0 ? 'combo' : 'good')
    this.fx.solveBurst(perfect ? [GREEN, WHITE, CYAN] : [CYAN, WHITE, GREEN], false)
    this.solveSeq++
    this.solvedCode = inc.def.code
    this.hint = null
    this.index++
    this.progress = 0
    this.codeHadMiss = false
    this.codeStart = this.t
    if (this.index >= this.incidents.length) this.waveClear()
    else this.rebuildWave()
  }

  private waveClear() {
    const bonus = Math.round(this.timeLeft) * 25
    const perfect = this.waveMisses === 0
    const total = bonus + (perfect ? 500 : 0)
    this.score += total
    this.gain = { id: ++this.gainSeq, amount: total }
    if (perfect) this.perfectWaves++
    this.wavesCleared++
    for (const id of SYSTEM_IDS) this.systems[id] = Math.min(100, this.systems[id] + HEAL_PER_WAVE)
    this.offline.delete(this.sector.id)
    this.setFeedback('clear', perfect ? 'PERFECT!' : 'WAVE CLEAR', `TIME BONUS +${bonus}${perfect ? ' · FLAWLESS +500' : ''}`)
    this.setToast('info', `${this.sector.label} SECURED`, `wave ${this.wave} clear`)
    sfx.play('win')
    this.fx.solveBurst(perfect ? [GREEN, AMBER, WHITE] : [CYAN, GREEN, WHITE], true)
    this.rebuildWave()
    // stay in 'playing' (timer frozen, no current code) so the burst and the banner get their moment
    this.clearHold = CLEAR_HOLD_SECONDS
  }

  private afterClearHold() {
    if (this.wave === MISSION_WAVES) this.beginInterlude('complete', this.wave, 0)
    else this.beginInterlude('next', this.wave + 1, 0)
  }

  private timeout() {
    const open = this.incidents.filter((i) => !i.solved)
    const before = this.integrity()
    for (const inc of open) this.systems[inc.def.system] = Math.max(0, this.systems[inc.def.system] - HIT_PER_TIMEOUT)
    const loss = Math.max(0, Math.round(before - this.integrity()))
    this.lives--
    this.streak = 0
    this.offline.add(this.sector.id)
    this.timeLeft = 0
    this.setFeedback('timeout', 'TIME OUT', `${open.length} INCIDENT${open.length === 1 ? '' : 'S'} UNRESOLVED · -1 LIFE`)
    this.setToast('bad', 'WAVE TIMEOUT', `integrity -${loss} %`)
    sfx.play('alarm')
    this.rebuildWave()
    if (this.lives <= 0) this.fail('All three lives lost – the network went dark.')
    else if (this.integrity() < FAIL_INTEGRITY) this.fail('Operational integrity collapsed below 20 %.')
    else this.beginInterlude('retry', this.wave, loss)
  }

  private beginInterlude(kind: InterludeView['kind'], nextWave: number, loss: number) {
    const sec = sectorForWave(nextWave)
    this.interlude = {
      kind,
      wave: nextWave,
      sectorId: sec.id,
      sectorName: sec.name,
      count: Math.min(12, 4 + nextWave),
      loss,
      timer: INTERLUDE_SECONDS + (kind === 'complete' ? 0.3 : 0),
      nextWave,
    }
    this.setPhase('interlude')
  }

  private finishInterlude() {
    const il = this.interlude
    if (!il) return
    this.interlude = null
    if (il.kind === 'complete') this.finishMission(true, 'Five waves cleared – every sector back online.')
    else {
      this.startWave(il.nextWave)
      sfx.play('whoosh')
    }
  }

  private fail(reason: string) {
    this.finishMission(false, reason)
    sfx.play('lose')
  }

  private finishMission(won: boolean, reason: string) {
    const score = Math.round(this.score)
    const prev = this.best
    this.best = submitBest(SLUG, score)
    this.debrief = {
      won,
      reason,
      score,
      best: this.best,
      isBest: score > 0 && score >= this.best && score > prev,
      waves: this.wavesCleared,
      accuracy: this.accuracy(),
      bestCombo: this.bestCombo,
      perfectWaves: this.perfectWaves,
    }
    this.setPhase(won ? 'complete' : 'failed')
  }

  /* ---------------------------------------------------------------- */
  /* loop                                                               */
  /* ---------------------------------------------------------------- */

  private update(dt: number) {
    this.t += dt
    this.fx.update(dt)
    if (this.phase === 'playing' && this.clearHold > 0) {
      this.clearHold -= dt
      if (this.clearHold <= 0) {
        this.clearHold = 0
        this.afterClearHold()
      }
    } else if (this.phase === 'playing') {
      this.timeLeft -= dt
      // systems with an open incident degrade until it is solved – speed matters
      const hit = new Set<SystemId>()
      for (let i = this.index; i < this.incidents.length; i++) hit.add(this.incidents[i].def.system)
      for (const id of hit) this.systems[id] = Math.max(0, this.systems[id] - DECAY_PER_SECOND * dt)
      if (this.timeLeft <= 0) {
        this.timeout()
      } else if (this.integrity() < FAIL_INTEGRITY) {
        this.fail('Operational integrity collapsed below 20 %.')
      }
      const q = Math.ceil(Math.max(0, this.timeLeft) * 10) / 10
      if (q !== this.lastTimeQ) {
        this.lastTimeQ = q
        this.dirty = true
      }
    } else if (this.phase === 'interlude' && this.interlude) {
      this.interlude.timer -= dt
      if (this.interlude.timer <= 0) this.finishInterlude()
    }
    // systems view only changes when a rounded value moves
    for (const id of SYSTEM_IDS) {
      const v = Math.round(this.systems[id])
      if (v !== this.systemsView[id]) {
        this.systemsView = { ...this.systemsView, [id]: v }
        this.dirty = true
      }
    }
    if (this.dirty) this.emit()
  }

  private render() {
    if (this.ctx) this.fx.draw(this.ctx)
    this.map?.draw(this.mapState, this.t)
  }

  /* ---------------------------------------------------------------- */
  /* helpers                                                            */
  /* ---------------------------------------------------------------- */

  private integrity() {
    let sum = 0
    for (const id of SYSTEM_IDS) sum += this.systems[id]
    return sum / SYSTEM_IDS.length
  }

  private accuracy() {
    return this.totalArrows === 0 ? 100 : Math.round((100 * this.correctArrows) / this.totalArrows)
  }

  private setPhase(p: Phase) {
    this.phase = p
    this.dirty = true
  }

  private setFeedback(kind: FeedbackView['kind'], text: string, sub: string) {
    this.feedback = { id: ++this.feedbackSeq, kind, text, sub }
    this.dirty = true
  }

  private setToast(kind: ToastView['kind'], text: string, sub: string) {
    this.toast = { id: ++this.toastSeq, kind, text, sub }
    this.dirty = true
  }

  private rebuildCurrent() {
    const inc = this.incidents[this.index]
    this.currentView = inc
      ? { ...commandView(inc.def), incidentId: inc.id, progress: this.progress, location: inc.location, incident: inc.def.incident, sectorId: inc.sectorId }
      : null
    this.dirty = true
  }

  /** Rebuild every wave-level view: current, queue, incidents, map nodes. */
  private rebuildWave() {
    this.rebuildCurrent()
    this.queueView = this.incidents.slice(this.index + 1, this.index + 5).map((i) => commandView(i.def))
    this.incidentsView = this.incidents.map((i, n) => ({
      id: i.id,
      location: i.location,
      incident: i.def.incident,
      sectorId: i.sectorId,
      arrows: i.def.code.length,
      state: i.solved ? 'solved' : n === this.index ? 'active' : 'queued',
    }))
    const pending: Partial<Record<SectorId, number>> = {}
    for (const i of this.incidents) if (!i.solved) pending[i.sectorId] = (pending[i.sectorId] ?? 0) + 1
    const nodes = {} as Record<SectorId, NodeState>
    const counts = { online: 0, incident: 0, offline: 0 }
    for (const id of Object.keys(SECTOR_BY_ID) as SectorId[]) {
      // a timed-out sector shows OFFLINE (grey) until its wave restarts, even with incidents listed
      const st: NodeState = this.offline.has(id) ? 'offline' : (pending[id] ?? 0) > 0 ? 'incident' : 'online'
      nodes[id] = st
      counts[st]++
    }
    this.nodesView = nodes
    this.countsView = counts
    const active = this.incidents[this.index]
    this.mapState = { nodes, active: active && !active.solved ? active.sectorId : null, pending }
    this.dirty = true
  }

  private emit() {
    this.dirty = false
    const hud: HudState = {
      phase: this.phase,
      wave: this.wave,
      endless: this.wave > MISSION_WAVES,
      sectorId: this.sector.id,
      sectorName: this.sector.name,
      waveCount: this.incidents.length,
      waveSolved: Math.min(this.index, this.incidents.length),
      wavesCleared: this.wavesCleared,
      score: Math.round(this.score),
      gain: this.gain,
      combo: Math.min(MAX_COMBO, 1 + this.streak),
      bestCombo: this.bestCombo,
      timeLeft: Math.ceil(Math.max(0, this.timeLeft) * 10) / 10,
      waveTime: this.waveTime,
      lives: this.lives,
      integrity: Math.round(this.integrity()),
      accuracy: this.accuracy(),
      systems: this.systemsView,
      current: this.currentView,
      queue: this.queueView,
      incidents: this.incidentsView,
      nodes: this.nodesView,
      counts: this.countsView,
      feedback: this.feedback,
      toast: this.toast,
      missSeq: this.missSeq,
      solveSeq: this.solveSeq,
      solvedCode: this.solvedCode,
      interlude: this.interlude ? { kind: this.interlude.kind, wave: this.interlude.wave, sectorId: this.interlude.sectorId, sectorName: this.interlude.sectorName, count: this.interlude.count, loss: this.interlude.loss } : null,
      debrief: this.debrief,
      best: this.best,
      hint: this.hint,
      waveFlawless: this.waveMisses === 0,
    }
    this.cb.onHud(hud)
  }

  private onKey(e: KeyboardEvent) {
    if (e.repeat) return
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'interlude') {
        e.preventDefault()
        sfx.unlock()
        sfx.play('click')
        this.togglePause()
      }
      return
    }
    const dir = KEY_DIRS[e.key]
    if (!dir) return
    if (this.phase === 'playing') {
      e.preventDefault()
      sfx.unlock()
      this.press(dir)
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
    }
  }

  /* ---------------------------------------------------------------- */
  /* dev hook – used by the screenshot scenario                         */
  /* ---------------------------------------------------------------- */

  private installHook() {
    const hook: HookApi = {
      state: () => {
        const inc = this.incidents[this.index]
        return {
          phase: this.phase,
          wave: this.wave,
          sector: this.sector.id,
          score: Math.round(this.score),
          combo: Math.min(MAX_COMBO, 1 + this.streak),
          lives: this.lives,
          timeLeft: Math.round(Math.max(0, this.timeLeft) * 10) / 10,
          waveTime: this.waveTime,
          current:
            inc && this.phase !== 'start'
              ? { name: inc.def.name, code: inc.def.code.slice(), arrows: inc.def.code.map((d) => ARROW_CHAR[d]).join(''), progress: this.progress }
              : null,
          clearing: this.clearHold > 0,
          queue: this.incidents.slice(this.index + 1).map((i) => i.def.name),
          systems: { ...this.systemsView },
          accuracy: this.accuracy(),
          integrity: Math.round(this.integrity()),
          misses: this.misses,
          waveCount: this.incidents.length,
          waveSolved: Math.min(this.index, this.incidents.length),
          interlude: this.interlude,
        }
      },
      press: (dir) => this.press(dir),
      solveCurrent: () => {
        const inc = this.incidents[this.index]
        if (!inc || this.phase !== 'playing') return
        const code = inc.def.code
        while (this.phase === 'playing' && this.incidents[this.index] === inc && this.progress < code.length) this.press(code[this.progress])
      },
      failWave: () => {
        if (this.phase !== 'playing' || this.clearHold > 0) return
        this.timeout()
        this.emit()
      },
      skipToWave: (n) => {
        if (this.phase === 'start' || this.phase === 'complete' || this.phase === 'failed') return
        this.interlude = null
        this.startWave(clamp(Math.round(n), 1, 99))
        this.emit()
      },
      start: () => this.start(),
    }
    window.__signalCommand = hook
    this.disposers.push(() => {
      if (window.__signalCommand === hook) delete window.__signalCommand
    })
  }
}
