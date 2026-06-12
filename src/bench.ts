import { readFileSync, statSync } from 'node:fs'
import { SessionStore } from './sessions.js'
import { transformRequest } from './pipeline.js'
import { estimateMessage } from './tokens.js'
import type { ScalpelConfig } from './config.js'
import type { Message } from './types.js'

export interface BenchResult {
  requests: number
  baselineWeighted: number
  scalpelWeighted: number
  savedPct: number
  parseErrors: number
  /** true when the file was skipped because it exceeded OVERSIZED_BYTES or OVERSIZED_LINES */
  oversized?: boolean
}

/** Same prefix-cache model as test/cache-sim.ts, duplicated in src so bench ships in dist. */
export class CacheModel {
  private prev: string[] = []
  private lastAt = -Infinity
  // Memoize per-message JSON stringify and estimateMessage using WeakMap so
  // unchanged message objects (history is append-only) are never re-serialised.
  private readonly jsonCache = new WeakMap<object, string>()
  private readonly tokenCache = new WeakMap<object, number>()

  constructor(private ttlMs: number) {}

  private msgJson(m: Message): string {
    let v = this.jsonCache.get(m)
    if (v === undefined) { v = JSON.stringify(m); this.jsonCache.set(m, v) }
    return v
  }

  private msgTokens(m: Message): number {
    let v = this.tokenCache.get(m)
    if (v === undefined) { v = estimateMessage(m); this.tokenCache.set(m, v) }
    return v
  }

  request(messages: Message[], now: number): { reads: number; writes: number } {
    const hashes = messages.map(m => this.msgJson(m))
    const tokens = messages.map(m => this.msgTokens(m))
    let common = 0
    if (now - this.lastAt <= this.ttlMs)
      while (common < hashes.length && common < this.prev.length && hashes[common] === this.prev[common]) common++
    this.prev = hashes; this.lastAt = now
    return {
      reads: tokens.slice(0, common).reduce((a, b) => a + b, 0),
      writes: tokens.slice(common).reduce((a, b) => a + b, 0),
    }
  }
}

/** Maximum file size (bytes) and message-line count before a session is skipped as oversized. */
export const OVERSIZED_BYTES = 20 * 1024 * 1024  // 20 MB
export const OVERSIZED_LINES = 6000

export function benchFile(path: string, cfg: ScalpelConfig): BenchResult {
  // Oversized guard: skip files that are too large to process safely
  const stat = statSync(path)
  if (stat.size > OVERSIZED_BYTES) {
    return { requests: 0, baselineWeighted: 0, scalpelWeighted: 0, savedPct: 0, parseErrors: 0, oversized: true }
  }

  const W = cfg.weights
  const base = new CacheModel(cfg.ttlMs)
  const scalp = new CacheModel(cfg.ttlMs)
  const store = new SessionStore(cfg)
  let baseline = 0, scalpel = 0, n = 0, parseErrors = 0
  const history: Message[] = []
  let messageLineCount = 0

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let rec: { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } }
    try { rec = JSON.parse(line) } catch { parseErrors++; continue }
    const msg = rec.message
    if (!msg?.role || (rec.type !== 'user' && rec.type !== 'assistant')) continue
    messageLineCount++
    if (messageLineCount > OVERSIZED_LINES) {
      // Oversized: return what we have so far with a sentinel that tells the caller to skip
      return { requests: 0, baselineWeighted: 0, scalpelWeighted: 0, savedPct: 0, parseErrors, oversized: true }
    }

    if (rec.type === 'assistant') {
      // Process this request inline using the CURRENT history (no cloning needed:
      // applyLog/buildCandidates/transformRequest never mutate their input arrays)
      if (history.length > 0) {
        n++
        const now = Date.parse(rec.timestamp ?? '0')
        const b = base.request(history, now)
        baseline += b.reads * W.read + b.writes * W.write
        const t = transformRequest({ model: 'bench', messages: history, stream: false }, store, cfg, now)
        const s = scalp.request(t.body.messages, now)
        scalpel += s.reads * W.read + s.writes * W.write
      }
    }

    // Append message to history AFTER processing (history represents state before this response)
    history.push({ role: msg.role as 'user' | 'assistant', content: msg.content as Message['content'] })
  }

  return {
    requests: n, baselineWeighted: Math.round(baseline), scalpelWeighted: Math.round(scalpel),
    savedPct: baseline > 0 ? Math.round((1000 * (baseline - scalpel)) / baseline) / 10 : 0,
    parseErrors,
  }
}
