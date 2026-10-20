/**
 * 验证改名迁移：旧目录/旧凭据引用中的配置必须被带到新位置。
 * 用一个临时 DSH_HOME 走真实的 Host 半代码。
 *
 * 用法：node .verify/rename-migration-test.mjs
 */
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

const home = await mkdtemp(join(tmpdir(), 'dsh-rename-mig-'))
process.env.DSH_HOME = home

/** Credential service double that records every write. */
const credentialStore = new Map()
const credentialCalls = []
const credentials = {
  async set(ref, value) {
    credentialCalls.push(['set', ref])
    credentialStore.set(ref, value)
  },
  async unset(ref) {
    credentialCalls.push(['unset', ref])
    credentialStore.delete(ref)
  },
  async resolve(ref) {
    return credentialStore.has(ref) ? { value: credentialStore.get(ref), source: 'test' } : undefined
  },
}

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

// --- Seed the legacy layout exactly as the pre-rename build wrote it ---------
const legacyDir = join(home, 'dsh-promt-refine')
await mkdir(legacyDir, { recursive: true })
const legacySettings = {
  mode: 'custom',
  provider: '',
  model: 'legacy-model',
  baseURL: 'http://127.0.0.1:11434/v1',
  apiKey: '',
  temperature: 0.42,
  maxTokens: 777,
  systemPrompt: 'legacy instruction',
  showLabel: true,
  candidates: 3,
}
await writeFile(join(legacyDir, 'settings.json'), JSON.stringify(legacySettings, null, 2), 'utf8')
credentialStore.set('DSH_PROMT_REFINE_API_KEY', 'sk-legacy-key-value')

const plugin = await import(new URL('../index.js', import.meta.url).href)
const ctx = makeContext({ credentials })
plugin.apply(ctx)

// The migration effect is async; give it a turn to settle.
await new Promise((resolve) => setTimeout(resolve, 100))

// --- 1. Settings moved to the new directory --------------------------------
const migrated = JSON.parse(await readFile(join(home, 'dsh-prompt-optimization', 'settings.json'), 'utf8'))
check('settings migrated to new directory', migrated.model === 'legacy-model', migrated)
check('settings keep every field', migrated.temperature === 0.42 && migrated.maxTokens === 777 && migrated.candidates === 3, migrated)
check('settings keep custom instruction', migrated.systemPrompt === 'legacy instruction', migrated)
check('legacy settings left in place (non-destructive)', await readFile(join(legacyDir, 'settings.json'), 'utf8').then(() => true, () => false))

// --- 2. Legacy credential is re-homed and readable -------------------------
const handler = ctx.get('__route').handler
const { res, state } = { res: null, state: null } // placeholder to keep lint quiet
void res
void state

async function call(method, url, body) {
  const state = { status: 0, body: '' }
  const response = {
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
    end(payload) {
      state.body = payload ?? ''
      this.headersSent = true
      this.writableEnded = true
    },
  }
  const { EventEmitter } = await import('node:events')
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { 'x-dsh-promt-refine': '1' }
  req.socket = { remoteAddress: '127.0.0.1' }
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  await handler(req, response)
  let parsed
  try {
    parsed = JSON.parse(state.body)
  } catch {
    parsed = state.body
  }
  return { status: state.status, body: parsed }
}

const status = await call('GET', '/dsh-prompt-optimization/status')
check('status responds on the new route', status.status === 200, status)
check('status reports a configured key', status.body.hasApiKey === true, status.body)
check('key re-homed to the new credential reference', credentialStore.has('DSH_PROMPT_OPTIMIZATION_API_KEY'), [...credentialStore.keys()])
check('old credential reference removed', !credentialStore.has('DSH_PROMT_REFINE_API_KEY'), [...credentialStore.keys()])

// --- 3. A second start must not clobber the migrated file ------------------
await writeFile(join(home, 'dsh-prompt-optimization', 'settings.json'), JSON.stringify({ ...migrated, model: 'edited-after-migration' }, null, 2), 'utf8')
await new Promise((resolve) => setTimeout(resolve, 50))
const plugin2 = await import(new URL('../index.js', import.meta.url).href + '?second')
const ctx2 = makeContext({ credentials })
plugin2.apply(ctx2)
await new Promise((resolve) => setTimeout(resolve, 100))
const afterRestart = JSON.parse(await readFile(join(home, 'dsh-prompt-optimization', 'settings.json'), 'utf8'))
check('existing settings survive a restart', afterRestart.model === 'edited-after-migration', afterRestart)

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
await rm(home, { recursive: true, force: true })
