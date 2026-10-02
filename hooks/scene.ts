// Context Aquarium: the context window as a tank. Every tool result drops in a fish sized by its tokens,
// coloured by its tool; the water murks and silt rises as the window fills toward compaction. Pure: no `$`.
import type { Fish } from '../types'

import { canvas, cells, clawd, CLAWD_W, GROUND, hash, mix, put, text, type Canvas, type Glyph } from './art'

export type Moment = {
  t: number
  fish: Fish[]
  percent: number | null  // the window's fill, 0..100, once a response reported one
  tokens: number | null
  window: number | null
  fedAt: number  // when the last fish dropped in (ms), for Clawd's sprinkle
  changes: number  // compactions this session: water changes
}

const GLASS = 0x4a5a68
const CLEAR = 0x0f2c3a
const MURK = 0x3a3820
const SILT = 0x5a4a2a
const MUTED = 0x8a8f9c
const AMBER = 0xe0a050
const STATS = 16  // columns kept for the figures at the right

export function colourOf(tool: string): number {
  if (tool === 'Read') return 0x6ab0e0
  if (tool === 'Grep' || tool === 'Glob') return 0xe0c060
  if (tool === 'Bash' || tool === 'PowerShell') return 0x70c080
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 0xe08a50
  if (tool === 'Agent' || tool === 'Task') return 0xb08ae0
  if (tool.startsWith('Web')) return 0x60d0d0
  if (tool.startsWith('mcp__')) return 0xe070a0
  return 0xa0a0b0
}

/** A fish's body length and height in pixels by its tokens. */
export function sizeOf(tokens: number): [number, number] {
  if (tokens < 300) return [2, 1]
  if (tokens < 2000) return [3, 1]
  if (tokens < 8000) return [4, 1]
  if (tokens < 20000) return [5, 2]
  return [7, 2]
}

export const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

function fish(c: Canvas, f: Fish, x0: number, x1: number, y0: number, y1: number, t: number, water: number) {
  const [len, tall] = sizeOf(f.tokens)
  const h = hash(f.id)
  const range = Math.max(1, x1 - x0 - len - 1)
  const speed = 0.004 + (h % 5) * 0.0012  // px per ms
  const phase = (t * speed + (h % 997)) % (2 * range)
  const right = phase < range
  const x = x0 + (right ? phase : 2 * range - phase)
  const bob = Math.round(Math.sin(t / 1100 + h) * 0.6)
  const y = Math.min(y1 - tall, Math.max(y0, y0 + ((h >>> 7) % Math.max(1, y1 - y0 - tall + 1)) + bob))
  const body = colourOf(f.tool)
  const fin = mix(body, water, 0.45)
  for (let j = 0; j < tall; j++) for (let i = 0; i < len; i++) put(c, x + i, y + j, body)
  const head = right ? x + len - 1 : x
  put(c, right ? x - 1 : x + len, y + (tall > 1 ? 0 : 0), fin)  // the tail
  if (tall > 1) put(c, right ? x - 1 : x + len, y + 1, fin)
  if (len >= 4) put(c, head, y, 0x101418)  // an eye on the bigger ones
}

export function frame(m: Moment, W: number): Uint32Array {
  const c = canvas(W)
  const glyphs: Glyph[] = []
  const pct = m.percent ?? 0
  const murk = smooth(55, 92, pct)
  const water = mix(CLEAR, MURK, murk)

  // the tank: glass, water, silt that rises with the fill
  const x0 = CLAWD_W + 3, x1 = W - STATS - 2, top = 2, bottom = GROUND - 1
  for (let y = top; y <= bottom; y++) for (let x = x0 + 1; x < x1; x++) put(c, x, y, water)
  const silt = Math.round((pct / 100) * 4)
  for (let x = x0 + 1; x < x1; x++) {
    const bump = (hash(String(x)) % 3 === 0 ? 1 : 0)
    for (let k = 0; k < Math.min(5, silt + (silt ? bump : 0)); k++) put(c, x, bottom - k, mix(SILT, water, 0.15 + k * 0.12))
  }
  for (let y = top; y <= GROUND; y++) { put(c, x0, y, GLASS); put(c, x1, y, GLASS) }
  for (let x = x0; x <= x1; x++) put(c, x, GROUND, GLASS)
  // weed, and bubbles rising from the left corner
  for (let k = 0; k < 4; k++) put(c, x0 + 3 + (Math.floor(m.t / 700 + k) % 2), bottom - k, mix(0x4a8a4a, water, 0.3))
  for (let k = 0; k < 3; k++) {
    const rise = ((m.t / 160) + k * 4) % (bottom - top)
    put(c, x0 + 6 + (k % 2), bottom - rise, mix(water, 0xc8e0f0, 0.45))
  }

  // the fish, newest last (drawn on top); the biggest one carries its label
  const room = Math.max(4, Math.floor(((x1 - x0) * (bottom - top - silt)) / 22))
  const school = m.fish.slice(-room)
  let big: Fish | null = null
  for (const f of school) {
    fish(c, f, x0 + 2, x1 - 1, top + 1, bottom - silt, m.t, water)
    if (!big || f.tokens > big.tokens) big = f
  }
  if (big && big.tokens >= 1000) text(glyphs, x0 + 1, 0, `biggest: ${big.label} ${short(big.tokens)}`, mix(colourOf(big.tool), 0xffffff, 0.35))
  if (!m.fish.length) text(glyphs, x0 + 3, 3, 'an empty tank: each tool result drops in a fish', MUTED)

  // Clawd beside the tank: sprinkles food as a result drops in
  const fed = m.t - m.fedAt < 1400
  const [hx, hy] = clawd(c, m.t, fed ? 'sprinkle' : 'stand', 1, 1)
  if (fed) for (let k = 0; k < 3; k++) put(c, hx + 1 + k, hy + 1 + ((Math.floor(m.t / 120) + k) % 3), 0xd8c890)

  // the figures
  const sx = W - STATS + 1
  const warn = pct >= 80
  text(glyphs, sx, 0, 'context', MUTED)
  text(glyphs, sx, 1, m.percent === null ? 'waiting...' : `${Math.round(pct)}% full`, warn ? AMBER : 0xc8ccd8)
  if (m.tokens !== null && m.window) text(glyphs, sx, 2, `${short(m.tokens)} of ${short(m.window)}`, MUTED)
  text(glyphs, sx, 4, `${m.fish.length} fish`, MUTED)
  if (m.changes) text(glyphs, sx, 5, `${m.changes} water change${m.changes > 1 ? 's' : ''}`, MUTED)
  if (warn) text(glyphs, sx, 7, 'murky: /compact', AMBER)
  return cells(c, glyphs)
}
