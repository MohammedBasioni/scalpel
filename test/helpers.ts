import type { ContentBlock, Message, MessagesRequest } from '../src/types.js'

let nextId = 0
export const freshId = () => `toolu_${String(++nextId).padStart(6, '0')}`

/** Append an assistant tool_use + user tool_result pair. Returns the tool_use id. */
export function addToolCall(
  messages: Message[],
  name: string,
  input: Record<string, unknown>,
  result: string,
  opts: { isError?: boolean; id?: string } = {},
): string {
  const id = opts.id ?? freshId()
  messages.push({ role: 'assistant', content: [{ type: 'tool_use', id, name, input }] })
  messages.push({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: result, ...(opts.isError ? { is_error: true } : {}) }],
  })
  return id
}
export function addExchange(messages: Message[], user: string, assistant: string): void {
  messages.push({ role: 'user', content: user })
  messages.push({ role: 'assistant', content: [{ type: 'text', text: assistant }] })
}
export function mkRequest(messages: Message[], extra: Partial<MessagesRequest> = {}): MessagesRequest {
  return { model: 'claude-opus-4-8', system: 'You are Claude Code.', messages, stream: true, ...extra }
}
/** Pad a session with filler exchanges so candidates fall outside the protected tail. */
export function pad(messages: Message[], exchanges: number): void {
  for (let i = 0; i < exchanges; i++) addExchange(messages, `filler question ${i}`, `filler answer ${i}`)
}
export function toolResultBlocks(m: Message): ContentBlock[] {
  return typeof m.content === 'string' ? [] : m.content.filter(b => b.type === 'tool_result')
}
