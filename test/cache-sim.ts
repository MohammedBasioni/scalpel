import { createHash } from 'node:crypto'
import { estimateMessage } from '../src/tokens.js'
import type { Message } from '../src/types.js'

/**
 * Minimal model of Anthropic prefix caching: longest common message-prefix with the
 * previous request is read from cache (if within TTL); the remainder is written.
 */
export class CacheSim {
  private prevHashes: string[] = []
  private prevTokens: number[] = []
  private lastAt = -Infinity
  constructor(private readonly ttlMs: number) {}
  request(messages: Message[], now: number): { reads: number; writes: number } {
    const hashes = messages.map(m => createHash('sha256').update(JSON.stringify(m)).digest('hex'))
    const tokens = messages.map(estimateMessage)
    let common = 0
    if (now - this.lastAt <= this.ttlMs)
      while (common < hashes.length && common < this.prevHashes.length && hashes[common] === this.prevHashes[common]) common++
    const reads = tokens.slice(0, common).reduce((a, b) => a + b, 0)
    const writes = tokens.slice(common).reduce((a, b) => a + b, 0)
    this.prevHashes = hashes; this.prevTokens = tokens; this.lastAt = now
    return { reads, writes }
  }
}
