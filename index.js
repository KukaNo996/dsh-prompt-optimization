/**
 * Host half of the "dsh-promt-refine" bundle.
 *
 * Responsibilities:
 * - Own the persisted refinement settings (model / endpoint / API key) in the DSH home directory.
 * - Serve same-origin HTTP routes for the browser half (settings CRUD, connection test, refinement).
 * - Call the model: the logged-in account route through the Host LLM service, or a custom
 *   OpenAI-compatible endpoint through fetch.
 *
 * The browser half stays free of Host RPC plumbing: it only talks to these routes with fetch().
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Services this plugin needs to serve the browser half. */
export const inject = ['webServer']

const ROUTE_BASE = '/dsh-promt-refine'
const MAX_BODY_BYTES = 1_000_000
const MAX_INPUT_CHARS = 20_000
const DEFAULT_TIMEOUT_MS = 120_000
const TEST_TIMEOUT_MS = 45_000

const SETTING_FIELDS = [
  'mode',
  'provider',
  'model',
  'baseURL',
  'apiKey',
  'temperature',
  'maxTokens',
  'systemPrompt',
  'showLabel',
]

const DEFAULT_SETTINGS = Object.freeze({
  mode: 'account',
  provider: '',
  model: '',
  baseURL: '',
  apiKey: '',
  temperature: 0.3,
  maxTokens: 0,
  systemPrompt: '',
  showLabel: true,
})

const DEFAULT_REFINE_INSTRUCTION = [
  '你是一位资深提示词工程师。请把用户提供的原始需求改写成一个专业、可直接执行的高质量提示词。',
  '如果原始需求主要使用中文，就用中文输出；否则使用原始需求的主要语言输出。',
  '',
  '改写后的提示词必须满足以下要求：',
  '1. 任务明确：用一句话说清要完成的核心任务。',
  '2. 主旨清晰：补充必要的背景与目的，让执行者理解为什么做、为谁做。',
  '3. 无歧义：消除指代不明、范围模糊和口语化表达；必要时补全合理的上下文假设，并明确标注为假设。',
  '4. 条理清晰：使用 Markdown 标题与有序结构组织内容。',
  '5. 计划合理：给出可执行的步骤或阶段划分，说明先后顺序与依赖关系。',
  '6. 目标准确：列出明确的验收标准或期望产出。',
  '',
  '输出要求：',
  '- 只输出改写后的提示词正文，不要任何解释、前言、寒暄、代码块围栏或“以下是改写后的提示词”之类的话术。',
  '- 建议包含的段落：目标、背景、具体任务、约束与要求、执行步骤、输出格式、验收标准。可按内容需要合并或删减，不要机械套模板。',
  '- 完整保留原始需求中的事实、数字、专有名词、链接和限制条件，不要添加用户未提及的新需求。',
  '- 如果原始需求本身已经比较清晰，只做结构化润色与补全，不要扩写成无关内容。',
  '- 改写后的篇幅应与原需求的信息量匹配，不要无意义地堆砌辞藻或重复。',
].join('\n')

class HttpError extends Error {
  constructor(status, code, message, detail) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/** Resolve the durable settings file under the DSH home directory. */
function settingsPath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'dsh-promt-refine', 'settings.json')
}

function asString(value, fallback) {
  return typeof value === 'string' ? value : fallback
}

/** Coerce arbitrary input into the exact persisted settings shape. */
function normalizeSettings(raw, current) {
  const base = { ...DEFAULT_SETTINGS, ...(current || {}) }
  const input = raw && typeof raw === 'object' ? raw : {}
  const mode = input.mode === 'custom' ? 'custom' : input.mode === 'account' ? 'account' : base.mode
  const temperatureRaw = Number(input.temperature ?? base.temperature)
  const temperature = Number.isFinite(temperatureRaw) ? Math.min(2, Math.max(0, temperatureRaw)) : DEFAULT_SETTINGS.temperature
  const maxTokensRaw = Math.floor(Number(input.maxTokens ?? base.maxTokens))
  const maxTokens = Number.isFinite(maxTokensRaw) ? Math.min(32_768, Math.max(0, maxTokensRaw)) : 0
  return {
    mode,
    provider: asString(input.provider, base.provider).trim(),
    model: asString(input.model, base.model).trim(),
    baseURL: asString(input.baseURL, base.baseURL).trim(),
    apiKey: asString(input.apiKey, base.apiKey).trim(),
    temperature,
    maxTokens,
    systemPrompt: asString(input.systemPrompt, base.systemPrompt),
    showLabel: typeof input.showLabel === 'boolean' ? input.showLabel : base.showLabel !== false,
  }
}

