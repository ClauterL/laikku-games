/**
 * Pseudo-3D canvas rendering for Access Crossing (behind-the-back runner, Subway-Surfers look).
 *
 * Everything in the world is positioned in world units (x across the corridor, y up, z along
 * the track relative to the player) and projected through ONE `project()` function with
 * `s = f / (z + camD)` pixels per unit. Sprites are stacks of "voxel" boxes whose front, top
 * and visible side faces are projected individually and wrapped in a dark ink outline, which
 * gives the chunky toy look of the mobile runners with real perspective. Draw order: backdrop
 * (cached skyline) → lit rooms outside → floor → ceiling → glass walls → floor cones →
 * entities far → near (the player is inserted at z = 0) → vignette.
 *
 * Hot-path rules: the projection output objects, point scratch arrays, gradients, the skyline
 * bitmaps and shaded colours are all reused; nothing is allocated per frame except the
 * unavoidable font / colour strings.
 */
import { fillRoundRect, shade, type Ctx } from '../../shared/draw'
import { clamp, lerp } from '../../shared/math'
import { BADGE_INFO, ELEVATOR_INFO, LANE_W, WALL_H, WALL_X, makeEntity, type Badge, type BadgeIcon, type Entity, type FloorTheme } from './types'

const DISPLAY = '"Baloo 2", "Nunito", sans-serif'
const UI = '"Nunito", "Baloo 2", sans-serif'
/** Dark ink around every voxel part (the Crossy-Road / Subway-Surfers toy look). */
const INK = 'rgba(12,20,46,0.6)'
const INK_SOLID = '#111b3a'
const TAU = Math.PI * 2

/* ------------------------------------------------------------------------------------ */
/* Camera / projection                                                                   */
/* ------------------------------------------------------------------------------------ */

export interface View {
  width: number
  height: number
  /** Screen position of the vanishing point. */
  cx: number
  horizon: number
  /** Camera x (world units, follows the player a little), height and distance behind the player. */
  camX: number
  camH: number
  camD: number
  /** Focal length in px·units: s = f / (z + camD). */
  f: number
  /** Pixels per world unit at the player's depth (sizes the screen-space effects). */
  s0: number
  time: number
  theme: FloorTheme
}

export interface P {
  x: number
  y: number
  /** Pixels per world unit at this depth. */
  s: number
}

/** Project a world point. `out` is reused by the caller – never allocate here. */
export function project(v: View, x: number, y: number, z: number, out: P): P {
  const s = v.f / Math.max(0.12, z + v.camD)
  out.x = v.cx + (x - v.camX) * s
  out.y = v.horizon + (v.camH - y) * s
  out.s = s
  return out
}

const PA: P = { x: 0, y: 0, s: 0 }
const PB: P = { x: 0, y: 0, s: 0 }
const PC: P = { x: 0, y: 0, s: 0 }
const PD: P = { x: 0, y: 0, s: 0 }
const PE: P = { x: 0, y: 0, s: 0 }

/** Nearest z that may be drawn (just in front of the camera) and the far end of the corridor. */
export const Z_NEAR_OFFSET = 0.45
export const Z_FAR = 78

/**
 * Visibility of something at depth z: 1 = solid, 0 = gone. Far objects dissolve into the haze;
 * things the runner has passed fade out before they reach the camera – otherwise a hanging sign
 * or a pillar sweeping past the lens would blot out the whole screen for a frame or two.
 */
export function fogAlpha(z: number): number {
  if (z < -0.5) return Math.max(0, 1 + (z + 0.5) / 1.3)
  return z < 34 ? 1 : Math.max(0, 1 - (z - 34) / 30)
}

