import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { benchFile } from '../src/bench.js'
import { loadConfig } from '../src/config.js'

function makeCfg() {
  const root = mkdtempSync(join(tmpdir(), 'scalpel-bench-'))
  return { ...loadConfig({}), paths: { root, spillDir: join(root, 'spill'), sessionsDir: join(root, 's'), dbPath: join(root, 'db') } }
}

describe('bench', () => {
  it('replays a session JSONL and reports counterfactual savings', () => {
    const r = benchFile('test/fixtures/synthetic-session.jsonl', makeCfg())
    expect(r.requests).toBeGreaterThan(10)
    expect(r.baselineWeighted).toBeGreaterThan(0)
    expect(r.scalpelWeighted).toBeGreaterThan(0)
    expect(r.scalpelWeighted).toBeLessThan(r.baselineWeighted) // superseded read + failed bash get pruned
    expect(r.savedPct).toBeGreaterThan(0)
  })

  it('counts invalid JSON lines as parseErrors without silently swallowing them', () => {
    const root = mkdtempSync(join(tmpdir(), 'scalpel-bench-parse-'))
    const cfg = makeCfg()
    // A valid session with two assistant turns, interspersed with bad lines
    const lines = [
      '{"timestamp":"2026-01-01T00:00:00Z","type":"user","message":{"role":"user","content":"hello"}}',
      'NOT_VALID_JSON',
      '{"timestamp":"2026-01-01T00:01:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
      '{broken',
      '{"timestamp":"2026-01-01T00:02:00Z","type":"user","message":{"role":"user","content":"follow up"}}',
      '{"timestamp":"2026-01-01T00:03:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"sure"}]}}',
    ]
    const fixturePath = join(root, 'parse-errors.jsonl')
    writeFileSync(fixturePath, lines.join('\n'))
    const r = benchFile(fixturePath, cfg)
    expect(r.parseErrors).toBe(2) // two bad lines: 'NOT_VALID_JSON' and '{broken'
    expect(r.requests).toBe(2)    // two valid assistant turns
  })
})
