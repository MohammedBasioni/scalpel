import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLedger, saveLedger } from '../src/hooks/ledger-io.js'
import { emptyLedger, recordPostTool } from '../src/hooks/logic.js'

describe('ledger-io', () => {
  it('round-trips a ledger to disk', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'scalpel-rl-')), 'sess-1.json')
    expect(loadLedger(p)).toEqual(emptyLedger())
    const l = recordPostTool(emptyLedger(), 'Read', { file_path: '/a.ts' }, 300, 'h1')
    saveLedger(p, l)
    expect(loadLedger(p)).toEqual(l)
  })
  it('returns an empty ledger for corrupt or malformed files (fail-open)', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'scalpel-rl-')), 'sess-2.json')
    writeFileSync(p, '{not json', 'utf8')
    expect(loadLedger(p)).toEqual(emptyLedger())
    writeFileSync(p, '{"calls":"nope"}', 'utf8')
    expect(loadLedger(p)).toEqual(emptyLedger())
  })
})
