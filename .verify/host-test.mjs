/**
 * Integration harness for the dsh-prompt-optimization Host half.
 * Runs the plugin's real route handler against fake ctx services, a temp DSH_HOME,
 * a local mock OpenAI-compatible server, and a fake LLM stream.
 */
import { createServer } from 'node:http'
import { randomBytes as cryptoRandomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-prompt-optimization-test-'))
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
    writableEnded: false,
    destroyed: false,
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
      this.writableEnded = true
    },
  }
  return { res, state }
}

/** Tickets handed out by /status are collected so later calls can present them. */
let activeTicket = null

function makeReq(method, url, body, headers) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.socket = { remoteAddress: '127.0.0.1' }
  const isStatus = url.endsWith('/status')
  req.headers = {
    'x-dsh-prompt-optimization': '1',
    ...(isStatus ? {} : { 'x-dsh-prompt-optimization-ticket': activeTicket || '' }),
    ...(headers || {}),
  }
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) delete req.headers[name]
  }
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

async function call(handler, method, url, body, headers) {
  const { res, state } = makeRes()
  const req = makeReq(method, url, body, headers)
  await handler(req, res)
  let parsed
  try {
    parsed = JSON.parse(state.body)
  } catch {
    parsed = state.body
  }
  if (parsed && typeof parsed.ticket === 'string') activeTicket = parsed.ticket
  return { status: state.status, body: parsed }
}

/** Fetch a fresh ticket from one handler (every plugin activation issues its own). */
async function refreshTicket(handler) {
  activeTicket = null
  const { res, state } = makeRes()
  await handler(makeReq('GET', '/dsh-prompt-optimization/status'), res)
  try {
    const payload = JSON.parse(state.body)
    if (payload && typeof payload.ticket === 'string') activeTicket = payload.ticket
  } catch {
    activeTicket = null
  }
  return activeTicket
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

/** In-memory stand-in for the Host credential service. */
function makeCredentialService() {
  const store = new Map()
  return {
    store,
    async set(ref, value) {
      if (!value) throw new Error('empty value')
      store.set(ref, value)
    },
    async unset(ref) {
      store.delete(ref)
    },
    async resolve(ref) {
      return store.has(ref) ? { value: store.get(ref), source: 'test' } : undefined
    },
    async describe(ref) {
      return { configured: store.has(ref), writable: true }
    },
  }
}

const credentials = makeCredentialService()
const ctx = makeContext({
  llm: emptyLlm,
  credentials,
  agentDefaultModel: {
    currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
  },
})
plugin.apply(ctx)
const handler = ctx.get('__route').handler
check('route mounted with prefix kind', ctx.get('__route').kind === 'prefix' && ctx.get('__route').path === '/dsh-prompt-optimization')

// --- 1. status -------------------------------------------------------------
let response = await call(handler, 'GET', '/dsh-prompt-optimization/status')
check('status 200 + ok', response.status === 200 && response.body.ok === true, response)
check('status issues a request ticket', typeof response.body.ticket === 'string' && response.body.ticket.length >= 32, response.body)
check('status reports composer mode by default', response.body.mode === 'composer', response.body)
check('showLabel defaults to false (icon only)', response.body.showLabel === false, response.body)

// --- 1a. ticket and origin gates -------------------------------------------
response = await call(handler, 'GET', '/dsh-prompt-optimization/settings', undefined, { 'x-dsh-prompt-optimization-ticket': '' })
check('settings without ticket rejected 403', response.status === 403 && response.body.error.code === 'forbidden', response)
response = await call(handler, 'GET', '/dsh-prompt-optimization/settings', undefined, { 'x-dsh-prompt-optimization-ticket': 'x'.repeat(activeTicket.length) })
check('settings with wrong ticket rejected 403', response.status === 403, response)
response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: {} }, { origin: 'https://evil.example' })
check('cross-origin write rejected 403', response.status === 403, response)

// --- 1b. label preference round-trips --------------------------------------
// 默认关闭（仅图标）；开启后同时显示「优化提示词」和「撤回」文字。
response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'account', provider: '', model: '', showLabel: true },
})
check('showLabel=true saved', response.status === 200 && response.body.showLabel === true, response)
response = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('showLabel=true read back', response.body.showLabel === true, response.body)
response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'account', provider: '', model: '', showLabel: false },
})
check('showLabel=false saved', response.status === 200 && response.body.showLabel === false, response)
response = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('showLabel=false read back', response.body.showLabel === false, response.body)

// --- 2. save custom settings ----------------------------------------------
response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', {
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

const stored = JSON.parse(await readFile(join(tempHome, 'dsh-prompt-optimization', 'settings.json'), 'utf8'))
check('settings persisted non-secret fields', stored.model === 'local-test-model' && stored.mode === 'custom', stored)
check('saved key lives in the credential store', [...credentials.store.values()].includes('sk-test-1234567890'), [...credentials.store.entries()])

