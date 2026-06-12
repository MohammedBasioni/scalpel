#!/usr/bin/env node
// PreToolUse hook for Read: deny duplicate full reads of unchanged files.
// Fail-open: ANY error → no output, exit 0 → Claude Code proceeds normally.
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { loadConfig } from '../config.js'
import { decidePreRead } from './logic.js'
import { loadLedger } from './ledger-io.js'

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  if (input.tool_name === 'Read' && typeof input.session_id === 'string') {
    const fp = input.tool_input?.file_path
    if (typeof fp === 'string' && existsSync(fp)) {
      const ledger = loadLedger(join(homedir(), '.scalpel', 'readledger', `${input.session_id}.json`))
      const hash = createHash('sha256').update(readFileSync(fp)).digest('hex')
      const d = decidePreRead(ledger, input.tool_input, hash, loadConfig({}).ledger)
      if (d.deny)
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason },
        }))
    }
  }
} catch { /* fail-open */ }
