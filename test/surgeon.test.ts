import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SurgeryLog } from '../src/surgeon/log.js'
import { applyLog } from '../src/surgeon/apply.js'
import { stubText } from '../src/surgeon/spill.js'
import { addToolCall, pad, toolResultBlocks } from './helpers.js'
import type { Message, SurgeryLogEntry, ToolResultBlock } from '../src/types.js'

const entry = (toolUseId: string): SurgeryLogEntry => ({
  toolUseId, kind: 'superseded-read', estTokens: 500, spillPath: '/tmp/spill/abc.txt',
  turn: 3, ts: '2026-06-11T00:00:00Z',
})

describe('applyLog', () => {
  it('stubs only the targeted tool_result content, preserving block structure and cache_control', () => {
    const m: Message[] = []
    const id = addToolCall(m, 'Read', { file_path: '/a.ts' }, 'ORIGINAL'.repeat(100))
    ;(toolResultBlocks(m[m.length - 1])[0] as ToolResultBlock).cache_control = { type: 'ephemeral' }
    pad(m, 2)
    const out = applyLog(m, [entry(id)])
    const stubbed = toolResultBlocks(out[1])[0] as ToolResultBlock
    expect(stubbed.content).toBe(stubText({ kind: 'superseded-read', estTokens: 500, spillPath: '/tmp/spill/abc.txt' }))
    expect(stubbed.tool_use_id).toBe(id)
    expect(stubbed.cache_control).toEqual({ type: 'ephemeral' })
    expect(m[1]).not.toBe(out[1])           // no mutation of input
    expect(out.length).toBe(m.length)
    expect((toolResultBlocks(m[1])[0] as ToolResultBlock).content).toContain('ORIGINAL') // original untouched
  })
  it('is byte-deterministic: same history + same log → identical JSON, and appending turns preserves the transformed prefix', () => {
    const m: Message[] = []
    const id = addToolCall(m, 'Bash', { command: 'ls' }, 'OUT'.repeat(200))
    pad(m, 3)
    const log = [entry(id)]
    const a = JSON.stringify(applyLog(m, log))
    const b = JSON.stringify(applyLog(structuredClone(m), log))
    expect(a).toBe(b)
    const longer = structuredClone(m)
    pad(longer, 2)
    expect(JSON.stringify(applyLog(longer, log)).startsWith(a.slice(0, a.length - 1))).toBe(true)
  })
  it('silently skips log entries whose tool_use_id is absent (fingerprint-collision safety)', () => {
    const m: Message[] = []
    addToolCall(m, 'Read', { file_path: '/x.ts' }, 'data')
    expect(JSON.stringify(applyLog(m, [entry('toolu_does_not_exist')]))).toBe(JSON.stringify(m))
  })
})

describe('SurgeryLog persistence', () => {
  it('appends and reloads entries from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scalpel-log-'))
    const log = new SurgeryLog(join(dir, 'log.jsonl'))
    log.append(entry('toolu_1'))
    log.append(entry('toolu_2'))
    const reloaded = new SurgeryLog(join(dir, 'log.jsonl'))
    expect(reloaded.entries.map(e => e.toolUseId)).toEqual(['toolu_1', 'toolu_2'])
    expect(reloaded.has('toolu_1')).toBe(true)
  })
})
