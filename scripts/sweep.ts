// Threshold sweep over the N largest replayable sessions. Run: npx tsx scripts/sweep.ts [corpusDir]
import { readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { benchFile } from '../src/bench.js'
import { loadConfig } from '../src/config.js'

process.env.SCALPEL_NO_CONFIG = '1'
const corpus = process.argv[2] ?? join(homedir(), '.claude', 'projects')
const files: Array<{ path: string; bytes: number }> = []
for (const p of readdirSync(corpus)) {
  let names: string[] = []
  try { names = readdirSync(join(corpus, p)).filter(f => f.endsWith('.jsonl')) } catch { continue }
  for (const f of names) {
    const path = join(corpus, p, f)
    const bytes = statSync(path).size
    if (bytes > 20 * 1024 * 1024) continue
    files.push({ path, bytes })
  }
}
files.sort((a, b) => b.bytes - a.bytes)
const sample = files.slice(0, 30)
console.log(`sample: ${sample.length} largest sessions (${(sample.reduce((s, f) => s + f.bytes, 0) / 1e6).toFixed(0)} MB)`)

interface Variant { name: string; ledger?: Record<string, number>; econ?: Record<string, number> }
const VARIANTS: Variant[] = [
  { name: 'baseline' },
  { name: 'tail6',        ledger: { protectedTailMsgs: 6 } },
  { name: 'failed6',      ledger: { failedAgeMsgs: 6 } },
  { name: 'stale12',      ledger: { staleAgeMsgs: 12 } },
  { name: 'staleMin1000', ledger: { staleMinTokens: 1000 } },
  { name: 'minSpan120',   ledger: { minSpanTokens: 120 } },
  { name: 'margin1.5',    econ:   { safetyMargin: 1.5 } },
  // combined: all OFAT winners that beat baseline by ≥0.5 pp
  { name: 'combined',     ledger: { staleMinTokens: 1000 } },
]

function run(v: Variant): number {
  let base = 0, scalp = 0, n = 0, i = 0
  for (const f of sample) {
    i++
    const root = join(tmpdir(), 'scalpel-sweep', v.name, String(i))
    const cfg = { ...loadConfig({}), paths: { root, spillDir: join(root, 'spill'), sessionsDir: join(root, 's'), dbPath: join(root, 'db') } }
    cfg.ledger = { ...cfg.ledger, ...(v.ledger ?? {}) }
    cfg.econ = { ...cfg.econ, ...(v.econ ?? {}) }
    let r
    try { r = benchFile(f.path, cfg) } catch (e) { console.error(`  error ${f.path}: ${e}`); continue }
    if (r.oversized || r.requests < 5) continue
    n++; base += r.baselineWeighted; scalp += r.scalpelWeighted
  }
  const pct = base ? (100 * (base - scalp)) / base : 0
  console.log(`${v.name.padEnd(14)} sessions=${n} saving=${pct.toFixed(2)}%`)
  return pct
}
for (const v of VARIANTS) run(v)
rmSync(join(tmpdir(), 'scalpel-sweep'), { recursive: true, force: true })
