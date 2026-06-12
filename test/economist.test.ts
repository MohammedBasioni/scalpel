import { describe, expect, it } from 'vitest'
import { decide, isDoomed } from '../src/economist.js'
import { loadConfig } from '../src/config.js'
import type { CacheState, CandidateSpan, SessionStats } from '../src/types.js'

const cfg = loadConfig({})
const warm: CacheState = { idleMs: 1000, modelChanged: false, systemChanged: false, toolsChanged: false }
const span = (i: number, est: number, kind: CandidateSpan['kind'] = 'superseded-read'): CandidateSpan =>
  ({ toolUseId: `toolu_${i}`, messageIndex: i, kind, estTokens: est, reason: 'test' })
// 60 messages of 1000 tokens each
const stats: SessionStats = { turnsSoFar: 30, msgTokens: Array(60).fill(1000) }

describe('doom detection', () => {
  it('doomed on TTL expiry, model/system/tools change; warm otherwise', () => {
    expect(isDoomed(warm, cfg)).toBe(false)
    expect(isDoomed({ ...warm, idleMs: cfg.ttlMs + 1 }, cfg)).toBe(true)
    expect(isDoomed({ ...warm, modelChanged: true }, cfg)).toBe(true)
    expect(isDoomed({ ...warm, systemChanged: true }, cfg)).toBe(true)
    expect(isDoomed({ ...warm, toolsChanged: true }, cfg)).toBe(true)
  })
})

describe('decide', () => {
  it('doomed moment → commit all tier-eligible candidates (free surgery)', () => {
    const c = [span(5, 5000), span(10, 800, 'stale-large-result')]
    const plan = decide(c, { ...warm, idleMs: cfg.ttlMs + 1 }, stats, cfg)
    expect(plan).toHaveLength(2)
  })
  it('tier 1 never operates on a warm cache and excludes tier-2 kinds even when doomed', () => {
    const t1 = loadConfig({ tier: 1 })
    const doomed = { ...warm, idleMs: t1.ttlMs + 1 }
    expect(decide([span(5, 50_000)], warm, stats, t1)).toEqual([])
    expect(decide([span(5, 5000, 'stale-large-result')], doomed, stats, t1)).toEqual([])
    expect(decide([span(5, 5000)], doomed, stats, t1)).toHaveLength(1)
  })
  it('tier 2 warm cache: operates only when savings ≥ safetyMargin × suffix rewrite cost', () => {
    // Huge prunable span late in history → tiny suffix to rewrite → economics clearly positive
    const winner = decide([span(55, 40_000)], warm, stats, cfg)
    expect(winner).toHaveLength(1)
    // Small span early in history → whole 60k-token suffix rewritten for 300 tokens → no
    const loser = decide([span(2, 300)], warm, stats, cfg)
    expect(loser).toEqual([])
  })
})
