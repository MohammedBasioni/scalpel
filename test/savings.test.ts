import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SavingsStore } from '../src/savings.js'

describe('savings', () => {
  it('records turns and aggregates weighted savings', () => {
    const db = join(mkdtempSync(join(tmpdir(), 'scalpel-sav-')), 'savings.db')
    const s = new SavingsStore(db)
    s.recordTurn({ ts: '2026-06-11T10:00:00Z', session: 'fp1', model: 'claude-opus-4-8', input: 100, output: 500, cacheRead: 90_000, cacheCreate: 2_000, estSavedTokens: 30_000 })
    s.recordTurn({ ts: '2026-06-11T10:01:00Z', session: 'fp1', model: 'claude-opus-4-8', input: 50, output: 300, cacheRead: 95_000, cacheCreate: 1_000, estSavedTokens: 30_000 })
    const r = s.report()
    expect(r.turns).toBe(2)
    expect(r.estSavedTokens).toBe(60_000)
    expect(r.weightedSavedPct).toBeGreaterThan(0)
    const s2 = new SavingsStore(db) // persists
    expect(s2.report().turns).toBe(2)
  })

  it('handles invalid report result gracefully', () => {
    const db = join(mkdtempSync(join(tmpdir(), 'scalpel-sav-')), 'savings.db')
    const s = new SavingsStore(db)
    // Empty database should return zero report, not crash
    const r = s.report()
    expect(r.turns).toBe(0)
    expect(r.estSavedTokens).toBe(0)
    expect(r.weightedSavedPct).toBe(0)
  })

  it('handles recordTurn errors gracefully when db.prepare().run() throws', () => {
    const db = join(mkdtempSync(join(tmpdir(), 'scalpel-sav-')), 'savings.db')
    const s = new SavingsStore(db)

    // Spy on console.error to verify error logging happens
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // First, record a valid turn
    s.recordTurn({
      ts: '2026-06-11T10:00:00Z',
      session: 'fp1',
      model: 'claude-opus-4-8',
      input: 100,
      output: 500,
      cacheRead: 90_000,
      cacheCreate: 2_000,
      estSavedTokens: 30_000
    })

    // Verify it was recorded
    let r = s.report()
    expect(r.turns).toBe(1)

    // Store the original db and prepare method
    const originalDb = (s as any).db
    const originalPrepare = originalDb.prepare.bind(originalDb)

    // Mock the db.prepare method to throw an error (simulating database failure)
    // Only for INSERT statements, leave SELECT alone for report()
    originalDb.prepare = vi.fn((sql: string) => {
      if (sql.includes('INSERT')) {
        throw new Error('Simulated database error')
      }
      return originalPrepare(sql)
    })

    // Now try to record a turn - the error should be caught and logged
    const result = s.recordTurn({
      ts: '2026-06-11T10:01:00Z',
      session: 'fp1',
      model: 'claude-opus-4-8',
      input: 100,
      output: 500,
      cacheRead: 90_000,
      cacheCreate: 2_000,
      estSavedTokens: 30_000
    })

    // Should complete without throwing despite the error
    expect(result).toBeUndefined()

    // Verify error was logged
    expect(errorSpy).toHaveBeenCalledWith(
      '[SavingsStore] recordTurn error:',
      expect.any(Error)
    )

    // Restore the original db.prepare
    originalDb.prepare = originalPrepare

    // The previous valid record should still be there (error didn't crash)
    r = s.report()
    expect(r.turns).toBe(1)

    errorSpy.mockRestore()
  })
})
