/**
 * 验证多语言解析：模拟宿主 locale 服务，检查不同 active id 下的译文。
 * 用法：node .verify/locale-test.mjs
 */
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'client.js'), 'utf8')

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

// 提取生成区里的解析函数并在隔离环境中执行
function extractBlock() {
  const begin = source.indexOf('// >>> LOCALES BEGIN')
  const end = source.indexOf('// <<< LOCALES END')
  if (begin < 0 || end < 0) throw new Error('LOCALES block missing')
  const body = source.slice(source.indexOf('\n', begin) + 1, end)
  return body
}

const block = extractBlock()
const sandbox = {}
vm.createContext(sandbox)
vm.runInContext(block, sandbox)

const { resolveLocale, dictionaryFor } = sandbox

// 宿主内置语言是 zh / en；区域变体也必须命中。
// 注意：规范化后 `zh-cn` 会命中主语言 `zh`（同一份简体字典），这是预期行为。
const cases = [
  ['zh', 'zh', '优化提示词'],
  ['zh-CN', 'zh-CN', '优化提示词'],
  ['zh-Hans', 'zh-Hans', '优化提示词'],
  ['zh_TW', 'zh-TW', '優化提示詞'],
  ['zh-Hant', 'zh-Hant', '優化提示詞'],
  ['zh-HK', 'zh-HK', '優化提示詞'],
  ['zh-cn', 'zh', '优化提示词'],
  ['ja', 'ja', 'プロンプトを最適化'],
  ['ja-JP', 'ja-JP', 'プロンプトを最適化'],
  ['en', 'en', 'Optimize prompt'],
  ['en-US', 'en-US', 'Optimize prompt'],
  ['fr', undefined, 'Optimize prompt'],
  ['', undefined, 'Optimize prompt'],
]

for (const [input, expectedId, expectedLabel] of cases) {
  const resolved = resolveLocale(input)
  check(`resolveLocale(${JSON.stringify(input)}) -> ${expectedId}`, resolved === expectedId, resolved)
  const label = dictionaryFor(input)?.['tool.optimize']
  check(`dictionaryFor(${JSON.stringify(input)}) label`, label === expectedLabel, label)
}

// 所有语言的键集合必须一致，占位符不能丢
const dictionaries = ['en', 'zh-cn', 'zh-tw', 'ja'].map(async (name) => ({
  name,
  dict: JSON.parse(await readFile(join(root, 'locale', `${name}.json`), 'utf8')),
}))
const loaded = await Promise.all(dictionaries)
const reference = Object.keys(loaded[0].dict).sort()
for (const { name, dict } of loaded) {
  const keys = Object.keys(dict).sort()
  const missing = reference.filter((key) => !keys.includes(key))
  check(`${name} key parity (${keys.length})`, missing.length === 0, missing)
  const placeholders = (value) => (String(value).match(/\{\w+\}/g) || []).sort().join(',')
  const mismatched = reference.filter((key) => placeholders(dict[key]) !== placeholders(loaded[0].dict[key]))
  check(`${name} placeholder parity`, mismatched.length === 0, mismatched)
}

// 内联字典必须与 JSON 一致（防止忘记 build:locales）
const inline = /const zhCN = (\{[\s\S]*?\n    \})/.exec(source)?.[1]
check('inline zhCN exists', Boolean(inline))
if (inline) {
  const parsed = new Function(`return ${inline}`)()
  const json = JSON.parse(await readFile(join(root, 'locale', 'zh-cn.json'), 'utf8'))
  const { meta, ...copy } = json
  const diff = Object.keys(copy).filter((key) => parsed[key] !== copy[key])
  check('inline zhCN matches zh-cn.json', diff.length === 0, diff.slice(0, 5))
}

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
