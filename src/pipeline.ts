import { buildCandidates } from './ledger.js'
import { decide } from './economist.js'
import { applyLog } from './surgeon/apply.js'
import { validate } from './surgeon/validator.js'
import { spill } from './surgeon/spill.js'
import { estimateMessage } from './tokens.js'
import type { ScalpelConfig } from './config.js'
import type { Message, MessagesRequest, ToolResultBlock } from './types.js'
import type { SessionStore } from './sessions.js'

export interface TransformResult { body: MessagesRequest; savedTokens: number; applied: number; estContextTokens: number; degraded?: string }

function findResultContent(messages: Message[], toolUseId: string): string {
  for (const m of messages) {
    if (typeof m.content === 'string') continue
    for (const b of m.content)
      if (b.type === 'tool_result' && (b as ToolResultBlock).tool_use_id === toolUseId)
        return JSON.stringify((b as ToolResultBlock).content ?? '')
  }
  return ''
}

/** Fail-open: ANY error → return the original request untouched. */
export function transformRequest(
  req: MessagesRequest, store: SessionStore, cfg: ScalpelConfig, now: number,
): TransformResult {
  const original: TransformResult = { body: req, savedTokens: 0, applied: 0, estContextTokens: 0 }
  try {
    if (!Array.isArray(req.messages) || req.messages.length === 0) return original
    const session = store.get(req)
    const cache = session.computeCacheState(req, now)
    if (cache !== null) {
      // new surgery only with known cache state; replay alone otherwise
      const candidates = buildCandidates(req.messages, cfg.ledger).filter(c => !session.log.has(c.toolUseId))
      const stats = {
        turnsSoFar: session.meta?.turns ?? 0,
        msgTokens: req.messages.map(m => Math.round(estimateMessage(m) * session.calib.factor)),
      }
      for (const c of decide(candidates, cache, stats, cfg)) {
        const path = spill(cfg.paths.spillDir, findResultContent(req.messages, c.toolUseId))
        session.log.append({
          toolUseId: c.toolUseId, kind: c.kind, estTokens: c.estTokens,
          spillPath: path, turn: stats.turnsSoFar, ts: new Date(now).toISOString(),
        })
      }
    }
    const transformed = applyLog(req.messages, session.log.entries)
    const errors = validate(req.messages, transformed)
    if (errors.length > 0) return { ...original, degraded: errors.join('; ') }
    session.touch(req, now)
    const present = new Set<string>()
    for (const m of req.messages) {
      if (typeof m.content === 'string') continue
      for (const b of m.content) if (b.type === 'tool_result') present.add((b as ToolResultBlock).tool_use_id)
    }
    const savedTokens = session.log.entries.filter(e => present.has(e.toolUseId)).reduce((s, e) => s + e.estTokens, 0)
    // Raw (uncalibrated) sum of estimateMessage over the transformed messages actually sent upstream
    const estContextTokens = transformed.reduce((s, m) => s + estimateMessage(m), 0)
    return { body: { ...req, messages: transformed }, savedTokens, applied: session.log.entries.length, estContextTokens }
  } catch (err) {
    return { ...original, degraded: String(err) }
  }
}
