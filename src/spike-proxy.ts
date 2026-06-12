// Spike 1: pure logging passthrough. Proves ANTHROPIC_BASE_URL + OAuth + SSE work.
import http from 'node:http'

const PORT = Number(process.env.SCALPEL_PORT ?? 4242)
const UPSTREAM = process.env.SCALPEL_UPSTREAM ?? 'https://api.anthropic.com'

const HOP = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding'])

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = Buffer.concat(chunks)

  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers))
    if (!HOP.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v

  const auth = req.headers.authorization ? 'oauth-bearer' : req.headers['x-api-key'] ? 'api-key' : 'NONE'
  let summary = ''
  try {
    const j = JSON.parse(body.toString() || '{}')
    summary = `model=${j.model} stream=${j.stream} msgs=${j.messages?.length} sys=${typeof j.system} tools=${j.tools?.length ?? 0}`
  } catch { summary = `(non-JSON ${body.length}B)` }
  console.log(`→ ${req.method} ${req.url} auth=${auth} ${summary}`)

  try {
    const upstream = await fetch(UPSTREAM + req.url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method!) ? undefined : body,
    })
    const respHeaders: Record<string, string> = {}
    upstream.headers.forEach((v, k) => { if (!HOP.has(k) && k !== 'content-encoding') respHeaders[k] = v })
    res.writeHead(upstream.status, respHeaders)
    let bytes = 0, events = 0
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        bytes += chunk.length
        events += (Buffer.from(chunk).toString().match(/^event:/gm) ?? []).length
        res.write(chunk)
      }
    }
    res.end()
    console.log(`← ${upstream.status} ${bytes}B ${events} SSE events`)
  } catch (e) {
    console.error('UPSTREAM ERROR', e)
    if (res.headersSent) {
      res.destroy()
    } else {
      res.writeHead(502).end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: String(e) } }))
    }
  }
})
server.listen(PORT, '127.0.0.1', () => console.log(`spike proxy on http://127.0.0.1:${PORT} → ${UPSTREAM}`))
