/**
 * 端到端验证：新指令是否真的被发到模型端。
 *
 * 用 mock OpenAI 服务捕获实际发出的 system 消息，
 * 确认三处提示词分别出现在正确的调用里，且用户消息标签正确。
 */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-po-e2e-'))
process.env.DSH_HOME = tempHome

const captured = []

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    captured.push({
      system: parsed.messages?.[0]?.content || '',
      user: parsed.messages?.[1]?.content || '',
    })
    const isJudge = (parsed.messages?.[0]?.content || '').includes('评审员')
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: isJudge
                ? '2'
                : '把登录页主按钮改为蓝色（假设：色值取设计系统 #1677ff），保持现有尺寸、圆角与悬停态不变，并满足浅色与深色主题下的文字对比度可读性要求。',
            },
          },
        ],
      }),
    )
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

function makeContext() {
  const services = {
    llm: {
      async *stream() {
        throw new Error('should not be called')
      },
    },
    credentials: {
      store: new Map(),
      async get() {
        return undefined
      },
      async set() {},
      async delete() {},
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    },
  }
  return {
    effect: (cb) => cb(),
    get: (name) => services[name],
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
  return {
    state,
    res: {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      set statusCode(v) {
        state.status = v
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
    },
  }
}

let activeTicket = null

function makeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.socket = { remoteAddress: '127.0.0.1' }
  const isStatus = url.endsWith('/status')
  req.headers = {
    'x-dsh-prompt-optimization': '1',
    ...(isStatus ? {} : { 'x-dsh-prompt-optimization-ticket': activeTicket || '' }),
  }
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
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

const plugin = await import(new URL('../index.js', import.meta.url).href)
const ctx = makeContext()
plugin.apply(ctx)
const handler = ctx.get('__route').handler

// 取一张 ticket
await call(handler, 'GET', '/dsh-prompt-optimization/status')

await call(handler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: {
    mode: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`,
    model: 'test-model',
    candidates: 2,
  },
})

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

const response = await call(handler, 'POST', '/dsh-prompt-optimization/optimize', {
  text: '把登录按钮改成蓝色',
})

check('优化请求返回 200', response.status === 200, response)
check(
  '返回改写结果',
  typeof response.body.optimized === 'string' && response.body.optimized.length > 0,
  response.body,
)

const draftCalls = captured.filter((c) => !c.system.includes('评审员'))
const judgeCalls = captured.filter((c) => c.system.includes('评审员'))

check('发出 2 次生成调用（candidates=2）', draftCalls.length === 2, { count: draftCalls.length })
check('发出 1 次评审调用', judgeCalls.length === 1, { count: judgeCalls.length })

const draft = draftCalls[0]
check(
  '主指令已下发',
  draft.system.includes('将当前输入的整段文本作为改写对象'),
  draft.system.slice(0, 120),
)
check(
  '主指令含四要素',
  draft.system.includes('任务目标') &&
    draft.system.includes('适用场景') &&
    draft.system.includes('必要约束') &&
    draft.system.includes('期望输出'),
  draft.system.slice(0, 200),
)
check(
  '主指令含「仅返回改写后的提示词本身」',
  draft.system.includes('仅返回改写后的提示词本身'),
  draft.system.slice(0, 200),
)
check(
  '主指令含「不以未完列表、悬垂连词或冒号结尾」',
  draft.system.includes('不以未完列表、悬垂连词或冒号结尾'),
  draft.system.slice(0, 200),
)
check('主指令不含旧版六类分类', !draft.system.includes('表达转换类'), draft.system.slice(0, 200))
check('主指令不含旧版档位规则', !draft.system.includes('档'), draft.system.slice(0, 200))
check(
  '用户消息带原始需求标签',
  draft.user.includes('<原始需求>') && draft.user.includes('把登录按钮改成蓝色'),
  draft.user,
)

const judge = judgeCalls[0]
check('评审指令含候选编号格式说明', judge.system.includes('【候选 N】'), judge.system.slice(0, 200))
check('评审指令含防位置偏好', judge.system.includes('位置靠后的候选'), judge.system.slice(0, 200))
check(
  '评审消息带候选列表',
  judge.user.includes('【候选 1】') && judge.user.includes('【候选 2】'),
  judge.user.slice(0, 200),
)
check('评审选中项被回填', response.body.chosen === 2, response.body)

server.close()
await rm(tempHome, { recursive: true, force: true })

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
