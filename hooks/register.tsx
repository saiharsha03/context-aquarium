import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fill, Fish } from '../types'

import { encode, ROWS } from './art'
import { frame, type Moment } from './scene'

const FRAME_MS = 125
const KEEP = 400  // fish kept in state; the tank shows the newest that fit
const isShown = atom({ plugin: 'context-aquarium', key: 'isShown' } as const, false)
const fish = atom({ plugin: 'context-aquarium', key: 'fish' } as const, [] as Fish[])
const fill = atom({ plugin: 'context-aquarium', key: 'fill' } as const, { percent: null, tokens: null, window: null } as Fill)
const fedAt = atom({ plugin: 'context-aquarium', key: 'fedAt' } as const, 0)
const changes = atom({ plugin: 'context-aquarium', key: 'changes' } as const, 0)

const base = (p: string) => p.split(/[\\/]/).pop() ?? p

/** The fish's label: the tool, and the file it read when it names one. */
function labelFor(tool: string, input: Record<string, unknown>): string {
  const name = tool.startsWith('mcp__') ? tool.split('__').pop() ?? tool : tool
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' ? `${name} ${base(path).slice(0, 14)}` : name
}

const anim = { mount: null as { requestId: string; columns: number } | null, moment: null as Omit<Moment, 't'> | null, last: '', retryAt: 0 }

async function paint($: EngineInterface) {
  const m = anim.mount
  if (!m || !anim.moment) return
  const now = await $.clock.now()
  const cells = encode(frame({ ...anim.moment, t: now }, m.columns))
  if (cells === anim.last) return
  anim.last = cells
  const r = await $.ui.blit({ requestId: m.requestId, key: 'tank', cells })
  if ('deny' in r && r.deny) {
    anim.mount = null
    if (now - anim.retryAt > 2000) {
      anim.retryAt = now
      $.ui.invalidate('ui.render')
    }
  }
}

export const register: Register = hook => {
  hook('session.start', async ($, e, next) => {
    await $.command.register({ name: 'context-aquarium', description: 'Context Aquarium: toggle the context window as a fish tank above the prompt' })
    if ((await $.store.get('isShown')) === true) await update($, isShown, () => true)
    const { context } = await $.session.usage()
    await update($, fill, () => ({ percent: context.percent ?? null, tokens: context.tokens ?? null, window: context.window }))
    if (e.isInteractive) $.clock.every(FRAME_MS, () => void paint($))
    return next(e)
  })

  // Each result the main conversation reads drops in a fish: its text's length / 4, as tokens.
  hook('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId || ran.deny !== undefined) return ran
    const one: Fish = {
      id: e.tool_use_id ?? String(await $.clock.now()),
      tool: String(e.tool),
      label: labelFor(String(e.tool), e as unknown as Record<string, unknown>),
      tokens: Math.ceil((ran.text?.length ?? 0) / 4),
    }
    await update($, fish, all => [...all, one].slice(-KEEP))
    const now = await $.clock.now()
    await update($, fedAt, () => now)
    return ran
  })

  hook('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      const { percent, tokens, window } = e.context
      await update($, fill, () => ({ percent: percent ?? null, tokens: tokens ?? null, window }))
    }
    return next(e)
  })

  // A compaction that stands is a water change: the tank empties.
  hook('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId || e.trigger === 'precompute' || 'skip' in done) return done
    await update($, fish, () => [])
    await update($, changes, n => n + 1)
    return done
  })

  hook('command.run', { command: 'context-aquarium' }, async ($, e) => {
    const shown = !(await read($, isShown))
    await update($, isShown, () => shown)
    await $.store.set('isShown', shown)
    if (!shown) return { text: 'Context Aquarium is hidden.' }
    const f = await read($, fill)
    return { text: `Context Aquarium is open: ${(await read($, fish)).length} fish${f.percent === null ? '' : `, the window ${Math.round(f.percent)}% full`}.` }
  })

  hook('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, isShown)
    const columns = e.props.bodyColumns - 2
    if (!shown || e.surface !== 'terminal' || e.props.hasSurvey || e.props.maxRows < ROWS || columns < 60) {
      anim.mount = null
      return next(e)
    }
    const { Raster } = $.ui.resolve(e)
    const f = await read($, fill)
    anim.moment = { fish: await read($, fish), ...f, fedAt: await read($, fedAt), changes: await read($, changes) }
    anim.mount = { requestId: e.requestId, columns }
    const cells = encode(frame({ ...anim.moment, t: await $.clock.now() }, columns))
    anim.last = cells
    return <Raster key="tank" columns={columns} rows={ROWS} cells={cells} />
  })
}
