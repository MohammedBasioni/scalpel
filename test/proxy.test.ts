import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProxy } from '../src/proxy.js'
import { loadConfig } from '../src/config.js'
import { fingerprintSession } from '../src/fingerprint.js'
import { addToolCall, mkRequest, pad } from './helpers.js'
import type { Message } from '../src/types.js'

let upstream: http.Server, proxy: http.Server
let lastUpstreamBody = ''
let upstreamPort = 0, proxyPort = 0

const SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":10,"cache_read_input_tokens":1000,"cache_creation_input_tokens":50,"output_tokens":1}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
].join('')

beforeAll(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer)
    lastUpstreamBody = Buffer.concat(chunks).toString()
    if (req.url === '/v1/messages') {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(SSE)
    } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') }
  })
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r))
  upstreamPort = (upstream.address() as { port: number }).port
  const root = mkdtempSync(join(tmpdir(), 'scalpel-proxy-'))
  const cfg = {
    ...loadConfig({}), upstream: `http://127.0.0.1:${upstreamPort}`,
    paths: { root, spillDir: join(root, 'spill'), sessionsDir: join(root, 's'), dbPath: join(root, 'savings.db') },
  }
  proxy = createProxy(cfg)
  await new Promise<void>(r => proxy.listen(0, '127.0.0.1', r))
  proxyPort = (proxy.address() as { port: number }).port
})
afterAll(() => { proxy.close(); upstream.close() })

const post = (path: string, body: unknown) =>
  fetch(`http://127.0.0.1:${proxyPort}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-oauth' },
    body: JSON.stringify(body),
  })

describe('proxy', () => {
  it('streams SSE through byte-identically and transforms a doomed session', async () => {
    const m: Message[] = []
    const old = addToolCall(m, 'Read', { file_path: '/a.ts' }, 'OLD'.repeat(3000))
    pad(m, 6); addToolCall(m, 'Read', { file_path: '/a.ts' }, 'NEW'.repeat(3000)); pad(m, 6)
    const r1 = await post('/v1/messages', mkRequest(m))
    expect(await r1.text()).toBe(SSE) // byte-identical passthrough
    // second request, same session, simulated long idle via header for testability
    pad(m, 1)
    const r2 = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t', 'x-scalpel-test-now': String(Date.now() + 4_000_000) },
      body: JSON.stringify(mkRequest(m)),
    })
    expect(await r2.text()).toBe(SSE)
    const sent = JSON.parse(lastUpstreamBody)
    const stub = sent.messages[1].content[0]
    expect(stub.tool_use_id).toBe(old)
    expect(String(stub.content)).toContain('scalpel: output pruned')
  })
  it('passes non-/v1/messages traffic through untouched', async () => {
    const r = await post('/v1/messages/count_tokens', { model: 'm', messages: [] })
    expect(await r.json()).toEqual({ ok: true })
  })
  it('answers /scalpel/healthz locally', async () => {
    const r = await fetch(`http://127.0.0.1:${proxyPort}/scalpel/healthz`)
    expect((await r.json()).status).toBe('ok')
  })

  it('calibration: factor moves below 1 after proxied response with actual << estimated', async () => {
    // Standalone proxy/store so this test is independent of the others
    const calibRoot = mkdtempSync(join(tmpdir(), 'scalpel-calib-'))
    const calibCfg = {
      ...loadConfig({}),
      upstream: `http://127.0.0.1:${upstreamPort}`,
      paths: {
        root: calibRoot, spillDir: join(calibRoot, 'spill'),
        sessionsDir: join(calibRoot, 's'), dbPath: join(calibRoot, 'savings.db'),
      },
    }
    const calibProxy = createProxy(calibCfg)
    await new Promise<void>(r => calibProxy.listen(0, '127.0.0.1', r))
    const calibPort = (calibProxy.address() as { port: number }).port

    try {
      // Build a large request so estimated context >> actual 1060 (input=10+cacheRead=1000+cacheCreate=50)
      const m: Message[] = []
      for (let i = 0; i < 5; i++) addToolCall(m, 'Read', { file_path: `/big${i}.ts` }, 'X'.repeat(3000))
      const req1 = mkRequest(m)

      // First request: session first sighting (no cache state, no surgery), but proxy
      // still receives the usage response and should update calib
      await fetch(`http://127.0.0.1:${calibPort}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
        body: JSON.stringify(req1),
      })

      // Second request to same session: touch() persists calibFactor to meta.json
      const m2 = [...m]
      pad(m2, 1)
      await fetch(`http://127.0.0.1:${calibPort}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
        body: JSON.stringify(mkRequest(m2)),
      })

      // Read meta.json from disk (touch() writes it during the second request)
      const fp = fingerprintSession(req1)
      const metaPath = join(calibRoot, 's', fp, 'meta.json')
      expect(existsSync(metaPath)).toBe(true)
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      // estimated context is ~5*3000/3.5 tokens ≈ 4285 >> 1060 actual, so factor < 1
      expect(meta.calibFactor).toBeLessThan(1)
    } finally {
      calibProxy.close()
    }
  })
})
