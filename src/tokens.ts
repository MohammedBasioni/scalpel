import type { ContentBlock, Message } from './types.js'

export function estimateText(s: string): number {
  return Math.ceil(s.length / 3.5)
}
export function estimateBlock(b: ContentBlock): number {
  return estimateText(JSON.stringify(b))
}
export function estimateMessage(m: Message): number {
  if (typeof m.content === 'string') return estimateText(m.content)
  return m.content.reduce((sum, b) => sum + estimateBlock(b), 0)
}

/** EMA calibration of the chars/3.5 heuristic against actual usage deltas. */
export class Calibration {
  factor = 1
  private readonly alpha = 0.2
  update(estimated: number, actual: number): void {
    if (estimated <= 0 || actual <= 0) return
    const observed = actual / estimated
    this.factor = this.factor * (1 - this.alpha) + observed * this.alpha
  }
}
