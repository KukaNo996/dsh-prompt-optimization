/**
 * 「流式输出」与「根据上下文优化」的测试。
 *
 * 覆盖：
 * - 流式接口逐段返回 delta，最终 done 事件带完整文本
 * - 多候选时只流式输出评审选中的那一份
 * - 上下文模式下会话历史被压缩并注入改写请求
 * - 上下文开关默认关闭
 *
 * 用法：node .verify/stream-context-test.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

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

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-stream-test-'))
process.env.DSH_HOME = tempHome

const plugin = await import(new URL('../index.js', import.meta.url).href)

// ---------------------------------------------------------------------------
// 假 LLM：可配置分片内容、评审回答
// ---------------------------------------------------------------------------

/** 每个 LLM 调用记录其 system 与 user，用于断言上下文注入。 */
const llmCalls = []
/** 草稿生成时返回的分片。 */
let draftPieces = ['改写后', '的提示词', '内容']
/** 评审回答；数字字符串表示选中的候选序号。 */
let judgeAnswer = '1'
/** 压缩阶段的回答。 */
let contextAnswer = '用户偏好简洁的中文表达'

const llm = {
  async *stream(options) {
    llmCalls.push({ system: options.system, user: JSON.stringify(options.messages) })
    const isJudge = typeof options.system === 'string' && options.system.includes('评审员')
    const isContext = typeof options.system === 'string' && options.system.includes('上下文分析器')
    if (isJudge) {
      yield { type: 'text-delta', text: judgeAnswer }
    } else if (isContext) {
      yield { type: 'text-delta', text: contextAnswer }
    } else {
      for (const piece of draftPieces) {
        yield { type: 'text-delta', text: piece }
        // A pause between pieces keeps the ordering realistic.
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
    }
    yield { type: 'finish', reason: { kind: 'success' } }
  },
}

/** 会话事件：由测试决定内容。 */
let sessionEvents = []

function makeContext() {
  const store = {
    credentials: undefined,
    llm,
    sessionController: {
      async inspect() {
        return { events: sessionEvents }
      },
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'p', model: 'm' }),
    },
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
  const state = { status: 0, body: '', headers: {}, chunks: [] }
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
    write(chunk) {
      state.chunks.push(String(chunk))
    },
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
  try {
    parsed = JSON.parse(state.body)
  } catch {
    parsed = state.body
  }
  if (parsed && typeof parsed.ticket === 'string') activeTicket = parsed.ticket
  return { status: state.status, body: parsed, raw: state.body, state }
}

/** 解析 NDJSON 流。 */
function parseStream(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { type: 'unparsed', raw: line }
      }
    })
}

const ctx = makeContext()
plugin.apply(ctx)
const handler = ctx.get('__route').handler
await call(handler, 'GET', '/dsh-prompt-optimization/status')

// ---------------------------------------------------------------------------
// 1. 流式：单候选逐段返回
// ---------------------------------------------------------------------------

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'account', candidates: 1 } })
llmCalls.length = 0
let result = await call(handler, 'POST', '/dsh-prompt-optimization/optimize/stream', {
  text: '帮我写个函数',
  sessionId: 'session-stream',
})
const events = parseStream(result.raw)
const deltas = events.filter((event) => event.type === 'delta')
const done = events.find((event) => event.type === 'done')

check('the stream returns 200', result.status === 200, result.status)
check('the content type is ndjson', String(result.state.headers['content-type'] || '').includes('ndjson'), result.state.headers)
check('several deltas are emitted', deltas.length >= 2, deltas.length)
check(
  'the deltas concatenate into the final text',
  deltas.map((event) => event.text).join('') === '改写后的提示词内容',
  deltas.map((event) => event.text),
)
check('a done event carries the cleaned text', done?.optimized === '改写后的提示词内容', done)
check('the done event names the model', done?.model?.provider === 'p', done?.model)
check('the done event reports one candidate', done?.candidates === 1, done)

// 未完成解析不应出现
check('no unparsed lines', !events.some((event) => event.type === 'unparsed'), events.filter((e) => e.type === 'unparsed'))

// ---------------------------------------------------------------------------
// 2. 多候选：只流式输出评审选中的那一份
// ---------------------------------------------------------------------------

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'account', candidates: 3 } })
// 每份草稿内容不同，便于确认流式输出的是被选中的那一份。
let callIndex = 0
const originalStream = llm.stream.bind(llm)
llm.stream = async function* (options) {
  const isJudge = typeof options.system === 'string' && options.system.includes('评审员')
  if (isJudge) {
    yield { type: 'text-delta', text: '2' }
    yield { type: 'finish', reason: { kind: 'success' } }
    return
  }
  callIndex += 1
  const body = `草稿-${callIndex} 内容`
  yield { type: 'text-delta', text: body }
  yield { type: 'finish', reason: { kind: 'success' } }
}

llmCalls.length = 0
result = await call(handler, 'POST', '/dsh-prompt-optimization/optimize/stream', {
  text: '帮我写个函数',
  sessionId: 'session-stream',
})
const multiEvents = parseStream(result.raw)
const multiDeltas = multiEvents.filter((event) => event.type === 'delta')
const multiDone = multiEvents.find((event) => event.type === 'done')

