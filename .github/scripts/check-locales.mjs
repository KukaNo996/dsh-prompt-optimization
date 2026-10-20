/**
 * 校验 client.js 内联的字典与 locale/*.json 完全一致，且各语言键集合相同。
 * 用法：node .github/scripts/check-locales.mjs
 */
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const TARGETS = [
  { file: 'zh-cn.json', id: 'zh-CN', variable: 'zhCN' },
  { file: 'zh-tw.json', id: 'zh-TW', variable: 'zhTW' },
  { file: 'ja.json', id: 'ja', variable: 'ja' },
  { file: 'en.json', id: 'en', variable: 'en' },
]

const failures = []
function fail(message) {
  failures.push(message)
  console.log(`FAIL  ${message}`)
}

const source = await readFile(join(root, 'client.js'), 'utf8')

/** 从 client.js 取出某个字典变量名对应的对象字面量。 */
function readLiteral(variable) {
  const marker = `const ${variable} = {`
  const start = source.indexOf(marker)
  if (start < 0) return null
  let depth = 0
  let quote = null
  let escaped = false
  for (let index = start + marker.length - 1; index < source.length; index += 1) {
    const ch = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start + marker.length - 1, index + 1)
    }
  }
  return null
}

let reference = null
for (const target of TARGETS) {
  const json = JSON.parse(await readFile(join(root, 'locale', target.file), 'utf8'))
  const { meta, ...copy } = json
  if (!meta || !meta.title || !meta.description) fail(`locale/${target.file} 缺少 meta.title 或 meta.description`)

  const literal = readLiteral(target.variable)
  if (literal === null) {
    fail(`client.js 缺少字典 ${target.variable}`)
    continue
  }
  const inline = new Function(`return ${literal}`)()
  const jsonKeys = Object.keys(copy).sort()
  const inlineKeys = Object.keys(inline).sort()

  const missing = jsonKeys.filter((key) => !inlineKeys.includes(key))
  const extra = inlineKeys.filter((key) => !jsonKeys.includes(key))
  if (missing.length || extra.length) fail(`${target.id} 键不一致：缺少 [${missing.join(', ')}] 多出 [${extra.join(', ')}]`)

  const changed = jsonKeys.filter((key) => inline[key] !== copy[key])
  if (changed.length) fail(`${target.id} 文案与内联不一致（需重新运行 build:locales）：${changed.slice(0, 5).join(', ')}`)

  if (!reference) reference = jsonKeys
  else {
    const lacking = reference.filter((key) => !jsonKeys.includes(key))
    if (lacking.length) fail(`${target.id} 相比 en 缺少键：${lacking.join(', ')}`)
  }

  const empty = jsonKeys.filter((key) => typeof copy[key] !== 'string' || copy[key].trim() === '')
  if (empty.length) fail(`${target.id} 存在空译文：${empty.join(', ')}`)

  // 占位符必须一致，否则运行时会丢参数
  const placeholders = (value) => (String(value).match(/\{\w+\}/g) || []).sort().join(',')
  const english = JSON.parse(await readFile(join(root, 'locale', 'en.json'), 'utf8'))
  const mismatched = jsonKeys.filter((key) => placeholders(copy[key]) !== placeholders(english[key]))
  if (mismatched.length) fail(`${target.id} 占位符与 en 不一致：${mismatched.slice(0, 5).join(', ')}`)

  console.log(`PASS  ${target.id.padEnd(6)} ${Object.keys(copy).length} keys, meta="${meta?.title}"`)
}

if (failures.length) {
  console.error(`\n${failures.length} locale problem(s)`)
  process.exit(1)
}
console.log('\nlocale check passed')
