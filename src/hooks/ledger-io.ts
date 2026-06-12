import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { emptyLedger, type ReadLedger } from './logic.js'

export function loadLedger(path: string): ReadLedger {
  try {
    if (!existsSync(path)) return emptyLedger()
    const l = JSON.parse(readFileSync(path, 'utf8')) as ReadLedger
    return typeof l?.calls === 'number' && l.entries ? l : emptyLedger()
  } catch { return emptyLedger() }
}
export function saveLedger(path: string, ledger: ReadLedger): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(ledger), 'utf8')
}
