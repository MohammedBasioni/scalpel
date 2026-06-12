import { createHash } from 'node:crypto'
import { estimateBlock } from './tokens.js'
import type { CandidateSpan, Message, ToolResultBlock, ToolUseBlock } from './types.js'
import type { ScalpelConfig } from './config.js'

interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  useIndex: number          // message index of the tool_use
  resultIndex: number       // message index of the tool_result
  result: ToolResultBlock
  estTokens: number
  contentHash: string
  isError: boolean
}

const SNAPSHOT_RE = /browser_snapshot|take_snapshot|read_page/

function collectToolCalls(messages: Message[]): ToolCall[] {
  const uses = new Map<string, { name: string; input: Record<string, unknown>; useIndex: number }>()
  const calls: ToolCall[] = []
  messages.forEach((msg, i) => {
    if (typeof msg.content === 'string') return
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        const u = block as ToolUseBlock
        uses.set(u.id, { name: u.name, input: u.input ?? {}, useIndex: i })
      } else if (block.type === 'tool_result') {
        const r = block as ToolResultBlock
        const u = uses.get(r.tool_use_id)
        if (!u) continue
        const contentJson = JSON.stringify(r.content ?? '')
        calls.push({
          id: r.tool_use_id, name: u.name, input: u.input, useIndex: u.useIndex, resultIndex: i,
          result: r, estTokens: estimateBlock(r),
          contentHash: createHash('sha256').update(contentJson).digest('hex'),
          isError: r.is_error === true,
        })
      }
    }
  })
  return calls
}

/** PURE: original history → prunable candidate spans. No I/O, no state. */
export function buildCandidates(messages: Message[], cfg: ScalpelConfig['ledger']): CandidateSpan[] {
  const calls = collectToolCalls(messages)
  const out = new Map<string, CandidateSpan>() // toolUseId → span (first kind wins)
  const tailStart = messages.length - cfg.protectedTailMsgs
  const eligible = (c: ToolCall) => c.resultIndex < tailStart && c.estTokens >= cfg.minSpanTokens
  const add = (c: ToolCall, kind: CandidateSpan['kind'], reason: string) => {
    if (!out.has(c.id) && eligible(c))
      out.set(c.id, { toolUseId: c.id, messageIndex: c.resultIndex, kind, estTokens: c.estTokens, reason })
  }

  // superseded-read: an earlier Read of a path that a later Read/Edit/Write touches
  const lastTouch = new Map<string, number>() // file_path → latest useIndex among Read/Edit/Write
  for (const c of calls) {
    const fp = typeof c.input['file_path'] === 'string' ? (c.input['file_path'] as string) : undefined
    if (fp && ['Read', 'Edit', 'Write'].includes(c.name))
      lastTouch.set(fp, Math.max(lastTouch.get(fp) ?? -1, c.useIndex))
  }
  for (const c of calls) {
    const fp = typeof c.input['file_path'] === 'string' ? (c.input['file_path'] as string) : undefined
    if (c.name === 'Read' && fp && (lastTouch.get(fp) ?? -1) > c.useIndex)
      add(c, 'superseded-read', `later Read/Edit/Write of ${fp}`)
  }

  // duplicate-result: identical content; keep the last occurrence
  const lastByHash = new Map<string, number>()
  for (const c of calls) lastByHash.set(c.contentHash, Math.max(lastByHash.get(c.contentHash) ?? -1, c.resultIndex))
  for (const c of calls)
    if ((lastByHash.get(c.contentHash) ?? -1) > c.resultIndex)
      add(c, 'duplicate-result', 'identical result appears later in context')

  // failed-command: errored results past the age threshold
  for (const c of calls)
    if (c.isError && messages.length - c.resultIndex > cfg.failedAgeMsgs)
      add(c, 'failed-command', 'errored tool result past age threshold')

  // dead-snapshot: superseded UI/browser snapshots (same tool name, later call exists)
  const lastSnap = new Map<string, number>()
  for (const c of calls) if (SNAPSHOT_RE.test(c.name)) lastSnap.set(c.name, Math.max(lastSnap.get(c.name) ?? -1, c.useIndex))
  for (const c of calls)
    if (SNAPSHOT_RE.test(c.name) && (lastSnap.get(c.name) ?? -1) > c.useIndex)
      add(c, 'dead-snapshot', 'newer snapshot from same tool exists')

  // stale-large-result: big and old, any tool
  for (const c of calls)
    if (c.estTokens >= cfg.staleMinTokens && messages.length - c.resultIndex > cfg.staleAgeMsgs)
      add(c, 'stale-large-result', `~${c.estTokens} tokens, ${messages.length - c.resultIndex} messages old`)

  return [...out.values()].sort((a, b) => a.messageIndex - b.messageIndex)
}
