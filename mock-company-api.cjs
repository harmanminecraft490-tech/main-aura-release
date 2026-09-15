const http = require('http')

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Not found' } }))
    return
  }

  let body = ''
  req.on('data', chunk => {
    body += chunk.toString()
  })

  req.on('end', () => {
    const parsed = JSON.parse(body || '{}')
    const stream = Boolean(parsed.stream)

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(`data: ${JSON.stringify({
        id: 'chatcmpl-mock-1',
        object: 'chat.completion.chunk',
        model: parsed.model || 'company-smart-1',
        choices: [{ index: 0, delta: { content: 'Hello from your company API.' }, finish_reason: null }],
      })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl-mock-2',
      object: 'chat.completion',
      model: parsed.model || 'company-smart-1',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 4,
        completion_tokens: 2,
        total_tokens: 6,
      },
    }))
  })
})

server.listen(8787, '127.0.0.1', () => {
  console.log('Mock company API listening on http://127.0.0.1:8787/v1')
})
