// ---- Anthropic Messages API (the subset scalpel touches) ----
export interface CacheControl { type: 'ephemeral'; [k: string]: unknown }
export interface TextBlock { type: 'text'; text: string; cache_control?: CacheControl }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; cache_control?: CacheControl }
export interface ToolResultBlock {
  type: 'tool_result'; tool_use_id: string
  content?: string | Array<Record<string, unknown>>
  is_error?: boolean; cache_control?: CacheControl
}
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | { type: string; [k: string]: unknown }
export interface Message { role: 'user' | 'assistant'; content: string | ContentBlock[] }
export interface MessagesRequest {
  model: string
  system?: string | ContentBlock[]
  messages: Message[]
  tools?: unknown[]
  stream?: boolean
  [k: string]: unknown
}

// ---- scalpel domain ----
export type SpanKind = 'superseded-read' | 'duplicate-result' | 'failed-command' | 'stale-large-result' | 'dead-snapshot'
export interface CandidateSpan {
  toolUseId: string
  messageIndex: number
  kind: SpanKind
  estTokens: number
  reason: string
}
export interface SurgeryLogEntry {
  toolUseId: string
  kind: SpanKind
  estTokens: number
  spillPath: string
  turn: number
  ts: string
}
export type SurgeryPlan = CandidateSpan[]
export interface CacheState {
  idleMs: number
  modelChanged: boolean
  systemChanged: boolean
  toolsChanged: boolean
}
export interface SessionStats { turnsSoFar: number; msgTokens: number[] }
