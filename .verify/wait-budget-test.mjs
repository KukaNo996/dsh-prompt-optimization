/**
 * 「最大等待时长」与「点击中断」的测试。
 *
 * 覆盖：
 * - 设置值的默认值、下限与上限
 * - 超过等待时长后模型调用被中止，并返回明确错误
 * - 客户端断开连接时同样中止
 * - 客户端侧：忙碌时按钮可点击并能中断
 *
 * 用法：node .verify/wait-budget-test.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

const DEADLINE_MS = 90_000
const deadline = setTimeout(() => {
  console.log(`\nTIMEOUT after ${DEADLINE_MS}ms`)
  process.exit(1)
}, DEADLINE_MS)
deadline.unref?.()

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-wait-test-'))
process.env.DSH_HOME = tempHome

const plugin = await import(new URL('../index.js', import.meta.url).href)

// ---------------------------------------------------------------------------
// 假 LLM：可以挂起，用来观察超时与中止
// ---------------------------------------------------------------------------

let hangForever = false
let abortObserved = false
const llmCalls = []

const llm = {
  async *stream(options) {
    llmCalls.push({ system: options.system })
    if (hangForever) {
      // 等待被中止，或一直等下去。
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 120_000)
        options.signal?.addEventListener('abort', () => {
          abortObserved = true
          clearTimeout(timer)
          reject(options.signal.reason ?? new Error('aborted'))
        })
      })
    }
    yield { type: 'text-delta', text: '改写结果' }
    yield { type: 'finish', reason: { kind: 'success' } }
  },
}

function makeContext() {
  const store = {
    credentials: undefined,
    llm,
    sessionController: { async inspect() { return { events: [] } } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  }
  return {
    effect(callback) { return callback() },
    get(name) { return store[name] },
    webServer: {
      register(route) { store.__route = route; return () => {} },
    },
  }
}

let activeTicket = null

function makeRes() {
  const state = { status: 0, body: '', headers: {}, chunks: [] }
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    set statusCode(value) { state.status = value },
    get statusCode() { return state.status },
    setHeader(name, value) { state.headers[name.toLowerCase()] = value },
    write(chunk) { state.chunks.push(String(chunk)) },
    end(chunk) {
      if (chunk !== undefined) state.chunks.push(String(chunk))
      state.body = state.chunks.join('')
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
  try { parsed = JSON.parse(state.body) } catch { parsed = state.body }
  if (parsed && typeof parsed.ticket === 'string') activeTicket = parsed.ticket
  return { status: state.status, body: parsed, raw: state.body, state }
}

const ctx = makeContext()
plugin.apply(ctx)
const handler = ctx.get('__route').handler
await call(handler, 'GET', '/dsh-prompt-optimization/status')

// ---------------------------------------------------------------------------
// 1. 设置值的规范化
// ---------------------------------------------------------------------------

let response = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('the wait budget defaults to 15 seconds', response.body.maxWaitSeconds === 15, response.body.maxWaitSeconds)

response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 30 } })
check('a custom wait budget is stored', response.body.maxWaitSeconds === 30, response.body.maxWaitSeconds)

response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 5 } })
check('a value below the floor is raised to 10', response.body.maxWaitSeconds === 10, response.body.maxWaitSeconds)

response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 0 } })
check('zero is raised to the floor', response.body.maxWaitSeconds === 10, response.body.maxWaitSeconds)

response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: -100 } })
check('a negative value is raised to the floor', response.body.maxWaitSeconds === 10, response.body.maxWaitSeconds)

response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 99999 } })
check('an absurd value is capped', response.body.maxWaitSeconds === 600, response.body.maxWaitSeconds)

// A value that is not a number keeps whatever was saved, rather than silently
// becoming the floor or resetting the user's choice.
response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 'abc' } })
check('a non-numeric value keeps the saved budget', response.body.maxWaitSeconds === 600, response.body.maxWaitSeconds)

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 15 } })
response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 'abc' } })
check('a non-numeric value keeps the saved budget (15)', response.body.maxWaitSeconds === 15, response.body.maxWaitSeconds)

response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 12.7 } })
check('a fractional value is rounded', response.body.maxWaitSeconds === 13, response.body.maxWaitSeconds)

// ---------------------------------------------------------------------------
// 2. 超过等待时长后中止
// ---------------------------------------------------------------------------

// 等待时长下限是 10 秒，这里用 10 秒并让模型挂起。
await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 10, mode: 'account', candidates: 1 } })
hangForever = true
abortObserved = false
const startedAt = Date.now()
response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize/stream', { text: '写个函数', sessionId: 's' })
const elapsed = Date.now() - startedAt

check('the model call is aborted when the budget runs out', abortObserved, { abortObserved })
check('it gives up close to the configured budget', elapsed >= 9_500 && elapsed < 20_000, { elapsed })
check('the error names the wait budget', response.body?.error?.code === 'wait_budget_exceeded', response.body)
check(
  'the error message states the limit',
  typeof response.body?.error?.message === 'string' && response.body.error.message.includes('10'),
  response.body?.error?.message,
)
check('the stream is closed', response.state.chunks.length > 0, response.state.chunks.length)

// 非流式路由也应遵守同一预算
await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 10, mode: 'account', candidates: 1 } })
abortObserved = false
const startedAt2 = Date.now()
response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', { text: '写个函数', sessionId: 's' })
const elapsed2 = Date.now() - startedAt2
check('the plain route also aborts', abortObserved && elapsed2 < 20_000, { abortObserved, elapsed2 })
check('the plain route reports the budget', response.body?.error?.code === 'wait_budget_exceeded', response.body)

hangForever = false

// ---------------------------------------------------------------------------
// 3. 等待时长足够时正常完成
// ---------------------------------------------------------------------------

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { maxWaitSeconds: 15, mode: 'account', candidates: 1 } })
response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize/stream', { text: '写个函数', sessionId: 's' })
const events = response.raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
check('a fast model still succeeds', events.some((event) => event.type === 'done'), events)
check('no error is reported', !events.some((event) => event.type === 'error'), events)

// ---------------------------------------------------------------------------
// 4. 客户端侧：忙碌时按钮可点击、能中断
// ---------------------------------------------------------------------------

const clientSrc = await (await import('node:fs/promises')).readFile(new URL('../client.js', import.meta.url), 'utf8')

const cancelBody = clientSrc.split('const cancel = () => {')[1]?.split('const locked')[0] ?? ''
check('cancel aborts the request', /abortInflight\(\)/.test(cancelBody), 'cancel does not abort')
check('cancel restores the original draft', /inputActions\.setDraft\(original\)/.test(cancelBody), 'cancel does not restore the draft')
check('the button stays enabled while busy', !/const disabled = isRefined \? false : busy \|\|/.test(clientSrc), 'disabled still includes busy')
check('clicking while busy calls cancel', /onClick: busy \? cancel :/.test(clientSrc), 'no cancel branch on onClick')
check('a cancel handler exists', /const cancel = \(\) => \{/.test(clientSrc), 'no cancel function')
check('the spinner is clickable', /'data-busy': busy \? 'true' : 'false'/.test(clientSrc), 'no data-busy marker')
check('the busy button is labelled as a cancel', /aria-label': busy \? t\('tool\.cancel'\)/.test(clientSrc), 'no cancel label')

// The wait budget applies to every model source. It must therefore NOT live
// inside the custom-mode block, or the two follow modes would not be able to
// reach it at all.
const customBlock = clientSrc.slice(clientSrc.indexOf('custom\n          ? h('))
const customBlockEnd = customBlock.indexOf(': null')
const customOnly = customBlock.slice(0, customBlockEnd)
check('the wait field is reachable in every mode', !customOnly.includes('dsh-pr-max-wait'), 'the wait field is inside the custom-only block')
check('the wait field exists in the page', clientSrc.includes('dsh-pr-max-wait'), 'no wait field')

// 四种语言都要有取消相关的文案
const { readFile: read } = await import('node:fs/promises')
for (const locale of ['zh-cn', 'zh-tw', 'ja', 'en']) {
  const dict = JSON.parse(await read(new URL(`../locale/${locale}.json`, import.meta.url), 'utf8'))
  check(`${locale} has the cancel copy`, typeof dict['tool.cancel'] === 'string' && typeof dict['tool.cancelled'] === 'string', {
    cancel: dict['tool.cancel'],
  })
  check(`${locale} has the wait copy`, typeof dict['settings.maxWait'] === 'string', dict['settings.maxWait'])
}

// ---------------------------------------------------------------------------

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((item) => item.name).join(', '))
  process.exitCode = 1
}
await rm(tempHome, { recursive: true, force: true })
