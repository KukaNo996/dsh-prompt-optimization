/**
 * 模拟宿主 locale 服务，验证 translate() 在各语言下的实际输出。
 * 用法：node .verify/translate-sim.mjs
 */
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'client.js'), 'utf8')

const begin = source.indexOf('// >>> LOCALES BEGIN')
const end = source.indexOf('// <<< LOCALES END')
const block = source.slice(source.indexOf('\n', begin) + 1, end)
const sandbox = {}
vm.createContext(sandbox)
vm.runInContext(block, sandbox)
const { dictionaryFor } = sandbox

/** 宿主只内置 zh / en；缺失时 t() 返回 key（这也是"未命中"的信号）。 */
function makeHost(active) {
  const dicts = { zh: dictionaryFor('zh'), en: dictionaryFor('en') }
  return {
    getSnapshot: () => ({ active, revision: 1 }),
    bind: () => (key, params) => {
      const dictionary = dicts[active]
      const value = dictionary && dictionary[key] !== undefined ? dictionary[key] : key
      if (value === key) return key
      if (!params) return value
      return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
    },
  }
}

/** 复刻 apply() 里 translate 的实现。 */
function translateWith(locale, key, params) {
  const t = locale.bind()
  const fromHost = t(key, params)
  if (fromHost !== undefined && fromHost !== null && fromHost !== key) return fromHost
  const dictionary = dictionaryFor(locale.getSnapshot().active)
  const template = dictionary[key] !== undefined ? dictionary[key] : dictionaryFor('en')[key]
  if (template === undefined) return key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
}

const expectation = {
  zh: { nav: '提示词优化', evaluate: '多候选评估（更慢、更贵）' },
  en: { nav: 'Prompt Refine', evaluate: 'Multi-candidate evaluation (slower, costlier)' },
  ja: { nav: 'プロンプト最適化', evaluate: '複数候補の評価（低速・高コスト）' },
  'zh-TW': { nav: '提示詞優化', evaluate: '多候選評估（較慢、較貴）' },
}

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

for (const [active, expected] of Object.entries(expectation)) {
  const locale = makeHost(active)
  const nav = translateWith(locale, 'settings.nav')
  const evaluate = translateWith(locale, 'settings.evaluate')
  const interpolated = translateWith(locale, 'settings.testOk', { model: 'provider/model', latency: '42' })
  check(`${active}: nav`, nav === expected.nav, nav)
  check(`${active}: evaluate`, evaluate === expected.evaluate, evaluate)
  check(`${active}: interpolation`, interpolated.includes('provider/model') && interpolated.includes('42'), interpolated)
}

// 未知语言回退英文，而不是显示 key
const unknown = makeHost('fr')
check('unknown locale falls back to English', translateWith(unknown, 'settings.nav') === 'Prompt Refine', translateWith(unknown, 'settings.nav'))

// 缺失键返回 key 本身，便于发现漏翻
check('missing key returns the key', translateWith(makeHost('zh'), 'settings.doesNotExist') === 'settings.doesNotExist')

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
