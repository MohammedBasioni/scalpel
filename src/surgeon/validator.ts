import type { Message, ToolResultBlock, ToolUseBlock } from '../types.js'

/** Last gate before forwarding. Any violation → pipeline falls back to the original request. */
export function validate(original: Message[], transformed: Message[]): string[] {
  const errors: string[] = []
  if (transformed.length !== original.length) errors.push(`message count drift: ${original.length} → ${transformed.length}`)
  const n = Math.min(original.length, transformed.length)
  const seenToolUse = new Set<string>()
  let breakpoints = 0
  for (let i = 0; i < n; i++) {
    const o = original[i], t = transformed[i]
    if (o.role !== t.role) errors.push(`role drift at message ${i}`)
    if (typeof t.content === 'string') continue
    if (t.content.length === 0) errors.push(`empty content array at message ${i}`)
    for (const block of t.content) {
      if ((block as { cache_control?: unknown }).cache_control) breakpoints++
      if (block.type === 'tool_use') seenToolUse.add((block as ToolUseBlock).id)
      if (block.type === 'tool_result') {
        const r = block as ToolResultBlock
        if (!seenToolUse.has(r.tool_use_id)) errors.push(`orphaned tool_result ${r.tool_use_id} at message ${i}`)
        if (r.content === '' || (Array.isArray(r.content) && r.content.length === 0))
          errors.push(`empty tool_result content at message ${i}`)
      }
    }
  }
  if (breakpoints > 4) errors.push(`${breakpoints} cache_control breakpoints (max 4)`)
  return errors
}
