#!/usr/bin/env node
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { loadConfig } from './config.js'
import { createProxy } from './proxy.js'
import { SavingsStore } from './savings.js'
import { benchFile } from './bench.js'

const cmd = process.argv[2] ?? 'help'
const cfg = loadConfig({})

const fmt = (n: number) => n.toLocaleString('en-US')

switch (cmd) {
  case 'start': {
    const server = createProxy(cfg)
    server.listen(cfg.port, '127.0.0.1', () =>
      console.log(`scalpel tier ${cfg.tier} on http://127.0.0.1:${cfg.port} → ${cfg.upstream}\n` +
        `point Claude Code at it:  export ANTHROPIC_BASE_URL=http://127.0.0.1:${cfg.port}`))
    break
  }
  case 'status': {
    fetch(`http://127.0.0.1:${cfg.port}/scalpel/healthz`)
      .then(async r => console.log(JSON.stringify(await r.json(), null, 2)))
      .catch(() => { console.error(`not running on :${cfg.port}`); process.exit(1) })
    break
  }
  case 'report': {
    const r = new SavingsStore(cfg.paths.dbPath).report()
    console.log(`turns proxied:     ${fmt(r.turns)}`)
    console.log(`tokens pruned:     ${fmt(r.estSavedTokens)} (est)`)
    console.log(`weighted saved:    ${r.weightedSavedPct.toFixed(1)}% of weighted token cost`)
    break
  }
  case 'tier': {
    const t = Number(process.argv[3])
    if (t !== 1 && t !== 2) { console.error('usage: scalpel tier <1|2>'); process.exit(1) }
    mkdirSync(cfg.paths.root, { recursive: true })
    writeFileSync(join(cfg.paths.root, 'config.json'), JSON.stringify({ tier: t }, null, 2))
    console.log(`tier set to ${t} (restart scalpel to apply)`)
    break
  }
  case 'bench': {
    const dir = process.argv[3] ?? join(homedir(), '.claude', 'projects')
    let totalBase = 0, totalScalp = 0, replayed = 0
    let skippedFewRequests = 0, skippedOversized = 0, skippedErrors = 0, totalParseErrors = 0
    let fileCounter = 0
    const errorMessages: string[] = []
    for (const project of readdirSync(dir)) {
      const pdir = join(dir, project)
      let entries: string[] = []
      try { entries = readdirSync(pdir).filter(f => f.endsWith('.jsonl')) } catch { continue }
      for (const f of entries) {
        const filePath = join(pdir, f)
        const sessionId = `${project}/${f}`
        try {
          const r = benchFile(filePath, { ...cfg, paths: { ...cfg.paths, sessionsDir: join(cfg.paths.root, 'bench-tmp', String(fileCounter)), spillDir: join(cfg.paths.root, 'bench-tmp', 'spill') } })
          fileCounter++
          if (r.oversized) { skippedOversized++; continue }
          if (r.requests < 5) { skippedFewRequests++; continue }
          totalBase += r.baselineWeighted; totalScalp += r.scalpelWeighted; replayed++
          totalParseErrors += r.parseErrors
        } catch (err) {
          skippedErrors++
          if (errorMessages.length < 3) errorMessages.push(`${sessionId}: ${String(err)}`)
        }
      }
    }
    const pct = totalBase > 0 ? ((100 * (totalBase - totalScalp)) / totalBase).toFixed(1) : '0'
    console.log(`sessions replayed:      ${replayed}`)
    console.log(`baseline weighted cost: ${fmt(Math.round(totalBase))}`)
    console.log(`scalpel  weighted cost: ${fmt(Math.round(totalScalp))}`)
    console.log(`estimated saving:       ${pct}%  (tier ${cfg.tier})`)
    console.log(`--- skip accounting ---`)
    console.log(`excluded (<5 requests): ${skippedFewRequests}`)
    console.log(`skipped (oversized):    ${skippedOversized}`)
    console.log(`failed (errors):        ${skippedErrors}`)
    console.log(`parse errors (lines):   ${totalParseErrors}`)
    if (errorMessages.length > 0) {
      console.log(`first errors:`)
      for (const msg of errorMessages) console.log(`  ${msg}`)
    }
    break
  }
  case 'install-hooks': {
    const dist = join(process.cwd(), 'dist', 'hooks')
    const snippet = {
      hooks: {
        PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: `node ${join(dist, 'pre-read.js')}` }] }],
        PostToolUse: [{ matcher: 'Read|Edit|Write', hooks: [{ type: 'command', command: `node ${join(dist, 'post-tool.js')}` }] }],
      },
    }
    console.log('Add this to ~/.claude/settings.json (merge into existing "hooks" if present):\n')
    console.log(JSON.stringify(snippet, null, 2))
    console.log('\nRemove the entries to disable. Ledger lives in ~/.scalpel/readledger/.')
    break
  }
  case 'install': {
    const unit = `[Unit]
Description=scalpel cache-aware context proxy
After=network.target

[Service]
ExecStart=${process.execPath} ${join(process.cwd(), 'dist', 'cli.js')} start
Restart=on-failure

[Install]
WantedBy=default.target
`
    const unitDir = join(homedir(), '.config', 'systemd', 'user')
    mkdirSync(unitDir, { recursive: true })
    writeFileSync(join(unitDir, 'scalpel.service'), unit)
    console.log(`wrote ${join(unitDir, 'scalpel.service')}
enable:   systemctl --user enable --now scalpel
then add to your shell profile:
  export ANTHROPIC_BASE_URL=http://127.0.0.1:${cfg.port}
escape hatch (instant stock behavior):  unset ANTHROPIC_BASE_URL`)
    break
  }
  default:
    console.log('scalpel <start|status|report|tier|bench|install|install-hooks>')
}
