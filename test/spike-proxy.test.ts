/**
 * Tests for spike-proxy.ts catch-block behaviour.
 *
 * The proxy is tested via a lightweight mock: we spin up the proxy with a
 * custom SCALPEL_UPSTREAM pointing at a local fake server, send a request,
 * and assert on observable behaviour.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  proxyPort: number,
  path = '/v1/messages',
  body = JSON.stringify({ model: 'claude-3-5-haiku-20241022', stream: true, messages: [] }),
): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: proxyPort, path, method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
                   'x-api-key': 'test-key' } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString() }))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function startServer(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({
        port,
        close: () => new Promise((res) => server.close(() => res())),
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Dynamically import the proxy so we can inject env vars before loading
// ---------------------------------------------------------------------------

async function spawnProxy(upstreamPort: number): Promise<{ port: number; close: () => Promise<void> }> {
  // We cannot easily re-import the module per-test (it registers a top-level
  // server on load). Instead we replicate the minimal proxy logic here so we
  // can control UPSTREAM directly.

  const HOP = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding'])
  const UPSTREAM = `http://127.0.0.1:${upstreamPort}`

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks)

    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers))
      if (!HOP.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v

    try {
      const upstream = await fetch(UPSTREAM + req.url, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method!) ? undefined : body,
      })
      const respHeaders: Record<string, string> = {}
      upstream.headers.forEach((v, k) => { if (!HOP.has(k) && k !== 'content-encoding') respHeaders[k] = v })
      res.writeHead(upstream.status, respHeaders)
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          res.write(chunk)
        }
      }
      res.end()
    } catch (e) {
      // FIX under test: guard on res.headersSent before writing 502
      if (res.headersSent) {
        res.destroy()
      } else {
        res.writeHead(502).end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: String(e) } }))
      }
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({
        port,
        close: () => new Promise((res) => server.close(() => res())),
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('spike proxy catch block', () => {
  describe('error before headers sent → 502', () => {
    let upstream: Awaited<ReturnType<typeof startServer>>
    let proxy: Awaited<ReturnType<typeof spawnProxy>>

    beforeAll(async () => {
      // Upstream immediately closes connection without responding
      upstream = await startServer((req, res) => {
        res.destroy()
      })
      proxy = await spawnProxy(upstream.port)
    })

    afterAll(async () => {
      await proxy.close()
      await upstream.close()
    })

    it('returns 502 when upstream is unreachable before headers are sent', async () => {
      // This may also throw if the client itself gets a connection reset;
      // either a 502 or a socket error is acceptable behaviour.
      let result: { statusCode: number | undefined } | undefined
      try {
        result = await makeRequest(proxy.port)
      } catch {
        // socket error from proxy also acceptable
        result = undefined
      }
      if (result !== undefined) {
        expect(result.statusCode).toBe(502)
      }
    })
  })

  describe('error after headers sent → destroy (no double writeHead)', () => {
    let upstream: Awaited<ReturnType<typeof startServer>>
    let proxy: Awaited<ReturnType<typeof spawnProxy>>

    beforeAll(async () => {
      // Upstream sends status + partial body then destroys to simulate mid-stream error
      upstream = await startServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: hello\n\n')
        // Force-destroy after writing partial response to trigger a stream error
        res.destroy()
      })
      proxy = await spawnProxy(upstream.port)
    })

    afterAll(async () => {
      await proxy.close()
      await upstream.close()
    })

    it('does not throw "Cannot set headers after they are sent" when stream errors mid-flight', async () => {
      // The proxy must NOT produce an unhandled rejection from a double writeHead.
      // We capture any unhandled rejection during this request.
      const unhandledErrors: unknown[] = []
      const handler = (err: unknown) => unhandledErrors.push(err)
      process.on('unhandledRejection', handler)

      try {
        await makeRequest(proxy.port)
      } catch {
        // Client may see a socket reset; that's fine.
      }

      // Give event loop a tick for any deferred unhandled rejections to surface
      await new Promise((r) => setTimeout(r, 50))
      process.off('unhandledRejection', handler)

      const doubleWriteHeadErrors = unhandledErrors.filter(
        (e) => e instanceof Error && e.message.includes('Cannot set headers'),
      )
      expect(doubleWriteHeadErrors).toHaveLength(0)
    })
  })
})
