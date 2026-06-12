import { describe, expect, it } from 'vitest'
import { buildCandidates } from '../src/ledger.js'
import { loadConfig } from '../src/config.js'
import { addToolCall, pad } from './helpers.js'
import type { Message } from '../src/types.js'

const cfg = loadConfig({}).ledger
const big = (seed: string) => seed.repeat(900) // ~> minSpanTokens after JSON overhead

describe('ledger: superseded-read', () => {
  it('flags an earlier Read of a file re-read later', () => {
    const m: Message[] = []
    const first = addToolCall(m, 'Read', { file_path: '/a.ts' }, big('old'))
    pad(m, 6)
    addToolCall(m, 'Read', { file_path: '/a.ts' }, big('new'))
    pad(m, 6) // push the first read out of the protected tail
    const c = buildCandidates(m, cfg)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ toolUseId: first, kind: 'superseded-read' })
  })
  it('flags a Read superseded by a later Edit/Write to the same path', () => {
    const m: Message[] = []
    const r = addToolCall(m, 'Read', { file_path: '/b.ts' }, big('content'))
    pad(m, 6)
    addToolCall(m, 'Edit', { file_path: '/b.ts', old_string: 'x', new_string: 'y' }, 'ok edited')
    pad(m, 6)
    expect(buildCandidates(m, cfg).map(c => c.toolUseId)).toContain(r)
  })
  it('never flags the latest read, reads in the protected tail, or small results', () => {
    const m: Message[] = []
    addToolCall(m, 'Read', { file_path: '/c.ts' }, big('only')) // latest read of /c.ts
    addToolCall(m, 'Read', { file_path: '/tiny.ts' }, 'short')  // under minSpanTokens
    pad(m, 6)
    const tail = addToolCall(m, 'Read', { file_path: '/tiny.ts' }, 'short again') // in tail
    const ids = buildCandidates(m, cfg).map(c => c.toolUseId)
    expect(ids).toHaveLength(0)
    expect(ids).not.toContain(tail)
  })
})

describe('ledger: duplicate-result', () => {
  it('flags earlier byte-identical tool results, keeps the last', () => {
    const m: Message[] = []
    const dup1 = addToolCall(m, 'Bash', { command: 'ls -la' }, big('same-output'))
    pad(m, 6)
    const dup2 = addToolCall(m, 'Bash', { command: 'ls -la' }, big('same-output'))
    pad(m, 6)
    addToolCall(m, 'Bash', { command: 'ls -la' }, big('same-output')) // the keeper (also in tail)
    const c = buildCandidates(m, cfg)
    const ids = c.filter(x => x.kind === 'duplicate-result').map(x => x.toolUseId)
    expect(ids).toEqual(expect.arrayContaining([dup1, dup2]))
    expect(ids).toHaveLength(2)
  })
})

describe('ledger: failed-command / stale-large / dead-snapshot', () => {
  it('flags an old errored result but not a recent one', () => {
    const m: Message[] = []
    const failed = addToolCall(m, 'Bash', { command: 'npm test' }, big('FAIL stacktrace'), { isError: true })
    pad(m, 8) // age > failedAgeMsgs(10 msgs) and out of tail
    const recent = addToolCall(m, 'Bash', { command: 'npm test' }, big('FAIL again'), { isError: true })
    const c = buildCandidates(m, cfg)
    expect(c.find(x => x.toolUseId === failed)?.kind).toBe('failed-command')
    expect(c.find(x => x.toolUseId === recent)).toBeUndefined()
  })
  it('flags large old results (stale-large-result) but not large recent ones', () => {
    const m: Message[] = []
    const huge = addToolCall(m, 'Bash', { command: 'cat big.log' }, 'x'.repeat(9000)) // ~2.5k tokens
    pad(m, 12) // age > staleAgeMsgs(20 msgs)
    const c = buildCandidates(m, cfg)
    expect(c.find(x => x.toolUseId === huge)?.kind).toBe('stale-large-result')
  })
  it('flags superseded browser snapshots', () => {
    const m: Message[] = []
    const old = addToolCall(m, 'mcp__playwright__browser_snapshot', {}, big('<dom v1>'))
    pad(m, 6)
    addToolCall(m, 'mcp__playwright__browser_snapshot', {}, big('<dom v2>'))
    pad(m, 6)
    expect(buildCandidates(m, cfg).find(x => x.toolUseId === old)?.kind).toBe('dead-snapshot')
  })
  it('one span per tool_use_id even when multiple kinds match', () => {
    const m: Message[] = []
    const id = addToolCall(m, 'Read', { file_path: '/d.ts' }, 'x'.repeat(9000))
    pad(m, 12)
    addToolCall(m, 'Read', { file_path: '/d.ts' }, big('fresh'))
    pad(m, 6)
    expect(buildCandidates(m, cfg).filter(x => x.toolUseId === id)).toHaveLength(1)
  })
})
