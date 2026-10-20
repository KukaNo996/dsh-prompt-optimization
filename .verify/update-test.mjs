/**
 * 检查更新功能的集成测试。
 *
 * 覆盖：版本比较、更新源解析、多源回退、自定义源、超时与错误、路由鉴权，
 * 以及「只读不写」这一安全属性。
 *
 * 用法：node .verify/update-test.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

// 任何断言若挂起都会让整套测试无输出而超时，无法归因。因此统一设一个总期限。
const DEADLINE_MS = 60_000
const deadline = setTimeout(() => {
  console.log(`\nTIMEOUT after ${DEADLINE_MS}ms`)
  const failedAt = results.filter((item) => !item.ok).map((item) => item.name)
  console.log(`${results.length} checks completed${failedAt.length ? `, failed: ${failedAt.join(', ')}` : ''}`)
  process.exit(1)
}, DEADLINE_MS)
deadline.unref?.()

const tempHome = await mkdtemp(join(tmpdir(), 'dsh-update-test-'))
process.env.DSH_HOME = tempHome

const plugin = await import(new URL('../index.js', import.meta.url).href)

// ---------------------------------------------------------------------------
// 可控的假更新源
// ---------------------------------------------------------------------------

/** 每个假源的行为由调用方改写此表决定。 */
const routes = new Map()

const sourceServer = createServer((req, res) => {
  const entry = routes.get(req.url)
  if (!entry) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  if (entry.delayMs) {
    setTimeout(() => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(entry.body))
    }, entry.delayMs)
    return
  }
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(entry.body))
})
await new Promise((resolve) => sourceServer.listen(0, '127.0.0.1', () => resolve()))
const sourceBase = `http://127.0.0.1:${sourceServer.address().port}`

// ---------------------------------------------------------------------------
// 假 ctx 与请求工具
// ---------------------------------------------------------------------------

