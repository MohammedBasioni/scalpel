import { stubText } from './spill.js'
import type { Message, SurgeryLogEntry, ToolResultBlock } from '../types.js'

/** PURE replay: original messages + committed log → transformed messages. Never mutates input. */
export function applyLog(messages: Message[], entries: SurgeryLogEntry[]): Message[] {
  // Always return an independent top-level array: the result is a stable snapshot of the
  // request as sent, so later mutation of the caller's input array cannot retroactively
  // corrupt a transformed prefix the proxy is holding for cache-stability comparisons.
  if (entries.length === 0) return messages.slice()
  const byId = new Map(entries.map(e => [e.toolUseId, e]))
  return messages.map(msg => {
    if (typeof msg.content === 'string') return msg
    let changed = false
    const content = msg.content.map(block => {
      if (block.type !== 'tool_result') return block
      const e = byId.get((block as ToolResultBlock).tool_use_id)
      if (!e) return block
      changed = true
      return { ...block, content: stubText(e) }
    })
    return changed ? { ...msg, content } : msg
  })
}
