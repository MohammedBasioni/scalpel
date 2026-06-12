#!/usr/bin/env node
// PostToolUse hook for Read|Edit|Write: maintain the per-session read ledger.
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { recordPostTool } from './logic.js'
import { loadLedger, saveLedger } from './ledger-io.js'

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const tool = input.tool_name
  if (['Read', 'Edit', 'Write'].includes(tool) && typeof input.session_id === 'string') {
    const path = join(homedir(), '.scalpel', 'readledger', `${input.session_id}.json`)
    const fp = input.tool_input?.file_path
    let hash: string | null = null
    let sizeEst = 0
    if (tool === 'Read' && typeof fp === 'string' && existsSync(fp)) {
      const buf = readFileSync(fp)
      hash = createHash('sha256').update(buf).digest('hex')
      sizeEst = Math.ceil(buf.length / 3.5)
    }
    saveLedger(path, recordPostTool(loadLedger(path), tool, input.tool_input ?? {}, sizeEst, hash))
  }
} catch { /* fail-open */ }
