/**
 * Browser half of the "dsh-promt-refine" bundle.
 *
 * Registers two slots:
 * - `conversation.input.right`: the Optimize / Undo control inside the composer toolbar,
 *   immediately before the model selector (between the permission controls and the model seat).
 * - `settings.section`:        the "Prompt Refine" settings page, which also owns the
 *   "show the 优化提示词 label" preference.
 *
 * All model calls and persistence live in the Host half; this module only uses the
 * same-origin HTTP routes it serves. Draft reads/writes use the injected standard props
 * `useInput` and `inputActions` (`setDraft`), never the DOM.
 */
window.__ModuleLoader__.load({
  id: 'dsh-promt-refine',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-promt-refine'
    const ROUTE = '/dsh-promt-refine'

    // ---------------------------------------------------------------------
    // Localized copy
    // ---------------------------------------------------------------------
    const zh = {
      'tool.optimize': '优化提示词',
      'tool.undo': '撤回',
      'tool.busy': '优化中…',
      'tool.empty': '请先输入需要优化的提示词。',
      'tool.failed': '优化失败：{message}',
      'tool.draftChanged': '草稿在优化期间发生了变化，本次结果未应用。',
      'tool.undoHint': '恢复优化前的提示词',
      'tool.optimizeHint': '把当前输入改写为更专业、更清晰的提示词',
      'settings.nav': '提示词优化',
      'settings.title': '提示词优化',
      'settings.description': '把输入框里的自然语言需求改写为任务明确、主旨清晰、无歧义、条理清晰、计划合理、目标准确的专业提示词。',
      'settings.showLabel': '显示「优化提示词」文字',
      'settings.showLabelHint': '关闭后按钮在输入框工具栏里只显示图标；撤回时仍显示「撤回」文字。',
      'settings.mode': '模型来源',
      'settings.modeAccount': '跟随主程序',
      'settings.modeAccountHint': '默认使用登录账户的 DeepSeek 模型；如果会话已选择模型，则优先使用该模型。',
      'settings.modeCustom': '自定义模型',
      'settings.modeCustomHint': '通过 OpenAI 兼容接口调用在线或本地模型（Ollama、LM Studio、vLLM、DeepSeek、OpenAI 等）。',
      'settings.provider': 'Provider（可选）',
      'settings.providerHint': '留空则自动选择。填写时必须与模型名一起填写。',
      'settings.providerPlaceholder': '例如 deepseek-account',
      'settings.model': '模型名称',
      'settings.modelHint': '跟随模式下可留空表示自动选择；自定义模式下必填。',
      'settings.modelPlaceholder': '例如 deepseek-flash',
      'settings.baseURL': 'API 地址',
      'settings.baseURLHint': 'OpenAI 兼容地址，末尾带 /v1；也可以直接填到 /chat/completions。',
      'settings.baseURLPlaceholder': '例如 http://127.0.0.1:11434/v1',
      'settings.apiKey': 'API Key',
      'settings.apiKeyHint': '仅保存在本机 DSH 数据目录，不会回传到浏览器。本地模型可留空。',
      'settings.apiKeySaved': '已保存：{masked}',
      'settings.apiKeyUnset': '未保存',
      'settings.apiKeyPlaceholderSaved': '已保存，留空保持不变',
      'settings.apiKeyPlaceholder': 'sk-…',
      'settings.clearKey': '清除已保存的 Key',
      'settings.temperature': '温度',
      'settings.temperatureHint': '0–2，越低越稳定。建议 0.2–0.4。',
      'settings.maxTokens': '最大输出 token',
      'settings.maxTokensHint': '0 表示不限制，交给模型默认值。',
      'settings.systemPrompt': '优化指令（system prompt）',
      'settings.systemPromptHint': '留空使用内置指令。高级用户可自定义改写要求。',
      'settings.restoreDefault': '恢复默认指令',
      'settings.save': '保存设置',
      'settings.saving': '保存中…',
      'settings.test': '测试连接',
      'settings.testing': '测试中…',
      'settings.saved': '设置已保存。',
      'settings.saveFailed': '保存失败：{message}',
      'settings.testOk': '连接成功 · {model} · {latency} ms',
      'settings.testFailed': '连接失败：{message}',
      'settings.loadFailed': '读取设置失败：{message}',
      'settings.loading': '正在读取设置…',
      'settings.storageNote': '设置保存在本机，重启主程序后仍然有效。',
      'settings.keyPresent': '已配置 API Key',
      'settings.keyAbsent': '未配置 API Key',
      'settings.requiredCustom': '自定义模式需要填写 API 地址与模型名称。',
    }

    const en = {
      'tool.optimize': 'Optimize prompt',
      'tool.undo': 'Undo',
      'tool.busy': 'Optimizing…',
      'tool.empty': 'Type the prompt you want to optimize first.',
      'tool.failed': 'Optimization failed: {message}',
      'tool.draftChanged': 'The draft changed while optimizing, so the result was not applied.',
      'tool.undoHint': 'Restore the prompt from before optimization',
      'tool.optimizeHint': 'Rewrite the current input as a clearer, more professional prompt',
      'settings.nav': 'Prompt Refine',
      'settings.title': 'Prompt Refine',
      'settings.description': 'Rewrite a rough request in the composer into a professional prompt with a clear task, purpose, plan, and acceptance criteria.',
      'settings.showLabel': 'Show the "Optimize prompt" label',
      'settings.showLabelHint': 'When off, the toolbar control shows only an icon; the Undo action keeps its label.',
      'settings.mode': 'Model source',
      'settings.modeAccount': 'Follow the app',
      'settings.modeAccountHint': 'Use the signed-in account DeepSeek model by default; the session-selected model wins when one is set.',
      'settings.modeCustom': 'Custom model',
      'settings.modeCustomHint': 'Call an online or local OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, DeepSeek, OpenAI, …).',
      'settings.provider': 'Provider (optional)',
      'settings.providerHint': 'Leave both fields empty to resolve automatically. Fill it together with the model.',
      'settings.providerPlaceholder': 'e.g. deepseek-account',
      'settings.model': 'Model',
      'settings.modelHint': 'Empty in follow mode means automatic; required in custom mode.',
      'settings.modelPlaceholder': 'e.g. deepseek-flash',
      'settings.baseURL': 'API base URL',
      'settings.baseURLHint': 'OpenAI-compatible endpoint, usually ending in /v1; a full /chat/completions URL also works.',
      'settings.baseURLPlaceholder': 'e.g. http://127.0.0.1:11434/v1',
      'settings.apiKey': 'API key',
      'settings.apiKeyHint': 'Stored only on this machine in the DSH data directory and never sent back to the browser. Local models may leave it empty.',
      'settings.apiKeySaved': 'Saved: {masked}',
      'settings.apiKeyUnset': 'Not set',
      'settings.apiKeyPlaceholderSaved': 'Saved — leave empty to keep it',
      'settings.apiKeyPlaceholder': 'sk-…',
      'settings.clearKey': 'Clear the saved key',
      'settings.temperature': 'Temperature',
      'settings.temperatureHint': '0–2; lower is steadier. 0.2–0.4 works well.',
      'settings.maxTokens': 'Max output tokens',
      'settings.maxTokensHint': '0 means unlimited (provider default).',
      'settings.systemPrompt': 'Refinement instruction (system prompt)',
      'settings.systemPromptHint': 'Leave empty to use the built-in instruction.',
      'settings.restoreDefault': 'Restore default',
      'settings.save': 'Save settings',
      'settings.saving': 'Saving…',
      'settings.test': 'Test connection',
      'settings.testing': 'Testing…',
      'settings.saved': 'Settings saved.',
      'settings.saveFailed': 'Save failed: {message}',
      'settings.testOk': 'Connected · {model} · {latency} ms',
      'settings.testFailed': 'Connection failed: {message}',
      'settings.loadFailed': 'Could not load settings: {message}',
      'settings.loading': 'Loading settings…',
      'settings.storageNote': 'Settings are stored on this machine and survive a restart.',
      'settings.keyPresent': 'API key configured',
      'settings.keyAbsent': 'No API key',
      'settings.requiredCustom': 'Custom mode needs an API base URL and a model name.',
    }

    // ---------------------------------------------------------------------
    // Same-origin HTTP helpers
    // ---------------------------------------------------------------------
    function apiUrl(path) {
      const origin = typeof location !== 'undefined' && location.origin && location.origin !== 'null' ? location.origin : ''
      return origin + ROUTE + path
    }

    async function request(path, options) {
      const init = options || {}
      const response = await fetch(apiUrl(path), {
        credentials: 'same-origin',
        ...init,
        headers: { 'content-type': 'application/json', 'x-dsh-promt-refine': '1', ...(init.headers || {}) },
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        const message = payload && payload.error && payload.error.message ? payload.error.message : `HTTP ${response.status}`
        throw new Error(message)
      }
      return payload
    }

    function postJson(path, body) {
      return request(path, { method: 'POST', body: JSON.stringify(body || {}) })
    }

    function errorMessage(error) {
      return error instanceof Error ? error.message : String(error)
    }

    // ---------------------------------------------------------------------
    // Shared, page-local settings mirror (the toolbar and the settings page are
    // two components of this same module, so they can share plain module state).
    // ---------------------------------------------------------------------
    const shared = { showLabel: true, loaded: false }
    const sharedListeners = new Set()

    function publishShared(patch) {
      let changed = false
      for (const key of Object.keys(patch)) {
        if (shared[key] !== patch[key]) changed = true
        shared[key] = patch[key]
      }
      if (changed) for (const listener of sharedListeners) listener()
    }

    function useSharedSettings() {
      const [, refresh] = React.useState(0)
      React.useEffect(() => {
        const listener = () => refresh((value) => value + 1)
        sharedListeners.add(listener)
        return () => {
          sharedListeners.delete(listener)
        }
      }, [])
      return shared
    }

    function loadSharedSettings() {
      if (shared.loaded) return
      request('/settings')
        .then((payload) => {
          if (!payload) return
          publishShared({ showLabel: payload.showLabel !== false, loaded: true })
        })
        .catch(() => {})
    }

    // ---------------------------------------------------------------------
    // Shared tiny controls (styled with host theme tokens)
    // ---------------------------------------------------------------------
    function IconSparkle({ size }) {
      return h(
        'svg',
        { viewBox: '0 0 20 20', width: size || 15, height: size || 15, 'aria-hidden': true, focusable: false, style: { display: 'block' } },
        h('path', {
          d: 'M10 2.2l1.75 4.55L16.3 8.5l-4.55 1.75L10 14.8l-1.75-4.55L3.7 8.5l4.55-1.75z',
          fill: 'currentColor',
        }),
      )
    }

    function IconUndo({ size }) {
      return h(
        'svg',
        {
          viewBox: '0 0 20 20',
          width: size || 15,
          height: size || 15,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        h('path', { d: 'M6.5 7.5h7a3.75 3.75 0 010 7.5H9' }),
        h('path', { d: 'M9 4.5L6 7.5l3 3' }),
      )
    }

    function Spinner() {
      return h('span', { className: 'dsh-pr-spinner', 'aria-hidden': true })
    }

    function Field({ id, label, hint, children }) {
      return h(
        'div',
        { className: 'dsh-pr-field' },
        h('label', { className: 'dsh-pr-label', htmlFor: id }, label),
        children,
        hint ? h('div', { className: 'dsh-pr-hint' }, hint) : null,
      )
    }

    // ---------------------------------------------------------------------
    // Composer toolbar control (conversation.input.right: immediately before
    // the model selector, inside the composer card's tool row).
    // ---------------------------------------------------------------------
    const toolbarCss = `
.dsh-pr-wrap { position: relative; display: inline-flex; align-items: center; flex: none; }
.dsh-pr-tool { display: inline-flex; align-items: center; gap: 4px; flex: none; height: 28px; padding: 0 8px;
  border: none; border-radius: var(--dsw-radius-sm, 8px); background: transparent;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-family: inherit;
  font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 20px; white-space: nowrap; cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease; }
.dsh-pr-tool[data-icon-only="true"] { width: 28px; padding: 0; justify-content: center; }
.dsh-pr-tool:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.dsh-pr-tool:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary))); outline-offset: 2px; }
.dsh-pr-tool:disabled { cursor: default; opacity: 0.4; }
.dsh-pr-tool[data-refined="true"] { color: var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary)); }
.dsh-pr-tip { position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 2; box-sizing: border-box; max-width: 300px;
  padding: 6px 10px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 18px; white-space: normal; box-shadow: var(--dsw-elevation-soft, 0 4px 16px rgba(0, 0, 0, 0.16)); }
.dsh-pr-tip[data-level="error"] { color: var(--dsw-alias-state-error-primary); }
.dsh-pr-tip[data-level="info"] { color: var(--dsw-alias-label-secondary); }
.dsh-pr-spinner { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid currentColor; border-top-color: transparent; animation: dsh-pr-spin 0.8s linear infinite; }
@keyframes dsh-pr-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dsh-pr-spinner { animation-duration: 2s; } }
`

    function RefineToolbar(props) {
      const { inputActions, useInput, sessionId } = props
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const draft = useInput((state) => state.draft)
      const phase = useInput((state) => state.phase)
      const preferences = useSharedSettings()
      const [busy, setBusy] = React.useState(false)
      const [original, setOriginal] = React.useState(null)
      const [refined, setRefined] = React.useState(null)
      const [message, setMessage] = React.useState(null)
      const draftRef = React.useRef(draft)
      draftRef.current = draft
      const mounted = React.useRef(true)

      React.useEffect(() => {
        mounted.current = true
        loadSharedSettings()
        return () => {
          mounted.current = false
        }
      }, [])

      React.useEffect(() => {
        setBusy(false)
        setOriginal(null)
        setRefined(null)
        setMessage(null)
      }, [sessionId])

      React.useEffect(() => {
        if (refined === null) return
        if (draft === refined) return
        // Sending or clearing the optimized draft ends the undo window.
        if (draft.trim() === '') {
          setRefined(null)
          setOriginal(null)
          setMessage(null)
        }
      }, [draft, refined])

      React.useEffect(() => {
        if (message === null) return
        const timer = setTimeout(() => setMessage(null), message.level === 'error' ? 9000 : 4000)
        return () => clearTimeout(timer)
      }, [message])

      const optimize = async () => {
        if (busy) return
        const source = draft
        if (!source.trim()) {
          setMessage({ level: 'error', text: t('tool.empty') })
          return
        }
        setBusy(true)
        setMessage(null)
        try {
          const result = await postJson('/optimize', { text: source, sessionId })
          const optimized = typeof result.optimized === 'string' ? result.optimized.trim() : ''
          if (!optimized) throw new Error(t('tool.empty'))
          if (!mounted.current) return
          if (draftRef.current !== source) {
            setMessage({ level: 'info', text: t('tool.draftChanged') })
            return
          }
          setOriginal(source)
          setRefined(optimized)
          inputActions.setDraft(optimized)
        } catch (error) {
          if (!mounted.current) return
          setMessage({ level: 'error', text: t('tool.failed', { message: errorMessage(error) }) })
        } finally {
          if (mounted.current) setBusy(false)
        }
      }

      const undo = () => {
        if (original === null) return
        inputActions.setDraft(original)
        setOriginal(null)
        setRefined(null)
        setMessage(null)
      }

      const locked = phase !== 'plain'
      const isRefined = refined !== null && original !== null
      const disabled = busy || locked
      const showIdleLabel = preferences.showLabel !== false
      const showText = isRefined ? true : showIdleLabel
      const title = isRefined ? t('tool.undoHint') : t('tool.optimizeHint')
      const label = busy ? t('tool.busy') : isRefined ? t('tool.undo') : t('tool.optimize')

      return h(
        'div',
        { className: 'dsh-pr-wrap' },
        h('style', null, toolbarCss),
        message ? h('div', { className: 'dsh-pr-tip', 'data-level': message.level, role: message.level === 'error' ? 'alert' : 'status' }, message.text) : null,
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-pr-tool',
            'data-icon-only': showText ? 'false' : 'true',
            'data-refined': isRefined ? 'true' : 'false',
            disabled,
            title,
            'aria-label': label,
            'aria-busy': busy ? 'true' : 'false',
            // Keep the caret/selection in the draft editor, like the host toolbar controls.
            onMouseDown: (event) => event.preventDefault(),
            onClick: isRefined ? undo : optimize,
          },
          busy ? h(Spinner) : isRefined ? h(IconUndo) : h(IconSparkle),
          showText ? h('span', null, label) : null,
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Settings section
    // ---------------------------------------------------------------------
    const settingsCss = `
.dsh-pr-settings { display: flex; flex-direction: column; width: 100%; gap: 0; }
.dsh-pr-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-pr-row:last-child { border-bottom: none; }
.dsh-pr-row-title { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dsh-pr-row-desc { margin-top: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-pr-heading { font-size: 16px; line-height: 24px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-pr-subheading { margin-top: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-pr-form { display: flex; flex-direction: column; gap: 14px; width: 100%; }
.dsh-pr-field { display: flex; flex-direction: column; gap: 6px; }
.dsh-pr-label { font-size: 13px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dsh-pr-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsh-pr-input, .dsh-pr-textarea { box-sizing: border-box; width: 100%; padding: 6px 12px; border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md, 12px); background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 20px; }
.dsh-pr-input:focus-visible, .dsh-pr-textarea:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary))); outline-offset: 1px; }
.dsh-pr-input:disabled, .dsh-pr-textarea:disabled { opacity: 0.5; }
.dsh-pr-textarea { resize: vertical; min-height: 140px; font-family: inherit; }
.dsh-pr-modes { display: flex; gap: 10px; flex-wrap: wrap; }
.dsh-pr-mode { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg, 16px); cursor: pointer; flex: 1 1 220px; }
.dsh-pr-mode[data-active="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2)); }
.dsh-pr-mode input { margin-top: 3px; accent-color: var(--dsw-alias-brand-primary); }
.dsh-pr-mode-title { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.dsh-pr-mode-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-pr-inline { display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
.dsh-pr-number { width: 140px; }
.dsh-pr-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsh-pr-primary, .dsh-pr-secondary { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 28px; padding: 0 12px;
  border-radius: var(--dsw-radius-md, 12px); font-family: inherit; font-size: 13px; line-height: 20px; cursor: pointer; border: none; }
.dsh-pr-primary { background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dsh-pr-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary)); }
.dsh-pr-secondary { background: transparent; color: var(--dsw-alias-label-primary); border: 0.5px solid var(--dsw-alias-border-l3); }
.dsh-pr-secondary:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-pr-primary:disabled, .dsh-pr-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
.dsh-pr-primary:focus-visible, .dsh-pr-secondary:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary))); outline-offset: 2px; }
.dsh-pr-status { margin-top: 6px; font-size: 12px; line-height: 18px; min-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-pr-status[data-tone="ok"] { color: var(--dsw-alias-state-success-primary); }
.dsh-pr-status[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.dsh-pr-checkbox { display: inline-flex; align-items: center; gap: 6px; height: 28px; font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsh-pr-checkbox input { accent-color: var(--dsw-alias-brand-primary); }
.dsh-pr-switch { position: relative; flex: none; width: 36px; height: 20px; padding: 2px; border: none; border-radius: 999px;
  background: var(--dsw-alias-border-l3); cursor: pointer; transition: background-color 120ms ease; }
.dsh-pr-switch[data-on="true"] { background: var(--dsw-alias-brand-primary); }
.dsh-pr-switch:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary))); outline-offset: 2px; }
.dsh-pr-switch-thumb { display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-label-primary-foreground, #fff);
  transform: translateX(0); transition: transform 120ms ease; }
.dsh-pr-switch[data-on="true"] .dsh-pr-switch-thumb { transform: translateX(16px); }
.dsh-pr-spinner { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid currentColor; border-top-color: transparent; animation: dsh-pr-spin 0.8s linear infinite; }
.dsh-pr-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsh-pr-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.dsh-pr-dot[data-on="true"] { background: var(--dsw-alias-state-success-primary); }
@keyframes dsh-pr-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dsh-pr-spinner { animation-duration: 2s; } }
`

    const EMPTY_FORM = {
      mode: 'account',
      provider: '',
      model: '',
      baseURL: '',
      apiKey: '',
      temperature: '0.3',
      maxTokens: '0',
      systemPrompt: '',
      showLabel: true,
    }

    function toForm(settings) {
      return {
        mode: settings.mode === 'custom' ? 'custom' : 'account',
        provider: settings.provider || '',
        model: settings.model || '',
        baseURL: settings.baseURL || '',
        apiKey: '',
        temperature: String(settings.temperature ?? 0.3),
        maxTokens: String(settings.maxTokens ?? 0),
        systemPrompt: settings.systemPrompt || '',
        showLabel: settings.showLabel !== false,
      }
    }

    function RefineSettings(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const [form, setForm] = React.useState(EMPTY_FORM)
      const [hasKey, setHasKey] = React.useState(false)
      const [keyMasked, setKeyMasked] = React.useState('')
      const [clearKey, setClearKey] = React.useState(false)
      const [defaultInstruction, setDefaultInstruction] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [saving, setSaving] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [status, setStatus] = React.useState(null)
      const mounted = React.useRef(true)

      React.useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
        }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        request('/settings')
          .then((payload) => {
            if (cancelled || !payload) return
            setForm(toForm(payload))
            setHasKey(Boolean(payload.hasApiKey))
            setKeyMasked(payload.apiKeyMasked || '')
            if (payload.defaults && payload.defaults.systemPrompt) setDefaultInstruction(payload.defaults.systemPrompt)
            publishShared({ showLabel: payload.showLabel !== false, loaded: true })
            setLoading(false)
          })
          .catch((error) => {
            if (cancelled) return
            setLoading(false)
            setStatus({ tone: 'error', text: t('settings.loadFailed', { message: errorMessage(error) }) })
          })
        return () => {
          cancelled = true
        }
      }, [])

      const update = (field, value) => {
        setForm((previous) => ({ ...previous, [field]: value }))
      }

      const payloadSettings = () => ({
        mode: form.mode,
        provider: form.provider,
        model: form.model,
        baseURL: form.baseURL,
        temperature: form.temperature,
        maxTokens: form.maxTokens,
        systemPrompt: form.systemPrompt,
        showLabel: form.showLabel,
      })

      const save = async () => {
        if (saving || testing) return
        if (form.mode === 'custom' && (!form.baseURL.trim() || !form.model.trim())) {
          setStatus({ tone: 'error', text: t('settings.requiredCustom') })
          return
        }
        setSaving(true)
        setStatus(null)
        try {
          const payload = await postJson('/settings', {
            settings: payloadSettings(),
            apiKey: form.apiKey,
            clearApiKey: clearKey,
          })
          if (!mounted.current) return
          setForm(toForm({ ...payload, apiKey: '' }))
          setHasKey(Boolean(payload.hasApiKey))
          setKeyMasked(payload.apiKeyMasked || '')
          setClearKey(false)
          publishShared({ showLabel: payload.showLabel !== false, loaded: true })
          setStatus({ tone: 'ok', text: t('settings.saved') })
        } catch (error) {
          if (mounted.current) setStatus({ tone: 'error', text: t('settings.saveFailed', { message: errorMessage(error) }) })
        } finally {
          if (mounted.current) setSaving(false)
        }
      }

      const test = async () => {
        if (saving || testing) return
        if (form.mode === 'custom' && (!form.baseURL.trim() || !form.model.trim())) {
          setStatus({ tone: 'error', text: t('settings.requiredCustom') })
          return
        }
        setTesting(true)
        setStatus(null)
        try {
          const payload = await postJson('/test', {
            settings: payloadSettings(),
            apiKey: form.apiKey,
            clearApiKey: clearKey,
          })
          if (!mounted.current) return
          const model = payload.model ? [payload.model.provider, payload.model.model].filter(Boolean).join(' / ') : ''
          setStatus({ tone: 'ok', text: t('settings.testOk', { model, latency: String(payload.latencyMs ?? 0) }) })
        } catch (error) {
          if (mounted.current) setStatus({ tone: 'error', text: t('settings.testFailed', { message: errorMessage(error) }) })
        } finally {
          if (mounted.current) setTesting(false)
        }
      }

      if (loading) {
        return h('div', { className: 'dsh-pr-settings' }, h('style', null, settingsCss), h('div', { className: 'dsh-pr-status', role: 'status' }, t('settings.loading')))
      }

      const custom = form.mode === 'custom'
      return h(
        'div',
        { className: 'dsh-pr-settings' },
        h('style', null, settingsCss),

        h(
          'div',
          { className: 'dsh-pr-row' },
          h(
            'div',
            null,
            h('div', { className: 'dsh-pr-heading' }, t('settings.title')),
            h('div', { className: 'dsh-pr-subheading' }, t('settings.description')),
          ),
          h(
            'span',
            { className: 'dsh-pr-pill', title: hasKey ? t('settings.keyPresent') : t('settings.keyAbsent') },
            h('span', { className: 'dsh-pr-dot', 'data-on': hasKey ? 'true' : 'false' }),
            hasKey ? t('settings.apiKey') : t('settings.apiKeyUnset'),
          ),
        ),

        h(
          'div',
          { className: 'dsh-pr-row' },
          h(
            'div',
            { style: { flex: '1 1 260px', minWidth: 0 } },
            h('div', { className: 'dsh-pr-row-title' }, t('settings.showLabel')),
            h('div', { className: 'dsh-pr-row-desc' }, t('settings.showLabelHint')),
          ),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': form.showLabel ? 'true' : 'false',
            'aria-label': t('settings.showLabel'),
            className: 'dsh-pr-switch',
            'data-on': form.showLabel ? 'true' : 'false',
            onClick: () => update('showLabel', !form.showLabel),
          }, h('span', { className: 'dsh-pr-switch-thumb' })),
        ),

        h(
          'div',
          { className: 'dsh-pr-row' },
          h(
            'div',
            { style: { flex: '1 1 auto', minWidth: 0 } },
            h('div', { className: 'dsh-pr-row-title' }, t('settings.mode')),
            h('div', { className: 'dsh-pr-row-desc' }, custom ? t('settings.modeCustomHint') : t('settings.modeAccountHint')),
          ),
          h(
            'div',
            { className: 'dsh-pr-form', style: { flex: '0 1 620px' } },
            h(
              'div',
              { className: 'dsh-pr-modes', role: 'radiogroup', 'aria-label': t('settings.mode') },
              h(
                'label',
                { className: 'dsh-pr-mode', 'data-active': custom ? 'false' : 'true' },
                h('input', {
                  type: 'radio',
                  name: 'dsh-pr-mode',
                  value: 'account',
                  checked: !custom,
                  onChange: () => update('mode', 'account'),
                }),
                h(
                  'span',
                  null,
                  h('div', { className: 'dsh-pr-mode-title' }, t('settings.modeAccount')),
                  h('div', { className: 'dsh-pr-mode-desc' }, t('settings.modeAccountHint')),
                ),
              ),
              h(
                'label',
                { className: 'dsh-pr-mode', 'data-active': custom ? 'true' : 'false' },
                h('input', {
                  type: 'radio',
                  name: 'dsh-pr-mode',
                  value: 'custom',
                  checked: custom,
                  onChange: () => update('mode', 'custom'),
                }),
                h(
                  'span',
                  null,
                  h('div', { className: 'dsh-pr-mode-title' }, t('settings.modeCustom')),
                  h('div', { className: 'dsh-pr-mode-desc' }, t('settings.modeCustomHint')),
                ),
              ),
            ),
          ),
        ),

        h(
          'div',
          { className: 'dsh-pr-row' },
          h(
            'div',
            { style: { flex: '1 1 260px', minWidth: 0 } },
            h('div', { className: 'dsh-pr-row-title' }, custom ? t('settings.baseURL') : t('settings.provider')),
            h('div', { className: 'dsh-pr-row-desc' }, custom ? t('settings.baseURLHint') : t('settings.providerHint')),
          ),
          h(
            'div',
            { className: 'dsh-pr-form', style: { flex: '0 1 620px' } },
            custom
              ? h(Field, {
                  id: 'dsh-pr-base-url',
                  label: t('settings.baseURL'),
                  hint: t('settings.baseURLHint'),
                  children: h('input', {
                    id: 'dsh-pr-base-url',
                    className: 'dsh-pr-input',
                    type: 'text',
                    spellCheck: false,
                    value: form.baseURL,
                    placeholder: t('settings.baseURLPlaceholder'),
                    onChange: (event) => update('baseURL', event.target.value),
                  }),
                })
              : h(
                  'div',
                  { className: 'dsh-pr-inline' },
                  h(
                    'div',
                    { style: { flex: '1 1 180px' } },
                    h(Field, {
                      id: 'dsh-pr-provider',
                      label: t('settings.provider'),
                      children: h('input', {
                        id: 'dsh-pr-provider',
                        className: 'dsh-pr-input',
                        type: 'text',
                        spellCheck: false,
                        value: form.provider,
                        placeholder: t('settings.providerPlaceholder'),
                        onChange: (event) => update('provider', event.target.value),
                      }),
                    }),
                  ),
                  h(
                    'div',
                    { style: { flex: '1 1 180px' } },
                    h(Field, {
                      id: 'dsh-pr-model-account',
                      label: t('settings.model'),
                      children: h('input', {
                        id: 'dsh-pr-model-account',
                        className: 'dsh-pr-input',
                        type: 'text',
                        spellCheck: false,
                        value: form.model,
                        placeholder: t('settings.modelPlaceholder'),
                        onChange: (event) => update('model', event.target.value),
                      }),
                    }),
                  ),
                ),
          ),
        ),

        custom
          ? h(
              'div',
              { className: 'dsh-pr-row' },
              h(
                'div',
                { style: { flex: '1 1 260px', minWidth: 0 } },
                h('div', { className: 'dsh-pr-row-title' }, t('settings.model')),
                h('div', { className: 'dsh-pr-row-desc' }, t('settings.modelHint')),
              ),
              h(
                'div',
                { className: 'dsh-pr-form', style: { flex: '0 1 620px' } },
                h(Field, {
                  id: 'dsh-pr-model',
                  label: t('settings.model'),
                  hint: t('settings.modelHint'),
                  children: h('input', {
                    id: 'dsh-pr-model',
                    className: 'dsh-pr-input',
                    type: 'text',
                    spellCheck: false,
                    value: form.model,
                    placeholder: t('settings.modelPlaceholder'),
                    onChange: (event) => update('model', event.target.value),
                  }),
                }),
                h(Field, {
                  id: 'dsh-pr-api-key',
                  label: t('settings.apiKey'),
                  hint: t('settings.apiKeyHint'),
                  children: h(
                    'div',
                    { className: 'dsh-pr-inline' },
                    h('input', {
                      id: 'dsh-pr-api-key',
                      className: 'dsh-pr-input',
                      style: { flex: '1 1 260px' },
                      type: 'password',
                      autoComplete: 'off',
                      spellCheck: false,
                      value: form.apiKey,
                      placeholder: hasKey ? t('settings.apiKeyPlaceholderSaved') : t('settings.apiKeyPlaceholder'),
                      onChange: (event) => update('apiKey', event.target.value),
                    }),
                    hasKey
                      ? h(
                          'label',
                          { className: 'dsh-pr-checkbox' },
                          h('input', {
                            type: 'checkbox',
                            checked: clearKey,
                            onChange: (event) => setClearKey(event.target.checked),
                          }),
                          t('settings.clearKey'),
                        )
                      : null,
                  ),
                }),
                h(
                  'div',
                  { className: 'dsh-pr-inline' },
                  h(
                    'div',
                    { style: { flex: '0 1 220px' } },
                    h(Field, {
                      id: 'dsh-pr-temperature',
                      label: t('settings.temperature'),
                      hint: t('settings.temperatureHint'),
                      children: h('input', {
                        id: 'dsh-pr-temperature',
                        className: 'dsh-pr-input dsh-pr-number',
                        type: 'number',
                        min: 0,
                        max: 2,
                        step: 0.1,
                        value: form.temperature,
                        onChange: (event) => update('temperature', event.target.value),
                      }),
                    }),
                  ),
                  h(
                    'div',
                    { style: { flex: '0 1 220px' } },
                    h(Field, {
                      id: 'dsh-pr-max-tokens',
                      label: t('settings.maxTokens'),
                      hint: t('settings.maxTokensHint'),
                      children: h('input', {
                        id: 'dsh-pr-max-tokens',
                        className: 'dsh-pr-input dsh-pr-number',
                        type: 'number',
                        min: 0,
                        step: 1,
                        value: form.maxTokens,
                        onChange: (event) => update('maxTokens', event.target.value),
                      }),
                    }),
                  ),
                ),
              ),
            )
          : null,

        h(
          'div',
          { className: 'dsh-pr-row' },
          h(
            'div',
            { style: { flex: '1 1 260px', minWidth: 0 } },
            h('div', { className: 'dsh-pr-row-title' }, t('settings.systemPrompt')),
            h('div', { className: 'dsh-pr-row-desc' }, t('settings.systemPromptHint')),
          ),
          h(
            'div',
            { className: 'dsh-pr-form', style: { flex: '0 1 620px' } },
            h('textarea', {
              id: 'dsh-pr-system-prompt',
              className: 'dsh-pr-textarea',
              value: form.systemPrompt,
              placeholder: defaultInstruction,
              spellCheck: false,
              onChange: (event) => update('systemPrompt', event.target.value),
            }),
            h(
              'div',
              { className: 'dsh-pr-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-pr-secondary',
                  onClick: () => update('systemPrompt', defaultInstruction),
                },
                t('settings.restoreDefault'),
              ),
            ),
          ),
        ),

        h(
          'div',
          { className: 'dsh-pr-row' },
          h(
            'div',
            { style: { flex: '1 1 260px', minWidth: 0 } },
            h('div', { className: 'dsh-pr-row-desc' }, t('settings.storageNote')),
            h('div', { className: 'dsh-pr-status', 'data-tone': status ? status.tone : 'idle', role: 'status' }, status ? status.text : ''),
          ),
          h(
            'div',
            { className: 'dsh-pr-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-pr-secondary',
                disabled: saving || testing,
                onClick: test,
              },
              testing ? h(Spinner) : null,
              testing ? t('settings.testing') : t('settings.test'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-pr-primary',
                disabled: saving || testing,
                onClick: save,
              },
              saving ? h(Spinner) : null,
              saving ? t('settings.saving') : t('settings.save'),
            ),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Client plugin
    // ---------------------------------------------------------------------
    const inject = ['slots', 'locale']

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-promt-refine: dictionaries')

      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.right',
            id: 'dsh-promt-refine',
            order: 20,
            locale: NS,
          },
          RefineToolbar,
        ),
      )

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-promt-refine',
            order: 50,
            label: () => t('settings.nav'),
            locale: NS,
          },
          RefineSettings,
        ),
      )
    }

    return { inject, apply }
  },
})
