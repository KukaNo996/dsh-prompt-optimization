/**
 * Integration harness for the dsh-promt-refine Host half.
 * Runs the plugin's real route handler against fake ctx services, a temp DSH_HOME,
 * a local mock OpenAI-compatible server, and a fake LLM stream.
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-promt-refine-test-'))
process.env.DSH_HOME = tempHome

/** Fake Cordis context with exactly the services the Host half reads. */
function makeContext(services) {
  return {
    effect(callback) {
      return callback()
    },
    get(name) {
      return services[name]
    },
    webServer: {
      register(route) {
        services.__route = route
        return () => {}
      },
    },
  }
}

function makeRes() {
  const state = { status: 0, headers: {}, body: '' }
  const res = {
    headersSent: false,
    set statusCode(value) {
      state.status = value
    },
    get statusCode() {
      return state.status
    },
    setHeader(name, value) {
      state.headers[name.toLowerCase()] = value
    },
    end(body) {
      state.body = body ?? ''
      this.headersSent = true
    },
  }
  return { res, state }
}

function makeReq(method, url, body, headers) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { 'x-dsh-promt-refine': '1', ...(headers || {}) }
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

async function call(handler, method, url, body, headers) {
  const { res, state } = makeRes()
  await handler(makeReq(method, url, body, headers), res)
  let parsed
  try {
    parsed = JSON.parse(state.body)
  } catch {
    parsed = state.body
  }
  return { status: state.status, body: parsed }
}

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

// --- Mock OpenAI-compatible upstream ---------------------------------------
const mockRequests = []
const mockServer = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    mockRequests.push({ url: req.url, parsed })
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '# 优化后的提示词\n\n目标：完成测试。' } }],
      }),
    )
  })
})
await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve))
const mockPort = mockServer.address().port

// --- Import the plugin after DSH_HOME is set --------------------------------
const plugin = await import(new URL('../index.js', import.meta.url).href)

const emptyLlm = {
  async *stream() {
    throw new Error('should not be called')
  },
}

const ctx = makeContext({
  llm: emptyLlm,
  agentDefaultModel: {
    currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
  },
})
plugin.apply(ctx)
const handler = ctx.get('__route').handler
check('route mounted with prefix kind', ctx.get('__route').kind === 'prefix' && ctx.get('__route').path === '/dsh-promt-refine')

// --- 1. status -------------------------------------------------------------
let response = await call(handler, 'GET', '/dsh-promt-refine/status')
check('status 200 + ok', response.status === 200 && response.body.ok === true, response)
check('status reports account mode by default', response.body.mode === 'account', response.body)
check('showLabel defaults to true', response.body.showLabel === true, response.body)

// --- 1b. label preference round-trips --------------------------------------
response = await call(handler, 'POST', '/dsh-promt-refine/settings', {
  settings: { mode: 'account', provider: '', model: '', showLabel: false },
})
check('showLabel=false saved', response.status === 200 && response.body.showLabel === false, response)
response = await call(handler, 'GET', '/dsh-promt-refine/settings')
check('showLabel=false read back', response.body.showLabel === false, response.body)

// --- 2. save custom settings ----------------------------------------------
response = await call(handler, 'POST', '/dsh-promt-refine/settings', {
  settings: {
    mode: 'custom',
    baseURL: `http://127.0.0.1:${mockPort}/v1`,
    model: 'local-test-model',
    temperature: 0.2,
    maxTokens: 512,
  },
  apiKey: 'sk-test-1234567890',
})
check('save custom settings 200', response.status === 200, response)
check('api key stored masked', response.body.hasApiKey === true && response.body.apiKeyMasked.includes('7890'), response.body)
check('mode is custom', response.body.mode === 'custom', response.body)

const stored = JSON.parse(await readFile(join(tempHome, 'dsh-promt-refine', 'settings.json'), 'utf8'))
check('settings persisted key + fields', stored.apiKey === 'sk-test-1234567890' && stored.model === 'local-test-model', stored)

// --- 3. optimize through custom endpoint ----------------------------------
response = await call(handler, 'POST', '/dsh-promt-refine/optimize', { text: '帮我写一个登录页' })
check('custom optimize 200', response.status === 200, response)
check('custom optimize text cleaned', response.body.optimized.startsWith('# 优化后的提示词'), response.body)
check('custom endpoint received system + user', mockRequests.length === 1 && mockRequests[0].parsed.messages.length === 2, mockRequests)
check('custom endpoint path /v1/chat/completions', mockRequests[0]?.url === '/v1/chat/completions', mockRequests[0]?.url)
check('auth header model/max tokens forwarded', mockRequests[0]?.parsed.model === 'local-test-model' && mockRequests[0]?.parsed.max_tokens === 512, mockRequests[0]?.parsed)

