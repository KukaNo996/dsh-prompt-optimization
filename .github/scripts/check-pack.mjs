/**
 * 断言 npm 打包内容：必须包含运行时文件，且不得包含测试/CI/密钥文件。
 * 用法：npm pack --dry-run --json > pack.json && node .github/scripts/check-pack.mjs pack.json
 */
import { readFile } from 'node:fs/promises'

const reportPath = process.argv[2] || 'pack.json'
const report = JSON.parse(await readFile(reportPath, 'utf8'))
const entry = Array.isArray(report) ? report[0] : report
const names = entry.files.map((file) => file.path)

const required = [
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'locale/en.json',
  'locale/zh-cn.json',
  'locale/zh-tw.json',
  'locale/ja.json',
  'package.json',
  'LICENSE',
  'README.md',
]

const forbiddenPrefixes = ['.verify/', '.github/', 'node_modules/', '.git/']
const forbiddenNames = ['settings.json', '.npmrc', '.env']
const failures = []

for (const file of required) {
  if (!names.includes(file)) failures.push(`missing required file: ${file}`)
}
for (const name of names) {
  if (forbiddenPrefixes.some((prefix) => name.startsWith(prefix))) failures.push(`forbidden path: ${name}`)
  if (forbiddenNames.some((bad) => name.endsWith(bad))) failures.push(`forbidden secret file: ${name}`)
}
if (entry.size > 200 * 1024) failures.push(`tarball too large: ${entry.size} bytes (limit 200 KiB)`)

console.log(`pack contains ${names.length} files, ${entry.size} bytes packed, ${entry.unpackedSize} bytes unpacked`)
for (const name of names.sort()) console.log(`  ${name}`)

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\npack contents OK')
