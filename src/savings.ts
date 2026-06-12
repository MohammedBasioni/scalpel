import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import type { DatabaseSync } from 'node:sqlite'

// node:sqlite is a stable built-in only on Node >= 24 (experimental, flag-gated on
// 22.x). Loading it lazily inside a try/catch keeps scalpel running on older Node —
// the savings DB simply degrades to a no-op rather than crashing the proxy on import.
const require = createRequire(import.meta.url)

export interface TurnRecord {
  ts: string; session: string; model: string
  input: number; output: number; cacheRead: number; cacheCreate: number
  estSavedTokens: number
}
export interface SavingsReport { turns: number; estSavedTokens: number; weightedActual: number; weightedSaved: number; weightedSavedPct: number }

const W = { read: 0.1, write: 1.25, output: 5, input: 1 }

function isValidSavingsRow(row: unknown): row is { n: number; i: number; o: number; cr: number; cc: number; sv: number } {
  return (
    row !== null &&
    typeof row === 'object' &&
    typeof (row as Record<string, unknown>).n === 'number' &&
    typeof (row as Record<string, unknown>).i === 'number' &&
    typeof (row as Record<string, unknown>).o === 'number' &&
    typeof (row as Record<string, unknown>).cr === 'number' &&
    typeof (row as Record<string, unknown>).cc === 'number' &&
    typeof (row as Record<string, unknown>).sv === 'number'
  )
}

export class SavingsStore {
  private db: DatabaseSync | null = null
  constructor(path: string) {
    try {
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
      mkdirSync(dirname(path), { recursive: true })
      this.db = new DatabaseSync(path)
      this.db.exec(`CREATE TABLE IF NOT EXISTS turns (
        id INTEGER PRIMARY KEY, ts TEXT, session TEXT, model TEXT,
        input INTEGER, output INTEGER, cache_read INTEGER, cache_create INTEGER, est_saved INTEGER)`)
    } catch (err) {
      // Fail-open: log error but don't crash
      console.error('[SavingsStore] constructor error:', err)
      // Don't throw - fail open and allow the instance to continue
    }
  }
  recordTurn(t: TurnRecord): void {
    try {
      if (!this.db) {
        console.error('[SavingsStore] recordTurn: database not initialized')
        return
      }
      this.db.prepare(`INSERT INTO turns (ts, session, model, input, output, cache_read, cache_create, est_saved)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(t.ts, t.session, t.model, t.input, t.output, t.cacheRead, t.cacheCreate, t.estSavedTokens)
    } catch (err) {
      // Fail-open: log error but don't crash
      console.error('[SavingsStore] recordTurn error:', err)
    }
  }
  report(): SavingsReport {
    const defaultReport: SavingsReport = {
      turns: 0,
      estSavedTokens: 0,
      weightedActual: 0,
      weightedSaved: 0,
      weightedSavedPct: 0,
    }
    try {
      if (!this.db) {
        console.error('[SavingsStore] report: database not initialized')
        return defaultReport
      }

      const row = this.db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(input),0) i, COALESCE(SUM(output),0) o,
        COALESCE(SUM(cache_read),0) cr, COALESCE(SUM(cache_create),0) cc, COALESCE(SUM(est_saved),0) sv FROM turns`).get()

      if (!isValidSavingsRow(row)) {
        console.error('[SavingsStore] report: invalid query result shape')
        return defaultReport
      }

      const weightedActual = row.i * W.input + row.o * W.output + row.cr * W.read + row.cc * W.write
      const weightedSaved = row.sv * W.read // saved tokens would have been cache reads each turn
      return {
        turns: row.n, estSavedTokens: row.sv, weightedActual, weightedSaved,
        weightedSavedPct: weightedActual + weightedSaved > 0 ? (100 * weightedSaved) / (weightedActual + weightedSaved) : 0,
      }
    } catch (err) {
      // Fail-open: log error but don't crash
      console.error('[SavingsStore] report error:', err)
      return defaultReport
    }
  }
}
