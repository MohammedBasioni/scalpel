import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fingerprintSession, hashModel, hashSystem, hashTools } from './fingerprint.js'
import { SurgeryLog } from './surgeon/log.js'
import { Calibration } from './tokens.js'
import type { ScalpelConfig } from './config.js'
import type { CacheState, MessagesRequest } from './types.js'

interface SessionMeta { lastTs: number; modelHash: string; systemHash: string; toolsHash: string; turns: number; calibFactor: number }

export class SessionState {
  readonly log: SurgeryLog
  readonly calib = new Calibration()
  meta: SessionMeta | null = null
  private readonly metaPath: string
  constructor(readonly fp: string, dir: string) {
    mkdirSync(dir, { recursive: true })
    this.log = new SurgeryLog(join(dir, 'log.jsonl'))
    this.metaPath = join(dir, 'meta.json')
    if (existsSync(this.metaPath)) {
      this.meta = JSON.parse(readFileSync(this.metaPath, 'utf8')) as SessionMeta
      this.calib.factor = this.meta.calibFactor
    }
  }
  /** null on first sighting (unknown cache state → caller must be conservative). */
  computeCacheState(req: MessagesRequest, now: number): CacheState | null {
    if (!this.meta) return null
    return {
      idleMs: now - this.meta.lastTs,
      modelChanged: hashModel(req) !== this.meta.modelHash,
      systemChanged: hashSystem(req) !== this.meta.systemHash,
      toolsChanged: hashTools(req) !== this.meta.toolsHash,
    }
  }
  touch(req: MessagesRequest, now: number): void {
    this.meta = {
      lastTs: now, modelHash: hashModel(req), systemHash: hashSystem(req), toolsHash: hashTools(req),
      turns: (this.meta?.turns ?? 0) + 1, calibFactor: this.calib.factor,
    }
    writeFileSync(this.metaPath, JSON.stringify(this.meta), 'utf8')
  }
}

export class SessionStore {
  private cache = new Map<string, SessionState>()
  constructor(private readonly cfg: ScalpelConfig) {}
  get(req: MessagesRequest): SessionState {
    const fp = fingerprintSession(req)
    let s = this.cache.get(fp)
    if (!s) { s = new SessionState(fp, join(this.cfg.paths.sessionsDir, fp)); this.cache.set(fp, s) }
    return s
  }
}
