import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spill, stubText } from '../src/surgeon/spill.js'

describe('spill store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scalpel-spill-'))
  it('writes content-addressed files and is idempotent', () => {
    const p1 = spill(dir, 'big tool output here')
    const p2 = spill(dir, 'big tool output here')
    expect(p1).toBe(p2)
    expect(readFileSync(p1, 'utf8')).toBe('big tool output here')
  })
  it('stub text is deterministic and instructive', () => {
    const s = stubText({ kind: 'superseded-read', estTokens: 1234, spillPath: '/tmp/x.txt' })
    expect(s).toContain('scalpel')
    expect(s).toContain('~1234 tokens')
    expect(s).toContain('/tmp/x.txt')
    expect(s).toContain('Read it if needed')
    expect(stubText({ kind: 'superseded-read', estTokens: 1234, spillPath: '/tmp/x.txt' })).toBe(s)
  })
})
