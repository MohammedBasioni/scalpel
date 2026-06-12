import { describe, expect, it } from 'vitest'
import { fingerprintSession, hashModel, hashSystem, hashTools } from '../src/fingerprint.js'
import { addExchange, mkRequest } from './helpers.js'
import type { Message } from '../src/types.js'

describe('fingerprint', () => {
  it('session fingerprint depends only on the first message (stable as history grows)', () => {
    const m1: Message[] = []
    addExchange(m1, 'build me a parser', 'ok')
    const fp1 = fingerprintSession(mkRequest(m1))
    addExchange(m1, 'now add tests', 'ok')
    expect(fingerprintSession(mkRequest(m1))).toBe(fp1)
    const m2: Message[] = []
    addExchange(m2, 'different task', 'ok')
    expect(fingerprintSession(mkRequest(m2))).not.toBe(fp1)
  })
  it('system/tools/model hashes change when their inputs change', () => {
    const m: Message[] = []
    addExchange(m, 'hi', 'hello')
    const base = mkRequest(m)
    expect(hashSystem(base)).not.toBe(hashSystem(mkRequest(m, { system: 'v2 prompt' })))
    expect(hashTools(base)).not.toBe(hashTools(mkRequest(m, { tools: [{ name: 'Bash' }] })))
    expect(hashModel(base)).not.toBe(hashModel(mkRequest(m, { model: 'claude-haiku-4-5' })))
  })
})
