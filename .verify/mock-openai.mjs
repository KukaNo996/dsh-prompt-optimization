/** Tiny OpenAI-compatible mock used by the live custom-endpoint verification. */
import { createServer } from 'node:http'

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    let parsed = {}
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      parsed = {}
    }
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: `# 目标\n来自本地自定义模型（${parsed.model ?? 'unknown'}）的测试结果。`,
            },
          },
        ],
      }),
    )
  })
})

server.listen(31999, '127.0.0.1', () => {
  console.log('mock listening on 31999')
})
