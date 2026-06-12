import { describe, expect, it } from 'vitest'
import { Calibration, estimateBlock, estimateMessage, estimateText } from '../src/tokens.js'

describe('tokens', () => {
  it('estimates ~chars/3.5', () => {
    expect(estimateText('a'.repeat(350))).toBe(100)
    expect(estimateText('')).toBe(0)
  })
  it('estimates blocks and messages via their JSON size', () => {
    const block = { type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(700) } as const
    expect(estimateBlock(block)).toBeGreaterThanOrEqual(200)
    expect(estimateMessage({ role: 'user', content: [block] })).toBeGreaterThanOrEqual(200)
    expect(estimateMessage({ role: 'user', content: 'hi' })).toBe(estimateText('hi'))
  })
  it('calibration nudges the factor toward observed/estimated (EMA)', () => {
    const c = new Calibration()
    expect(c.factor).toBe(1)
    c.update(1000, 1400) // estimated 1000, actual 1400 → factor moves up
    expect(c.factor).toBeGreaterThan(1)
    expect(c.factor).toBeLessThan(1.4)
  })
})