// --- 4. account mode uses the LLM service --------------------------------
let seenOptions
const accountLlm = {
  async *stream(options) {
    seenOptions = options
    yield { type: 'text-delta', index: 0, text: '目标：' }
    yield { type: 'text-delta', index: 0, text: '账号模型结果' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
const accountCtx = makeContext({
  llm: accountLlm,
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) },
  sessionController: {
    inspect: async () => ({
      events: [{ type: 'request/header', data: { header: { config: { provider: 'deepseek-account', model: 'deepseek-pro' } } } }],
    }),
  },
})
plugin.apply(accountCtx)
const accountHandler = accountCtx.get('__route').handler

response = await call(accountHandler, 'POST', '/dsh-promt-refine/settings', {
  settings: { mode: 'account', provider: '', model: '' },
  clearApiKey: true,
})
check('switch back to account mode', response.status === 200 && response.body.mode === 'account', response)

response = await call(accountHandler, 'POST', '/dsh-promt-refine/optimize', {
  text: '把这段需求整理成提示词',
  sessionId: 'session-test',
})
check('account optimize 200', response.status === 200, response)
check('account optimize joined deltas', response.body.optimized === '目标：账号模型结果', response.body)
check('account session model preferred', seenOptions?.provider === 'deepseek-account' && seenOptions?.model === 'deepseek-pro', seenOptions)
check('account call carries system + user content', typeof seenOptions?.system === 'string' && Array.isArray(seenOptions?.messages?.[0]?.content), seenOptions?.messages)

// --- 5. default selection when no session --------------------------------
response = await call(accountHandler, 'POST', '/dsh-promt-refine/optimize', { text: '没有会话 id' })
check('account default selection used', response.status === 200 && seenOptions?.model === 'deepseek-flash', { response, seenOptions })

// --- 6. validation + errors ----------------------------------------------
response = await call(handler, 'POST', '/dsh-promt-refine/optimize', { text: '   ' })
check('empty input rejected 400', response.status === 400 && response.body.error.code === 'empty_input', response)

response = await call(handler, 'POST', '/dsh-promt-refine/optimize', { text: 'x' }, { 'x-dsh-promt-refine': '' })
check('missing CSRF marker rejected 403', response.status === 403 && response.body.error.code === 'forbidden', response)

response = await call(handler, 'GET', '/dsh-promt-refine/settings')
check('GET settings needs no CSRF marker', response.status === 200, response)

response = await call(handler, 'POST', '/dsh-promt-refine/settings', { settings: { mode: 'custom', baseURL: '', model: '' } })
response = await call(handler, 'POST', '/dsh-promt-refine/optimize', { text: 'x' })
check('missing base url rejected 400', response.status === 400 && response.body.error.code === 'missing_base_url', response)

response = await call(handler, 'GET', '/dsh-promt-refine/nope')
check('unknown route 404', response.status === 404 && response.body.error.code === 'not_found', response)

response = await call(handler, 'POST', '/dsh-promt-refine/settings', {
  settings: { mode: 'custom', baseURL: `http://127.0.0.1:${mockPort}/v1`, model: 'keep-key-model' },
  apiKey: 'sk-keep-me-0000',
})
check('save key for retention test', response.body.hasApiKey === true, response.body)
response = await call(handler, 'POST', '/dsh-promt-refine/settings', {
  settings: { mode: 'custom', baseURL: `http://127.0.0.1:${mockPort}/v1`, model: 'keep-key-model' },
  apiKey: '',
})
check('empty api key keeps stored key', response.body.hasApiKey === true, response.body)

// --- 7. upstream failure surfaces ----------------------------------------
const failingServer = createServer((req, res) => {
  res.statusCode = 500
  res.end(JSON.stringify({ error: { message: 'upstream exploded' } }))
})
await new Promise((resolve) => failingServer.listen(0, '127.0.0.1', resolve))
const failingPort = failingServer.address().port
await call(handler, 'POST', '/dsh-promt-refine/settings', {
  settings: { mode: 'custom', baseURL: `http://127.0.0.1:${failingPort}/v1`, model: 'x' },
  clearApiKey: true,
})
response = await call(handler, 'POST', '/dsh-promt-refine/optimize', { text: '触发错误' })
check('upstream 500 becomes readable 502', response.status === 502 && response.body.error.message.includes('upstream exploded'), response)

// --- cleanup ---------------------------------------------------------------
mockServer.close()
failingServer.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((item) => item.name).join(', '))
  process.exitCode = 1
}
await rm(tempHome, { recursive: true, force: true })