// --- 3. optimize through custom endpoint ----------------------------------
response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', { text: '帮我写一个登录页' })
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
await refreshTicket(accountHandler)

response = await call(accountHandler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'account', provider: '', model: '' },
  clearApiKey: true,
})
check('switch back to account mode', response.status === 200 && response.body.mode === 'account', response)

response = await call(accountHandler, 'POST', '/dsh-prompt-optimization/optimize', {
  text: '把这段需求整理成提示词',
  sessionId: 'session-test',
})
check('account optimize 200', response.status === 200, response)
check('account optimize joined deltas', response.body.optimized === '目标：账号模型结果', response.body)
check('account session model preferred', seenOptions?.provider === 'deepseek-account' && seenOptions?.model === 'deepseek-pro', seenOptions)
check('account call carries system + user content', typeof seenOptions?.system === 'string' && Array.isArray(seenOptions?.messages?.[0]?.content), seenOptions?.messages)

// --- 5. default selection when no session --------------------------------
response = await call(accountHandler, 'POST', '/dsh-prompt-optimization/optimize', { text: '没有会话 id' })
check('account default selection used', response.status === 200 && seenOptions?.model === 'deepseek-flash', { response, seenOptions })

// --- 6. validation + errors ----------------------------------------------
await refreshTicket(handler)
response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', { text: '   ' })
check('empty input rejected 400', response.status === 400 && response.body.error.code === 'empty_input', response)

response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', { text: 'x' }, { 'x-dsh-prompt-optimization': '' })
check('missing CSRF marker rejected 403', response.status === 403 && response.body.error.code === 'forbidden', response)
await refreshTicket(handler)

response = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('GET settings with ticket works', response.status === 200, response)

response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'custom', baseURL: '', model: '' } })
response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', { text: 'x' })
check('missing base url rejected 400', response.status === 400 && response.body.error.code === 'missing_base_url', response)

response = await call(handler, 'GET', '/dsh-prompt-optimization/nope')
check('unknown route 404', response.status === 404 && response.body.error.code === 'not_found', response)

// --- 6b. credential store holds the key, file does not --------------------
await call(handler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'custom', baseURL: `http://127.0.0.1:${mockPort}/v1`, model: 'keep-key-model' },
  apiKey: 'sk-keep-me-0000',
})
check('key written to credential store', [...credentials.store.values()].includes('sk-keep-me-0000'), [...credentials.store.entries()])
const persisted = JSON.parse(await readFile(join(tempHome, 'dsh-prompt-optimization', 'settings.json'), 'utf8'))
check('plaintext key absent from settings.json', !persisted.apiKey, persisted)
response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'custom', baseURL: `http://127.0.0.1:${mockPort}/v1`, model: 'keep-key-model' },
  apiKey: '',
})
check('empty api key keeps stored key', response.body.hasApiKey === true && response.body.keyStorage === 'credential', response.body)
response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'custom', baseURL: `http://127.0.0.1:${mockPort}/v1`, model: 'keep-key-model' },
  clearApiKey: true,
})
check('clear key removes credential', response.body.hasApiKey === false && credentials.store.size === 0, response.body)

// --- 6c. rate limit on model routes ---------------------------------------
let rateLimited = null
for (let index = 0; index < 12; index += 1) {
  const attempt = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', { text: '限流测试' })
  if (attempt.status === 429) {
    rateLimited = attempt
    break
  }
}
check('optimize route is rate limited', rateLimited !== null && rateLimited.body.error.code === 'rate_limited', rateLimited)

