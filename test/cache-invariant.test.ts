import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheSim } from './cache-sim.js'
import { SessionStore } from '../src/sessions.js'
import { transformRequest } from '../src/pipeline.js'
import { loadConfig } from '../src/config.js'
import { estimateMessage } from '../src/tokens.js'
import { addExchange, addToolCall, mkRequest } from './helpers.js'
import type { Message } from '../src/types.js'

// Deterministic PRNG (mulberry32) — no Date.now/Math.random, reproducible failures.
function prng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('CORE INVARIANT: surgery never converts warm cache reads into writes unplanned', () => {
  it('over 20 random 40-turn sessions, writes occur only on first turn, post-surgery, or post-TTL-gap', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rnd = prng(seed)
      const root = mkdtempSync(join(tmpdir(), `scalpel-inv-${seed}-`))
      const cfg = { ...loadConfig({}), paths: { root, spillDir: join(root, 'spill'), sessionsDir: join(root, 's'), dbPath: join(root, 'db') } }
      const store = new SessionStore(cfg)
      const sim = new CacheSim(cfg.ttlMs)
      const m: Message[] = []
      addExchange(m, `task seed ${seed}`, 'starting')
      let now = 0
      let appliedBefore = 0
      let prevTransformed: Message[] | null = null
      for (let turn = 0; turn < 40; turn++) {
        // grow history randomly: file reads (some repeated), bash calls (some failing), chatter
        const r = rnd()
        if (r < 0.4) addToolCall(m, 'Read', { file_path: `/f${Math.floor(rnd() * 5)}.ts` }, 'F'.repeat(800 + Math.floor(rnd() * 4000)))
        else if (r < 0.7) addToolCall(m, 'Bash', { command: `cmd ${turn}` }, 'B'.repeat(500 + Math.floor(rnd() * 3000)), { isError: rnd() < 0.2 })
        else addExchange(m, `q${turn}`, `a${turn}`)
        const idleGap = rnd() < 0.1 ? cfg.ttlMs + 1000 : Math.floor(rnd() * 60_000)
        now += idleGap
        const res = transformRequest(mkRequest(m), store, cfg, now)
        const { writes } = sim.request(res.body.messages, now)
        const surgeryHappened = res.applied > appliedBefore
        const gapExpired = idleGap > cfg.ttlMs
        if (prevTransformed && !surgeryHappened && !gapExpired) {
          // THE invariant, exact and zero-tolerance: on a warm append-only turn, every
          // previously-sent transformed message is byte-identical (whole prior history is
          // read from cache) and cache writes are EXACTLY the genuinely-new suffix.
          const prev = prevTransformed.map(msg => JSON.stringify(msg))
          const curr = res.body.messages.map(msg => JSON.stringify(msg))
          expect(curr.length, `seed=${seed} turn=${turn}: history shrank`).toBeGreaterThanOrEqual(prev.length)
          for (let k = 0; k < prev.length; k++)
            expect(curr[k], `seed=${seed} turn=${turn}: message ${k} rewritten on warm cache`).toBe(prev[k])
          const newSuffixTokens = res.body.messages.slice(prev.length).reduce((s, msg) => s + estimateMessage(msg), 0)
          expect(writes, `seed=${seed} turn=${turn}: cache writes exceed the new suffix`).toBe(newSuffixTokens)
        }
        prevTransformed = res.body.messages
        appliedBefore = res.applied
      }
    }
  })
})
