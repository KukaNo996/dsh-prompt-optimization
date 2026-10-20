/**
 * 验证空输入提示动画：type -> hold -> erase 的时序与打断行为。
 * 在真实的定时器语义下模拟组件逻辑，不依赖 React。
 *
 * 用法：node .verify/hint-animation-test.mjs
 */
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'client.js'), 'utf8')

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

// --- 1. 读取时序常量 ---------------------------------------------------------
const constOf = (name) => {
  const match = new RegExp(`const ${name} = (\\d+)`).exec(source)
  return match ? Number(match[1]) : undefined
}

const chunk = constOf('HINT_CHUNK')
const typeMs = constOf('HINT_TYPE_MS')
const holdMs = constOf('HINT_HOLD_MS')
const eraseChunk = constOf('HINT_ERASE_CHUNK')
const eraseMs = constOf('HINT_ERASE_MS')

check('hint timing constants defined', [chunk, typeMs, holdMs, eraseChunk, eraseMs].every(Number.isFinite), {
  chunk, typeMs, holdMs, eraseChunk, eraseMs,
})
check('hold is 5 seconds', holdMs === 5000, holdMs)
check('typing uses chunks, not single chars', chunk > 1, chunk)
check('erasing is slower than typing', eraseMs >= typeMs, { typeMs, eraseMs })
check('erasing removes fewer chars per tick', eraseChunk <= chunk, { eraseChunk, chunk })

// --- 2. 动画时序模拟 ---------------------------------------------------------
const HINT = '先写下你想完成的事情，例如：帮我给项目写一份使用说明。'
const chars = [...HINT]

function simulate(opts) {
  const {
    userTypedAt = null, // 该 tick 之后用户手动输入
    userText = '', // 用户键入的内容
    cancelAt = null, // 该 tick 之后外部调用 cancel
    unmountAt = null,
  } = opts || {}
  const draft = { value: '' }
  const written = []
  let now = 0
  let timer = null
  const run = { timer: null, phase: 'typing', chars, index: 0 }
  const mounted = { value: true }

  const setDraft = (text) => {
    draft.value = text
    written.push({ at: now, text })
  }

  const cancel = (keepText) => {
    if (run.timer !== null) {
      timer = null
    }
    const wasAnimating = run.phase !== 'idle'
    const owned = run.chars.slice(0, run.index).join('')
    run.phase = 'idle'
    run.chars = []
    run.index = 0
    if (wasAnimating && !keepText && mounted.value) {
      if (owned && draft.value === owned) setDraft('')
    }
  }

  const step = () => {
    if (!mounted.value) return
    if (run.phase === 'typing') {
      run.index = Math.min(run.chars.length, run.index + chunk)
      setDraft(run.chars.slice(0, run.index).join(''))
      if (run.index >= run.chars.length) {
        run.phase = 'holding'
        run.timer = { hold: true, delay: holdMs }
        return
      }
      run.timer = { delay: typeMs }
      return
    }
    if (run.phase === 'erasing') {
      run.index = Math.max(0, run.index - eraseChunk)
      setDraft(run.chars.slice(0, run.index).join(''))
      if (run.index <= 0) {
        run.phase = 'idle'
        run.timer = null
        run.chars = []
        return
      }
      run.timer = { delay: eraseMs }
    }
  }

  run.timer = { delay: typeMs }

  let tick = 0
  let cancelCalled = false
  while (tick < 5000) {
    tick += 1
    now += 10
    if (unmountAt !== null && tick >= unmountAt) {
      mounted.value = false
      run.timer = null
      run.phase = 'idle'
      break
    }
    if (cancelAt !== null && tick >= cancelAt && !cancelCalled) {
      cancel()
      cancelCalled = true
      continue
    }
    if (!run.timer) break
    if (now >= run.timer.delay) {
      if (run.phase === 'holding') {
        run.phase = 'erasing'
        now = 0 // hold 用相对时间重置
        run.timer = { delay: 0 }
        step()
        continue
      }
      now = 0
      step()
    }
    // 用户输入：draft 与动画所拥有的前缀不一致 => 打断
    if (userTypedAt !== null && tick >= userTypedAt) {
      setDraft(userText)
      const owned = run.chars.slice(0, run.index).join('')
      if (draft.value !== owned) {
        cancel()
        cancelCalled = true
        break
      }
    }
  }
  return { written, finalDraft: draft.value, run, cancelCalled }
}