const shadeCache = new Map<string, string>()
function tint(color: string, amount: number): string {
  const key = color + amount
  let c = shadeCache.get(key)
  if (!c) {
    c = shade(color, amount)
    shadeCache.set(key, c)
  }
  return c
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

function quad(ctx: Ctx, a: P, b: P, c: P, d: P) {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(c.x, c.y)
  ctx.lineTo(d.x, d.y)
  ctx.closePath()
}

/** Fill a quad on the floor (y = 0) spanning x0..x1 and z0..z1. */
function floorQuad(ctx: Ctx, v: View, x0: number, x1: number, z0: number, z1: number, fill: string | CanvasGradient) {
  project(v, x0, 0, z0, PA)
  project(v, x1, 0, z0, PB)
  project(v, x1, 0, z1, PC)
  project(v, x0, 0, z1, PD)
  quad(ctx, PA, PB, PC, PD)
  ctx.fillStyle = fill
  ctx.fill()
}

/** Fill a quad on a horizontal plane at height y. */
function planeQuad(ctx: Ctx, v: View, x0: number, x1: number, y: number, z0: number, z1: number, fill: string | CanvasGradient) {
  project(v, x0, y, z0, PA)
  project(v, x1, y, z0, PB)
  project(v, x1, y, z1, PC)
  project(v, x0, y, z1, PD)
  quad(ctx, PA, PB, PC, PD)
  ctx.fillStyle = fill
  ctx.fill()
}

/** Fill a quad on a vertical plane at world x spanning z0..z1 and y0..y1. */
function wallQuad(ctx: Ctx, v: View, x: number, z0: number, z1: number, y0: number, y1: number, fill: string | CanvasGradient) {
  project(v, x, y0, z0, PA)
  project(v, x, y0, z1, PB)
  project(v, x, y1, z1, PC)
  project(v, x, y1, z0, PD)
  quad(ctx, PA, PB, PC, PD)
  ctx.fillStyle = fill
  ctx.fill()
}

/**
 * Voxel box centred at world x, standing on height y0 up to y1, half width hw, depth dz, at
 * depth z. Lit from above: light top face, base-colour front face, dark visible side face.
 * The visible faces are first stroked as one path with a wide ink line and then filled, so
 * only the outer half of the stroke survives: a clean 1–2.5 px outline around the silhouette.
 */
function box(ctx: Ctx, v: View, x: number, z: number, hw: number, y0: number, y1: number, dz: number, color: string, outline = true) {
  const zf = z - dz / 2
  const zb = z + dz / 2
  project(v, x - hw, y0, zf, PA) // front bottom left
  project(v, x + hw, y1, zf, PB) // front top right
  const fw = PB.x - PA.x
  const fh = PA.y - PB.y
  if (fw < 0.5 || fh < 0.5) {
    ctx.fillStyle = color
    ctx.fillRect(PA.x, PB.y, Math.max(1, fw), Math.max(1, fh))
    return
  }
  project(v, x - hw, y0, zb, PC) // back bottom left
  project(v, x + hw, y1, zb, PD) // back top right
  const leftVisible = v.camX < x - hw
  const rightVisible = v.camX > x + hw
  const topVisible = y1 < v.camH - 0.02
  const bottomVisible = y0 > v.camH + 0.02
  const s = PA.s
  if (outline && fh > 5 && s > 11) {
    ctx.beginPath()
    ctx.rect(PA.x, PB.y, fw, fh)
    if (topVisible) {
      ctx.moveTo(PA.x, PB.y)
      ctx.lineTo(PB.x, PB.y)
      ctx.lineTo(PD.x, PD.y)
      ctx.lineTo(PC.x, PD.y)
      ctx.closePath()
    } else if (bottomVisible) {
      ctx.moveTo(PA.x, PA.y)
      ctx.lineTo(PB.x, PA.y)
      ctx.lineTo(PD.x, PC.y)
      ctx.lineTo(PC.x, PC.y)
      ctx.closePath()
    }
    if (leftVisible) {
      ctx.moveTo(PA.x, PA.y)
      ctx.lineTo(PA.x, PB.y)
      ctx.lineTo(PC.x, PD.y)
      ctx.lineTo(PC.x, PC.y)
      ctx.closePath()
    } else if (rightVisible) {
      ctx.moveTo(PB.x, PA.y)
      ctx.lineTo(PB.x, PB.y)
      ctx.lineTo(PD.x, PD.y)
      ctx.lineTo(PD.x, PC.y)
      ctx.closePath()
    }
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.min(5, Math.max(2, 0.026 * s))
    ctx.strokeStyle = INK
    ctx.stroke()
  }
  // visible side face (the face turned toward the camera)
  if (leftVisible || rightVisible) {
    const fx = leftVisible ? PA.x : PB.x
    const bx = leftVisible ? PC.x : PD.x
    ctx.fillStyle = tint(color, -0.3)
    ctx.beginPath()
    ctx.moveTo(fx, PA.y)
    ctx.lineTo(fx, PB.y)
    ctx.lineTo(bx, PD.y)
    ctx.lineTo(bx, PC.y)
    ctx.closePath()
    ctx.fill()
  }
  if (topVisible) {
    ctx.fillStyle = tint(color, 0.26)
    ctx.beginPath()
    ctx.moveTo(PA.x, PB.y)
    ctx.lineTo(PB.x, PB.y)
    ctx.lineTo(PD.x, PD.y)
    ctx.lineTo(PC.x, PD.y)
    ctx.closePath()
    ctx.fill()
  } else if (bottomVisible) {
    ctx.fillStyle = tint(color, -0.42)
    ctx.beginPath()
    ctx.moveTo(PA.x, PA.y)
    ctx.lineTo(PB.x, PA.y)
    ctx.lineTo(PD.x, PC.y)
    ctx.lineTo(PC.x, PC.y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = color
  ctx.fillRect(PA.x, PB.y, fw, fh)
}

/** Soft two-layer contact shadow on the floor. */
function groundShadow(ctx: Ctx, v: View, x: number, z: number, rx: number, alpha: number) {
  project(v, x, 0, z, PA)
  const ga = ctx.globalAlpha
  const r = rx * PA.s
  ctx.fillStyle = '#0f1a3a'
  ctx.globalAlpha = ga * alpha * 0.4
  ctx.beginPath()
  ctx.ellipse(PA.x, PA.y, r * 1.3, r * 0.44, 0, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = ga * alpha
  ctx.beginPath()
  ctx.ellipse(PA.x, PA.y, r, r * 0.34, 0, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = ga
}

/* ------------------------------------------------------------------------------------ */
/* Cached gradients and skyline bitmaps                                                  */
/* ------------------------------------------------------------------------------------ */

interface GradientCache {
  key: string
  sky: CanvasGradient | null
  floor: CanvasGradient | null
  ceiling: CanvasGradient | null
  haze: CanvasGradient | null
  glass: CanvasGradient | null
  vignette: CanvasGradient | null
  hot: CanvasGradient | null
  /** Two skyline layers (far / near) drawn once per theme + size, blitted with parallax. */
  cityFar: HTMLCanvasElement | null
  cityNear: HTMLCanvasElement | null
}

const gcache: GradientCache = { key: '', sky: null, floor: null, ceiling: null, haze: null, glass: null, vignette: null, hot: null, cityFar: null, cityNear: null }

/** Deterministic pseudo-random for the city skyline (no RNG state needed). */
function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Extra width of the skyline bitmaps so they can slide sideways with the camera. */
const CITY_PAD = 60

function paintCity(c: HTMLCanvasElement, v: View, near: boolean) {
  const t = v.theme
  const w = c.width
  const h = c.height
  const g = c.getContext('2d')
  if (!g) return
  g.clearRect(0, 0, w, h)
  const unit = Math.max(36, v.width / 24)
  const n = Math.ceil(w / unit) + 2
  for (let i = -1; i < n; i++) {
    const bh = near ? (0.06 + hash(i * 5 + 9) * 0.19) * v.height : (0.09 + hash(i * 3 + 1) * 0.25) * v.height
    const bw = unit * (near ? 0.8 + hash(i * 11 + 4) * 0.7 : 0.7 + hash(i * 7 + 2) * 0.6)
    const x = i * unit * (near ? 1.15 : 1)
    g.fillStyle = near ? t.city : t.cityFar
    g.fillRect(x, h - bh, bw, bh + 2)
    if (!near) continue
    // roof detail and lit windows
    g.fillStyle = tint(t.city, 0.18)
    g.fillRect(x + bw * 0.3, h - bh - 4, bw * 0.4, 4)
    g.fillStyle = t.dark ? 'rgba(255,224,150,0.7)' : 'rgba(255,255,255,0.42)'
    const cols = Math.max(1, Math.floor(bw / 11))
    const rows = Math.max(1, Math.floor(bh / 13))
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) if (hash(i * 97 + r * 13 + k) > 0.5) g.fillRect(x + 4 + k * 11, h - bh + 5 + r * 13, 5, 6)
  }
}

function gradients(ctx: Ctx, v: View): GradientCache {
  const key = `${v.theme.name}|${v.width}x${v.height}|${Math.round(v.horizon)}|${Math.round(v.cx)}|${Math.round(v.s0)}`
  if (gcache.key === key && gcache.sky) return gcache
  const t = v.theme
  const sky = ctx.createLinearGradient(0, 0, 0, v.horizon)
  sky.addColorStop(0, t.sky0)
  sky.addColorStop(1, t.sky1)
  const floor = ctx.createLinearGradient(0, v.horizon, 0, v.height)
  floor.addColorStop(0, t.fog)
  floor.addColorStop(0.16, t.floorA)
  floor.addColorStop(1, t.floorA)
  const ceiling = ctx.createLinearGradient(0, v.horizon, 0, 0)
  ceiling.addColorStop(0, t.fog)
  ceiling.addColorStop(0.2, t.ceiling)
  ceiling.addColorStop(1, t.ceiling)
  // haze only where the corridor disappears, so the skyline behind the glass stays crisp
  const hazeY = v.horizon + v.height * 0.012
  const haze = ctx.createRadialGradient(v.cx, hazeY, 0, v.cx, hazeY, hazeRadius(v))
  const rgb = hexToRgb(t.fog)
  haze.addColorStop(0, `rgba(${rgb},1)`)
  haze.addColorStop(0.35, `rgba(${rgb},0.9)`)
  haze.addColorStop(1, `rgba(${rgb},0)`)
  // deep tinted glass: lighter and more see-through at the top, saturated at the bottom
  const glass = ctx.createLinearGradient(0, 0, 0, v.height)
  glass.addColorStop(0, `rgba(${hexToRgb(t.glassTop)},${(t.glassAlpha * 0.8).toFixed(3)})`)
  glass.addColorStop(0.45, `rgba(${hexToRgb(t.glassTop)},${t.glassAlpha.toFixed(3)})`)
  glass.addColorStop(1, `rgba(${hexToRgb(t.glassBottom)},${Math.min(1, t.glassAlpha + 0.1).toFixed(3)})`)
  // darker corners, bright centre
  const vr = Math.hypot(v.width, v.height) * 0.56
  const vignette = ctx.createRadialGradient(v.cx, v.height * 0.5, vr * 0.42, v.cx, v.height * 0.5, vr)
  vignette.addColorStop(0, 'rgba(6,14,40,0)')
  vignette.addColorStop(1, t.dark ? 'rgba(0,0,0,0.5)' : 'rgba(6,14,40,0.4)')
  // unit-radius spotlight on the floor around the runner (scaled per frame)
  const hot = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  hot.addColorStop(0, t.dark ? 'rgba(255,240,210,0.16)' : 'rgba(255,255,255,0.3)')
  hot.addColorStop(0.55, t.dark ? 'rgba(255,240,210,0.07)' : 'rgba(255,255,255,0.14)')
  hot.addColorStop(1, 'rgba(255,255,255,0)')
  // skyline bitmaps
  const cw = Math.ceil(v.width + CITY_PAD * 2)
  const ch = Math.max(2, Math.ceil(v.height * 0.36))
  const far = gcache.cityFar ?? document.createElement('canvas')
  const nearC = gcache.cityNear ?? document.createElement('canvas')
  far.width = cw
  far.height = ch
  nearC.width = cw
  nearC.height = ch
  paintCity(far, v, false)
  paintCity(nearC, v, true)
  gcache.key = key
  gcache.sky = sky
  gcache.floor = floor
  gcache.ceiling = ceiling
  gcache.haze = haze
  gcache.glass = glass
  gcache.vignette = vignette
  gcache.hot = hot
  gcache.cityFar = far
  gcache.cityNear = nearC
  return gcache
}

function hazeRadius(v: View): number {
  return Math.max(60, v.height * 0.16)
}

/* ------------------------------------------------------------------------------------ */
/* Backdrop, outside, floor, ceiling, walls                                              */
/* ------------------------------------------------------------------------------------ */

/** Sky gradient and two layers of city silhouette around the horizon (parallax with the camera). */
function drawBackdrop(ctx: Ctx, v: View) {
  const g = gradients(ctx, v)
  const t = v.theme
  ctx.fillStyle = g.sky!
  ctx.fillRect(-40, -40, v.width + 80, v.horizon + 41)
  // ground outside the building (below the horizon): the city's lower floors
  ctx.fillStyle = t.city
  ctx.fillRect(-40, v.horizon, v.width + 80, v.height - v.horizon + 40)
  const shift = -v.camX * 20
  const far = g.cityFar!
  const near = g.cityNear!
  ctx.drawImage(far, -CITY_PAD + shift * 0.4, v.horizon - far.height + 1)
  ctx.drawImage(near, -CITY_PAD + shift, v.horizon - near.height + 1)
}

const SILHOUETTE = '#1b2a52'

/** Dark outer floor and lit glass meeting-room boxes behind the side walls (seen through the glass). */
function drawOutside(ctx: Ctx, v: View, dist: number) {
  const t = v.theme
  if (t.solidWall) return
  const zNear = -v.camD + Z_NEAR_OFFSET
  const back = WALL_X + 2.7
  for (let side = -1; side <= 1; side += 2) {
    floorQuad(ctx, v, side * WALL_X, side * (WALL_X + 3.4), zNear, Z_FAR, t.outside)
    for (let zr = -(dist % 15) - 15 + (side > 0 ? 0 : 7.5); zr < 44; zr += 15) {
      const z1 = zr + 6.5
      if (z1 < zNear + 0.5) continue
      const a = fogAlpha(Math.max(0, zr))
      if (a <= 0) break
      const z0 = Math.max(zNear, zr)
      ctx.globalAlpha = a
      // lit back wall of the room, roof slab, two end partitions
      wallQuad(ctx, v, side * back, z0, z1, 0, 2.9, t.room)
      planeQuad(ctx, v, side * (WALL_X + 0.5), side * back, 2.9, z0, z1, tint(t.outside, 0.25))
      if (zr > zNear) box(ctx, v, side * (back - 1.1), zr, 1.1, 0, 2.9, 0.12, tint(t.outside, 0.35), false)
      box(ctx, v, side * (back - 1.1), z1, 1.1, 0, 2.9, 0.12, tint(t.outside, 0.35), false)
      // meeting: a table and people in silhouette
      const zm = zr + 3.2
      if (zm > zNear + 1.5) {
        const xm = side * (back - 1.0)
        box(ctx, v, xm, zm, 0.55, 0.62, 0.72, 1.8, SILHOUETTE, false)
        box(ctx, v, xm, zm - 1.3, 0.2, 0, 1.15, 0.4, SILHOUETTE, false)
        box(ctx, v, xm + side * 0.5, zm + 0.6, 0.2, 0, 1.05, 0.4, SILHOUETTE, false)
        // a screen on the back wall
        wallQuad(ctx, v, side * (back - 0.02), zm - 0.9, zm + 0.9, 1.5, 2.5, '#9ad6ff')
      }
    }
    ctx.globalAlpha = 1
  }
}

/** Corridor floor: marble bands rushing toward the camera, tile joints, gloss, lane lines, glowing chevrons. */
function drawFloor(ctx: Ctx, v: View, dist: number) {
  const g = gradients(ctx, v)
  const t = v.theme
  const zNear = -v.camD + Z_NEAR_OFFSET
  floorQuad(ctx, v, -WALL_X, WALL_X, zNear, Z_FAR, g.floor!)
  // carpet runner in each lane
  if (t.carpet) {
    for (let l = -1; l <= 1; l++) {
      const x = l * LANE_W
      floorQuad(ctx, v, x - 0.44 * LANE_W, x + 0.44 * LANE_W, zNear, Z_FAR, t.carpet)
      ctx.globalAlpha = 0.3
      floorQuad(ctx, v, x - 0.44 * LANE_W, x - 0.39 * LANE_W, zNear, Z_FAR, '#ffffff')
      floorQuad(ctx, v, x + 0.39 * LANE_W, x + 0.44 * LANE_W, zNear, Z_FAR, '#ffffff')
      ctx.globalAlpha = 1
    }
  }
  // Tile bands every 2 units rush toward the camera with the running distance. On bare floors
  // they are the second marble tone; over a carpet they are a soft shade so the pile shows through.
  const bandFill = t.carpet ? '#06153a' : t.floorB
  const bandAlpha = t.carpet ? 0.13 : 1
  const joint = tint(t.floorB, t.dark ? 0.22 : -0.18)
  for (let zb = -(dist % 4) - 12; zb < Z_FAR; zb += 4) {
    if (zb + 2 <= zNear) continue
    const a = fogAlpha(Math.max(0, zb - 10))
    if (a <= 0) break
    ctx.globalAlpha = bandAlpha * a
    floorQuad(ctx, v, -WALL_X, WALL_X, Math.max(zNear, zb), zb + 2, bandFill)
    if (!t.carpet && zb > zNear) {
      // tile joints make the speed readable even on the pale marble
      ctx.globalAlpha = 0.85 * a
      floorQuad(ctx, v, -WALL_X, WALL_X, zb, zb + 0.07, joint)
      floorQuad(ctx, v, -WALL_X, WALL_X, zb + 2, zb + 2.07, joint)
    }
  }
  // glossy reflections of the ceiling light strips
  for (let zl = -(dist % 8) - 4; zl < 50; zl += 8) {
    if (zl + 2.4 < zNear) continue
    const a = fogAlpha(Math.max(0, zl))
    ctx.globalAlpha = (t.dark ? 0.18 : t.carpet ? 0.16 : 0.55) * a
    floorQuad(ctx, v, -0.55, 0.55, Math.max(zNear, zl + 0.2), zl + 2.2, t.light)
    ctx.globalAlpha = (t.dark ? 0.08 : 0.22) * a
    floorQuad(ctx, v, -1.1, 1.1, Math.max(zNear, zl - 0.2), zl + 2.6, t.light)
  }
  ctx.globalAlpha = 1
  // lane separators and the corridor edge trims
  for (let k = -1; k <= 1; k += 2) {
    floorQuad(ctx, v, k * 0.5 * LANE_W - 0.035, k * 0.5 * LANE_W + 0.035, zNear, Z_FAR, t.line)
    floorQuad(ctx, v, k * 1.5 * LANE_W - 0.05, k * 1.5 * LANE_W + 0.05, zNear, Z_FAR, tint(t.line, t.dark ? 0.1 : -0.25))
  }
  // side strips (between the lanes and the walls) are a touch darker
  ctx.globalAlpha = 0.45
  floorQuad(ctx, v, -WALL_X, -1.5 * LANE_W - 0.05, zNear, Z_FAR, t.floorB)
  floorQuad(ctx, v, 1.5 * LANE_W + 0.05, WALL_X, zNear, Z_FAR, t.floorB)
  ctx.globalAlpha = 1
  // glowing chevrons pointing forward in every lane (wide soft stroke + bright core + white tip)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let zc = -(dist % 6) - 6; zc < 58; zc += 6) {
    if (zc + 1.2 < zNear) continue
    const a = fogAlpha(Math.max(0, zc))
    if (a <= 0) break
    for (let l = -1; l <= 1; l++) {
      const x = l * LANE_W
      project(v, x - 0.33 * LANE_W, 0, zc, PA)
      project(v, x, 0, zc + 1.15, PB)
      project(v, x + 0.33 * LANE_W, 0, zc, PC)
      ctx.beginPath()
      ctx.moveTo(PA.x, PA.y)
      ctx.lineTo(PB.x, PB.y)
      ctx.lineTo(PC.x, PC.y)
      ctx.strokeStyle = t.arrow
      if (PA.s > 22) {
        ctx.globalAlpha = 0.28 * a
        ctx.lineWidth = Math.max(3, 0.27 * PA.s)
        ctx.stroke()
      }
      ctx.globalAlpha = 0.95 * a
      ctx.lineWidth = Math.max(1.5, 0.1 * PA.s)
      ctx.stroke()
      if (PA.s > 55) {
        ctx.strokeStyle = '#ffffff'
        ctx.globalAlpha = 0.55 * a
        ctx.lineWidth = Math.max(1, 0.03 * PA.s)
        ctx.stroke()
      }
    }
  }
  ctx.globalAlpha = 1
}

/** Bright spot on the floor under the runner – the stage light that makes the player pop. */
function drawHotSpot(ctx: Ctx, v: View, p: PlayerView) {
  const g = gradients(ctx, v)
  project(v, p.laneX * LANE_W, 0, p.z, PA)
  const r = 2.1 * PA.s
  ctx.save()
  ctx.translate(PA.x, PA.y)
  ctx.scale(r, r * 0.42)
  ctx.fillStyle = g.hot!
  ctx.fillRect(-1, -1, 2, 2)
  ctx.restore()
}

/** Ceiling plane over the corridor with cross beams and glowing light strips. */
function drawCeiling(ctx: Ctx, v: View, dist: number) {
  const g = gradients(ctx, v)
  const t = v.theme
  const zNear = -v.camD + Z_NEAR_OFFSET
  planeQuad(ctx, v, -WALL_X, WALL_X, WALL_H, zNear, Z_FAR, g.ceiling!)
  // cross beams every 8 units
  for (let zb = -(dist % 8) - 8; zb < Z_FAR; zb += 8) {
    if (zb + 0.3 < zNear) continue
    const a = fogAlpha(Math.max(0, zb - 6))
    if (a <= 0) break
    ctx.globalAlpha = 0.85 * a
    planeQuad(ctx, v, -WALL_X, WALL_X, WALL_H, Math.max(zNear, zb), zb + 0.35, tint(t.ceiling, t.dark ? 0.14 : -0.12))
  }
  // light strips (offset by half a beam interval): glow halo + bright core
  for (let zl = -(dist % 8) - 4; zl < Z_FAR; zl += 8) {
    if (zl + 2.4 < zNear) continue
    const a = fogAlpha(Math.max(0, zl - 6))
    if (a <= 0) break
    ctx.globalAlpha = 0.3 * a
    planeQuad(ctx, v, -1.2, 1.2, WALL_H - 0.02, Math.max(zNear, zl - 0.5), zl + 2.9, t.light)
    ctx.globalAlpha = a
    planeQuad(ctx, v, -0.6, 0.6, WALL_H - 0.03, Math.max(zNear, zl), zl + 2.4, t.light)
    ctx.globalAlpha = 0.8 * a
    planeQuad(ctx, v, -0.4, 0.4, WALL_H - 0.04, Math.max(zNear, zl + 0.2), zl + 2.2, '#ffffff')
  }
  ctx.globalAlpha = 1
}

/** Deep-blue glass (or solid) side walls with reflections, white mullions, rails and LED trims. */
function drawWalls(ctx: Ctx, v: View, dist: number) {
  const t = v.theme
  const g = gradients(ctx, v)
  const zNear = -v.camD + Z_NEAR_OFFSET
  for (let side = -1; side <= 1; side += 2) {
    const x = side * WALL_X
    if (t.solidWall) {
      wallQuad(ctx, v, x, zNear, Z_FAR, 0, WALL_H, t.solidWall)
      // panel seams / rack bays every 3 units
      for (let zm = -(dist % 3) - 3; zm < Z_FAR; zm += 3) {
        if (zm < zNear) continue
        const a = fogAlpha(Math.max(0, zm))
        if (a <= 0) break
        ctx.globalAlpha = a
        wallQuad(ctx, v, x, zm, zm + 0.12, 0, WALL_H, t.frame)
        if (t.name === 'Server room') {
          // blinking rack LEDs
          for (let k = 0; k < 4; k++) {
            const on = Math.sin(v.time * 4 + zm * 1.7 + k * 2.1) > 0.2
            wallQuad(ctx, v, x, zm + 0.8 + k * 0.5, zm + 1.0 + k * 0.5, 0.5 + k * 0.55, 0.62 + k * 0.55, on ? (k % 2 ? '#2f80ff' : '#e63946') : '#2a3350')
          }
        } else {
          wallQuad(ctx, v, x, zm + 0.12, zm + 3, 1.1, 1.18, tint(t.solidWall, 0.18))
        }
      }
      ctx.globalAlpha = 1
      // warm picture lights along the executive floor
      if (t.name === 'Executive') {
        ctx.globalAlpha = 0.5
        wallQuad(ctx, v, x, zNear, Z_FAR, 2.6, 2.7, t.light)
        ctx.globalAlpha = 1
      }
    } else {
      wallQuad(ctx, v, x, zNear, Z_FAR, 0, WALL_H, g.glass!)
      // slanted reflection streaks sliding along the glass
      ctx.fillStyle = '#ffffff'
      for (let zs = -(dist % 7) - 7; zs < 52; zs += 7) {
        if (zs + 2.8 < zNear) continue
        const a = fogAlpha(Math.max(0, zs))
        if (a <= 0) break
        ctx.globalAlpha = 0.12 * a
        project(v, x, 0.25, zs, PA)
        project(v, x, 0.25, zs + 0.9, PB)
        project(v, x, WALL_H - 0.3, zs + 2.8, PC)
        project(v, x, WALL_H - 0.3, zs + 1.9, PD)
        quad(ctx, PA, PB, PC, PD)
        ctx.fill()
        ctx.globalAlpha = 0.07 * a
        project(v, x, 0.25, zs + 1.3, PA)
        project(v, x, 0.25, zs + 1.6, PB)
        project(v, x, WALL_H - 0.3, zs + 3.5, PC)
        project(v, x, WALL_H - 0.3, zs + 3.2, PD)
        quad(ctx, PA, PB, PC, PD)
        ctx.fill()
      }
      // white mullions every 3 units
      for (let zm = -(dist % 3) - 3; zm < Z_FAR; zm += 3) {
        if (zm + 0.12 < zNear) continue
        const a = fogAlpha(Math.max(0, zm))
        if (a <= 0) break
        ctx.globalAlpha = a
        wallQuad(ctx, v, x, Math.max(zNear, zm), zm + 0.12, 0, WALL_H, t.frame)
      }
      ctx.globalAlpha = 1
      // rails: handrail, mid rail, top rail; LED strip under the handrail
      wallQuad(ctx, v, x, zNear, Z_FAR, 1.0, 1.1, t.frame)
      wallQuad(ctx, v, x, zNear, Z_FAR, 3.1, 3.18, t.frame)
      wallQuad(ctx, v, x, zNear, Z_FAR, WALL_H - 0.16, WALL_H, t.frame)
      ctx.globalAlpha = 0.9
      wallQuad(ctx, v, x, zNear, Z_FAR, 0.9, 1.0, t.led)
      ctx.globalAlpha = 1
    }
    // baseboard
    wallQuad(ctx, v, x, zNear, Z_FAR, 0, 0.16, tint(t.accent, -0.45))
  }
}

/* ------------------------------------------------------------------------------------ */
/* Icons & text                                                                          */
/* ------------------------------------------------------------------------------------ */

export function icon(ctx: Ctx, kind: BadgeIcon | 'star' | 'keypad' | 'lock' | 'magnet' | 'camera', cx: number, cy: number, size: number, color = '#ffffff') {
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  const r = size / 2
  switch (kind) {
    case 'person':
      ctx.beginPath()
      ctx.arc(cx, cy - r * 0.45, r * 0.32, 0, TAU)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.7, cy + r * 0.8)
      ctx.quadraticCurveTo(cx, cy - r * 0.5, cx + r * 0.7, cy + r * 0.8)
      ctx.closePath()
      ctx.fill()
      break
    case 'people':
      for (let k = -1; k <= 1; k += 2) {
        const dx = k * r * 0.38
        ctx.beginPath()
        ctx.arc(cx + dx, cy - r * 0.4, r * 0.26, 0, TAU)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(cx + dx - r * 0.5, cy + r * 0.8)
        ctx.quadraticCurveTo(cx + dx, cy - r * 0.3, cx + dx + r * 0.5, cy + r * 0.8)
        ctx.closePath()
        ctx.fill()
      }
      break
    case 'helmet':
      ctx.beginPath()
      ctx.arc(cx, cy + r * 0.2, r * 0.7, Math.PI, 0)
      ctx.closePath()
      ctx.fill()
      ctx.fillRect(cx - r * 0.95, cy + r * 0.15, r * 1.9, r * 0.25)
      break
    case 'crown':
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.85, cy + r * 0.6)
      ctx.lineTo(cx - r * 0.95, cy - r * 0.5)
      ctx.lineTo(cx - r * 0.4, cy)
      ctx.lineTo(cx, cy - r * 0.8)
      ctx.lineTo(cx + r * 0.4, cy)
      ctx.lineTo(cx + r * 0.95, cy - r * 0.5)
      ctx.lineTo(cx + r * 0.85, cy + r * 0.6)
      ctx.closePath()
      ctx.fill()
      break
    case 'shield':
      ctx.beginPath()
      ctx.moveTo(cx, cy - r * 0.85)
      ctx.lineTo(cx + r * 0.75, cy - r * 0.5)
      ctx.quadraticCurveTo(cx + r * 0.75, cy + r * 0.5, cx, cy + r * 0.9)
      ctx.quadraticCurveTo(cx - r * 0.75, cy + r * 0.5, cx - r * 0.75, cy - r * 0.5)
      ctx.closePath()
      ctx.fill()
      break
    case 'star':
      ctx.beginPath()
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5
        const rr = k % 2 === 0 ? r : r * 0.45
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
      }
      ctx.closePath()
      ctx.fill()
      break
    case 'keypad':
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
          ctx.beginPath()
          ctx.arc(cx + (col - 1) * r * 0.6, cy + (row - 1) * r * 0.6, r * 0.18, 0, TAU)
          ctx.fill()
        }
      break
    case 'lock':
      ctx.lineWidth = Math.max(1.5, r * 0.3)
      ctx.beginPath()
      ctx.arc(cx, cy - r * 0.25, r * 0.42, Math.PI, 0)
      ctx.stroke()
      fillRoundRect(ctx, cx - r * 0.7, cy - r * 0.2, r * 1.4, r * 1.0, r * 0.2, color)
      break
    case 'magnet':
      ctx.lineWidth = Math.max(2, r * 0.55)
      ctx.strokeStyle = '#e63946'
      ctx.beginPath()
      ctx.arc(cx, cy - r * 0.1, r * 0.55, Math.PI, 0)
      ctx.stroke()
      ctx.fillStyle = '#e63946'
      ctx.fillRect(cx - r * 0.55 - r * 0.27, cy - r * 0.1, r * 0.55, r * 0.55)
      ctx.fillRect(cx + r * 0.55 - r * 0.27, cy - r * 0.1, r * 0.55, r * 0.55)
      ctx.fillStyle = '#dfe6f0'
      ctx.fillRect(cx - r * 0.55 - r * 0.27, cy + r * 0.3, r * 0.55, r * 0.3)
      ctx.fillRect(cx + r * 0.55 - r * 0.27, cy + r * 0.3, r * 0.55, r * 0.3)
      break
    case 'camera':
      fillRoundRect(ctx, cx - r * 0.9, cy - r * 0.45, r * 1.4, r * 0.9, r * 0.15, color)
      ctx.beginPath()
      ctx.moveTo(cx + r * 0.5, cy - r * 0.2)
      ctx.lineTo(cx + r * 0.95, cy - r * 0.5)
      ctx.lineTo(cx + r * 0.95, cy + r * 0.5)
      ctx.lineTo(cx + r * 0.5, cy + r * 0.2)
      ctx.closePath()
      ctx.fill()
      break
  }
  ctx.restore()
}

