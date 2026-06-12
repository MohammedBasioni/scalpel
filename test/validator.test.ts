import { describe, expect, it } from 'vitest'
import { validate } from '../src/surgeon/validator.js'
import { addExchange, addToolCall } from './helpers.js'
import type { Message, ToolResultBlock } from '../src/types.js'

const session = (): Message[] => {
  const m: Message[] = []
  addExchange(m, 'do the thing', 'on it')
  addToolCall(m, 'Read', { file_path: '/a.ts' }, 'content')
  return m
}

describe('validator', () => {
  it('passes an untouched valid transform', () => {
    const m = session()
    expect(validate(m, structuredClone(m))).toEqual([])
  })
  it('rejects message count or role drift', () => {
    const m = session()
    expect(validate(m, m.slice(0, -1)).length).toBeGreaterThan(0)
    const swapped = structuredClone(m); swapped[0].role = 'assistant'
    expect(validate(m, swapped).length).toBeGreaterThan(0)
  })
  it('rejects orphaned tool_results and empty content arrays', () => {
    const m = session()
    const orphan = structuredClone(m)
    ;(orphan[3].content as ToolResultBlock[])[0].tool_use_id = 'toolu_unknown'
    expect(validate(m, orphan).join(' ')).toMatch(/orphan/i)
    const empty = structuredClone(m); empty[1].content = []
    expect(validate(m, empty).join(' ')).toMatch(/empty/i)
  })
  it('rejects more than 4 cache_control breakpoints', () => {
    const m: Message[] = []
    for (let i = 0; i < 5; i++) {
      m.push({ role: 'user', content: [{ type: 'text', text: `u${i}`, cache_control: { type: 'ephemeral' } }] })
      m.push({ role: 'assistant', content: [{ type: 'text', text: `a${i}` }] })
    }
    expect(validate(m, structuredClone(m)).join(' ')).toMatch(/cache_control/)
  })
})
