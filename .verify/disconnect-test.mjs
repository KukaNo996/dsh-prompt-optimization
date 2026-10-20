/**
 * 验证「客户端中断」能被 Host 感知。
 *
 * 根因：connectionSignal 的 onClose 有一个 `res.destroyed` 的守卫。客户端
 * abort 一个 fetch 时，响应已经被销毁，这个守卫直接 return，abort 定时器
 * 从未注册——模型调用因此完全不知道客户端已经走了，继续生成、继续往一个
 * 死掉的 socket 写。表现就是「点击中断没有效果」，并让程序卡住。
 *
 * 用法：node .verify/disconnect-test.mjs
 */
import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

const DEADLINE_MS = 60_000
const deadline = setTimeout(() => {
  console.log(`\nTIMEOUT after ${DEADLINE_MS}ms`)
  process.exit(1)
}, DEADLINE_MS)
deadline.unref?.()

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-disconnect-test-'))
process.env.DSH_HOME = tempHome

const plugin = await import(new URL('../index.js', import.meta.url).href)

// ---------------------------------------------------------------------------
// 1. 单元层面：connectionSignal 必须能感知各种断开形态
// ---------------------------------------------------------------------------

// 直接从源码里取出 connectionSignal 以便单独验证。
const src = await (await import('node:fs/promises')).readFile(new URL('../index.js', import.meta.url), 'utf8')
const start = src.indexOf('function connectionSignal(')
const end = src.indexOf('\n}\n', start) + 3
const module_ = await import(
  `data:text/javascript,${encodeURIComponent(
    `const DISCONNECT_GRACE_MS = 2000\n${src.slice(start, end)}\nexport { connectionSignal }`,
  )}`,
)
const { connectionSignal } = module_

// 形态 A：响应已销毁（客户端 abort 时的典型状态），请求还没 close
{
  const req = new EventEmitter()
  const res = new EventEmitter()
  res.writableEnded = false
  res.destroyed = true
  const link = connectionSignal(req, res)
  res.emit('close')
  await new Promise((r) => setTimeout(r, 2400))
  check('a destroyed response is detected as a disconnect', link.signal.aborted, 'never aborted')
}

// 形态 B：请求 close，响应正常
{
  const req = new EventEmitter()
  const res = new EventEmitter()
  res.writableEnded = false
  res.destroyed = false
  const link = connectionSignal(req, res)
  req.emit('close')
  await new Promise((r) => setTimeout(r, 2400))
  check('a closed request is detected as a disconnect', link.signal.aborted, 'never aborted')
}

// 形态 C：响应已正常写完 —— 这不是断开，不应 abort
{
  const req = new EventEmitter()
  const res = new EventEmitter()
  res.writableEnded = true
  res.destroyed = true
  const link = connectionSignal(req, res)
  res.emit('close')
  req.emit('close')
  await new Promise((r) => setTimeout(r, 2400))
  check('a finished response is not treated as a disconnect', !link.signal.aborted, 'aborted although the response was finished')
}

// ---------------------------------------------------------------------------
// 2. 端到端：客户端 abort 后，模型调用必须被中止
// ---------------------------------------------------------------------------

let modelAborted = false
let modelCalls = 0

const llm = {
  async *stream(options) {
    modelCalls += 1
    try {
      // 生成很久，除非被中止。
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 60_000)
        options.signal?.addEventListener('abort', () => {
          modelAborted = true
          clearTimeout(timer)
          reject(options.signal.reason ?? new Error('aborted'))
        })
      })
    } catch (error) {
      // 模拟真实的流：中止时结束迭代。
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted' } } }
      return
    }
    yield { type: 'text-delta', text: '完成' }
    yield { type: 'finish', reason: { kind: 'success' } }
  },
}

const store = {
  credentials: undefined,
  llm,
  sessionController: { async inspect() { return { events: [] } } },
  agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
}
const ctx = {
  effect(callback) { return callback() },
  get(name) { return store[name] },
  webServer: { register(route) { store.__route = route; return () => {} } },
}
plugin.apply(ctx)
const handler = store.__route.handler

let activeTicket = null
function makeRes() {
  const state = { status: 0, body: '', chunks: [] }
  // The response is an EventEmitter so the disconnect can be simulated the way
  // an aborted fetch produces it: the response is destroyed and closed.
  const res = new EventEmitter()
  Object.assign(res, {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    set statusCode(value) { state.status = value },
    get statusCode() { return state.status },
    setHeader() {},
    write(chunk) { state.chunks.push(String(chunk)) },
    end(chunk) {
      if (chunk !== undefined) state.chunks.push(String(chunk))
      state.body = state.chunks.join('')
      this.headersSent = true
      this.writableEnded = true
    },
  })
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
async function call(method, url, body) {
  const { res, state } = makeRes()
  await handler(makeReq(method, url, body), res)
  let parsed
  try { parsed = JSON.parse(state.body) } catch { parsed = state.body }
  if (parsed && typeof parsed.ticket === 'string') activeTicket = parsed.ticket
  return { status: state.status, body: parsed, raw: state.body }
}
await call('GET', '/dsh-prompt-optimization/status')
await call('POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'account', candidates: 1, maxWaitSeconds: 60 } })

// 发起一个长时间优化，然后在响应过程中销毁响应（模拟客户端 abort）
{
  const { res } = makeRes()
  const req = makeReq('POST', '/dsh-prompt-optimization/optimize/stream', { text: '写个函数', sessionId: 's' })
  const pending = handler(req, res)
  // 等模型调用开始
  await new Promise((r) => setTimeout(r, 200))
  check('the model call started', modelCalls > 0, { modelCalls })
  // 模拟客户端断开：销毁响应并触发 close
  res.destroyed = true
  res.emit('close')
  await pending
  await new Promise((r) => setTimeout(r, 2600))
  check('the model call is aborted when the client disconnects', modelAborted, { modelAborted })
}

// ---------------------------------------------------------------------------

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((item) => item.name).join(', '))
  process.exitCode = 1
}
await rm(tempHome, { recursive: true, force: true })