function label(ctx: Ctx, text: string, x: number, y: number, px: number, color: string, font = UI, weight = 900) {
  ctx.font = `${weight} ${px}px ${font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

export function wordmark(ctx: Ctx, cx: number, cy: number, size: number, color: string) {
  label(ctx, 'Hansab', cx, cy, size, color, DISPLAY, 800)
}

/** Access card: coloured rounded card with a white disc + icon and a name strip (pickups, HUD flight). */
export function drawBadgeCard(ctx: Ctx, cx: number, cy: number, w: number, h: number, badge: Badge) {
  const info = BADGE_INFO[badge]
  const left = cx - w / 2
  const top = cy - h / 2
  const r = Math.max(2, w * 0.14)
  // lanyard clip
  ctx.fillStyle = '#b8c2d4'
  ctx.fillRect(cx - w * 0.12, top - h * 0.1, w * 0.24, h * 0.13)
  fillRoundRect(ctx, left - 1.5, top - 1.5, w + 3, h + 3, r + 1, INK_SOLID)
  fillRoundRect(ctx, left, top, w, h, r, info.color)
  ctx.globalAlpha *= 0.25
  fillRoundRect(ctx, left + w * 0.08, top + h * 0.05, w * 0.84, h * 0.3, r, '#ffffff')
  ctx.globalAlpha /= 0.25
  ctx.fillStyle = 'rgba(255,255,255,0.94)'
  ctx.beginPath()
  ctx.arc(cx, top + h * 0.4, w * 0.3, 0, TAU)
  ctx.fill()
  icon(ctx, info.icon, cx, top + h * 0.4, w * 0.4, info.color)
  if (w > 24) {
    fillRoundRect(ctx, left + w * 0.1, top + h * 0.72, w * 0.8, h * 0.2, 2, '#ffffff')
    const name = info.name.toUpperCase()
    label(ctx, name, cx, top + h * 0.82, Math.max(5, Math.min(h * 0.11, (w * 0.76) / (name.length * 0.68))), info.color)
  }
}

/** Little yellow stars with ink outlines (stumble). */
function star(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath()
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    const rr = k % 2 === 0 ? r : r * 0.45
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1.5, r * 0.35)
  ctx.strokeStyle = INK_SOLID
  ctx.stroke()
  ctx.fillStyle = '#ffd43b'
  ctx.fill()
}

/* ------------------------------------------------------------------------------------ */
/* Characters                                                                            */
/* ------------------------------------------------------------------------------------ */

export interface PlayerView {
  /** Lane position in lane units (float while changing lanes). */
  laneX: number
  /** Height above the floor (jump). */
  y: number
  /** Depth offset in front of the camera target (stepping into the elevator). */
  z: number
  /** 0..1 how deep in the slide pose. */
  slide: number
  jumping: boolean
  /** Running cycle phase in radians. */
  run: number
  /** 0..1 alpha for the invulnerability blink. */
  alpha: number
  /** 0..1 fall-over animation on the final crash. */
  fall: number
  shield: boolean
  magnet: boolean
  /** Lateral lean while changing lanes (−1..1) plus the stumble wobble. */
  lean: number
  /** 0..1 landing squash intensity. */
  squash: number
  /** 0..1 stumble intensity (stars circle the head). */
  stumble: number
  /** 0..1 how fast we run – the torso leans further forward with speed. */
  pace: number
}

const HOODIE = '#2a3a66'
const PANTS = '#1f2a48'
const HAIR = '#6b3f22'
const SKIN = '#f1c9a5'
const SHOE = '#f6f8fc'
const PACK = '#1a2a55'

/** The Hansab employee, seen from behind: brown hair, navy hoodie, backpack with an H. */
export function drawPlayer(ctx: Ctx, v: View, p: PlayerView, time: number) {
  const x = p.laneX * LANE_W
  const z = p.z
  const y = p.y
  const air = clamp(y / 1.1, 0, 1)
  groundShadow(ctx, v, x, z, 0.42 * (1 - 0.38 * air), 0.5 * (1 - 0.55 * air))
  ctx.save()
  ctx.globalAlpha = p.alpha
  // pose transform about the feet: fall-over, lean into the lane change, landing squash
  project(v, x, 0, z, PA)
  const fx = PA.x
  const fy = PA.y
  ctx.translate(fx, fy)
  if (p.fall > 0) ctx.rotate(p.fall * 1.3 * (p.laneX >= 0 ? 1 : -1))
  if (p.lean !== 0) ctx.rotate(p.lean * 0.15)
  if (p.squash > 0) ctx.scale(1 + 0.22 * p.squash, 1 - 0.26 * p.squash)
  ctx.translate(-fx, -fy)
  // shield bubble behind the body
  if (p.shield) {
    project(v, x, y + 0.55, z, PB)
    const pulse = 1 + 0.04 * Math.sin(time * 6)
    ctx.fillStyle = 'rgba(80,160,255,0.22)'
    ctx.beginPath()
    ctx.ellipse(PB.x, PB.y, 0.66 * PB.s * pulse, 0.76 * PB.s * pulse, 0, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = 'rgba(160,215,255,0.9)'
    ctx.lineWidth = Math.max(1.5, 0.045 * PB.s)
    ctx.stroke()
    ctx.globalAlpha = p.alpha * 0.6
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1, 0.02 * PB.s)
    ctx.beginPath()
    ctx.ellipse(PB.x - 0.2 * PB.s, PB.y - 0.3 * PB.s, 0.22 * PB.s, 0.14 * PB.s, -0.6, 0, TAU)
    ctx.stroke()
    ctx.globalAlpha = p.alpha
  }
  const sl = p.slide
  const run = p.run
  const bob = p.jumping || sl > 0 ? 0 : 0.045 * Math.abs(Math.sin(run))
  // the slide is a deep, wide crouch (hips low, knees out, torso and head bent forward, arms out)
  const hipY = y + lerp(0.42 + bob, 0.26, sl)
  const fwd = lerp(p.jumping ? 0.1 : 0.04 + 0.13 * p.pace, 0.1, sl)
  const torsoZ = z + fwd
  const torsoB = hipY - 0.02
  const torsoT = hipY + lerp(0.36, 0.22, sl)
  // legs: thigh + shin + shoe; the trailing foot kicks up toward the camera while running,
  // both tuck up in the air and splay into the crouch for the slide
  for (let k = -1; k <= 1; k += 2) {
    const lx = x + k * lerp(0.11, 0.25, sl)
    const ph = run + (k < 0 ? 0 : Math.PI)
    const sn = Math.sin(ph)
    const lift = (p.jumping ? 0.22 : 0.2 * Math.max(0, sn)) * (1 - sl)
    const swing = (p.jumping ? 0.14 : -0.22 * sn) * (1 - sl)
    const footY = y + lift
    const footZ = z + swing + 0.05 * sl
    const kneeZ = z + swing * 0.5 - (lift > 0.03 ? 0.05 : 0)
    box(ctx, v, lx, kneeZ, 0.075, lerp(hipY - 0.2, hipY - 0.1, sl), hipY + 0.02, lerp(0.2, 0.38, sl), PANTS)
    box(ctx, v, lx, footZ, 0.07, footY + 0.06, lerp(hipY - 0.18, hipY - 0.06, sl), 0.18, PANTS)
    box(ctx, v, lx, footZ - 0.04, 0.085, footY, footY + 0.08, 0.3, SHOE)
  }
  // torso (hoodie)
  box(ctx, v, x, torsoZ, 0.24, torsoB, torsoT, 0.3, HOODIE)
  // arms pump opposite to the legs; forearms rise when swinging; spread out wide in the crouch
  for (let k = -1; k <= 1; k += 2) {
    const ax = x + k * lerp(0.31, 0.36, sl)
    const ph = run + (k < 0 ? Math.PI : 0)
    const sw = p.jumping ? 0.6 : Math.sin(ph)
    const upZ = torsoZ + lerp(0.12 * sw, -0.02, sl)
    const upT = torsoT - 0.03
    const upB = upT - 0.2
    box(ctx, v, ax, upZ, 0.06, upB, upT, 0.16, HOODIE)
    const fax = x + k * lerp(0.31, 0.5, sl)
    const foZ = upZ + lerp(0.12 * sw, 0, sl)
    const foB = upB - 0.12 + lerp(0.1 * Math.abs(sw) + (p.jumping ? 0.08 : 0), 0.1, sl)
    box(ctx, v, fax, foZ, 0.055, foB, foB + 0.16, 0.14, HOODIE)
    box(ctx, v, fax, foZ - 0.02, 0.05, foB - 0.07, foB + 0.01, 0.12, SKIN, false)
  }
  // backpack (faces the camera) with the white H
  const bpBottom = torsoB + 0.05
  const bpTop = torsoT - 0.03
  box(ctx, v, x, torsoZ - 0.22, 0.17, bpBottom, bpTop, 0.14, PACK)
  project(v, x, (bpBottom + bpTop) / 2, torsoZ - 0.29, PB)
  if (PB.s > 18) label(ctx, 'H', PB.x, PB.y, Math.max(8, (bpTop - bpBottom) * PB.s * 0.72), '#ffffff', DISPLAY, 800)
  // hood / collar
  box(ctx, v, x, torsoZ + 0.02, 0.13, torsoT - 0.02, torsoT + 0.07, 0.26, tint(HOODIE, 0.15))
  // head (we see the back: hair), neck skin at the bottom, a tuft on top
  const headB = torsoT + lerp(0.05, -0.02, sl)
  const headZ = torsoZ + lerp(0.03 * p.pace, 0.14, sl)
  box(ctx, v, x, headZ, 0.14, headB, headB + 0.1, 0.28, SKIN, false)
  box(ctx, v, x, headZ, 0.16, headB + 0.08, headB + 0.3, 0.32, HAIR)
  box(ctx, v, x + 0.04, headZ - 0.03, 0.06, headB + 0.3, headB + 0.36, 0.16, HAIR, false)
  // dizzy stars after a crash
  if (p.stumble > 0) {
    ctx.globalAlpha = p.alpha * clamp(p.stumble * 3, 0, 1)
    for (let k = 0; k < 3; k++) {
      const a = time * 7 + (k * TAU) / 3
      project(v, x + Math.cos(a) * 0.3, headB + 0.45 + 0.05 * Math.sin(a * 2), headZ + Math.sin(a) * 0.2, PB)
      star(ctx, PB.x, PB.y, 0.07 * PB.s)
    }
  }
  ctx.restore()
  // magnet aura: two counter-rotating rings
  if (p.magnet) {
    project(v, x, y + 0.5, z, PB)
    ctx.globalAlpha = 0.45 + 0.2 * Math.sin(time * 8)
    ctx.strokeStyle = '#ff5c68'
    ctx.lineWidth = Math.max(1.5, 0.04 * PB.s)
    ctx.beginPath()
    ctx.ellipse(PB.x, PB.y, 0.95 * PB.s, 0.5 * PB.s, 0.25 * Math.sin(time * 3), 0, TAU)
    ctx.stroke()
    ctx.strokeStyle = '#ffd43b'
    ctx.lineWidth = Math.max(1, 0.025 * PB.s)
    ctx.beginPath()
    ctx.ellipse(PB.x, PB.y, 0.8 * PB.s, 0.42 * PB.s, -0.3 * Math.sin(time * 3 + 1), 0, TAU)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

/** Office worker / guard / contractor seen from the front, walking toward the camera or standing. */
function drawPerson(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const x = e.lane * LANE_W
  const guard = e.kind === 'guard'
  const contractor = !guard && e.variant === 3
  const shirt = guard ? '#243a63' : contractor ? '#3d4a63' : e.shirt
  const pants = guard ? '#1b2a4d' : '#3c4a63'
  const skin = e.skin
  const hair = e.hair
  const walking = e.walk > 0
  const phase = walking ? time * 7 + e.phase : 0
  const l0 = walking ? 0.12 * Math.max(0, Math.sin(phase)) : 0
  const l1 = walking ? 0.12 * Math.max(0, Math.sin(phase + Math.PI)) : 0
  const sway = walking ? 0 : 0.015 * Math.sin(time * 1.5 + e.phase)
  const shake = e.hitT > 0 ? 0.08 * Math.sin(e.hitT * 60) : 0
  const bx = x + sway + shake
  groundShadow(ctx, v, x, z, 0.36, 0.3)
  // legs and shoes
  box(ctx, v, bx - 0.1, z, 0.07, l0, 0.36, 0.2, pants)
  box(ctx, v, bx + 0.1, z, 0.07, l1, 0.36, 0.2, pants)
  box(ctx, v, bx - 0.1, z - 0.03, 0.08, l0, l0 + 0.06, 0.28, '#2b3240')
  box(ctx, v, bx + 0.1, z - 0.03, 0.08, l1, l1 + 0.06, 0.28, '#2b3240')
  // torso and arms
  box(ctx, v, bx, z, 0.23, 0.34, 0.74, 0.28, shirt)
  const a0 = walking ? 0.06 * Math.sin(phase + Math.PI) : 0
  const a1 = walking ? 0.06 * Math.sin(phase) : 0
  box(ctx, v, bx - 0.3, z, 0.06, 0.4 + a0, 0.72 + a0, 0.16, shirt)
  box(ctx, v, bx + 0.3, z, 0.06, 0.4 + a1, 0.72 + a1, 0.16, shirt)
  box(ctx, v, bx - 0.3, z, 0.055, 0.34 + a0, 0.41 + a0, 0.14, skin, false)
  box(ctx, v, bx + 0.3, z, 0.055, 0.34 + a1, 0.41 + a1, 0.14, skin, false)
  // front details on the torso
  project(v, bx, 0.54, z - 0.14, PA)
  const s = PA.s
  if (guard) {
    ctx.fillStyle = '#111a2e'
    ctx.fillRect(PA.x - 0.03 * s, PA.y - 0.2 * s, 0.06 * s, 0.26 * s) // tie
    ctx.fillStyle = '#ffd43b'
    ctx.fillRect(PA.x - 0.17 * s, PA.y - 0.12 * s, 0.07 * s, 0.07 * s) // badge
  } else if (contractor) {
    ctx.fillStyle = '#f28c28'
    ctx.fillRect(PA.x - 0.21 * s, PA.y - 0.2 * s, 0.42 * s, 0.34 * s)
    ctx.fillStyle = '#fff6c7'
    ctx.fillRect(PA.x - 0.21 * s, PA.y - 0.06 * s, 0.42 * s, 0.045 * s)
  } else if (e.variant === 1 && s > 14) {
    ctx.fillStyle = tint(shirt, -0.35)
    ctx.fillRect(PA.x - 0.1 * s, PA.y - 0.2 * s, 0.2 * s, 0.03 * s) // collar line
  }
  // head: skin block, hair on top (+ fringe), eyes
  const headBottom = 0.76
  const headTop = 1.04
  box(ctx, v, bx, z, 0.15, headBottom, headTop, 0.3, skin)
  box(ctx, v, bx, z, 0.16, headTop - 0.08, headTop + 0.03, 0.32, hair)
  project(v, bx, headBottom, z - 0.15, PA)
  project(v, bx, headTop, z - 0.15, PB)
  const hs = PA.s
  if (hs > 12) {
    const faceH = PA.y - PB.y
    ctx.fillStyle = hair
    ctx.fillRect(PA.x - 0.15 * hs, PB.y + 0.08 * hs, 0.3 * hs, faceH * 0.18) // fringe
    ctx.fillStyle = '#1b2238'
    const ew = Math.max(1.5, 0.04 * hs)
    ctx.fillRect(PA.x - 0.08 * hs - ew / 2, PB.y + faceH * 0.45, ew, ew * 1.3)
    ctx.fillRect(PA.x + 0.08 * hs - ew / 2, PB.y + faceH * 0.45, ew, ew * 1.3)
    if (e.variant === 2 && !guard) {
      ctx.strokeStyle = '#1b2238'
      ctx.lineWidth = 1
      ctx.strokeRect(PA.x - 0.12 * hs, PB.y + faceH * 0.38, 0.09 * hs, 0.07 * hs)
      ctx.strokeRect(PA.x + 0.03 * hs, PB.y + faceH * 0.38, 0.09 * hs, 0.07 * hs)
    }
  }
  if (guard) {
    box(ctx, v, bx, z, 0.17, headTop - 0.02, headTop + 0.08, 0.34, '#1f2a4d')
    box(ctx, v, bx, z - 0.22, 0.17, headTop - 0.03, headTop, 0.12, '#141c33', false)
  } else if (contractor) {
    box(ctx, v, bx, z, 0.18, headTop - 0.04, headTop + 0.1, 0.36, '#f7c531')
  }
}

/* ------------------------------------------------------------------------------------ */
/* Obstacles                                                                             */
/* ------------------------------------------------------------------------------------ */

function drawRobot(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const x = e.lane * LANE_W
  groundShadow(ctx, v, x, z, 0.48, 0.3)
  project(v, x, 0.08, z, PA)
  project(v, x, 0.4, z, PB)
  const s = PA.s
  const rx = 0.44 * s
  const ry = rx * 0.38
  // ink silhouette, body: lower rim (grey), side band, top disc (white)
  if (s > 11) {
    ctx.strokeStyle = INK
    ctx.lineWidth = Math.min(5, Math.max(2, 0.026 * s))
    ctx.beginPath()
    ctx.ellipse(PA.x, PA.y, rx, ry, 0, 0, Math.PI)
    ctx.lineTo(PA.x - rx, PB.y)
    ctx.ellipse(PA.x, PB.y, rx, ry, 0, Math.PI, 0)
    ctx.closePath()
    ctx.stroke()
  }
  ctx.fillStyle = '#9aa4b5'
  ctx.beginPath()
  ctx.ellipse(PA.x, PA.y, rx, ry, 0, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#dde3ec'
  ctx.fillRect(PA.x - rx, PB.y, rx * 2, PA.y - PB.y)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(PA.x, PB.y, rx, ry, 0, 0, TAU)
  ctx.fill()
  // LED ring
  ctx.globalAlpha = fogA * (0.55 + 0.45 * Math.sin(time * 6 + e.phase))
  ctx.strokeStyle = '#2f80ff'
  ctx.lineWidth = Math.max(1.5, 0.05 * s)
  ctx.beginPath()
  ctx.ellipse(PA.x, PB.y + (PA.y - PB.y) * 0.45, rx * 0.98, ry * 0.98, 0, 0, Math.PI)
  ctx.stroke()
  ctx.globalAlpha = fogA
  // sensor
  box(ctx, v, x, z, 0.08, 0.4, 0.52, 0.16, '#4a5566')
  project(v, x, 0.5, z - 0.08, PC)
  ctx.fillStyle = '#ff5252'
  ctx.beginPath()
  ctx.arc(PC.x, PC.y, Math.max(1, 0.03 * s), 0, TAU)
  ctx.fill()
}

function drawCart(ctx: Ctx, v: View, e: Entity, z: number) {
  const x = e.lane * LANE_W
  groundShadow(ctx, v, x, z, 0.52, 0.3)
  // wheels
  for (let i = -1; i <= 1; i += 2) for (let k = -1; k <= 1; k += 2) box(ctx, v, x + i * 0.34, z + k * 0.35, 0.07, 0.0, 0.14, 0.14, '#2b3240', false)
  box(ctx, v, x, z, 0.42, 0.12, 0.66, 0.95, '#b3bccb')
  // darker panel on the front face with a stripe
  project(v, x, 0.42, z - 0.48, PA)
  const s = PA.s
  if (s > 10) {
    ctx.fillStyle = '#8b95a7'
    ctx.fillRect(PA.x - 0.36 * s, PA.y - 0.22 * s, 0.72 * s, 0.44 * s)
    ctx.fillStyle = '#2f80ff'
    ctx.fillRect(PA.x - 0.36 * s, PA.y - 0.02 * s, 0.72 * s, 0.05 * s)
  }
  // envelopes on top and the push handle at the back
  box(ctx, v, x - 0.1, z - 0.1, 0.2, 0.66, 0.74, 0.3, '#ffffff')
  box(ctx, v, x + 0.15, z + 0.15, 0.18, 0.66, 0.8, 0.28, '#fff1c2')
  box(ctx, v, x, z + 0.46, 0.4, 0.72, 0.9, 0.05, '#4a5566', false)
}

const TROLLEY_COLORS = ['#e74c3c', '#2f80ff', '#f1c40f']
const LEAF_COLORS = ['#2e9e5b', '#4cc273', '#1f8a4c', '#63d48a']

function drawTrolley(ctx: Ctx, v: View, e: Entity, z: number) {
  const x = e.lane * LANE_W
  groundShadow(ctx, v, x, z, 0.52, 0.3)
  for (let i = -1; i <= 1; i += 2) for (let k = -1; k <= 1; k += 2) box(ctx, v, x + i * 0.36, z + k * 0.38, 0.06, 0.0, 0.12, 0.12, '#2b3240', false)
  box(ctx, v, x, z, 0.44, 0.1, 0.17, 1.0, '#8a94a8')
  // suitcases
  for (let i = 0; i < 3; i++) box(ctx, v, x + (i % 2 ? 0.03 : -0.03), z, 0.36 - i * 0.03, 0.17 + i * 0.2, 0.17 + (i + 1) * 0.2 - 0.02, 0.8 - i * 0.1, TROLLEY_COLORS[(i + e.variant) % 3])
  // frame posts
  box(ctx, v, x - 0.4, z + 0.45, 0.03, 0.17, 0.92, 0.06, '#8a94a8', false)
  box(ctx, v, x + 0.4, z + 0.45, 0.03, 0.17, 0.92, 0.06, '#8a94a8', false)
  box(ctx, v, x, z + 0.45, 0.42, 0.88, 0.94, 0.06, '#8a94a8', false)
}

function drawBarrier(ctx: Ctx, v: View, e: Entity, z: number) {
  const span = e.variant
  const laneMin = span > 0 ? 0 : -1
  const laneMax = span < 0 ? 0 : 1
  const xL = (laneMin - 0.5) * LANE_W + 0.12
  const xR = (laneMax + 0.5) * LANE_W - 0.12
  // posts
  for (let k = 0; k < 2; k++) {
    const px = k === 0 ? xL : xR
    groundShadow(ctx, v, px, z, 0.22, 0.25)
    box(ctx, v, px, z, 0.1, 0, 0.92, 0.32, '#3a4256')
    box(ctx, v, px, z, 0.11, 0.92, 1.0, 0.34, '#e63946')
  }
  // striped pole
  const y0 = 0.72
  const y1 = 0.86
  const hw = (xR - xL) / 2
  const cx = (xL + xR) / 2
  box(ctx, v, cx, z, hw, y0, y1, 0.14, '#ffffff')
  project(v, xL, y0, z - 0.07, PA)
  project(v, xR, y1, z - 0.07, PB)
  const w = PB.x - PA.x
  const h = PA.y - PB.y
  const seg = Math.max(0.5, (xR - xL) / Math.round((xR - xL) / 0.45))
  ctx.fillStyle = '#e63946'
  for (let i = 0, xx = xL; xx < xR - 0.01; i++, xx += seg) {
    if (i % 2 === 1) continue
    const a = (xx - xL) / (xR - xL)
    const b = Math.min(1, (xx + seg - xL) / (xR - xL))
    ctx.fillRect(PA.x + a * w, PB.y, (b - a) * w, h)
  }
}

function drawWetSign(ctx: Ctx, v: View, e: Entity, z: number) {
  const x = e.lane * LANE_W
  groundShadow(ctx, v, x, z, 0.32, 0.26)
  // back leg
  project(v, x - 0.2, 0, z + 0.2, PA)
  project(v, x + 0.2, 0, z + 0.2, PB)
  project(v, x, 0.78, z, PC)
  ctx.fillStyle = '#c9a227'
  ctx.beginPath()
  ctx.moveTo(PA.x, PA.y)
  ctx.lineTo(PB.x, PB.y)
  ctx.lineTo(PC.x + 0.09 * PC.s, PC.y)
  ctx.lineTo(PC.x - 0.09 * PC.s, PC.y)
  ctx.closePath()
  ctx.fill()
  // front panel
  project(v, x - 0.24, 0, z - 0.2, PA)
  project(v, x + 0.24, 0, z - 0.2, PB)
  ctx.beginPath()
  ctx.moveTo(PA.x, PA.y)
  ctx.lineTo(PB.x, PB.y)
  ctx.lineTo(PC.x + 0.1 * PC.s, PC.y)
  ctx.lineTo(PC.x - 0.1 * PC.s, PC.y)
  ctx.closePath()
  ctx.fillStyle = '#f7c531'
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.min(3, Math.max(1, 0.015 * PA.s))
  ctx.stroke()
  const s = PA.s
  if (s > 14) {
    const mx = (PA.x + PB.x) / 2
    const my = PA.y - (PA.y - PC.y) * 0.45
    ctx.fillStyle = '#1b2238'
    ctx.fillRect(mx - 0.03 * s, my - 0.16 * s, 0.06 * s, 0.2 * s)
    ctx.fillRect(mx - 0.03 * s, my + 0.07 * s, 0.06 * s, 0.06 * s)
  }
}

function drawPlanter(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const x = e.lane * LANE_W
  groundShadow(ctx, v, x, z, 0.52, 0.26)
  box(ctx, v, x, z, 0.46, 0, 0.44, 0.85, '#8d5a3b')
  box(ctx, v, x, z, 0.48, 0.4, 0.46, 0.9, '#a86e4b', false)
  leaves(ctx, v, x, z, 0.44, 0.5, time + e.phase, 4)
}

function leaves(ctx: Ctx, v: View, x: number, z: number, y: number, r: number, t: number, n: number) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + t * 0.2
    project(v, x + Math.cos(a) * r * 0.5, y + 0.12 + Math.abs(Math.sin(a)) * 0.2 + 0.02 * Math.sin(t * 2 + i), z + Math.sin(a) * r * 0.3, PA)
    const rx = r * 0.42 * PA.s
    const ry = r * 0.5 * PA.s
    ctx.beginPath()
    ctx.ellipse(PA.x, PA.y, rx, ry, 0, 0, TAU)
    if (rx > 5) {
      ctx.strokeStyle = INK
      ctx.lineWidth = Math.min(4, Math.max(1.5, 0.05 * rx))
      ctx.stroke()
    }
    ctx.fillStyle = LEAF_COLORS[i % 4]
    ctx.fill()
  }
}

function drawGlass(ctx: Ctx, v: View, e: Entity, z: number) {
  const x = e.lane * LANE_W
  groundShadow(ctx, v, x, z, 0.5, 0.18)
  project(v, x - 0.6, 0, z, PA)
  project(v, x + 0.6, 3.0, z, PB)
  const w = PB.x - PA.x
  const h = PA.y - PB.y
  ctx.fillStyle = e.hitT > 0 ? 'rgba(255,120,130,0.5)' : 'rgba(170,214,255,0.45)'
  ctx.fillRect(PA.x, PB.y, w, h)
  // frosted band and the "no entry" disc
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillRect(PA.x, PA.y - h * 0.52, w, h * 0.1)
  ctx.strokeStyle = '#dbe6f5'
  ctx.lineWidth = Math.max(1.5, 0.05 * PA.s)
  ctx.strokeRect(PA.x, PB.y, w, h)
  const s = PA.s
  if (s > 10) {
    const cx = PA.x + w / 2
    const cy = PA.y - h * 0.47
    ctx.fillStyle = '#e63946'
    ctx.beginPath()
    ctx.arc(cx, cy, 0.2 * s, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(cx - 0.13 * s, cy - 0.035 * s, 0.26 * s, 0.07 * s)
  }
  // steel posts
  box(ctx, v, x - 0.6, z, 0.04, 0, 3.0, 0.1, '#8a94a8', false)
  box(ctx, v, x + 0.6, z, 0.04, 0, 3.0, 0.1, '#8a94a8', false)
}

/* ------------------------------------------------------------------------------------ */
/* Pickups                                                                               */
/* ------------------------------------------------------------------------------------ */

function drawCoin(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const x = e.lane * LANE_W
  const y = e.y + 0.28 + 0.03 * Math.sin(time * 3 + e.d)
  if (e.y > 0.05) groundShadow(ctx, v, x, z, 0.18, 0.18)
  project(v, x, y, z, PA)
  const r = 0.22 * PA.s
  const rx = Math.max(r * 0.18, r * Math.abs(Math.cos(time * 4 + e.d * 0.7)))
  if (r > 7) {
    // soft glow behind the coin
    ctx.globalAlpha = fogA * 0.22
    ctx.fillStyle = '#ffe680'
    ctx.beginPath()
    ctx.arc(PA.x, PA.y, r * 1.5, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = fogA
  }
  ctx.fillStyle = '#b8860b'
  ctx.beginPath()
  ctx.ellipse(PA.x + r * 0.1, PA.y + r * 0.04, rx, r, 0, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#f5c518'
  ctx.beginPath()
  ctx.ellipse(PA.x, PA.y, rx, r, 0, 0, TAU)
  ctx.fill()
  if (r > 4) {
    ctx.strokeStyle = '#ffe680'
    ctx.lineWidth = Math.max(1, r * 0.16)
    ctx.beginPath()
    ctx.ellipse(PA.x, PA.y, rx * 0.6, r * 0.6, 0, 0, TAU)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.beginPath()
    ctx.ellipse(PA.x - rx * 0.3, PA.y - r * 0.45, Math.max(1, rx * 0.2), r * 0.14, 0, 0, TAU)
    ctx.fill()
  }
}

function bubble(ctx: Ctx, v: View, x: number, y: number, z: number, color: string, time: number): number {
  groundShadow(ctx, v, x, z, 0.3, 0.2)
  project(v, x, y + 0.45 + 0.06 * Math.sin(time * 2.5 + x), z, PA)
  const r = 0.42 * PA.s
  ctx.globalAlpha = fogA * (0.25 + 0.1 * Math.sin(time * 5))
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(PA.x, PA.y, r * 1.45, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = fogA
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(PA.x, PA.y, r, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, r * 0.14)
  ctx.stroke()
  return r
}

function drawBadgePickup(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const x = e.lane * LANE_W
  groundShadow(ctx, v, x, z, 0.3, 0.2)
  const y = e.y + 0.08 * Math.sin(time * 2.5 + e.d)
  project(v, x, y + 0.42, z, PA)
  const s = PA.s
  // glow + sparkle rays
  ctx.globalAlpha = fogA * (0.32 + 0.12 * Math.sin(time * 5))
  ctx.fillStyle = '#ffe678'
  ctx.beginPath()
  ctx.arc(PA.x, PA.y, 0.7 * s, 0, TAU)
  ctx.fill()
  if (s > 20) {
    ctx.globalAlpha = fogA * 0.5
    ctx.strokeStyle = '#fff3b0'
    ctx.lineWidth = Math.max(1, 0.03 * s)
    for (let k = 0; k < 4; k++) {
      const a = time * 1.5 + (k * Math.PI) / 2
      ctx.beginPath()
      ctx.moveTo(PA.x + Math.cos(a) * 0.5 * s, PA.y + Math.sin(a) * 0.5 * s)
      ctx.lineTo(PA.x + Math.cos(a) * 0.85 * s, PA.y + Math.sin(a) * 0.85 * s)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = fogA
  drawBadgeCard(ctx, PA.x, PA.y, 0.58 * s, 0.76 * s, e.badge ?? 'EMPLOYEE')
}

function drawNote(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const x = e.lane * LANE_W
  groundShadow(ctx, v, x, z, 0.28, 0.2)
  project(v, x, e.y + 0.4 + 0.06 * Math.sin(time * 2.5 + e.d), z, PA)
  const s = PA.s
  ctx.globalAlpha = fogA * (0.3 + 0.12 * Math.sin(time * 5))
  ctx.fillStyle = '#ffe150'
  ctx.beginPath()
  ctx.arc(PA.x, PA.y, 0.64 * s, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = fogA
  ctx.save()
  ctx.translate(PA.x, PA.y)
  ctx.rotate(-0.12)
  const w = 0.62 * s
  ctx.fillStyle = 'rgba(16,26,54,0.3)'
  ctx.fillRect(-w / 2 + 3, -w / 2 + 4, w, w)
  ctx.fillStyle = INK_SOLID
  ctx.fillRect(-w / 2 - 1.5, -w / 2 - 1.5, w + 3, w + 3)
  ctx.fillStyle = '#ffe14d'
  ctx.fillRect(-w / 2, -w / 2, w, w)
  ctx.fillStyle = '#f4b400'
  ctx.fillRect(-w / 2, -w / 2, w, w * 0.14)
  if (s > 18) {
    label(ctx, 'PIN', 0, -w * 0.16, Math.max(6, w * 0.16), '#6b5a1a')
    label(ctx, e.code, 0, w * 0.2, Math.max(8, w * 0.3), '#2b3240', DISPLAY, 800)
  }
  ctx.restore()
}

function drawMagnet(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const x = e.lane * LANE_W
  const r = bubble(ctx, v, x, e.y, z, '#e63946', time)
  icon(ctx, 'magnet', PA.x, PA.y + r * 0.05, r * 1.2)
}

function drawShieldPickup(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const x = e.lane * LANE_W
  const r = bubble(ctx, v, x, e.y, z, '#2f80ff', time)
  icon(ctx, 'shield', PA.x, PA.y, r * 1.3, '#2f80ff')
  icon(ctx, 'star', PA.x, PA.y, r * 0.55, '#ffffff')
}

/* ------------------------------------------------------------------------------------ */
/* Rows: gates, PIN gates, reception, elevator, camera                                   */
/* ------------------------------------------------------------------------------------ */

export interface RowContext {
  held: ReadonlySet<Badge>
  hasNote: boolean
}

/** Distance at which a row "reads" the player's badges and lights up green / red. */
const CHECK_Z = 34

/** Light colour of a passage at depth z: neutral far away, green/red once the badge check kicks in. */
function gateState(z: number, ok: boolean): string {
  if (z > CHECK_Z) return '#9ec5ff'
  return ok ? '#2fd47f' : '#ff4b57'
}

/** The lit runways need more punch over a coloured carpet or a dark floor than over pale marble. */
function runwayBoost(v: View): number {
  return v.theme.carpet || v.theme.dark ? 1.7 : 1
}

/**
 * Fog alpha of the entity being drawn. Sprites that change globalAlpha for a translucent part
 * multiply by this and restore it afterwards, so far objects keep dissolving into the haze.
 */
let fogA = 1
/** Extra fade for the signs of a gate row while another row is nearer (only one row is readable). */
let rowFade = 1

/**
 * Overhead signs hang at about camera height, so they would block the view ahead as the runner
 * gets close. They have done their job by then: fade them out over the last few units.
 */
function overheadAlpha(z: number): number {
  return fogA * clamp((z - 0.4) / overheadFade, 0, 1)
}
/** Length of that fade in units; longer when the camera sits high (phones), where signs cross the middle of the screen. */
let overheadFade = 2.4

function hangingSign(ctx: Ctx, v: View, x: number, z: number, color: string, line1: string, line2: string, ic: BadgeIcon | 'keypad' | 'lock' | 'star') {
  const a = overheadAlpha(z) * rowFade
  if (a <= 0.01) return
  const y0 = 1.84
  const y1 = 2.84
  project(v, x - 0.56, y0, z, PA)
  project(v, x + 0.56, y1, z, PB)
  const w = PB.x - PA.x
  const h = PA.y - PB.y
  const s = PA.s
  const r = Math.max(2, 0.08 * s)
  ctx.globalAlpha = a
  // ink outline, darker rim = the panel's thickness, then the face with a soft top highlight
  fillRoundRect(ctx, PA.x - 1.5, PB.y - 1.5, w + 3, h + 3 + 0.06 * s, r + 1, INK_SOLID)
  fillRoundRect(ctx, PA.x, PB.y + 0.06 * s, w, h, r, tint(color, -0.4))
  fillRoundRect(ctx, PA.x, PB.y, w, h, r, color)
  ctx.globalAlpha = a * 0.18
  fillRoundRect(ctx, PA.x + w * 0.05, PB.y + h * 0.04, w * 0.9, h * 0.36, r, '#ffffff')
  ctx.globalAlpha = a
  if (s > 8) {
    icon(ctx, ic, PA.x + w / 2, PB.y + h * 0.3, h * 0.36, '#ffffff')
    if (s > 14) {
      const px = Math.max(5, Math.min(h * 0.17, (w / Math.max(6, line1.length)) * 1.28))
      label(ctx, line1, PA.x + w / 2, PB.y + h * 0.65, px, '#ffffff')
      label(ctx, line2, PA.x + w / 2, PB.y + h * 0.84, px * 0.92, 'rgba(255,255,255,0.92)')
    }
  }
  ctx.globalAlpha = fogA
}

/** Speed-gate pedestals on the lane borders with glass flaps between them and signs on one beam. */
function drawGateRow(ctx: Ctx, v: View, e: Entity, z: number, rc: RowContext, time: number) {
  const pin = e.kind === 'pin'
  const checked = z <= CHECK_Z
  const zNear = -v.camD + Z_NEAR_OFFSET
  // lit runway in front of every passage: the lane you may use glows green well before the gate
  if (checked) {
    for (let l = -1; l <= 1; l++) {
      const ok = pin ? e.done : rc.held.has(e.gates[l + 1])
      const ready = pin && !e.done && rc.hasNote
      const color = ok ? '#2bb673' : ready ? '#ffd43b' : '#e63946'
      ctx.globalAlpha = fogA * (ok ? 0.4 : ready ? 0.32 : 0.18) * runwayBoost(v)
      floorQuad(ctx, v, (l - 0.42) * LANE_W, (l + 0.42) * LANE_W, Math.max(z - 10, zNear), z + 0.5, color)
      if (ok || ready) {
        ctx.globalAlpha = fogA * 0.3
        floorQuad(ctx, v, (l - 0.14) * LANE_W, (l + 0.14) * LANE_W, Math.max(z - 10, zNear), z + 0.5, '#ffffff')
      }
    }
    ctx.globalAlpha = fogA
  }
  // one overhead beam carrying all three signs on short rods
  const oa = overheadAlpha(z) * rowFade
  if (oa > 0.01) {
    ctx.globalAlpha = oa
    box(ctx, v, 0, z, WALL_X - 0.08, 2.92, 3.1, 0.22, '#3f4c6e')
    for (let l = -1; l <= 1; l++) box(ctx, v, l * LANE_W, z, 0.025, 2.84, 2.92, 0.05, '#aab6cc', false)
    ctx.globalAlpha = fogA
  }
  // chunky steel pedestals on every lane border: dark plinth, body, light cap, card reader
  for (let i = -3; i <= 3; i += 2) {
    const x = (i / 2) * LANE_W
    groundShadow(ctx, v, x, z, 0.3, 0.28)
    box(ctx, v, x, z, 0.2, 0, 0.1, 1.06, '#2b3550', false)
    box(ctx, v, x, z, 0.17, 0.08, 0.98, 1.0, '#6c7c9e')
    box(ctx, v, x, z, 0.19, 0.96, 1.06, 1.04, '#bcc8dc')
    box(ctx, v, x, z - 0.2, 0.1, 1.06, 1.1, 0.26, '#1b2440', false)
  }
  for (let l = -1; l <= 1; l++) {
    const x = l * LANE_W
    const ok = pin ? e.done : rc.held.has(e.gates[l + 1])
    const flash = e.hitT > 0 && e.hitLane === l && Math.sin(e.hitT * 40) > 0
    const color = flash ? '#ffb3b8' : gateState(z, ok)
    const open = pin ? (e.done ? e.anim : 0) : e.hitLane === l && (ok || e.done) ? e.anim : 0
    const flapW = (0.5 * LANE_W - 0.17) * (1 - open)
    // glass flaps retract into the pedestals when open
    if (flapW > 0.02) {
      for (let side = -1; side <= 1; side += 2) {
        const edge = x + side * (0.5 * LANE_W - 0.17)
        const tip = edge - side * flapW
        project(v, Math.min(edge, tip), 0.36, z, PA)
        project(v, Math.max(edge, tip), 0.98, z, PB)
        const w = PB.x - PA.x
        const h = PA.y - PB.y
        ctx.fillStyle = pin && !ok ? 'rgba(52,62,90,0.85)' : checked && !ok ? 'rgba(255,150,160,0.6)' : 'rgba(190,225,255,0.6)'
        ctx.fillRect(PA.x, PB.y, w, h)
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.lineWidth = Math.max(1, 0.015 * PA.s)
        ctx.strokeRect(PA.x, PB.y, w, h)
      }
    }
    // glowing light bars: LED strips on the pedestals facing the passage + a bar across the flaps
    for (let side = -1; side <= 1; side += 2) {
      project(v, x + side * (0.5 * LANE_W - 0.21), 0.18, z - 0.5, PA)
      project(v, x + side * (0.5 * LANE_W - 0.21), 0.92, z - 0.5, PB)
      const lw = Math.max(2, 0.09 * PA.s)
      ctx.globalAlpha = fogA * 0.4
      ctx.fillStyle = color
      ctx.fillRect(PA.x - lw * 1.6, PB.y - lw, lw * 3.2, PA.y - PB.y + lw * 2)
      ctx.globalAlpha = fogA
      ctx.fillRect(PA.x - lw / 2, PB.y, lw, PA.y - PB.y)
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.fillRect(PA.x - lw / 6, PB.y, lw / 3, PA.y - PB.y)
    }
    if (flapW > 0.02) {
      project(v, x - (0.5 * LANE_W - 0.17), 0.98, z, PA)
      project(v, x + (0.5 * LANE_W - 0.17), 0.98, z, PB)
      const bh = Math.max(2, 0.08 * PA.s)
      ctx.globalAlpha = fogA * 0.4
      ctx.fillStyle = color
      ctx.fillRect(PA.x, PA.y - bh * 1.5, PB.x - PA.x, bh * 3)
      ctx.globalAlpha = fogA
      ctx.fillRect(PA.x, PA.y - bh / 2, PB.x - PA.x, bh)
    }
    project(v, x, 0.66, z - 0.02, PC)
    if (!ok && open < 0.5 && PC.s > 8) {
      if (pin) {
        fillRoundRect(ctx, PC.x - 0.17 * PC.s, PC.y - 0.22 * PC.s, 0.34 * PC.s, 0.44 * PC.s, Math.max(1, 0.04 * PC.s), '#141c33')
        icon(ctx, 'keypad', PC.x, PC.y + 0.03 * PC.s, 0.27 * PC.s, '#ffd43b')
      } else if (checked) {
        ctx.fillStyle = INK_SOLID
        ctx.beginPath()
        ctx.arc(PC.x, PC.y, 0.215 * PC.s, 0, TAU)
        ctx.fill()
        ctx.fillStyle = '#e63946'
        ctx.beginPath()
        ctx.arc(PC.x, PC.y, 0.19 * PC.s, 0, TAU)
        ctx.fill()
        icon(ctx, 'lock', PC.x, PC.y + 0.01 * PC.s, 0.22 * PC.s, '#ffffff')
      }
    }
    if (pin) hangingSign(ctx, v, x, z, e.done ? '#2bb673' : '#1f2a4d', e.done ? 'PIN' : 'ENTER', e.done ? 'ACCEPTED' : 'PIN', e.done ? 'star' : 'keypad')
    else {
      const info = BADGE_INFO[e.gates[l + 1]]
      hangingSign(ctx, v, x, z, info.color, info.sign[0], info.sign[1], info.icon)
    }
  }
  // the whole row flashes red when the player ran into a locked lane
  if (e.hitT > 0 && Math.sin(time * 30) > 0) {
    ctx.globalAlpha = fogA * 0.2
    floorQuad(ctx, v, -1.5 * LANE_W, 1.5 * LANE_W, z - 2, z + 1, '#e63946')
    ctx.globalAlpha = fogA
  }
}

/** Scratch entity so the receptionist and the visitor can reuse the person sprite. */
const FIGURE = makeEntity('person', 0, 0)

function drawReception(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const open = e.anim
  // blue mat in front of the desk
  ctx.globalAlpha = fogA * 0.45
  floorQuad(ctx, v, -1.5 * LANE_W, 1.5 * LANE_W, z - 2.4, z - 0.6, '#2f80ff')
  // sign hanging over the checkpoint so it reads from far away
  ctx.globalAlpha = overheadAlpha(z)
  if (ctx.globalAlpha > 0.01) box(ctx, v, 0, z, 0.03, 2.86, WALL_H, 0.06, '#8a94a8', false)
  hangingSign(ctx, v, 0, z, '#1b5fd1', 'RECEPTION', 'CHECK-IN', 'people')
  ctx.globalAlpha = fogA
  // The receptionist stands behind the counter on a lane border, clear of all three lanes
  // (drawn first so the counter hides the legs).
  FIGURE.kind = 'person'
  FIGURE.variant = 0
  FIGURE.walk = 0
  FIGURE.hitT = 0
  FIGURE.phase = e.phase
  FIGURE.lane = 0.5
  FIGURE.shirt = '#ffffff'
  FIGURE.hair = '#6b3f22'
  FIGURE.skin = '#f6d3b8'
  drawPerson(ctx, v, FIGURE, z + 0.75, time)
  // Once the visitor is handled the counter sinks into the floor like a row of bollards.
  const k = 1 - open
  if (k > 0.02) {
    for (let l = -1; l <= 1; l++) {
      const cx = l * LANE_W
      box(ctx, v, cx, z, 0.5 * LANE_W, 0, 0.62 * k, 0.8, l === 0 ? '#1f4590' : '#1b3a7a')
      box(ctx, v, cx, z, 0.5 * LANE_W + 0.03, 0.6 * k, 0.68 * k, 0.92, '#f4f6fa')
      // light strip under the counter top
      project(v, cx - 0.5 * LANE_W, 0.5 * k, z - 0.4, PA)
      project(v, cx + 0.5 * LANE_W, 0.56 * k, z - 0.4, PB)
      ctx.fillStyle = '#4da3ff'
      ctx.fillRect(PA.x, PB.y, PB.x - PA.x, Math.max(1.5, PA.y - PB.y))
    }
    project(v, LANE_W, 0.27 * k, z - 0.4, PA)
    if (PA.s > 11 && k > 0.6) wordmark(ctx, PA.x, PA.y, 0.36 * PA.s, '#ffffff')
    // monitor and a plant on the counter
    box(ctx, v, 0.1, z - 0.05, 0.2, 0.68 * k, 0.68 * k + 0.3, 0.06, '#2b3240')
    box(ctx, v, 0.1, z - 0.09, 0.17, 0.68 * k + 0.04, 0.68 * k + 0.26, 0.02, '#4da3ff', false)
    box(ctx, v, -1.95, z - 0.1, 0.13, 0.68 * k, 0.68 * k + 0.18, 0.26, '#b35a3c', false)
    leaves(ctx, v, -1.95, z - 0.1, 0.68 * k + 0.16, 0.3, time, 3)
  }
  // the waiting visitor with a "?" bubble (steps aside after the decision)
  if (e.visitor && open < 1) {
    const face = e.visitor.face
    FIGURE.lane = -0.75 - open * 0.9
    FIGURE.shirt = face.shirt
    FIGURE.hair = face.hair
    FIGURE.skin = face.skin
    FIGURE.variant = face.glasses ? 2 : 0
    ctx.globalAlpha = fogA * (1 - open)
    drawPerson(ctx, v, FIGURE, z - 1.1, time)
    if (!e.done) {
      project(v, -0.75 * LANE_W, 1.5 + 0.05 * Math.sin(time * 3), z - 1.1, PA)
      const s = PA.s
      fillRoundRect(ctx, PA.x - 0.22 * s - 1.5, PA.y - 0.24 * s - 1.5, 0.44 * s + 3, 0.44 * s + 3, 0.1 * s + 1, INK_SOLID)
      fillRoundRect(ctx, PA.x - 0.22 * s, PA.y - 0.24 * s, 0.44 * s, 0.44 * s, 0.1 * s, '#ffffff')
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.moveTo(PA.x - 0.07 * s, PA.y + 0.18 * s)
      ctx.lineTo(PA.x + 0.07 * s, PA.y + 0.18 * s)
      ctx.lineTo(PA.x, PA.y + 0.3 * s)
      ctx.fill()
      if (s > 9) label(ctx, '?', PA.x, PA.y - 0.02 * s, 0.34 * s, '#1b5fd1', DISPLAY, 800)
    }
    ctx.globalAlpha = fogA
  }
}

function drawElevator(ctx: Ctx, v: View, e: Entity, z: number, rc: RowContext, time: number) {
  // the wall is exactly the corridor's cross-section (the side walls are nearer and stay visible)
  project(v, -WALL_X, 0, z, PA)
  project(v, WALL_X, WALL_H, z, PB)
  const w = PB.x - PA.x
  const h = PA.y - PB.y
  const s = PA.s
  const left = PA.x
  const floorY = PA.y
  const cx = left + w / 2
  ctx.fillStyle = '#1b5fd1'
  ctx.fillRect(left, PB.y, w, h)
  // vertical panel seams
  ctx.fillStyle = '#1752b8'
  for (let k = 1; k < 8; k++) ctx.fillRect(left + (w * k) / 8 - 1, PB.y, 2, h)
  // header band with the wordmark, a light line under it, skirting at the bottom
  const bandY = floorY - 3.72 * s
  ctx.fillStyle = '#0d3b8c'
  ctx.fillRect(left, PB.y, w, bandY - PB.y)
  ctx.fillStyle = '#4da3ff'
  ctx.fillRect(left, bandY - Math.max(1.5, 0.05 * s), w, Math.max(1.5, 0.05 * s))
  ctx.fillStyle = '#163f99'
  ctx.fillRect(left, floorY - 0.2 * s, w, 0.2 * s)
  if (s > 7) {
    wordmark(ctx, cx, floorY - 4.82 * s, 0.7 * s, '#ffffff')
    if (s > 12) label(ctx, 'E L E V A T O R S', cx, floorY - 4.2 * s, 0.2 * s, '#9ec5ff')
  }
  const checked = z <= CHECK_Z
  for (let l = -1; l <= 1; l++) {
    const x = l * LANE_W
    const req = e.doors[l + 1]
    const info = ELEVATOR_INFO[req]
    const ok = req === 'ALL' || rc.held.has(req)
    const flash = e.hitT > 0 && e.hitLane === l && Math.sin(e.hitT * 40) > 0
    const color = flash ? '#ffb3b8' : gateState(z, ok)
    // lit runway toward the doors you may use
    if (checked) {
      ctx.globalAlpha = fogA * (ok ? 0.4 : 0.18) * runwayBoost(v)
      floorQuad(ctx, v, x - 0.42 * LANE_W, x + 0.42 * LANE_W, Math.max(z - 10, -v.camD + Z_NEAR_OFFSET), z - 0.1, ok ? '#2bb673' : '#e63946')
      if (ok) {
        ctx.globalAlpha = fogA * 0.3
        floorQuad(ctx, v, x - 0.14 * LANE_W, x + 0.14 * LANE_W, Math.max(z - 10, -v.camD + Z_NEAR_OFFSET), z - 0.1, '#ffffff')
      }
      ctx.globalAlpha = fogA
    }
    // steel frame + dark cabin with a ceiling light
    box(ctx, v, x, z, 0.64, 0, 2.42, 0.2, '#b6bfcf')
    project(v, x - 0.55, 0, z - 0.1, PA)
    project(v, x + 0.55, 2.32, z - 0.1, PB)
    const dw = PB.x - PA.x
    const dh = PA.y - PB.y
    ctx.fillStyle = '#121a33'
    ctx.fillRect(PA.x, PB.y, dw, dh)
    ctx.fillStyle = 'rgba(255,240,200,0.6)'
    ctx.fillRect(PA.x + dw * 0.12, PB.y + dh * 0.04, dw * 0.76, dh * 0.035)
    ctx.fillStyle = '#2a3554'
    ctx.fillRect(PA.x + dw * 0.08, PB.y + dh * 0.5, dw * 0.84, dh * 0.03)
    // door leaves: only doors your badges allow slide open as you approach
    const openness = ok ? e.anim : 0
    const leafW = (dw / 2) * (1 - openness)
    if (leafW > 0.5) {
      ctx.fillStyle = '#d2d9e4'
      ctx.fillRect(PA.x, PB.y, leafW, dh)
      ctx.fillRect(PA.x + dw - leafW, PB.y, leafW, dh)
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.fillRect(PA.x + leafW * 0.15, PB.y, leafW * 0.12, dh)
      ctx.fillRect(PA.x + dw - leafW * 0.85, PB.y, leafW * 0.12, dh)
      ctx.fillStyle = '#8a94a8'
      ctx.fillRect(PA.x + leafW - 1, PB.y, 2, dh)
      ctx.fillRect(PA.x + dw - leafW - 1, PB.y, 2, dh)
    }
    // glowing light bar over the door
    const bar = Math.max(2, 0.09 * PA.s)
    ctx.globalAlpha = fogA * 0.4
    ctx.fillStyle = color
    ctx.fillRect(PA.x - 0.1 * PA.s, PB.y - 0.14 * PA.s - bar, dw + 0.2 * PA.s, bar * 3)
    ctx.globalAlpha = fogA
    ctx.fillRect(PA.x - 0.06 * PA.s, PB.y - 0.14 * PA.s, dw + 0.12 * PA.s, bar)
    // screen above the door: icon on top, two lines below (same layout as the gate signs)
    project(v, x - 0.62, 2.52, z - 0.02, PC)
    project(v, x + 0.62, 3.46, z - 0.02, PD)
    const sw = PD.x - PC.x
    const sh = PC.y - PD.y
    fillRoundRect(ctx, PC.x, PD.y, sw, sh, Math.max(2, 0.06 * s), '#0b1a3d')
    fillRoundRect(ctx, PC.x + sw * 0.035, PD.y + sh * 0.045, sw * 0.93, sh * 0.91, Math.max(2, 0.05 * s), info.color)
    if (s > 8) {
      icon(ctx, info.icon, PC.x + sw / 2, PD.y + sh * 0.28, sh * 0.34, '#ffffff')
      if (s > 13) {
        const px = Math.max(5, Math.min(sh * 0.19, (sw / Math.max(7, info.line1.length)) * 1.38))
        label(ctx, info.line1, PC.x + sw / 2, PD.y + sh * 0.6, px, '#ffffff')
        label(ctx, info.line2, PC.x + sw / 2, PD.y + sh * 0.82, Math.min(px * 0.9, (sw / info.line2.length) * 1.38), 'rgba(255,255,255,0.92)')
      }
    }
    if (!ok && checked && s > 8) {
      ctx.fillStyle = INK_SOLID
      ctx.beginPath()
      ctx.arc(PA.x + dw / 2, PB.y + dh * 0.45, 0.245 * s, 0, TAU)
      ctx.fill()
      ctx.fillStyle = '#e63946'
      ctx.beginPath()
      ctx.arc(PA.x + dw / 2, PB.y + dh * 0.45, 0.22 * s, 0, TAU)
      ctx.fill()
      icon(ctx, 'lock', PA.x + dw / 2, PB.y + dh * 0.455, 0.26 * s, '#ffffff')
    }
  }
  // plants flanking the doors
  for (let side = -1; side <= 1; side += 2) {
    const px = side * (1.5 * LANE_W + 0.32)
    box(ctx, v, px, z - 0.4, 0.18, 0, 0.4, 0.36, '#b35a3c')
    leaves(ctx, v, px, z - 0.4, 0.4, 0.42, time, 4)
  }
}

/**
 * Camera beam at clock time `t`: centre (lane units), lit or dark, about to switch on.
 * variant 0 sweeps the two lanes on the camera's side (the far lane is never lit), variant 1
 * sweeps all three. Returns a shared object – read it before the next call.
 */
export function cameraBeamAt(e: Entity, t: number): { center: number; on: boolean; warn: boolean } {
  const cycle = e.onDur + e.offDur
  const ph = t % cycle
  const wave = Math.sin((t * TAU) / e.period)
  BEAM.center = e.variant === 0 ? e.side * (0.5 + 0.5 * wave) : wave
  // a camera that already caught the player (done) stays dark
  BEAM.on = !e.done && ph < e.onDur
  BEAM.warn = !e.done && !BEAM.on && ph > cycle - 0.4
  return BEAM
}
const BEAM = { center: 0, on: false, warn: false }
/** Half width of the lit patch in lane units (a bit more than one lane wide in total). */
export const BEAM_HALF = 0.62

/** Red cone on the floor (drawn before the sprites) plus the zone's entry / exit markings. */
function drawCameraCone(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const b = cameraBeamAt(e, e.t)
  const zNear = -v.camD + Z_NEAR_OFFSET
  const z0 = Math.max(zNear, z - e.depth / 2)
  const z1 = z + e.depth / 2
  if (z1 <= z0) return
  // zone markings on the floor
  ctx.globalAlpha = fogA * 0.75
  floorQuad(ctx, v, -1.5 * LANE_W, 1.5 * LANE_W, z0 - 0.18, z0, '#e63946')
  floorQuad(ctx, v, -1.5 * LANE_W, 1.5 * LANE_W, z1, z1 + 0.18, '#e63946')
  const xa = clamp(b.center - BEAM_HALF, -1.5, 1.5) * LANE_W
  const xb = clamp(b.center + BEAM_HALF, -1.5, 1.5) * LANE_W
  const color = b.on ? '#ff2233' : b.warn && Math.sin(time * 25) > 0 ? '#ff8c28' : '#2f80ff'
  const alpha = b.on ? 0.7 : e.done ? 0.08 : 0.22
  // light cone from the wall camera down to the lit patch
  project(v, e.side * (WALL_X - 0.3), 2.6, z0, PE)
  project(v, xa, 0, z0, PA)
  project(v, xb, 0, z0, PB)
  project(v, xb, 0, z1, PC)
  project(v, xa, 0, z1, PD)
  ctx.fillStyle = color
  ctx.globalAlpha = fogA * alpha * 0.4
  ctx.beginPath()
  ctx.moveTo(PE.x, PE.y)
  ctx.lineTo(PA.x, PA.y)
  ctx.lineTo(PB.x, PB.y)
  ctx.lineTo(PC.x, PC.y)
  ctx.lineTo(PD.x, PD.y)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = fogA * alpha
  quad(ctx, PA, PB, PC, PD)
  ctx.fill()
  if (b.on) {
    // scan lines sliding through the lit patch
    ctx.globalAlpha = fogA * 0.3
    for (let k = 0; k < 3; k++) {
      const zz = z0 + (((time * 0.9 + k / 3) % 1) * (z1 - z0))
      floorQuad(ctx, v, xa, xb, zz, Math.min(z1, zz + 0.22), '#ffffff')
    }
    ctx.globalAlpha = fogA * 0.85
    ctx.strokeStyle = '#ffd0d4'
    ctx.lineWidth = 1.5
    quad(ctx, PA, PB, PC, PD)
    ctx.stroke()
  }
  ctx.globalAlpha = fogA
}

function drawCameraDevice(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const b = cameraBeamAt(e, e.t)
  const z0 = z - e.depth / 2
  const camX = e.side * (WALL_X - 0.12)
  // bracket + housing
  box(ctx, v, camX - e.side * 0.1, z0, 0.1, 2.55, 2.65, 0.1, '#3a4256', false)
  box(ctx, v, camX - e.side * 0.3, z0, 0.22, 2.5, 2.8, 0.26, '#f4f6fa')
  project(v, camX - e.side * 0.3, 2.65, z0 - 0.15, PA)
  const s = PA.s
  ctx.fillStyle = '#1b2238'
  ctx.beginPath()
  ctx.arc(PA.x, PA.y, 0.09 * s, 0, TAU)
  ctx.fill()
  ctx.fillStyle = b.on ? '#ff3b4a' : b.warn ? '#ffa040' : '#2f80ff'
  ctx.beginPath()
  ctx.arc(PA.x + 0.12 * s * -e.side, PA.y - 0.08 * s, Math.max(1, 0.03 * s), 0, TAU)
  ctx.fill()
  // CCTV sign on the wall
  project(v, camX, 3.3, z0, PB)
  if (PB.s > 10) {
    fillRoundRect(ctx, PB.x - 0.42 * PB.s - 1.5, PB.y - 0.2 * PB.s - 1.5, 0.84 * PB.s + 3, 0.4 * PB.s + 3, 4, INK_SOLID)
    fillRoundRect(ctx, PB.x - 0.42 * PB.s, PB.y - 0.2 * PB.s, 0.84 * PB.s, 0.4 * PB.s, 3, '#e63946')
    icon(ctx, 'camera', PB.x - 0.22 * PB.s, PB.y, 0.26 * PB.s)
    label(ctx, 'CCTV', PB.x + 0.12 * PB.s, PB.y, 0.17 * PB.s, '#ffffff')
  }
  if (b.on && Math.sin(time * 10) > 0) {
    ctx.globalAlpha = fogA * 0.35
    ctx.fillStyle = '#ff3c46'
    ctx.beginPath()
    ctx.arc(PA.x, PA.y, 0.3 * s, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = fogA
  }
}

/* ------------------------------------------------------------------------------------ */
/* Decor                                                                                 */
/* ------------------------------------------------------------------------------------ */

function drawDecor(ctx: Ctx, v: View, e: Entity, z: number, time: number) {
  const t = v.theme
  const x = e.lane * LANE_W
  switch (e.kind) {
    case 'pillar':
      box(ctx, v, x, z, 0.2, 0, WALL_H, 0.45, t.dark ? '#2a3146' : '#edf1f8')
      box(ctx, v, x, z, 0.24, 0, 0.28, 0.5, tint(t.accent, -0.3))
      box(ctx, v, x, z, 0.23, 1.0, 1.1, 0.48, tint(t.accent, 0.1), false)
      break
    case 'plant':
      groundShadow(ctx, v, x, z, 0.32, 0.24)
      box(ctx, v, x, z, 0.22, 0, 0.38, 0.44, e.variant === 1 ? '#8a94a8' : '#b35a3c')
      leaves(ctx, v, x, z, 0.38, 0.42 + e.variant * 0.05, time + e.phase, 4)
      break
    case 'bench':
      groundShadow(ctx, v, x, z, 0.32, 0.24)
      box(ctx, v, x, z - 0.6, 0.18, 0, 0.3, 0.08, '#4b5670', false)
      box(ctx, v, x, z + 0.6, 0.18, 0, 0.3, 0.08, '#4b5670', false)
      box(ctx, v, x, z, 0.22, 0.3, 0.42, 1.5, t.dark ? '#5a3b2a' : '#c98a4c')
      box(ctx, v, x + (e.lane < 0 ? 0.2 : -0.2), z, 0.03, 0.42, 0.78, 1.5, t.dark ? '#4a2f22' : '#b57a3f', false)
      break
    case 'cooler': {
      // water cooler: dark base, blue bottle, little cup stack
      groundShadow(ctx, v, x, z, 0.26, 0.24)
      box(ctx, v, x, z, 0.17, 0, 0.9, 0.34, '#e9eef6')
      box(ctx, v, x, z, 0.18, 0.86, 0.94, 0.36, '#4b5670', false)
      box(ctx, v, x, z, 0.14, 0.94, 1.36, 0.28, '#5fb3ff')
      box(ctx, v, x, z, 0.08, 1.36, 1.42, 0.16, '#2f80ff', false)
      box(ctx, v, x, z - 0.2, 0.05, 0.6, 0.72, 0.06, '#9aa4b5', false)
      break
    }
    case 'wallsign': {
      // A panel lying on the glass wall. Its text is drawn through an affine map of the panel's
      // near edge (the slight perspective taper over 3 units is ignored).
      const side = e.lane < 0 ? -1 : 1
      const wx = side * (WALL_X - 0.04)
      const zA = z - 1.5
      const zB = z + 1.5
      if (zA < -v.camD + Z_NEAR_OFFSET + 0.5) break
      project(v, wx, 3.35, zA, PA) // near top
      project(v, wx, 3.35, zB, PB) // far top
      project(v, wx, 2.25, zB, PC) // far bottom
      project(v, wx, 2.25, zA, PD) // near bottom
      quad(ctx, PA, PB, PC, PD)
      ctx.fillStyle = e.variant === 0 ? '#0d3b8c' : t.accent
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = Math.max(1, 0.012 * PA.s)
      ctx.stroke()
      if (PB.s < 9) break
      {
        // Unit space 300 × 110 laid over the panel: its x axis runs along the panel's centre line
        // (left → right on screen), its y axis is the average of the two vertical edges.
        const nx = (PA.x + PD.x) / 2
        const ny = (PA.y + PD.y) / 2
        const fx = (PB.x + PC.x) / 2
        const fy = (PB.y + PC.y) / 2
        const ux = ((fx - nx) * -side) / 300
        const uy = ((fy - ny) * -side) / 300
        const vx = (PD.x - PA.x + PC.x - PB.x) / 2 / 110
        const vy = (PD.y - PA.y + PC.y - PB.y) / 2 / 110
        const ox = (nx + fx) / 2 - ux * 150 - vx * 55
        const oy = (ny + fy) / 2 - uy * 150 - vy * 55
        ctx.save()
        ctx.transform(ux, uy, vx, vy, ox, oy)
      }
      if (e.variant === 0) {
        label(ctx, 'Hansab', 150, 50, 66, '#ffffff', DISPLAY, 800)
        ctx.fillStyle = '#5fd0ff'
        ctx.fillRect(60, 86, 180, 5)
      } else {
        label(ctx, 'SMART BUILDINGS', 150, 40, 30, '#ffffff')
        label(ctx, 'SAFE PEOPLE', 150, 74, 30, 'rgba(255,255,255,0.88)')
      }
      ctx.restore()
      break
    }
    default:
      break
  }
}

/* ------------------------------------------------------------------------------------ */
/* Scene                                                                                 */
/* ------------------------------------------------------------------------------------ */

const WALL_DECOR = new Set<string>(['pillar', 'plant', 'bench', 'cooler', 'wallsign'])

export interface SceneInput {
  /** Entities sorted by track distance ascending (near → far); drawn back to front. */
  entities: Entity[]
  dist: number
  player: PlayerView
  rows: RowContext
  /** Draw the player at all (hidden inside the elevator during the transition). */
  showPlayer: boolean
}

/** Signs of a farther gate row fade while the nearer one is still ahead, so only one row reads. */
function rowFadeFor(z: number, nearRow: number): number {
  if (z <= nearRow + 1) return 1
  return 1 - 0.8 * clamp((nearRow - 1) / 4, 0, 1) * clamp((z - nearRow - 3) / 6, 0, 1)
}

export function drawScene(ctx: Ctx, v: View, sc: SceneInput) {
  const time = v.time
  overheadFade = 2.4 + Math.max(0, v.camH - 1.9) * 1.5
  drawBackdrop(ctx, v)
  drawOutside(ctx, v, sc.dist)
  drawFloor(ctx, v, sc.dist)
  drawHotSpot(ctx, v, sc.player)
  drawCeiling(ctx, v, sc.dist)
  drawWalls(ctx, v, sc.dist)
  // soft haze at the far end
  const g = gradients(ctx, v)
  const hr = hazeRadius(v)
  ctx.fillStyle = g.haze!
  ctx.fillRect(v.cx - hr, v.horizon - hr, hr * 2, hr * 2)
  const zNear = -v.camD + Z_NEAR_OFFSET
  const list = sc.entities
  // the nearest unresolved gate row keeps its signs; farther rows fade
  let nearRow = Number.POSITIVE_INFINITY
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if ((e.kind === 'gate' || e.kind === 'pin') && !e.done) {
      const z = e.d - sc.dist
      if (z > -0.5) {
        nearRow = z
        break
      }
    }
  }
  // floor-level cones first so sprites stand on them
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    if (e.kind !== 'camera') continue
    const z = e.d - sc.dist
    if (z + e.depth / 2 < zNear || z - e.depth / 2 > Z_FAR) continue
    // far haze by the zone's near edge, near fade by its far edge: solid while the runner is inside
    fogA = Math.min(fogAlpha(Math.max(0, z - e.depth / 2)), fogAlpha(Math.min(0, z + e.depth / 2)))
    if (fogA <= 0) continue
    ctx.globalAlpha = fogA
    drawCameraCone(ctx, v, e, z, time)
  }
  let playerDrawn = !sc.showPlayer
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    const z = e.d - sc.dist
    if (!playerDrawn && z < sc.player.z) {
      fogA = 1
      rowFade = 1
      ctx.globalAlpha = 1
      drawPlayer(ctx, v, sc.player, time)
      playerDrawn = true
    }
    if (z < zNear || z > Z_FAR) continue
    // the wall camera hangs at the near edge of its zone; pillars and plants at the walls slide
    // off the sides of the screen, so they may stay solid a little longer than things in the lanes
    fogA = fogAlpha(e.kind === 'camera' ? z - e.depth / 2 : z < 0 && WALL_DECOR.has(e.kind) ? Math.min(0, z + 2.2) : z)
    if (fogA <= 0) continue
    rowFade = e.kind === 'gate' || e.kind === 'pin' ? rowFadeFor(z, nearRow) : 1
    ctx.globalAlpha = fogA
    drawEntity(ctx, v, e, z, sc.rows, time)
  }
  fogA = 1
  rowFade = 1
  ctx.globalAlpha = 1
  if (!playerDrawn) drawPlayer(ctx, v, sc.player, time)
}

function drawEntity(ctx: Ctx, v: View, e: Entity, z: number, rc: RowContext, time: number) {
  switch (e.kind) {
    case 'coin':
      drawCoin(ctx, v, e, z, time)
      break
    case 'badge':
      drawBadgePickup(ctx, v, e, z, time)
      break
    case 'note':
      drawNote(ctx, v, e, z, time)
      break
    case 'magnet':
      drawMagnet(ctx, v, e, z, time)
      break
    case 'shield':
      drawShieldPickup(ctx, v, e, z, time)
      break
    case 'person':
    case 'guard':
      drawPerson(ctx, v, e, z, time)
      break
    case 'robot':
      drawRobot(ctx, v, e, z, time)
      break
    case 'cart':
      drawCart(ctx, v, e, z)
      break
    case 'trolley':
      drawTrolley(ctx, v, e, z)
      break
    case 'barrier':
      drawBarrier(ctx, v, e, z)
      break
    case 'wetsign':
      drawWetSign(ctx, v, e, z)
      break
    case 'planter':
      drawPlanter(ctx, v, e, z, time)
      break
    case 'glass':
      drawGlass(ctx, v, e, z)
      break
    case 'gate':
    case 'pin':
      drawGateRow(ctx, v, e, z, rc, time)
      break
    case 'reception':
      drawReception(ctx, v, e, z, time)
      break
    case 'elevator':
      drawElevator(ctx, v, e, z, rc, time)
      break
    case 'camera':
      drawCameraDevice(ctx, v, e, z, time)
      break
    case 'pillar':
    case 'plant':
    case 'bench':
    case 'cooler':
    case 'wallsign':
      drawDecor(ctx, v, e, z, time)
      break
  }
}

/* ------------------------------------------------------------------------------------ */
/* Overlays                                                                              */
/* ------------------------------------------------------------------------------------ */

/** Darker corners so the bright corridor centre and the runner pop. */
export function drawVignette(ctx: Ctx, v: View) {
  const g = gradients(ctx, v)
  ctx.fillStyle = g.vignette!
  ctx.fillRect(-40, -40, v.width + 80, v.height + 80)
}

/** The badge card flying from the pickup into the HUD inventory. */
export function drawFlyingBadge(ctx: Ctx, x: number, y: number, size: number, badge: Badge, alpha: number) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = '#ffe678'
  ctx.globalAlpha = alpha * 0.3
  ctx.beginPath()
  ctx.arc(x, y, size * 0.9, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = alpha
  drawBadgeCard(ctx, x, y, size * 0.76, size, badge)
  ctx.restore()
}

/** "FLOOR 2/5" banner: slides in, holds, fades. */
export function banner(ctx: Ctx, width: number, height: number, title: string, sub: string, progress: number) {
  const a = progress < 0.1 ? progress / 0.1 : progress > 0.72 ? (1 - progress) / 0.28 : 1
  const slide = progress < 0.1 ? (1 - progress / 0.1) * -16 : 0
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, a))
  // on a landscape phone the band sits higher so it does not hide the far end of the corridor
  const y = height * (height < 480 ? 0.25 : 0.3) + slide
  const titleSize = Math.min(46, width * 0.1, height * 0.1)
  const subSize = Math.min(17, width * 0.038)
  ctx.fillStyle = 'rgba(13,59,140,0.6)'
  ctx.fillRect(0, y - titleSize * 0.7, width, titleSize * 0.7 + subSize * 2.6)
  ctx.fillStyle = '#5fd0ff'
  ctx.fillRect(0, y - titleSize * 0.7, width, 3)
  ctx.fillRect(0, y + subSize * 2.6 - 3, width, 3)
  ctx.font = `800 ${titleSize}px ${DISPLAY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(8,20,50,0.85)'
  ctx.strokeText(title, width / 2, y)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(title, width / 2, y)
  ctx.font = `800 ${subSize}px ${UI}`
  ctx.lineWidth = 4
  ctx.strokeText(sub, width / 2, y + titleSize * 0.52 + subSize * 0.6)
  ctx.fillStyle = '#ffd43b'
  ctx.fillText(sub, width / 2, y + titleSize * 0.52 + subSize * 0.6)
  ctx.restore()
}

/** Speed streaks radiating from the vanishing point at the edges of the screen while running fast. */
export function speedLines(ctx: Ctx, v: View, intensity: number) {
  if (intensity <= 0.02) return
  const maxR = Math.hypot(v.width, v.height) * 0.5
  ctx.save()
  ctx.lineCap = 'round'
  const n = 18
  for (let i = 0; i < n; i++) {
    // each streak flies outward along its own fixed direction; directions avoid the floor ahead
    const t = (v.time * (1.8 + hash(i + 40) * 1.5) + hash(i)) % 1
    const side = i % 2 ? 1 : -1
    const ang = (hash(i + 7) - 0.5) * 1.9
    const dx = Math.cos(ang) * side
    const dy = Math.sin(ang)
    const r0 = maxR * (0.42 + 0.58 * t)
    const len = maxR * 0.14 * (0.3 + t) * (0.6 + intensity)
    ctx.globalAlpha = 0.55 * intensity * Math.sin(t * Math.PI)
    ctx.strokeStyle = i % 3 === 0 ? '#bfe3ff' : '#ffffff'
    ctx.lineWidth = 1.5 + 1.5 * t
    ctx.beginPath()
    ctx.moveTo(v.cx + dx * r0, v.horizon + dy * r0)
    ctx.lineTo(v.cx + dx * (r0 + len), v.horizon + dy * (r0 + len))
    ctx.stroke()
  }
  ctx.restore()
}
