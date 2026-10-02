// Pixel art for the band, after clawd-spinner's acts.ts: an 8-row Raster, each cell two pixels stacked (▀).
// Pure: no `$` here.

export const ROWS = 8
export const PH = ROWS * 2
export const DEF = 0x01000000  // the terminal's own colour: transparent
export const GROUND = PH - 1

export type Canvas = { W: number; px: Uint32Array }
export type Glyph = { x: number; row: number; ch: string; fg: number }

export const canvas = (W: number): Canvas => ({ W, px: new Uint32Array(W * PH).fill(DEF) })

export function put(c: Canvas, x: number, y: number, colour: number) {
  x = Math.round(x)
  y = Math.round(y)
  if (x >= 0 && x < c.W && y >= 0 && y < PH) c.px[y * c.W + x] = colour
}

export const get = (c: Canvas, x: number, y: number) => (x >= 0 && x < c.W && y >= 0 && y < PH ? c.px[y * c.W + x]! : DEF)

export function rect(c: Canvas, x: number, y: number, w: number, h: number, colour: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(c, x + i, y + j, colour)
}

/** A stable random number in [0, 1) for the same inputs. */
export function rnd(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

export const hash = (s: string) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0

export const mix = (a: number, b: number, k: number) => {
  k = Math.min(1, Math.max(0, k))
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k) << s
  return ch(16) | ch(8) | ch(0)
}

export const wave = (t: number, period: number, phase = 0) => (Math.sin((t / period) * Math.PI * 2 + phase) + 1) / 2

export function text(glyphs: Glyph[], x: number, row: number, s: string, fg: number) {
  ;[...s].forEach((ch, i) => glyphs.push({ x: x + i, row, ch, fg }))
}

// ------------------------------------------------------------------ Clawd

export const CLAWD = 0xd97757
const CLAWD_ART = [
  '..CCCCCCCCCC..',
  '..CCECCCCECC..',
  '..CCECCCCECC..',
  '..CCCCCCCCCC..',
  '..CCCCCCCCCC..',
]
const LEGS = ['..C.C....C.C..', '...C.C..C.C...']
export const CLAWD_W = 14
export const CLAWD_TOP = GROUND - CLAWD_ART.length - 1

export type Pose = 'stand' | 'walk' | 'type' | 'water' | 'sprinkle' | 'yawn' | 'sip'

/** Clawd at x, facing right (1) or left (-1), lifted `lift` pixels. Returns the hand's pixel. */
export function clawd(c: Canvas, t: number, pose: Pose, x: number, facing: 1 | -1 = 1, lift = 0): [number, number] {
  const f = Math.floor(t / 83)
  const sleepy = pose === 'yawn'
  const blink = f % 47 < 2 || (sleepy && f % 30 < 12)
  const ox = Math.round(x)
  const breathe = pose === 'stand' && Math.floor(t / 700) % 2 ? 1 : 0
  const y = CLAWD_TOP + breathe - lift
  const at = (i: number) => (facing > 0 ? ox + i : ox + 13 - i)
  const P = (i: number, yy: number, colour: number) => put(c, at(i), yy, colour)
  const shade = mix(CLAWD, 0x000000, 0.18)
  const eye = 0x1a1410
  CLAWD_ART.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === 'C') P(i, y + j, CLAWD)
    // half-shut eyes when sleepy: only the lower eye pixel stays dark
    if (ch === 'E') P(i, y + j, blink || (sleepy && j === 1) ? CLAWD : eye)
  }))
  for (let i = 2; i < 12; i++) P(i, y + 4, shade)
  const stepping = pose === 'walk' || pose === 'water'
  ;[...LEGS[stepping ? (f >> 1) % 2 : 0]!].forEach((ch, i) => ch === 'C' && P(i, CLAWD_TOP + CLAWD_ART.length - lift, shade))
  const armY = y + 2
  let left: [number, number][] = [[1, armY], [0, armY]]
  let right: [number, number][] = [[12, armY], [13, armY]]
  if (pose === 'type') right = [[12, armY + 1], [13, armY + (f % 3 === 0 ? 1 : 2)]]
  if (pose === 'type') left = [[1, armY + 1], [0, armY + (f % 3 === 1 ? 1 : 2)]]
  if (pose === 'water' || pose === 'sip') right = [[12, armY], [13, armY], [14, armY]]
  if (pose === 'sprinkle') right = [[12, armY - 1], [13, armY - 2], [14, armY - 2]]
  if (pose === 'yawn') left = [[1, armY - 1], [0, armY - 2]]
  for (const [i, yy] of [...left, ...right]) P(i, yy, CLAWD)
  const [hi, hy] = right[right.length - 1]!
  return [at(hi), hy]
}

// ------------------------------------------------------------------ walking routes

export const WALK = 0.016  // pixels per ms

export type Stop = { x: number; stay: number; pose: Pose }
export type Where = { x: number; facing: 1 | -1; pose: Pose; stop: number; still: boolean }

/** Clawd's place on a looping route: stands at each stop for `stay` ms, walks between them. */
export function along(stops: Stop[], ms: number, walkPose: Pose = 'walk'): Where {
  const legs = stops.map((s, i) => {
    const next = stops[(i + 1) % stops.length]!
    return { s, next, walk: Math.abs(next.x - s.x) / WALK }
  })
  const total = legs.reduce((sum, l) => sum + l.s.stay + l.walk, 0) || 1
  let t = ms % total
  for (const [i, l] of legs.entries()) {
    if (t < l.s.stay) return { x: l.s.x, facing: 1, pose: l.s.pose, stop: i, still: true }
    t -= l.s.stay
    if (t < l.walk) return { x: l.s.x + (l.next.x - l.s.x) * (t / l.walk), facing: l.next.x >= l.s.x ? 1 : -1, pose: walkPose, stop: i, still: false }
    t -= l.walk
  }
  return { x: stops[0]!.x, facing: 1, pose: stops[0]!.pose, stop: 0, still: true }
}

// ------------------------------------------------------------------ cells

/** The canvas as Raster cells: columns * ROWS triplets of [codePoint, fg, bg]; glyphs on top. */
export function cells(c: Canvas, glyphs: Glyph[]): Uint32Array {
  const W = c.W
  const out = new Uint32Array(W * ROWS * 3)
  for (let r = 0; r < ROWS; r++) {
    for (let x = 0; x < W; x++) {
      const top = c.px[2 * r * W + x]!
      const bot = c.px[(2 * r + 1) * W + x]!
      const i = (r * W + x) * 3
      if (top === DEF && bot === DEF) out.set([0x20, DEF, DEF], i)
      else if (top === bot) out.set([0x2588, top, DEF], i)
      else if (top === DEF) out.set([0x2584, bot, DEF], i)
      else if (bot === DEF) out.set([0x2580, top, DEF], i)
      else out.set([0x2580, top, bot], i)
    }
  }
  for (const g of glyphs) {
    if (g.x < 0 || g.x >= W || g.row < 0 || g.row >= ROWS) continue
    const i = (g.row * W + g.x) * 3
    const top = c.px[2 * g.row * W + g.x]!
    const bot = c.px[(2 * g.row + 1) * W + g.x]!
    // A glyph sits on an empty cell, or on a cell of one colour (that colour its background).
    if (top === DEF && bot === DEF) out.set([g.ch.codePointAt(0)!, g.fg, DEF], i)
    else if (top === bot) out.set([g.ch.codePointAt(0)!, g.fg, top], i)
  }
  return out
}

/** Base64 of the cells, as RasterProps.cells wants them. */
export const encode = (cs: Uint32Array): string => new Uint8Array(cs.buffer).toBase64()
