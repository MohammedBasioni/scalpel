import { describe, expect, it } from 'vitest'
import { loadConfig, TIER_KINDS } from '../src/config.js'

describe('config', () => {
  it('defaults to tier 2, 1h TTL, subscription weights (1h-TTL write price)', () => {
    const cfg = loadConfig({})
    expect(cfg.tier).toBe(2)
    expect(cfg.ttlMs).toBe(3_600_000)
    expect(cfg.weights).toEqual({ read: 0.1, write: 2.0, output: 5 })
  })
  it('rejects tier 3 (v1 has no summarization)', () => {
    expect(() => loadConfig({ tier: 3 })).toThrow(/tier 3/i)
  })
  it('tier 1 kinds exclude stale-large-result and dead-snapshot', () => {
    expect(TIER_KINDS[1]).toEqual(['superseded-read', 'duplicate-result', 'failed-command'])
    expect(TIER_KINDS[2]).toContain('stale-large-result')
    expect(TIER_KINDS[2]).toContain('dead-snapshot')
  })
  it('merges weight overrides with defaults', () => {
    const cfg = loadConfig({ weights: { read: 0.5 } })
    expect(cfg.weights).toEqual({ read: 0.5, write: 2.0, output: 5 })
  })
})
