/** One tool result in the main conversation: its tool, a short label and its estimated tokens. */
export type Fish = { id: string; tool: string; label: string; tokens: number }

/** The window's fill as session.measure last reported it. */
export type Fill = { percent: number | null; tokens: number | null; window: number | null }

declare module 'claude-code' {
  interface PluginState {
    'context-aquarium': {
      isShown: boolean
      fish: Fish[]
      fill: Fill
      fedAt: number
      changes: number
    }
  }
}
