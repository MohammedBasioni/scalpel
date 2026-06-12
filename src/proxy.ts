import http from 'node:http'
import { SessionStore } from './sessions.js'
import { transformRequest } from './pipeline.js'
import { SavingsStore } from './savings.js'
import { fingerprintSession } from './fingerprint.js'
import type { ScalpelConfig } from './config.js'
import type { MessagesRequest } from './types.js'

const HOP = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding'])

function parseUsage(sseOrJson: string): { input: number; output: number; cacheRead: number; cacheCreate: number } {
  const u = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }
  const apply = (usage: Record<string, number> | undefined) => {
    if (!usage) return
    u.input = usage.input_tokens ?? u.input
    u.cacheRead = usage.cache_read_input_tokens ?? u.cacheRead
    u.cacheCreate = usage.cache_creation_input_tokens ?? u.cacheCreate
    u.output = usage.output_tokens ?? u.output
  }
  for (const line of sseOrJson.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      const j = JSON.parse(line.slice(6))
      apply(j.message?.usage); apply(j.usage)
    } catch { /* partial frame — ignore */ }
  }
  if (!sseOrJson.startsWith('event:')) { try { apply(JSON.parse(sseOrJson).usage) } catch { /* not JSON */ } }
  return u
}

export function createProxy(cfg: ScalpelConfig): http.Server {
  const store = new SessionStore(cfg)
  const savings = new SavingsStore(cfg.paths.dbPath)
  let degradedTurns = 0, totalTurns = 0

  return http.createServer(async (req, res) => {
    if (req.url === '/scalpel/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', tier: cfg.tier, totalTurns, degradedTurns }))
      return
    }
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    let body = Buffer.concat(chunks)

    let saved = 0, session = '', model = '', estContextTokens = 0
    let parsedReq: MessagesRequest | null = null
    if (req.method === 'POST' && req.url === '/v1/messages') {
      totalTurns++
      try {
        const parsed = JSON.parse(body.toString()) as MessagesRequest
        parsedReq = parsed
        // test hook: x-scalpel-test-now lets integration tests simulate idle gaps
        const now = req.headers['x-scalpel-test-now'] ? Number(req.headers['x-scalpel-test-now']) : Date.now()
        const result = transformRequest(parsed, store, cfg, now)
        if (result.degraded) { degradedTurns++; console.error(`[scalpel] degraded turn: ${result.degraded}`) }
        saved = result.savedTokens
        estContextTokens = result.estContextTokens
        session = fingerprintSession(parsed)
        model = parsed.model
        body = Buffer.from(JSON.stringify(result.body))
      } catch (e) { degradedTurns++; console.error('[scalpel] parse failure, passthrough:', e) }
    }

    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers))
      if (!HOP.has(k.toLowerCase()) && !k.startsWith('x-scalpel-') && typeof v === 'string') headers[k] = v

    try {
      const upstream = await fetch(cfg.upstream + req.url, {
        method: req.method, headers,
        body: ['GET', 'HEAD'].includes(req.method!) ? undefined : body,
      })
      const respHeaders: Record<string, string> = {}
      upstream.headers.forEach((v, k) => { if (!HOP.has(k) && k !== 'content-encoding') respHeaders[k] = v })
      res.writeHead(upstream.status, respHeaders)
      let tee = ''
      if (upstream.body) for await (const chunk of upstream.body) { tee += Buffer.from(chunk).toString(); res.write(chunk) }
      res.end()
      if (req.url === '/v1/messages' && upstream.status === 200 && session) {
        const u = parseUsage(tee)
        savings.recordTurn({ ts: new Date().toISOString(), session, model, ...u, estSavedTokens: saved })
        if (parsedReq && estContextTokens > 0) {
          const actualContext = u.input + u.cacheRead + u.cacheCreate
          if (actualContext > 0) store.get(parsedReq).calib.update(estContextTokens, actualContext)
        }
      }
    } catch (e) {
      console.error('[scalpel] upstream error:', e)
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `scalpel upstream error: ${e}` } }))
    }
  })
}
