/**
 * 「跟随输入框」模式的测试。
 *
 * 核心契约：该模式只用输入框当前选择的模型，取不到时必须明确报错，
 * 绝不静默回退到其它模型。
 *
 * 用法：node .verify/composer-mode-test.mjs
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

const DEADLINE_MS = 45_000
const deadline = setTimeout(() => {
  console.log(`\nTIMEOUT after ${DEADLINE_MS}ms`)
  process.exit(1)
}, DEADLINE_MS)
deadline.unref?.()

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-composer-test-'))
process.env.DSH_HOME = tempHome

const plugin = await import(new URL('../index.js', import.meta.url).href)

// ---------------------------------------------------------------------------
// 假 ctx：sessionController 决定「输入框选择的模型」是什么
// ---------------------------------------------------------------------------

/** 被 sessionController.inspect 返回的事件列表。 */
let sessionEvents = []
/** 记录 LLM 服务实际收到的 provider/model。 */
const llmCalls = []

function makeContext(overrides = {}) {
  const store = {
    credentials: undefined,
    sessionController: {
      async inspect() {
        return { events: sessionEvents }
      },
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
    },
    llm: {
      async *stream(options) {
        llmCalls.push({ provider: options.provider, model: options.model })
        yield { type: 'text-delta', text: '改写后的提示词' }
        yield { type: 'finish', reason: { kind: 'success' } }
      },
    },
    ...overrides,
  }
  return {
    effect(callback) {
      return callback()
    },
    get(name) {
      return store[name]
    },
    webServer: {
      register(route) {
        store.__route = route
        return () => {}
      },
    },
  }
}

let activeTicket = null

function makeRes() {
  const state = { status: 0, body: '' }
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
    setHeader() {},
    end(body) {
      state.body = body ?? ''
      this.headersSent = true
      this.writableEnded = true
    },
  }
  return { res, state }
}

function makeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.socket = { remoteAddress: '127.0.0.1' }
  req.headers = {
    'x-dsh-prompt-optimization': '1',
    ...(url.endsWith('/status') ? {} : { 'x-dsh-prompt-optimization-ticket': activeTicket || '' }),
  }
  setTimeout(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  }, 5)
  return req
}

async function call(handler, method, url, body) {
  const { res, state } = makeRes()
  await handler(makeReq(method, url, body), res)
  let parsed
  try {
    parsed = JSON.parse(state.body)
  } catch {
    parsed = state.body
  }
  if (parsed && typeof parsed.ticket === 'string') activeTicket = parsed.ticket
  return { status: state.status, body: parsed }
}

/** 造一个带模型选择的事件，模拟输入框右下角的选择。 */
function requestHeaderEvent(provider, model) {
  return { type: 'request/header', data: { header: { config: { provider, model } } } }
}

const ctx = makeContext()
plugin.apply(ctx)
const handler = ctx.get('__route').handler
await call(handler, 'GET', '/dsh-prompt-optimization/status')

// ---------------------------------------------------------------------------
// 1. 设置可以保存 composer 模式
// ---------------------------------------------------------------------------

let response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { mode: 'composer' },
})
check('settings accept the composer mode', response.status === 200 && response.body.mode === 'composer', response.body)

response = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('the composer mode survives a read', response.body.mode === 'composer', response.body)

// 旧模式仍然可用
await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'account' } })
response = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('the account mode is still accepted', response.body.mode === 'account', response.body)

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'custom', baseURL: 'http://x/v1', model: 'm' } })
response = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('the custom mode is still accepted', response.body.mode === 'custom', response.body)

// 未知模式：保留当前已保存的合法模式，而不是把设置卡在非法值上。
await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'custom', baseURL: 'http://x/v1', model: 'm' } })
response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'nonsense' } })
check('an unknown mode keeps the saved mode', response.body.mode === 'custom', response.body.mode)

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'account' } })
response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'nonsense' } })
check('an unknown mode keeps the saved account mode', response.body.mode === 'account', response.body.mode)

// 全新安装（没有任何已保存设置）时，非法值回退到默认的 composer
await rm(join(tempHome, 'dsh-prompt-optimization'), { recursive: true, force: true })
await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'nonsense' } })
response = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('without a saved mode an unknown mode falls back to composer', response.body.mode === 'composer', response.body.mode)

// ---------------------------------------------------------------------------
// 2. 有会话模型时，用的正是输入框选的那个
// ---------------------------------------------------------------------------

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'composer' } })
sessionEvents = [
  requestHeaderEvent('old-provider', 'old-model'),
  requestHeaderEvent('composer-provider', 'composer-model'),
]
llmCalls.length = 0
response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', {
  text: '帮我写个函数',
  sessionId: 'session-composer',
})
check('the composer mode succeeds', response.status === 200, response.body)
check(
  'the composer-selected model is used',
  llmCalls.length === 1 && llmCalls[0].provider === 'composer-provider' && llmCalls[0].model === 'composer-model',
  llmCalls,
)

// 最新的选择优先（用户刚换过模型）
sessionEvents = [
  requestHeaderEvent('composer-provider', 'composer-model'),
  requestHeaderEvent('newest-provider', 'newest-model'),
]
llmCalls.length = 0
await call(handler, 'POST', '/dsh-prompt-optimization/optimize', {
  text: '帮我写个函数',
  sessionId: 'session-composer',
})
check(
  'the most recent composer selection wins',
  llmCalls[0]?.provider === 'newest-provider' && llmCalls[0]?.model === 'newest-model',
  llmCalls,
)

// ---------------------------------------------------------------------------
// 3. 取不到时必须报错，绝不回退
// ---------------------------------------------------------------------------

sessionEvents = []
llmCalls.length = 0
response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', {
  text: '帮我写个函数',
  sessionId: 'session-composer',
})
check('an unknown composer model reports an error', response.status === 400, response)
check('the error names the cause', response.body?.error?.code === 'composer_model_unknown', response.body)
check('no model was called', llmCalls.length === 0, llmCalls)

// 缺少 sessionId 同样报错
response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', { text: '帮我写个函数' })
check('a missing session id reports an error', response.status === 400, response)
check('the missing-session error is specific', response.body?.error?.code === 'composer_model_unknown', response.body)
check('no model was called without a session', llmCalls.length === 0, llmCalls)

// 关键：account 模式在同一条件下会回退到默认模型，composer 模式不会
await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'account' } })
sessionEvents = []
llmCalls.length = 0
response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', {
  text: '帮我写个函数',
  sessionId: 'session-composer',
})
check('the account mode does fall back', response.status === 200, response.body)
check(
  'the account mode falls back to the app default',
  llmCalls[0]?.provider === 'default-provider' && llmCalls[0]?.model === 'default-model',
  llmCalls,
)

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'composer' } })

// ---------------------------------------------------------------------------
// 4. 设置页提供的内置源与文案仍然完整
// ---------------------------------------------------------------------------

response = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('update sources are still offered', Array.isArray(response.body.defaults?.updateSources), response.body.defaults)

// ---------------------------------------------------------------------------

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((item) => item.name).join(', '))
  process.exitCode = 1
}
await rm(tempHome, { recursive: true, force: true })
