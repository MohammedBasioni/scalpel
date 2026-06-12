import { TIER_KINDS, type ScalpelConfig } from './config.js'
import type { CacheState, CandidateSpan, SessionStats, SurgeryPlan } from './types.js'

export function isDoomed(cs: CacheState, cfg: ScalpelConfig): boolean {
  return cs.idleMs > cfg.ttlMs || cs.modelChanged || cs.systemChanged || cs.toolsChanged
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * PURE decision. Doomed cache → all tier-eligible candidates (the rewrite is happening anyway).
 * Warm cache (tier 2 only) → commit when
 *   savedTokens × readWeight × E[remainingTurns]  ≥  safetyMargin × suffixTokens × writeWeight
 * E[remainingTurns] is a Lindy estimate: a session that has run N turns tends to run ~N more.
 */
export function decide(
  candidates: CandidateSpan[], cache: CacheState, stats: SessionStats, cfg: ScalpelConfig,
): SurgeryPlan {
  const eligible = candidates.filter(c => TIER_KINDS[cfg.tier].includes(c.kind))
  if (eligible.length === 0) return []
  if (isDoomed(cache, cfg)) return eligible
  if (cfg.tier < 2) return []

  const saved = eligible.reduce((s, c) => s + c.estTokens, 0)
  const earliest = Math.min(...eligible.map(c => c.messageIndex))
  const suffix = stats.msgTokens.slice(earliest).reduce((a, b) => a + b, 0)
  const remaining = clamp(stats.turnsSoFar, cfg.econ.minRemainingTurns, cfg.econ.maxRemainingTurns)
  const benefit = saved * cfg.weights.read * remaining
  // the suffix is re-written in its TRANSFORMED form (stubs in place), so its cost
  // excludes the tokens being saved
  const cost = Math.max(0, suffix - saved) * cfg.weights.write
  return benefit >= cost * cfg.econ.safetyMargin ? eligible : []
}
