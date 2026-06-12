import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SurgeryLogEntry } from '../types.js'

/** Append-only JSONL log. Replay of this log is the ONLY thing that mutates messages. */
export class SurgeryLog {
  entries: SurgeryLogEntry[] = []
  private ids = new Set<string>()
  constructor(readonly path: string) {
    if (existsSync(path))
      for (const line of readFileSync(path, 'utf8').split('\n'))
        if (line.trim()) this.push(JSON.parse(line) as SurgeryLogEntry)
  }
  private push(e: SurgeryLogEntry): void {
    if (this.ids.has(e.toolUseId)) return
    this.entries.push(e); this.ids.add(e.toolUseId)
  }
  has(toolUseId: string): boolean { return this.ids.has(toolUseId) }
  append(e: SurgeryLogEntry): void {
    if (this.ids.has(e.toolUseId)) return
    mkdirSync(dirname(this.path), { recursive: true })
    appendFileSync(this.path, JSON.stringify(e) + '\n', 'utf8')
    this.push(e)
  }
}
