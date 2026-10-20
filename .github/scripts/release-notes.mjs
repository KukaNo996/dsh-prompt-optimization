/**
 * 生成 GitHub Release 说明：从 CHANGELOG 提取对应版本段落，缺失时回退到提交列表。
 * 用法：node .github/scripts/release-notes.mjs 1.0.0 > release-notes.md
 */
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const version = process.argv[2] || JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version

/** 从 CHANGELOG 中取出目标版本的正文（不含标题行）。 */
async function changelogSection(targetVersion) {
  const file = join(root, 'CHANGELOG.md')
  if (!existsSync(file)) return null
  const content = await readFile(file, 'utf8')
  const escaped = targetVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headerPattern = new RegExp(`^##\\s*\\[?v?${escaped}\\]?.*$`, 'm')
  const match = headerPattern.exec(content)
  if (!match) return null
  const rest = content.slice(match.index + match[0].length)
  const nextHeader = /^##\s/m.exec(rest)
  return (nextHeader ? rest.slice(0, nextHeader.index) : rest).trim()
}

/** 自上个 tag 以来的提交；没有 tag 时取最近若干条。 */
function recentCommits() {
  try {
    const range = execFileSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD^'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return execFileSync('git', ['log', `${range}..HEAD`, '--pretty=format:- %s'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    try {
      return execFileSync('git', ['log', '-10', '--pretty=format:- %s'], { cwd: root, encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const changelog = await changelogSection(version)

const lines = [
  `## dsh-promt-refine v${version}`,
  '',
  pkg.description,
  '',
]

if (changelog) {
  lines.push('### 更新内容', '', changelog, '')
} else {
  const commits = recentCommits()
  lines.push('### 提交记录', '', commits || '- 无', '')
}

lines.push(
  '### 安装',
  '',
  '```text',
  `plugin_manager install_bundle target=dsh-promt-refine@${version}`,
  '```',
  '',
  '或下载本页附带的 `.tgz` 与 `.sha256`，校验后从本地安装：',
  '',
  '```text',
  `plugin_manager install_bundle target=<下载目录>/dsh-promt-refine-${version}.tgz`,
  '```',
  '',
  '### 校验',
  '',
  '```bash',
  `sha256sum -c dsh-promt-refine-${version}.tgz.sha256`,
  '```',
)

process.stdout.write(`${lines.join('\n')}\n`)
