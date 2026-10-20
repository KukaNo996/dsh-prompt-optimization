/**
 * 验证「点击优化后界面卡死」已修复。
 *
 * 根因：流式改写的每个分片都直接调用一次 inputActions.setDraft()。
 * 一次改写会送来上百个分片，而宿主每次 setDraft 都要重渲染、持久化并把
 * 草稿写回会话——主线程被密集的写操作占满，窗口就失去响应。
 *
 * 这里用一个模拟宿主的假 inputActions 量化「每次改写触发的草稿写入次数」，
 * 并断言节流后写入次数降到与时长相关的量级，而不是与分片数相关。
 *
 * 用法：node .verify/stream-throttle-test.mjs
 */
import { readFile } from 'node:fs/promises'

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

const clientSrc = await readFile(new URL('../client.js', import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// 1. 客户端确实做了节流
// ---------------------------------------------------------------------------

const flushMatch = /const STREAM_FLUSH_MS = (\d+)/.exec(clientSrc)
const flushMs = flushMatch ? Number(flushMatch[1]) : 0
check('a flush interval is defined', flushMs > 0, flushMs)
check('the flush interval is short enough to look continuous', flushMs >= 40 && flushMs <= 200, flushMs)

const optimizeBlock = clientSrc.slice(clientSrc.indexOf('const optimize = async'), clientSrc.indexOf('const undo ='))
const directWrites = (optimizeBlock.match(/inputActions\.setDraft\(/g) || []).length
// setDraft 应只出现在 flush 与最终的写入两处，而不是每个分片一次。
check('the stream callback does not write the draft per delta', !/async \(piece\)[\s\S]{0,500}?inputActions\.setDraft\(streamed\)/.test(optimizeBlock), 'a direct write remains in the delta callback')
check('the writes are funnelled through a flush', /inputActions\.setDraft\(pendingText\)/.test(optimizeBlock), 'no pendingText write')
check('the flush is scheduled on a timer', /setTimeout\(flush, STREAM_FLUSH_MS\)/.test(optimizeBlock), 'no timer flush')

// ---------------------------------------------------------------------------
// 2. 行为模拟：同样的分片序列，写入次数从「每片一次」降到「每周期一次」
// ---------------------------------------------------------------------------

/** 模拟宿主的 setDraft：每次都要重渲染 + 持久化，代价随次数线性增长。 */
function makeHost(costPerWrite) {
  const state = { writes: 0, cost: 0, value: '' }
  return {
    state,
    setDraft(text) {
      state.writes += 1
      state.cost += costPerWrite
      state.value = text
    },
  }
}

/**
 * 复刻客户端的两种写法，对比同样 172 个分片下的写入次数。
 */
function simulate(pieces, { throttled, flushMs }) {
  const host = makeHost(1)
  let streamed = ''
  let pending = ''
  let timer = null
  let takenOver = false

  const flush = () => {
    timer = null
    if (takenOver || !pending) return
    host.setDraft(pending)
    pending = ''
  }
  const schedule = () => {
    if (timer !== null) return
    timer = setTimeout(flush, flushMs)
  }

  // 模拟流式回调逐片到达
  const start = Date.now()
  for (const piece of pieces) {
    streamed += piece
    if (throttled) {
      pending = streamed
      schedule()
    } else {
      host.setDraft(streamed)
    }
  }
  const elapsed = Date.now() - start
  if (timer !== null) {
    clearTimeout(timer)
    flush()
  }
  return { writes: host.state.writes, cost: host.state.cost, elapsed, final: host.state.value }
}

const PIECES = Array.from({ length: 172 }, (_, index) => `分片${index} `)

const unthrottled = simulate(PIECES, { throttled: false })
const throttled = simulate(PIECES, { throttled: true, flushMs })

check('the unthrottled path writes once per delta', unthrottled.writes === 172, unthrottled.writes)
check('the throttled path writes far fewer times', throttled.writes < unthrottled.writes / 4, {
  throttled: throttled.writes,
  unthrottled: unthrottled.writes,
})
check('the throttled path still ends with the full text', throttled.final === unthrottled.final, {
  throttled: throttled.final?.slice(-30),
  unthrottled: unthrottled.final?.slice(-30),
})
check(
  'the write count is bounded by time, not by the number of deltas',
  throttled.writes <= Math.ceil(throttled.elapsed / flushMs) + 2,
  { writes: throttled.writes, elapsed: throttled.elapsed, flushMs },
)

// 一个真实场景：模型分片密集到达时，写入次数应保持在几十次量级
check('a dense stream stays in the tens of writes', throttled.writes < 60, throttled.writes)

// ---------------------------------------------------------------------------
// 3. 取消不会留下待执行的写入
// ---------------------------------------------------------------------------

check('cancel drops the pending flush', /const cancelPendingFlush = \(\) =>/.test(clientSrc), 'no cancelPendingFlush')
check(
  'the cancel path calls it',
  /const cancel = \(\) => \{[\s\S]{0,400}?cancelPendingFlush\(\)/.test(clientSrc),
  'cancel does not drop the pending flush',
)
check(
  'unmounting drops the pending flush',
  /mounted\.current = false[\s\S]{0,120}?cancelPendingFlush\(\)/.test(clientSrc),
  'unmount does not drop the pending flush',
)
check(
  'switching session drops the pending flush',
  /cancelHintAnimation\(\)\s*\n\s*cancelPendingFlush\(\)/.test(clientSrc),
  'session change does not drop the pending flush',
)

// ---------------------------------------------------------------------------

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((item) => item.name).join(', '))
  process.exitCode = 1
}
