import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from '../src/sessions.js'
import { transformRequest } from '../src/pipeline.js'
import { loadConfig, type ScalpelConfig } from '../src/config.js'
import { addToolCall, mkRequest, pad, toolResultBlocks } from './helpers.js'
import type { Message, ToolResultBlock } from '../src/types.js'

let cfg: ScalpelConfig
let store: SessionStore
beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'scalpel-pipe-'))
  cfg = { ...loadConfig({}), paths: { root, spillDir: join(root, 'spill'), sessionsDir: join(root, 'sessions'), dbPath: join(root, 'savings.db') } }
  store = new SessionStore(cfg)
})

const bigSession = () => {
  const m: Message[] = []
  const old = addToolCall(m, 'Read', { file_path: '/a.ts' }, 'OLD'.repeat(3000))
  pad(m, 6)
  addToolCall(m, 'Read', { file_path: '/a.ts' }, 'NEW'.repeat(3000))
  pad(m, 6)
  return { m, old }
}

describe('pipeline', () => {
  it('turn 1 establishes the session; idle past TTL → doomed → surgery commits and stubs apply', () => {
    const { m, old } = bigSession()
    const t0 = 1_000_000
    const r1 = transformRequest(mkRequest(m), store, cfg, t0)
    expect(r1.savedTokens).toBe(0) // first sighting: cache state unknown → conservative no-op
    pad(m, 1)
    const r2 = transformRequest(mkRequest(m), store, cfg, t0 + cfg.ttlMs + 60_000)
    expect(r2.savedTokens).toBeGreaterThan(1000)
    const stub = toolResultBlocks(r2.body.messages[1])[0] as ToolResultBlock
    expect(String(stub.content)).toContain('scalpel')
    expect(String(stub.content)).toContain('superseded-read')
    expect(stub.tool_use_id).toBe(old)
  })
  it('replay is stable: the next warm turn re-applies the same stubs byte-identically', () => {
    const { m } = bigSession()
    transformRequest(mkRequest(m), store, cfg, 0)
    pad(m, 1)
    const r2 = transformRequest(mkRequest(m), store, cfg, cfg.ttlMs + 60_000)
    pad(m, 1)
    const r3 = transformRequest(mkRequest(m), store, cfg, cfg.ttlMs + 120_000)
    const p2 = JSON.stringify(r2.body.messages.slice(0, r2.body.messages.length))
    const p3 = JSON.stringify(r3.body.messages.slice(0, r2.body.messages.length))
    expect(p3).toBe(p2)
  })
  it('fail-open: a malformed request passes through untouched', () => {
    const req = { model: 'x', messages: 'garbage' } as never
    const out = transformRequest(req, store, cfg, 0)
    expect(out.body).toBe(req)
    expect(out.savedTokens).toBe(0)
  })
  it('spilled originals land on disk and stubs reference them', () => {
    const { m } = bigSession()
    transformRequest(mkRequest(m), store, cfg, 0)
    pad(m, 1)
    const r2 = transformRequest(mkRequest(m), store, cfg, cfg.ttlMs + 60_000)
    const stub = String((toolResultBlocks(r2.body.messages[1])[0] as ToolResultBlock).content)
    const path = stub.match(/stored at (\S+) —/)?.[1]
    expect(path).toBeTruthy()
    expect(readFileSync(path!, 'utf8')).toContain('OLD')
  })
})
