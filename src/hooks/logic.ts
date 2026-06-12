import type { ScalpelConfig } from '../config.js'

export interface ReadLedger {
  calls: number
  entries: Record<string, { hash: string; sizeEst: number; atCall: number }>
}
export const emptyLedger = (): ReadLedger => ({ calls: 0, entries: {} })

type LedgerCfg = ScalpelConfig['ledger']

/** PURE. Conservative by construction: every uncertain case allows the read. */
export function decidePreRead(
  ledger: ReadLedger,
  toolInput: Record<string, unknown>,
  currentHash: string,
  cfg: LedgerCfg,
): { deny: boolean; reason?: string } {
  if (toolInput['offset'] !== undefined || toolInput['limit'] !== undefined) return { deny: false }
  const fp = toolInput['file_path']
  if (typeof fp !== 'string') return { deny: false }
  const e = ledger.entries[fp]
  if (!e) return { deny: false }
  if (e.hash !== currentHash) return { deny: false }
  if (e.sizeEst >= cfg.staleMinTokens && ledger.calls - e.atCall >= cfg.staleAgeMsgs) return { deny: false }
  return {
    deny: true,
    reason: `scalpel: ${fp} was fully read earlier this session and is unchanged on disk — its content is already in your context. Use it instead of re-reading. If you believe the in-context copy was pruned, re-read with an explicit offset/limit to bypass this guard.`,
  }
}

/** PURE. Read (full) → record; Edit/Write → invalidate; every call increments the ordinal. */
export function recordPostTool(
  ledger: ReadLedger,
  toolName: string,
  toolInput: Record<string, unknown>,
  sizeEst: number,
  hash: string | null,
): ReadLedger {
  const entries = { ...ledger.entries }
  const fp = toolInput['file_path']
  if (typeof fp === 'string') {
    const partial = toolInput['offset'] !== undefined || toolInput['limit'] !== undefined
    if (toolName === 'Read' && !partial && hash) entries[fp] = { hash, sizeEst, atCall: ledger.calls }
    else if (toolName === 'Edit' || toolName === 'Write') delete entries[fp]
  }
  return { calls: ledger.calls + 1, entries }
}
