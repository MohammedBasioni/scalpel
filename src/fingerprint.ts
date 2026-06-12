import { createHash } from 'node:crypto'
import type { MessagesRequest } from './types.js'

const h16 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

/**
 * Keyed by the first message only: it is the longest-lived stable element of a session
 * (system prompt and model can legitimately change mid-session — those are doom signals,
 * not new sessions). Collisions are tolerable: surgery log entries are keyed by globally
 * unique tool_use_id, so a merged ledger cannot corrupt an unrelated session.
 */
export const fingerprintSession = (req: MessagesRequest): string =>
  h16(JSON.stringify(req.messages[0] ?? null))

export const hashSystem = (req: MessagesRequest): string => h16(JSON.stringify(req.system ?? null))
export const hashTools = (req: MessagesRequest): string => h16(JSON.stringify(req.tools ?? null))
export const hashModel = (req: MessagesRequest): string =>
  h16(JSON.stringify([req.model, req['thinking'] ?? null, req['effort'] ?? null]))
