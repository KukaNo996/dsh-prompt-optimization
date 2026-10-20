/**
 * 扫描仓库中的密钥泄漏：API Key、npm token、GitHub token、私钥等。
 * 用法：node .github/scripts/scan-secrets.mjs
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP_DIRS = new Set(['.git', 'node_modules', '.workbuddy', 'dist', 'build', 'out'])
const SKIP_EXT = new Set(['.tgz', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.zip', '.pdf'])
const MAX_BYTES = 2 * 1024 * 1024

/** 高置信度密钥模式；宁可少报，也不要误报打断 CI。 */
const PATTERNS = [
  { name: 'npm token', regex: /npm_[A-Za-z0-9]{36,}/g },
  { name: 'GitHub token', regex: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: 'OpenAI-style key', regex: /sk-[A-Za-z0-9]{32,}/g },
  { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'generic bearer literal', regex: /(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/gi },
]

/** 允许出现的已知占位/示例值。 */
const ALLOWLIST = [
  'sk-test-1234567890',
  'sk-keep-me-0000',
  'sk-live-test-9999',
  'freellmapi-',
  'npm_xxx',
  'npm_your',
  'placeholder',
]

const findings = []

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(join(dir, entry.name))
      continue
    }
    if (!entry.isFile()) continue
    const full = join(dir, entry.name)
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    if (SKIP_EXT.has(ext)) continue
    const stat = await import('node:fs/promises').then((fs) => fs.stat(full))
    if (stat.size > MAX_BYTES) continue
    const text = await readFile(full, 'utf8').catch(() => '')
    if (!text) continue
    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0
      let match
      while ((match = pattern.regex.exec(text)) !== null) {
        const hit = match[0]
        if (ALLOWLIST.some((allowed) => hit.startsWith(allowed))) continue
        const line = text.slice(0, match.index).split('\n').length
        findings.push({ file: relative(root, full), line, kind: pattern.name, sample: `${hit.slice(0, 8)}…` })
      }
    }
  }
}

await walk(root)

if (findings.length) {
  console.error(`${findings.length} potential secret(s) found:`)
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.kind}  ${finding.sample}`)
  }
  process.exit(1)
}
console.log('no secrets detected')
