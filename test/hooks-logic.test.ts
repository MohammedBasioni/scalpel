import { describe, expect, it } from 'vitest'
import { decidePreRead, emptyLedger, recordPostTool } from '../src/hooks/logic.js'

const CFG = { minSpanTokens: 200, protectedTailMsgs: 10, failedAgeMsgs: 10, staleAgeMsgs: 20, staleMinTokens: 2000 }
const read = (fp: string, extra: Record<string, unknown> = {}) => ({ file_path: fp, ...extra })

describe('recordPostTool', () => {
  it('records full reads, skips partial reads, deletes on edit/write, counts calls', () => {
    let l = emptyLedger()
    l = recordPostTool(l, 'Read', read('/a.ts'), 500, 'h1')
    expect(l.entries['/a.ts']).toMatchObject({ hash: 'h1', sizeEst: 500, atCall: 0 })
    l = recordPostTool(l, 'Read', read('/b.ts', { offset: 10 }), 100, 'h2')
    expect(l.entries['/b.ts']).toBeUndefined()
    l = recordPostTool(l, 'Edit', read('/a.ts'), 0, null)
    expect(l.entries['/a.ts']).toBeUndefined()
    expect(l.calls).toBe(3)
  })
})

describe('decidePreRead', () => {
  const base = () => recordPostTool(emptyLedger(), 'Read', read('/a.ts'), 500, 'h1')
  it('denies an unchanged duplicate full read, naming the bypass', () => {
    const d = decidePreRead(base(), read('/a.ts'), 'h1', CFG)
    expect(d.deny).toBe(true)
    expect(d.reason).toMatch(/already in your context/)
    expect(d.reason).toMatch(/offset/)
  })
  it('allows: partial reads, unknown files, changed files', () => {
    expect(decidePreRead(base(), read('/a.ts', { offset: 1 }), 'h1', CFG).deny).toBe(false)
    expect(decidePreRead(base(), read('/a.ts', { limit: 50 }), 'h1', CFG).deny).toBe(false)
    expect(decidePreRead(base(), read('/new.ts'), 'hX', CFG).deny).toBe(false)
    expect(decidePreRead(base(), read('/a.ts'), 'h-changed', CFG).deny).toBe(false)
  })
  it('overlap rule: allows re-read when the recorded read is big and old (proxy may have pruned it)', () => {
    let l = recordPostTool(emptyLedger(), 'Read', read('/big.ts'), 5000, 'hb') // sizeEst ≥ staleMinTokens
    for (let i = 0; i < 25; i++) l = recordPostTool(l, 'Bash', {}, 0, null)    // age ≥ staleAgeMsgs
    expect(decidePreRead(l, read('/big.ts'), 'hb', CFG).deny).toBe(false)
    let recent = recordPostTool(emptyLedger(), 'Read', read('/big.ts'), 5000, 'hb')
    expect(decidePreRead(recent, read('/big.ts'), 'hb', CFG).deny).toBe(true)  // big but recent → deny
  })
})