check('the multi-candidate stream succeeds', result.status === 200, result.status)
check('the judge answer is honoured', multiDone?.chosen === 2, multiDone)
check(
  'only the selected candidate is streamed',
  multiDeltas.map((event) => event.text).join('') === '草稿-2 内容',
  multiDeltas.map((event) => event.text),
)
check('the streamed text matches the done text', multiDeltas.map((e) => e.text).join('') === multiDone?.optimized, {
  streamed: multiDeltas.map((e) => e.text).join(''),
  done: multiDone?.optimized,
})
llm.stream = originalStream

// ---------------------------------------------------------------------------
// 3. 上下文开关默认关闭
// ---------------------------------------------------------------------------

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'account', candidates: 1 } })
result = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('the context switch is off by default', result.body.contextAware === false, result.body.contextAware)

// 关闭时不调用压缩，也不注入上下文
sessionEvents = [
  { type: 'user/message', data: { content: [{ type: 'text', text: '帮我写个函数' }], source: { kind: 'user' } } },
]
llmCalls.length = 0
await call(handler, 'POST', '/dsh-prompt-optimization/optimize/stream', { text: '写个函数', sessionId: 'session-ctx' })
check(
  'no compression call happens while the switch is off',
  !llmCalls.some((entry) => String(entry.system).includes('上下文分析器')),
  llmCalls.map((entry) => String(entry.system).slice(0, 20)),
)
check(
  'no context block is injected while the switch is off',
  !llmCalls.some((entry) => entry.user.includes('用户偏好上下文')),
  llmCalls.map((entry) => entry.user.slice(0, 60)),
)

// ---------------------------------------------------------------------------
// 4. 开启后：压缩会话历史并注入改写请求
// ---------------------------------------------------------------------------

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'account', candidates: 1, contextAware: true } })
result = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('the context switch can be turned on', result.body.contextAware === true, result.body.contextAware)

sessionEvents = [
  {
    type: 'user/message',
    data: { content: [{ type: 'text', text: '帮我写个快速排序' }], source: { kind: 'user' } },
  },
  {
    type: 'assistant/message',
    data: { message: { role: 'assistant', content: [{ type: 'text', text: '好的，下面是快速排序实现…' }] } },
  },
  {
    type: 'user/message',
    data: { content: [{ type: 'text', text: '再写个归并排序' }], source: { kind: 'user' } },
  },
  // 宿主注入的消息不应被当作用户意图。
  {
    type: 'user/message',
    data: { content: [{ type: 'text', text: 'Current runtime context: …' }], source: { kind: 'time-context' } },
  },
]
llmCalls.length = 0
result = await call(handler, 'POST', '/dsh-prompt-optimization/optimize/stream', { text: '写个堆排序', sessionId: 'session-ctx' })

const compressionCall = llmCalls.find((entry) => String(entry.system).includes('上下文分析器'))
const rewriteCall = llmCalls.find((entry) => !String(entry.system).includes('上下文分析器') && !String(entry.system).includes('评审员'))

check('a compression call is made', Boolean(compressionCall), llmCalls.length)
check('the compression call receives the transcript', compressionCall?.user.includes('快速排序'), compressionCall?.user?.slice(0, 120))
check('the compression call receives the later turn', compressionCall?.user.includes('归并排序'), compressionCall?.user?.slice(0, 200))
check(
  'injected host messages are excluded from the transcript',
  !compressionCall?.user.includes('Current runtime context'),
  compressionCall?.user?.slice(0, 200),
)
check('the compressed brief reaches the rewrite call', rewriteCall?.user.includes('用户偏好上下文'), rewriteCall?.user?.slice(0, 120))
check('the brief carries the compression output', rewriteCall?.user.includes('用户偏好简洁的中文表达'), rewriteCall?.user?.slice(0, 300))
check('the original request is still present', rewriteCall?.user.includes('写个堆排序'), rewriteCall?.user?.slice(0, 300))

// 压缩失败不应让改写失败
contextAnswer = ''
llmCalls.length = 0
result = await call(handler, 'POST', '/dsh-prompt-optimization/optimize/stream', { text: '写个堆排序', sessionId: 'session-ctx' })
check('a failed compression still produces a rewrite', result.status === 200, result.status)
const fallbackRewrite = llmCalls.find((entry) => !String(entry.system).includes('上下文分析器') && !String(entry.system).includes('评审员'))
check('the rewrite proceeds without a context block', !fallbackRewrite?.user.includes('用户偏好上下文'), fallbackRewrite?.user?.slice(0, 120))

// ---------------------------------------------------------------------------
// 5. 错误处理
// ---------------------------------------------------------------------------

await call(handler, 'POST', '/dsh-prompt-optimization/settings', { settings: { mode: 'account', candidates: 1, contextAware: false } })
result = await call(handler, 'POST', '/dsh-prompt-optimization/optimize/stream', { text: '', sessionId: 's' })
check('an empty draft is rejected', result.status === 400, result.status)

result = await call(handler, 'POST', '/dsh-prompt-optimization/optimize/stream', { text: 'x'.repeat(30_000), sessionId: 's' })
check('an oversized draft is rejected', result.status === 413, result.status)

// 无票据
const savedTicket = activeTicket
activeTicket = null
result = await call(handler, 'POST', '/dsh-prompt-optimization/optimize/stream', { text: '写个函数', sessionId: 's' })
check('the stream requires the ticket', result.status === 403, result.status)
activeTicket = savedTicket

// ---------------------------------------------------------------------------

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((item) => item.name).join(', '))
  process.exitCode = 1
}
await rm(tempHome, { recursive: true, force: true })
