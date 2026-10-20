/**
 * 把内部标识从 dsh-promt-refine 更正为 dsh-prompt-refine。
 *
 * 只改「包名/插件标识」这类由安装机制读取的字符串：
 *   - package.json name
 *   - cordis.patch.yml 的 id / name
 *   - client.js 的模块 id、locale 命名空间、请求头、路由前缀
 *   - index.js 的路由前缀、settings 目录、请求头、health 字段、日志标签
 *   - README / CHANGELOG 的安装命令与标题
 *
 * 不改 GitHub 仓库地址：仓库名仍是 KukaNo996/dsh-promt-refine，改了就指向不存在的仓库。
 *
 * 用法：node .verify/rename-package.mjs [--dry-run]
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')

const OLD = 'dsh-promt-refine'
const NEW = 'dsh-prompt-refine'

/**
 * GitHub 仓库地址保持原样：仓库把包名拼错了，但仓库名没有改。
 * 这些片段在任何替换前先替换成占位符，处理完再还原。
 */
const GITHUB_PATTERNS = [
  'https://github.com/KukaNo996/dsh-promt-refine',
  'git+https://github.com/KukaNo996/dsh-promt-refine.git',
  'https://github.com/KukaNo996/dsh-promt-refine/issues',
  'https://github.com/KukaNo996/dsh-promt-refine#readme',
  'https://github.com/KukaNo996/dsh-promt-refine.git',
  'github.com/KukaNo996/dsh-promt-refine',
]
const SENTINEL = '\u0000GH_REPO\u0000'

function protectGitHub(text) {
  let out = text
  // 长片段优先，避免短片段先命中导致长片段被拆碎
  const sorted = [...GITHUB_PATTERNS].sort((a, b) => b.length - a.length)
  for (const pattern of sorted) {
    out = out.split(pattern).join(SENTINEL)
  }
  return out
}

function restoreGitHub(text) {
  return text.split(SENTINEL).join(`https://github.com/KukaNo996/${OLD}`)
}

async function collectFiles(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '__pycache__') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(full, out)
      continue
    }
    if (!entry.isFile()) continue
    const ext = extname(entry.name).toLowerCase()
    // 只处理文本文件；截图与压缩包跳过
    if (!['.js', '.mjs', '.json', '.yml', '.yaml', '.md', '.py', '.svg'].includes(ext)) continue
    out.push(full)
  }
  return out
}

const files = await collectFiles(root)
let changed = 0

// 跳过本脚本自身：它的 OLD 常量必须保留旧名才能重复运行。
const selfPath = fileURLToPath(import.meta.url)

for (const file of files) {
  if (file === selfPath) continue
  const original = await readFile(file, 'utf8')
  if (!original.includes(OLD)) continue

  const protectedText = protectGitHub(original)
  if (!protectedText.includes(OLD)) {
    continue // 只含 GitHub 地址，无需改动
  }
  const updated = restoreGitHub(protectedText.split(OLD).join(NEW))
  if (updated === original) continue

  changed += 1
  const relative = file.slice(root.length + 1)
  console.log(`~ ${relative}`)
  if (!dryRun) await writeFile(file, updated, 'utf8')
}

console.log(`\n${dryRun ? '(dry run) would update' : 'updated'} ${changed} file(s)`)
console.log(`GitHub repository URLs kept as-is (repo name unchanged): ${OLD}`)
