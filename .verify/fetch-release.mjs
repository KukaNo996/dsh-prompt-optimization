/**
 * 从 GitHub Release 下载指定版本的 tarball 与校验和。
 * 走 api.github.com 的 release asset 接口（本机到 github.com 直连被阻断）。
 *
 * 用法：node .verify/fetch-release.mjs 1.2.1 <输出目录>
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const version = process.argv[2] || '1.2.1'
const outDir = process.argv[3] || '.'

const owner = 'KukaNo996'
const repo = 'dsh-prompt-refine'
const api = `https://api.github.com/repos/${owner}/${repo}/releases/tags/v${version}`

async function main() {
  await mkdir(outDir, { recursive: true })

  const release = await fetchJson(api)
  if (!release || !Array.isArray(release.assets)) {
    throw new Error(`release v${version} not found or has no assets`)
  }

  for (const asset of release.assets) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`
    const response = await fetch(url, {
      headers: { 'user-agent': 'dsh-prompt-refine-fetch', accept: 'application/octet-stream' },
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`${asset.name}: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const target = join(outDir, asset.name)
    await writeFile(target, bytes)

    // GitHub now reports a sha256 digest per asset; verify the tarball against it.
    const digest = asset.digest && asset.digest.startsWith('sha256:') ? asset.digest.slice(7) : null
    const actual = createHash('sha256').update(bytes).digest('hex')
    const verdict = digest ? (digest === actual ? 'digest OK' : `DIGEST MISMATCH (expected ${digest})`) : 'no digest'
    console.log(`${asset.name}  ${bytes.length} bytes  ${verdict}`)
  }

  // Cross-check the published .sha256 file against the tarball as well.
  const sumFile = join(outDir, `dsh-prompt-refine-${version}.tgz.sha256`)
  const tarball = join(outDir, `dsh-prompt-refine-${version}.tgz`)
  try {
    const expected = (await readFile(sumFile, 'utf8')).trim().split(/\s+/)[0]
    const bytes = await readFile(tarball)
    const actual = createHash('sha256').update(bytes).digest('hex')
    console.log(expected === actual ? 'sha256 file matches tarball' : `SHA256 FILE MISMATCH: ${expected} vs ${actual}`)
    if (expected !== actual) process.exitCode = 1
  } catch (error) {
    console.log(`sha256 cross-check skipped: ${error.message}`)
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'dsh-prompt-refine-fetch' } })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

main().catch((error) => {
  console.error('FAIL:', error.message)
  process.exitCode = 1
})