async function readSettingsFile() {
  try {
    const text = await readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(text)
    return normalizeSettings(parsed, DEFAULT_SETTINGS)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function writeSettingsFile(settings) {
  const target = settingsPath()
  await mkdir(dirname(target), { recursive: true })
  const scratch = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(scratch, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await rename(scratch, target)
}

/** Mask a stored key for display; the plaintext never leaves the Host. */
function maskApiKey(key) {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 3)}••••${key.slice(-4)}`
}

function publicSettings(settings) {
  const { apiKey, ...rest } = settings
  return {
    ...rest,
    hasApiKey: Boolean(apiKey),
    apiKeyMasked: maskApiKey(apiKey),
    defaults: { systemPrompt: DEFAULT_REFINE_INSTRUCTION },
  }
}

/** Validate only when a call is about to happen; incomplete drafts save fine. */
function validateForCall(settings) {
  if (settings.mode === 'custom' && !settings.baseURL) {
    throw new HttpError(400, 'missing_base_url', '自定义模式需要先在设置页填写 API 地址（例如 http://127.0.0.1:11434/v1）。')
  }
  if (settings.mode === 'custom' && !settings.model) {
    throw new HttpError(400, 'missing_model', '自定义模式需要先在设置页填写模型名称。')
  }
}

/**
 * Merge the form's key fields into normalized settings.
 * An empty password field means "keep the stored key"; clearApiKey deletes it.
 */
function mergeApiKey(settings, current, body) {
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    settings.apiKey = body.apiKey.trim()
  } else if (body.clearApiKey === true) {
    settings.apiKey = ''
  } else {
    settings.apiKey = current.apiKey
  }
  return settings
}

function chatCompletionsUrl(baseURL) {
  const trimmed = String(baseURL).trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

function extractMessageText(payload) {
  const message = payload?.choices?.[0]?.message
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('')
  }
  if (typeof message.reasoning_content === 'string') return message.reasoning_content
  return ''
}

/** Strip a single wrapping Markdown fence the model may have added despite instructions. */
function cleanModelOutput(text) {
  let value = String(text || '').trim()
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(value)
  if (fenced) value = fenced[1].trim()
  return value
}

function buildUserMessage(text) {
  return `<原始需求>\n${text}\n</原始需求>`
}

function timeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const forward = () => controller.abort(parentSignal?.reason)
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason)
    else parentSignal.addEventListener('abort', forward, { once: true })
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', forward)
    },
  }
}

/** Call a custom OpenAI-compatible endpoint. */
async function callCustomEndpoint(settings, instruction, userText, timeoutMs) {
  const url = chatCompletionsUrl(settings.baseURL)
  const headers = { 'content-type': 'application/json' }
  if (settings.apiKey) headers.authorization = `Bearer ${settings.apiKey}`
  const body = {
    model: settings.model,
    messages: [
      { role: 'system', content: instruction },
      { role: 'user', content: userText },
    ],
    temperature: settings.temperature,
    stream: false,
  }
  if (settings.maxTokens > 0) body.max_tokens = settings.maxTokens
  const guard = timeoutSignal(undefined, timeoutMs)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: guard.signal,
    })
  } catch (error) {
    const reason = error?.name === 'AbortError' ? '请求超时' : error?.message || String(error)
    throw new HttpError(502, 'custom_request_failed', `无法连接模型接口：${reason}`)
  } finally {
    guard.dispose()
  }
  const raw = await response.text()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  if (!response.ok) {
    const detail = parsed?.error?.message || parsed?.message || raw.slice(0, 400)
    throw new HttpError(502, 'custom_response_error', `模型接口返回 HTTP ${response.status}：${detail}`)
  }
  const text = extractMessageText(parsed)
  if (!text.trim()) throw new HttpError(502, 'empty_model_output', '模型没有返回文本内容。')
  return { text: cleanModelOutput(text), model: { provider: 'custom', model: settings.model, baseURL: settings.baseURL } }
}

/** Read the model used by the latest request of a session (the composer-selected model). */
async function latestSessionSelection(ctx, sessionId) {
  if (!sessionId) return undefined
  try {
    const controller = ctx.get('sessionController')
    if (!controller?.inspect) return undefined
    const inspection = await controller.inspect(sessionId)
    const events = inspection?.events
    if (!Array.isArray(events)) return undefined
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type !== 'request/header') continue
      const config = event?.data?.header?.config
      if (config?.provider && config?.model) {
        return { provider: config.provider, model: config.model, source: 'session' }
      }
    }
  } catch {
    // A session can be absent, cold, or owned by another instance; fall through to defaults.
  }
  return undefined
}

/** Resolve the account-mode model: explicit override, then session, then default, then account fallback. */
async function resolveAccountSelection(ctx, settings, sessionId) {
  if (settings.provider && settings.model) {
    return { provider: settings.provider, model: settings.model, source: 'settings' }
  }
  const fromSession = await latestSessionSelection(ctx, sessionId)
  if (fromSession) return fromSession
  const defaultModel = ctx.get('agentDefaultModel')
  try {
    const selection = defaultModel?.currentSelection?.()
    if (selection?.provider && selection?.model) {
      return { provider: selection.provider, model: selection.model, source: 'default' }
    }
  } catch {
    // Default selection is advisory; the fallback below still has a chance to work.
  }
  return { provider: 'deepseek-account', model: 'deepseek-flash', source: 'account-fallback' }
}

/** Call the logged-in account / default route through the Host LLM service. */
async function callAccountModel(ctx, settings, instruction, userText, timeoutMs, sessionId) {
  const llm = ctx.get('llm')
  if (!llm) {
    throw new HttpError(503, 'llm_unavailable', '主程序的 LLM 服务不可用，请在设置页改用自定义模型。')
  }
  const selection = await resolveAccountSelection(ctx, settings, sessionId)
  const guard = timeoutSignal(undefined, timeoutMs)
  let output = ''
  let failure
  try {
    const options = {
      provider: selection.provider,
      model: selection.model,
      system: instruction,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      signal: guard.signal,
    }
    if (settings.temperature > 0) options.temperature = settings.temperature
    for await (const chunk of llm.stream(options)) {
      if (chunk?.type === 'text-delta') output += chunk.text
      else if (chunk?.type === 'finish') {
        if (chunk.reason?.kind === 'error') failure = chunk.reason.failure
        else if (chunk.reason?.kind === 'aborted') failure = chunk.reason.failure ?? { message: '请求被取消' }
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    const message = error?.message || String(error)
    throw new HttpError(502, 'account_request_failed', `模型调用失败：${message}`)
  } finally {
    guard.dispose()
  }
  if (failure) {
    throw new HttpError(
      502,
      'account_request_failed',
      `模型调用失败：${failure.message || '未知错误'}${failure.code ? `（${failure.code}）` : ''}`,
      { status: failure.status },
    )
  }
  if (!output.trim()) throw new HttpError(502, 'empty_model_output', '模型没有返回文本内容。')
  return { text: cleanModelOutput(output), model: { ...selection } }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'body_too_large', '请求内容过大。'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJsonBody(req) {
  const raw = await readBody(req)
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'invalid_json', '请求体不是合法的 JSON。')
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

/**
 * Reject cross-site writes. The plugin route is served on the loopback app origin,
 * so a random website could otherwise post JSON as text/plain. A required custom
 * header forces a CORS preflight that this route never approves, and an Origin,
 * when present, must match the served host.
 */
function assertSameOriginWrite(req) {
  const method = (req.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return
  if (req.headers['x-dsh-promt-refine'] !== '1') {
    throw new HttpError(403, 'forbidden', '缺少插件请求标记。')
  }
  const origin = req.headers.origin
  if (!origin) return
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    throw new HttpError(403, 'forbidden', '请求来源无效。')
  }
  const host = req.headers.host
  if (!host || parsed.host !== host) {
    throw new HttpError(403, 'forbidden', '请求来源与当前服务不一致。')
  }
}

async function handleOptimize(ctx, req, res) {
  const body = await readJsonBody(req)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) throw new HttpError(400, 'empty_input', '请先在输入框中输入需要优化的提示词。')
  if (text.length > MAX_INPUT_CHARS) {
    throw new HttpError(413, 'input_too_long', `输入内容超过 ${MAX_INPUT_CHARS} 字符，请精简后再优化。`)
  }
  const settings = await readSettingsFile()
  validateForCall(settings)
  const instruction = settings.systemPrompt.trim() || DEFAULT_REFINE_INSTRUCTION
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
  const userText = buildUserMessage(text)
  const result =
    settings.mode === 'custom'
      ? await callCustomEndpoint(settings, instruction, userText, DEFAULT_TIMEOUT_MS)
      : await callAccountModel(ctx, settings, instruction, userText, DEFAULT_TIMEOUT_MS, sessionId)
  sendJson(res, 200, { optimized: result.text, model: result.model })
}

async function handleTest(ctx, req, res) {
  const body = await readJsonBody(req)
  const current = await readSettingsFile()
  const settings = mergeApiKey(normalizeSettings(body.settings ?? {}, current), current, body)
  validateForCall(settings)
  const startedAt = Date.now()
  const instruction = settings.systemPrompt.trim() || DEFAULT_REFINE_INSTRUCTION
  const probe = '<原始需求>\n请只回复两个字：正常\n</原始需求>'
  const result =
    settings.mode === 'custom'
      ? await callCustomEndpoint(settings, instruction, probe, TEST_TIMEOUT_MS)
      : await callAccountModel(ctx, settings, instruction, probe, TEST_TIMEOUT_MS, undefined)
  sendJson(res, 200, {
    ok: true,
    latencyMs: Date.now() - startedAt,
    model: result.model,
    sample: result.text.slice(0, 200),
  })
}

async function handleSettingsGet(res) {
  sendJson(res, 200, publicSettings(await readSettingsFile()))
}

async function handleSettingsSave(req, res) {
  const body = await readJsonBody(req)
  const current = await readSettingsFile()
  const settings = mergeApiKey(normalizeSettings(body.settings ?? body, current), current, body)
  await writeSettingsFile(settings)
  sendJson(res, 200, publicSettings(settings))
}

function createHandler(ctx) {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const path = url.pathname
    const method = (req.method || 'GET').toUpperCase()
    try {
      assertSameOriginWrite(req)
      if (path === `${ROUTE_BASE}/status`) {
        if (method !== 'GET') throw new HttpError(405, 'method_not_allowed', '仅支持 GET。')
        const settings = await readSettingsFile()
        sendJson(res, 200, {
          ok: true,
          plugin: 'dsh-promt-refine',
          mode: settings.mode,
          hasApiKey: Boolean(settings.apiKey),
          model: settings.mode === 'custom' ? settings.model : settings.model || '(auto)',
          showLabel: settings.showLabel !== false,
        })
        return
      }
      if (path === `${ROUTE_BASE}/settings`) {
        if (method === 'GET') return await handleSettingsGet(res)
        if (method === 'POST') return await handleSettingsSave(req, res)
        throw new HttpError(405, 'method_not_allowed', '仅支持 GET 或 POST。')
      }
      if (path === `${ROUTE_BASE}/optimize`) {
        if (method !== 'POST') throw new HttpError(405, 'method_not_allowed', '仅支持 POST。')
        return await handleOptimize(ctx, req, res)
      }
      if (path === `${ROUTE_BASE}/test`) {
        if (method !== 'POST') throw new HttpError(405, 'method_not_allowed', '仅支持 POST。')
        return await handleTest(ctx, req, res)
      }
      throw new HttpError(404, 'not_found', '未知接口。')
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const code = error instanceof HttpError ? error.code : 'internal_error'
      const message = error instanceof Error ? error.message : String(error)
      if (!(error instanceof HttpError)) {
        // Keep the browser side useful without leaking a stack trace.
        console.error('[dsh-promt-refine]', error)
      }
      if (!res.headersSent) {
        sendJson(res, status, {
          error: { code, message, detail: error instanceof HttpError ? error.detail : undefined },
        })
      } else {
        res.end()
      }
    }
  }
}

/** Mount the Host half: one prefix route serving the browser half. */
export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_BASE,
      handler: createHandler(ctx),
    }),
  )
}
