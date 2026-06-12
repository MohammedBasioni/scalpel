import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SpanKind } from '../types.js'

/** Content-addressed spill: same content → same path. Returns the absolute path. */
export function spill(spillDir: string, content: string): string {
  mkdirSync(spillDir, { recursive: true })
  const sha = createHash('sha256').update(content).digest('hex').slice(0, 24)
  const path = join(spillDir, `${sha}.txt`)
  if (!existsSync(path)) writeFileSync(path, content, 'utf8')
  return path
}

/** Deterministic stub — MUST depend only on these fields (replay byte-stability). */
export function stubText(e: { kind: SpanKind; estTokens: number; spillPath: string }): string {
  return `[scalpel: output pruned to save context (~${e.estTokens} tokens). Original stored at ${e.spillPath} — Read it if needed. Reason: ${e.kind}.]`
}
