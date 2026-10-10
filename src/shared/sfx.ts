/**
 * Tiny WebAudio synthesiser so the games have feedback sounds without any
 * audio files. Call `sfx.unlock()` from the first user gesture (pointerdown /
 * click), then `sfx.play('good')` anywhere. Mute state is persisted.
 */
import { loadJSON, saveJSON } from './storage'

export type SfxName =
  | 'click'
  | 'tap'
  | 'good'
  | 'bad'
  | 'combo'
  | 'alarm'
  | 'pop'
  | 'whoosh'
  | 'coin'
  | 'win'
  | 'lose'
  | 'launch'
  | 'hit'
  | 'explode'
  | 'denied'
  | 'connect'
  | 'repair'

type Ctor = typeof AudioContext

class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  muted = loadJSON<boolean>('muted', false)

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const AC: Ctor | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.35
    this.master.connect(this.ctx.destination)
  }

  setMuted(m: boolean) {
    this.muted = m
    saveJSON('muted', m)
  }

  toggle() {
    this.setMuted(!this.muted)
    return this.muted
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'sine',
    opts: { to?: number; vol?: number; delay?: number } = {},
  ) {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime + (opts.delay ?? 0)
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.5, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }

  private noise(dur: number, vol = 0.3, delay = 0, hp = 800) {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur))
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const f = this.ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = hp
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(vol, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t0)
  }

  play(name: SfxName) {
    if (!this.ctx) return
    switch (name) {
      case 'click':
        this.tone(600, 0.06, 'square', { vol: 0.15 })
        break
      case 'tap':
        this.tone(420, 0.05, 'triangle', { vol: 0.2 })
        break
      case 'good':
        this.tone(660, 0.09, 'triangle', { vol: 0.35 })
        this.tone(990, 0.12, 'triangle', { vol: 0.3, delay: 0.07 })
        break
      case 'combo':
        this.tone(523, 0.08, 'triangle', { vol: 0.3 })
        this.tone(659, 0.08, 'triangle', { vol: 0.3, delay: 0.06 })
        this.tone(784, 0.08, 'triangle', { vol: 0.3, delay: 0.12 })
        this.tone(1046, 0.16, 'triangle', { vol: 0.3, delay: 0.18 })
        break
      case 'bad':
      case 'denied':
        this.tone(220, 0.18, 'sawtooth', { to: 140, vol: 0.25 })
        this.tone(160, 0.22, 'square', { to: 90, vol: 0.12, delay: 0.05 })
        break
      case 'alarm':
        this.tone(880, 0.12, 'square', { vol: 0.18 })
        this.tone(660, 0.12, 'square', { vol: 0.18, delay: 0.14 })
        this.tone(880, 0.12, 'square', { vol: 0.18, delay: 0.28 })
        break
      case 'pop':
        this.tone(500, 0.08, 'sine', { to: 900, vol: 0.3 })
        this.noise(0.05, 0.15)
        break
      case 'whoosh':
        this.noise(0.18, 0.18, 0, 400)
        break
      case 'coin':
        this.tone(1200, 0.07, 'square', { vol: 0.15 })
        this.tone(1600, 0.14, 'square', { vol: 0.15, delay: 0.06 })
        break
      case 'launch':
        this.tone(300, 0.2, 'triangle', { to: 900, vol: 0.3 })
        this.noise(0.12, 0.12, 0, 600)
        break
      case 'hit':
        this.noise(0.09, 0.3, 0, 200)
        this.tone(140, 0.1, 'triangle', { to: 60, vol: 0.3 })
        break
      case 'explode':
        this.noise(0.4, 0.5, 0, 100)
        this.tone(90, 0.35, 'sawtooth', { to: 30, vol: 0.4 })
        break
      case 'connect':
        this.tone(440, 0.07, 'sine', { vol: 0.25 })
        this.tone(880, 0.14, 'sine', { vol: 0.25, delay: 0.06 })
        break
      case 'repair':
        this.tone(330, 0.08, 'square', { vol: 0.12 })
        this.tone(440, 0.08, 'square', { vol: 0.12, delay: 0.09 })
        this.tone(554, 0.12, 'square', { vol: 0.12, delay: 0.18 })
        break
      case 'win':
        ;[523, 659, 784, 1046, 1318].forEach((f, i) =>
          this.tone(f, 0.18, 'triangle', { vol: 0.3, delay: i * 0.09 }),
        )
        break
      case 'lose':
        ;[392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.22, 'sawtooth', { vol: 0.2, delay: i * 0.16 }))
        break
    }
  }
}

export const sfx = new Sfx()