function makeContext(services) {
  const store = { ...services }
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
  // 处理器会先 await 若干步骤才挂上 data/end 监听；用宏任务延后发射，
  // 避免请求体在有人监听之前就被消费掉。
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

const ctx = makeContext({ credentials: undefined })
plugin.apply(ctx)
const handler = ctx.get('__route').handler
if (typeof handler !== 'function') {
  console.log('FATAL: route handler was not registered')
  process.exit(1)
}
await call(handler, 'GET', '/dsh-prompt-optimization/status')

// ---------------------------------------------------------------------------
// 1. 版本比较（经由真实路由观察）
// ---------------------------------------------------------------------------

const runningVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const [major, minor] = runningVersion.split('.').map(Number)
const newerVersion = `${major}.${minor + 1}.0`
const olderVersion = `${major}.${Math.max(0, minor - 1)}.0`

routes.set('/packument-newer', { body: { 'dist-tags': { latest: newerVersion } } })
routes.set('/packument-same', { body: { 'dist-tags': { latest: runningVersion } } })
routes.set('/packument-older', { body: { 'dist-tags': { latest: olderVersion } } })
routes.set('/packument-pre', { body: { 'dist-tags': { latest: `${major}.${minor + 1}.0-beta.1` } } })

let response = await call(handler, 'POST', '/dsh-prompt-optimization/update-check', {
  updateSource: `${sourceBase}/packument-newer`,
})
check('reports the running version', response.status === 200 && response.body.currentVersion === runningVersion, response.body)
check('detects a newer version', response.body.updateAvailable === true && response.body.latestVersion === newerVersion, response.body)

response = await call(handler, 'POST', '/dsh-prompt-optimization/update-check', {
  updateSource: `${sourceBase}/packument-same`,
})
check('marks same version as up to date', response.body.updateAvailable === false, response.body)

response = await call(handler, 'POST', '/dsh-prompt-optimization/update-check', {
  updateSource: `${sourceBase}/packument-older`,
})
check('never reports an older version as an update', response.body.updateAvailable === false, response.body)

response = await call(handler, 'POST', '/dsh-prompt-optimization/update-check', {
  updateSource: `${sourceBase}/packument-pre`,
})
check('a newer prerelease still counts as an update', response.body.updateAvailable === true, response.body)

// ---------------------------------------------------------------------------
// 2. GitHub 形状的响应（按 payload 识别，而非按主机名）
// ---------------------------------------------------------------------------

routes.set('/gh', {
  body: {
    tag_name: `v${newerVersion}`,
    html_url: 'https://github.com/KukaNo996/dsh-prompt-optimization/releases/tag/x',
  },
})
response = await call(handler, 'POST', '/dsh-prompt-optimization/update-check', { updateSource: `${sourceBase}/gh` })
check('reads tag_name from a releases payload', response.body.latestVersion === newerVersion, response.body)
check('carries the release URL', String(response.body.releaseUrl || '').includes('releases'), response.body)
check('labels the source', typeof response.body.source === 'string' && response.body.source.length > 0, response.body)

// ---------------------------------------------------------------------------
// 3. 失败路径
// ---------------------------------------------------------------------------

routes.set('/garbage', { body: { nothing: 'useful' } })
response = await call(handler, 'POST', '/dsh-prompt-optimization/update-check', { updateSource: `${sourceBase}/missing` })
check('a 404 source reports failure, not a version', response.body.ok === false && Array.isArray(response.body.errors), response.body)

response = await call(handler, 'POST', '/dsh-prompt-optimization/update-check', { updateSource: `${sourceBase}/garbage` })
check('a payload without a version reports failure', response.body.ok === false, response.body)

// 指向一个刚关闭的端口：必须快速失败，且不会去访问公网
const closedPort = await new Promise((resolve) => {
  const probe = createServer()
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
response = await call(handler, 'POST', '/dsh-prompt-optimization/update-check', {
  updateSource: `http://127.0.0.1:${closedPort}/packument`,
})
check('an unreachable custom source fails cleanly', response.status === 200 && response.body.ok === false, response.body)

// ---------------------------------------------------------------------------
// 4. 源解析与版本比较的纯函数行为
// ---------------------------------------------------------------------------

const sourceSrc = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const resolveStart = sourceSrc.indexOf('const PACKAGE_NAME')
const resolveEnd = sourceSrc.indexOf('/** Read a JSON body with a byte cap')
const resolveModule = await import(
  `data:text/javascript,${encodeURIComponent(
    sourceSrc.slice(resolveStart, resolveEnd) +
      '\nexport { resolveUpdateSource, parseVersion, compareVersions, DEFAULT_UPDATE_SOURCE_ORDER }',
  )}`
)
const { resolveUpdateSource, parseVersion, compareVersions, DEFAULT_UPDATE_SOURCE_ORDER } = resolveModule
const cmp = (a, b) => Math.sign(compareVersions(parseVersion(a), parseVersion(b)))

check('built-in alias resolves', resolveUpdateSource('npm')?.url.includes('registry.npmjs.org'), resolveUpdateSource('npm'))
check('alias is case-insensitive', resolveUpdateSource('NPM')?.kind === 'npm')
check('a custom https source resolves', resolveUpdateSource('https://example.com/pkg')?.url === 'https://example.com/pkg')
check('a github url is recognised', resolveUpdateSource('https://api.github.com/repos/x/y/releases/latest')?.hostIsGithub === true)
check('a non-http scheme is rejected', resolveUpdateSource('file:///etc/passwd') === null)
check('a javascript scheme is rejected', resolveUpdateSource('javascript:alert(1)') === null)
check('an empty value falls back to the default order', resolveUpdateSource('   ') === null)
check('the default order covers three sources', DEFAULT_UPDATE_SOURCE_ORDER.length === 3, DEFAULT_UPDATE_SOURCE_ORDER)

check('1.3.0 is newer than 1.2.1', cmp('1.3.0', '1.2.1') === 1)
check('1.2.1 is older than 1.3.0', cmp('1.2.1', '1.3.0') === -1)
check('equal versions compare equal', cmp('1.2.1', '1.2.1') === 0)
check('a leading v is accepted', cmp('v1.3.0', '1.2.1') === 1)
check('numeric segments compare numerically', cmp('1.10.0', '1.9.0') === 1)
check('a prerelease sorts before its release', cmp('1.3.0-beta.1', '1.3.0') === -1)
check('a release sorts after its prerelease', cmp('1.3.0', '1.3.0-beta.1') === 1)
check('prerelease numbers compare numerically', cmp('1.3.0-beta.2', '1.3.0-beta.1') === 1)
check('numerics sort before alphanumerics', cmp('1.3.0-1', '1.3.0-alpha') === -1)
check('a malformed version does not parse', parseVersion('abc') === null)

// ---------------------------------------------------------------------------
// 5. 设置持久化
// ---------------------------------------------------------------------------

response = await call(handler, 'POST', '/dsh-prompt-optimization/settings', {
  settings: { updateSource: `${sourceBase}/packument-newer`, updateCheckEnabled: true },
})
check('settings save the update source', response.status === 200 && response.body.updateCheckEnabled === true, response.body)
check('the saved source is returned', String(response.body.updateSource || '').includes('/packument-newer'), response.body)

response = await call(handler, 'GET', '/dsh-prompt-optimization/settings')
check('the saved source survives a read', String(response.body.updateSource || '').includes('/packument-newer'), response.body)
check(
  'built-in sources are offered to the page',
  Array.isArray(response.body.defaults?.updateSources) && response.body.defaults.updateSources.length === 3,
  response.body.defaults?.updateSources,
)

// ---------------------------------------------------------------------------
// 6. 鉴权与副作用
// ---------------------------------------------------------------------------

const savedTicket = activeTicket
activeTicket = null
response = await call(handler, 'GET', '/dsh-prompt-optimization/update-check')
check('update-check requires the ticket', response.status === 403, response)
activeTicket = savedTicket

response = await call(handler, 'GET', '/dsh-prompt-optimization/update-check')
check('update-check accepts GET', response.status === 200 && response.body.latestVersion === newerVersion, response.body)

// 关键安全属性：检查更新绝不能写入设置文件
const settingsFile = join(tempHome, 'dsh-prompt-optimization', 'settings.json')
try {
  await readFile(settingsFile, 'utf8')
} catch {
  await mkdir(join(tempHome, 'dsh-prompt-optimization'), { recursive: true })
  await writeFile(settingsFile, JSON.stringify({ mode: 'account', updateSource: '' }), 'utf8')
}
const before = await readFile(settingsFile, 'utf8')
await call(handler, 'GET', '/dsh-prompt-optimization/update-check')
const after = await readFile(settingsFile, 'utf8')
check('checking for updates never rewrites settings', before === after, { before: before.length, after: after.length })

// ---------------------------------------------------------------------------
// 7. 超时保护
// ---------------------------------------------------------------------------

routes.set('/slow', { delayMs: 15_000, body: { 'dist-tags': { latest: newerVersion } } })
const startedAt = Date.now()
response = await call(handler, 'POST', '/dsh-prompt-optimization/update-check', { updateSource: `${sourceBase}/slow` })
const elapsed = Date.now() - startedAt
check('a hanging source times out instead of blocking', response.body.ok === false && elapsed < 14_000, { elapsed })

// ---------------------------------------------------------------------------

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((item) => item.name).join(', '))
  process.exitCode = 1
}

sourceServer.close()
await rm(tempHome, { recursive: true, force: true })