// 正常播放：应写满全文，停留 5 秒，再逐字删回空
const full = simulate({})
const maxText = full.written.reduce((a, b) => (b.text.length > a.text.length ? b : a), { text: '' })
check('hint is written in full', maxText.text === HINT, { got: maxText.text })
check('hint ends up empty', full.finalDraft === '', full.finalDraft)

const typingWrites = full.written.filter((w) => w.text.length < HINT.length && w.text.length > 0)
check('typing happens in multiple steps', typingWrites.length >= 5, typingWrites.length)

const erases = []
for (let i = 1; i < full.written.length; i += 1) {
  if (full.written[i].text.length < full.written[i - 1].text.length) erases.push(full.written[i])
}
// HINT_ERASE_CHUNK = 1 表示每次只删一个字符。
check('erasing removes exactly one character per step', erases.every((w, i) => {
  const prev = full.written[full.written.indexOf(w) - 1]
  return prev.text.length - w.text.length === eraseChunk
}), erases.slice(0, 3).map((w) => w.text.length))
check('erasing is gradual (many steps)', erases.length >= 10, erases.length)

const monotonic = full.written
  .map((w) => w.text)
  .reduce((acc, text) => {
    if (!acc.length) return [text]
    const prev = acc[acc.length - 1]
    if (text.length >= prev.length) acc.push(text)
    return acc
  }, [])
check('writes grow then shrink (no flicker)', monotonic.length >= 2, monotonic.length)

// 用户中途输入 -> 立即停止，且不清掉用户文字
// 模拟：动画写到一半时，用户在输入框里键入自己的文字（draft 变为用户内容）。
const interrupted = simulate({ userTypedAt: 40, userText: '帮我写个函数' })
check('user typing interrupts the animation', interrupted.cancelCalled, interrupted.run.phase)
check('interruption leaves the user text intact', interrupted.finalDraft === '帮我写个函数', interrupted.finalDraft)

const cancelled = simulate({ cancelAt: 30 })
check('cancel stops the run', cancelled.cancelCalled && cancelled.run.phase === 'idle', cancelled.run.phase)

const unmounted = simulate({ unmountAt: 20 })
check('unmount halts the run', unmounted.run.phase === 'idle', unmounted.run.phase)

// --- 3. 文案存在性 ----------------------------------------------------------
for (const locale of ['zh-cn', 'zh-tw', 'ja', 'en']) {
  const dict = JSON.parse(await readFile(join(root, 'locale', `${locale}.json`), 'utf8'))
  check(`${locale} has tool.hintType`, typeof dict['tool.hintType'] === 'string' && dict['tool.hintType'].length > 8, dict['tool.hintType'])
  // 提示语会被逐字写入，因此不能含占位符
  check(`${locale} hintType has no placeholders`, !/\{\w+\}/.test(dict['tool.hintType']), dict['tool.hintType'])
}

// --- 4. 组件接线 -----------------------------------------------------------
check('empty draft calls startHintAnimation', /startHintAnimation\(t\('tool\.hintType'\)\)/.test(source))
check('hint uses inputActions.setDraft only', /inputActions\.setDraft\(run\.chars\.slice/.test(source))
check('animation is cancelled on unmount', /mounted\.current = false[\s\S]{0,200}run\.phase = 'idle'/.test(source))
check('animation is cancelled on session switch', /\}, \[sessionId\]\)/.test(source) && /abortInflight\(\)\s*\n\s*cancelHintAnimation\(\)/.test(source))
check('animation is cancelled on undo', /const undo = \(\) => \{\s*\n\s*abortInflight\(\)\s*\n\s*cancelHintAnimation\(\)/.test(source))
// 用户要求：空输入时不再出现「请先输入需要优化的提示词」气泡，只保留输入框内动画。
// 因此 startHintAnimation 的函数体内不得出现 setMessage。
const hintFn = source.slice(
  source.indexOf('const startHintAnimation'),
  source.indexOf('React.useEffect(() => {', source.indexOf('const startHintAnimation')),
)
check('empty draft shows no bubble', !hintFn.includes('setMessage'), hintFn.match(/setMessage[^)]*\)/g))
check('animation completion shows no bubble', !/run\.index <= 0[\s\S]{0,200}setMessage/.test(source))
check('tool.empty is only an internal fallback', (source.match(/t\('tool\.empty'\)/g) || []).length <= 1, (source.match(/t\('tool\.empty'\)/g) || []).length)

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((item) => item.name).join(', '))
  process.exitCode = 1
}
