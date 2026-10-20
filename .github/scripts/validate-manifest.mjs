/**
 * 校验插件清单、补丁文件、语言包与图标，CI 与本地均可运行。
 * 用法：node .github/scripts/validate-manifest.mjs
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const failures = []

function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}`)
  } else {
    failures.push(name)
    console.log(`FAIL  ${name}${detail ? ` -> ${detail}` : ''}`)
  }
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

check('name is dsh-prompt-optimization', pkg.name === 'dsh-prompt-optimization', pkg.name)
check('version matches semver', /^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(pkg.version), pkg.version)
check('package is public', pkg.private !== true, pkg.private)
check('type is module', pkg.type === 'module', pkg.type)
check('declares bundle patch', pkg.dsh?.bundle?.patch === './cordis.patch.yml', pkg.dsh?.bundle?.patch)
check('declares web client', pkg.dsh?.client?.platform === 'web', pkg.dsh?.client?.platform)
check('client injects ui-conversation', (pkg.dsh?.client?.inject || []).includes('@deepseek-ai/dsh-client-ui-conversation'))
check('exports client entry', pkg.exports?.['./client'] === './client.js', pkg.exports?.['./client'])
check('exports icon', pkg.exports?.['./icon'] === './icon.svg', pkg.exports?.['./icon'])
check('exports locales', pkg.exports?.['./locale/*.json'] === './locale/*.json', pkg.exports?.['./locale/*.json'])
check('license is MIT', pkg.license === 'MIT', pkg.license)

// files 白名单必须覆盖运行时入口
const files = pkg.files || []
for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg']) {
  check(`files whitelist contains ${required}`, files.includes(required), files.join(','))
}

// 补丁中的插件名必须与包名一致
const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
const patchName = /name:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(patch.split('\n').find((line) => line.trim().startsWith('name:')) || '')?.[1]
check('patch row name equals package name', patchName === pkg.name, patchName)
check('patch inserts an entry', /-\s*insert:/.test(patch))

// 语言包必须中英齐全且键一致
const locales = {}
for (const locale of ['en', 'zh-cn', 'zh-tw', 'ja']) {
  const file = join(root, 'locale', `${locale}.json`)
  check(`locale ${locale}.json exists`, existsSync(file))
  if (existsSync(file)) {
    locales[locale] = JSON.parse(await readFile(file, 'utf8'))
    check(`locale ${locale} has meta.title`, Boolean(locales[locale]?.meta?.title), locales[locale]?.meta?.title)
    check(`locale ${locale} has meta.description`, Boolean(locales[locale]?.meta?.description))
  }
}
const metaKeySets = Object.values(locales).map((locale) => JSON.stringify(Object.keys(locale?.meta || {})))
check('locale meta keys match across languages', new Set(metaKeySets).size <= 1, metaKeySets.join(' | '))

// 图标必须是合法 SVG 且小于 256 KiB
const iconPath = join(root, 'icon.svg')
check('icon.svg exists', existsSync(iconPath))
if (existsSync(iconPath)) {
  const icon = await readFile(iconPath, 'utf8')
  check('icon.svg is svg markup', icon.trimStart().startsWith('<svg'), icon.slice(0, 40))
  check('icon.svg under 256 KiB', Buffer.byteLength(icon) < 256 * 1024, `${Buffer.byteLength(icon)} bytes`)
}

// 入口文件必须存在
for (const entry of [pkg.main, pkg.exports?.['.']]) {
  if (typeof entry === 'string') {
    check(`main entry exists: ${entry}`, existsSync(join(root, entry.replace(/^\.\//, ''))))
  }
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nmanifest validation passed')
