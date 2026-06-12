import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type { SpanKind } from './types.js'

export const TIER_KINDS: Record<1 | 2, SpanKind[]> = {
  1: ['superseded-read', 'duplicate-result', 'failed-command'],
  2: ['superseded-read', 'duplicate-result', 'failed-command', 'stale-large-result', 'dead-snapshot'],
}

export interface ScalpelConfig {
  port: number
  upstream: string
  tier: 1 | 2
  ttlMs: number
  weights: { read: number; write: number; output: number }
  ledger: { minSpanTokens: number; protectedTailMsgs: number; failedAgeMsgs: number; staleAgeMsgs: number; staleMinTokens: number }
  econ: { safetyMargin: number; minRemainingTurns: number; maxRemainingTurns: number }
  paths: { root: string; spillDir: string; sessionsDir: string; dbPath: string }
}

function isValidNumber(val: unknown): val is number {
  const num = Number(val)
  return !isNaN(num) && isFinite(num)
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && val.constructor === Object
}

function validateWeights(obj: unknown): obj is { read?: number; write?: number; output?: number } {
  if (obj === undefined) return true
  if (!isPlainObject(obj)) return false
  for (const [key, val] of Object.entries(obj)) {
    if (!['read', 'write', 'output'].includes(key) || (val !== undefined && !isValidNumber(val))) {
      return false
    }
  }
  return true
}

function validateLedger(obj: unknown): obj is { minSpanTokens?: number; protectedTailMsgs?: number; failedAgeMsgs?: number; staleAgeMsgs?: number; staleMinTokens?: number } {
  if (obj === undefined) return true
  if (!isPlainObject(obj)) return false
  const validKeys = ['minSpanTokens', 'protectedTailMsgs', 'failedAgeMsgs', 'staleAgeMsgs', 'staleMinTokens']
  for (const [key, val] of Object.entries(obj)) {
    if (!validKeys.includes(key) || (val !== undefined && !isValidNumber(val))) {
      return false
    }
  }
  return true
}

function validateEcon(obj: unknown): obj is { safetyMargin?: number; minRemainingTurns?: number; maxRemainingTurns?: number } {
  if (obj === undefined) return true
  if (!isPlainObject(obj)) return false
  const validKeys = ['safetyMargin', 'minRemainingTurns', 'maxRemainingTurns']
  for (const [key, val] of Object.entries(obj)) {
    if (!validKeys.includes(key) || (val !== undefined && !isValidNumber(val))) {
      return false
    }
  }
  return true
}

export function loadConfig(overrides: Partial<Record<string, unknown>> = {}): ScalpelConfig {
  const root = join(homedir(), '.scalpel')
  const filePath = join(root, 'config.json')
  const skipFile = process.env.SCALPEL_NO_CONFIG === '1'

  let file: Record<string, unknown> = {}
  if (!skipFile && existsSync(filePath)) {
    try {
      file = JSON.parse(readFileSync(filePath, 'utf8'))
    } catch {
      // JSON parse error: fall back to empty config
      file = {}
    }
  }

  const merged = { ...file, ...overrides }

  const tierVal = merged.tier ?? 2
  if (!isValidNumber(tierVal)) throw new Error(`invalid tier type: must be a number, got ${typeof tierVal}`)
  const tier = Number(tierVal)
  if (tier === 3) throw new Error('tier 3 (summarization) is reserved for v2 and cannot be activated in v1')
  if (tier !== 1 && tier !== 2) throw new Error(`invalid tier: ${tier}`)

  const portVal = merged.port ?? process.env.SCALPEL_PORT ?? 4242
  if (!isValidNumber(portVal)) throw new Error(`invalid port: must be a valid number, got ${portVal}`)
  const port = Number(portVal)

  const ttlMsVal = merged.ttlMs ?? 3_600_000
  if (!isValidNumber(ttlMsVal)) throw new Error(`invalid ttlMs: must be a valid number, got ${ttlMsVal}`)
  const ttlMs = Number(ttlMsVal)

  if (!validateWeights(merged.weights)) throw new Error(`invalid weights: must be an object with read/write/output as numbers`)
  if (!validateLedger(merged.ledger)) throw new Error(`invalid ledger: must be an object with valid ledger keys as numbers`)
  if (!validateEcon(merged.econ)) throw new Error(`invalid econ: must be an object with valid econ keys as numbers`)

  return {
    port,
    upstream: String(merged.upstream ?? process.env.SCALPEL_UPSTREAM ?? 'https://api.anthropic.com'),
    tier,
    ttlMs,
    // write 2.0 = 1-hour-TTL cache-write price (subscription default); API-key users on 5-min TTL should override to 1.25 with ttlMs 300000
    weights: { read: 0.1, write: 2.0, output: 5, ...(merged.weights as object ?? {}) },
    ledger: {
      minSpanTokens: 200, protectedTailMsgs: 10, failedAgeMsgs: 10,
      staleAgeMsgs: 20, staleMinTokens: 1000, ...(merged.ledger ?? {}),
    },
    econ: { safetyMargin: 2, minRemainingTurns: 5, maxRemainingTurns: 50, ...(merged.econ ?? {}) },
    paths: {
      root, spillDir: join(root, 'spill'), sessionsDir: join(root, 'sessions'), dbPath: join(root, 'savings.db'),
    },
  }
}