// --- 6d. multi-candidate evaluation ---------------------------------------
// A fresh handler resets the per-source budget; a dedicated mock returns drafts
// that differ so the judge can single one out.
//
// The N drafts are requested in parallel, so arrival order is not deterministic
// and no counter may be shared across requests. Instead the judge answers with a
// position, and the assertion checks that the returned text is exactly the draft
// that the judge was shown at that position in its own prompt — which is the
// behaviour that actually matters and is order-independent.
const judged = []
const judgeServer = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    const system = parsed.messages?.[0]?.content || ''
    const user = parsed.messages?.[1]?.content || ''
    judged.push({ system, user })
    // Every draft is byte-identical except for a unique nonce, so the chosen
    // draft can be identified no matter which request arrived first.
    const nonce = cryptoRandomBytes(3).toString('hex')
    const content = system.includes('评审员')
      ? '3'
      : `# 草稿 ${nonce}\n\n目标：改写草稿\n\n1. 步骤一\n2. 步骤二\n\n验收标准：通过`
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
  })
})
await new Promise((resolve) => judgeServer.listen(0, '127.0.0.1', resolve))
const judgePort = judgeServer.address().port
const evalCtx = makeContext({
  llm: emptyLlm,
  credentials: makeCredentialService(),
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) },
})
plugin.apply(evalCtx)
const evalHandler = evalCtx.get('__route').handler
activeTicket = null
await refreshTicket(evalHandler)
await call(evalHandler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'custom', baseURL: `http://127.0.0.1:${judgePort}/v1`, model: 'judge-model', candidates: 3 },
})
response = await call(evalHandler, 'POST', '/dsh-prompt-optimization/optimize', { text: '多候选评估测试' })
const draftCalls = judged.filter((entry) => !entry.system.includes('评审员'))
const judgeCalls = judged.filter((entry) => entry.system.includes('评审员'))
check('evaluation issues N draft calls', draftCalls.length === 3, { draftCalls: draftCalls.length })
check('evaluation issues one judge call', judgeCalls.length === 1, { judgeCalls: judgeCalls.length })
check('judge sees every candidate', judgeCalls[0]?.user.includes('【候选 1】') && judgeCalls[0]?.user.includes('【候选 3】'), judgeCalls[0]?.user?.slice(0, 200))
check('judge choice is returned', response.status === 200 && response.body.candidates === 3 && response.body.chosen === 3, response.body)
// The returned draft must be the one the judge saw at position 3, whatever order
// the parallel draft requests happened to arrive in.
const thirdCandidate = /【候选 3】\n([^【]*)/.exec(judgeCalls[0]?.user || '')?.[1]?.trim()
check(
  'chosen draft is the judged candidate',
  Boolean(thirdCandidate) && response.body.optimized === thirdCandidate,
  { chosen: response.body.optimized?.slice(0, 40), expected: thirdCandidate?.slice(0, 40) },
)
response = await call(evalHandler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'custom', baseURL: `http://127.0.0.1:${judgePort}/v1`, model: 'judge-model', candidates: 1 },
})
const beforeSingle = judged.length
response = await call(evalHandler, 'POST', '/dsh-prompt-optimization/optimize', { text: '单次优化' })
check('candidates=1 keeps single call', judged.length - beforeSingle === 1 && response.body.candidates === 1, { calls: judged.length - beforeSingle, body: response.body })

// --- 6e. cancellation aborts the model call ------------------------------
const slowServer = createServer((req, res) => {
  req.on('data', () => {})
  req.on('end', () => {
    setTimeout(() => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '迟到的结果' } }] }))
    }, 5000)
  })
})
await new Promise((resolve) => slowServer.listen(0, '127.0.0.1', resolve))
const slowPort = slowServer.address().port
const abortCtx = makeContext({
  llm: emptyLlm,
  credentials: makeCredentialService(),
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) },
})
plugin.apply(abortCtx)
const abortHandler = abortCtx.get('__route').handler
activeTicket = null
await refreshTicket(abortHandler)
await call(abortHandler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'custom', baseURL: `http://127.0.0.1:${slowPort}/v1`, model: 'slow-model' },
})
const abortedCall = (async () => {
  const { res, state } = makeRes()
  const req = makeReq('POST', '/dsh-prompt-optimization/optimize', { text: '取消测试' })
  const pending = abortHandler(req, res)
  setTimeout(() => req.emit('close'), 150)
  await pending
  return { status: state.status, body: JSON.parse(state.body || '{}') }
})()
response = await abortedCall
check('disconnected request reports 499', response.status === 499 && response.body.error.code === 'aborted', response)

// --- 7. upstream failure surfaces ----------------------------------------
// A dedicated activation keeps this section inside its own rate budget.
const failingServer = createServer((req, res) => {
  res.statusCode = 500
  res.end(JSON.stringify({ error: { message: 'upstream exploded' } }))
})
await new Promise((resolve) => failingServer.listen(0, '127.0.0.1', resolve))
const failingPort = failingServer.address().port
const failCtx = makeContext({
  llm: emptyLlm,
  credentials: makeCredentialService(),
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) },
})
plugin.apply(failCtx)
const failHandler = failCtx.get('__route').handler
activeTicket = null
await refreshTicket(failHandler)
await call(failHandler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'custom', baseURL: `http://127.0.0.1:${failingPort}/v1`, model: 'x' },
  clearApiKey: true,
})
await refreshTicket(failHandler)
response = await call(failHandler, 'POST', '/dsh-prompt-optimization/optimize', { text: '触发错误' })
check('upstream 500 becomes readable 502', response.status === 502 && response.body.error.message.includes('upstream exploded'), response)

// --- cleanup ---------------------------------------------------------------
mockServer.close()
failingServer.close()
judgeServer.close()
slowServer.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((item) => item.name).join(', '))
  process.exitCode = 1
}
await rm(tempHome, { recursive: true, force: true })
