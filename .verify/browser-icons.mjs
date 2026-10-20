/**
 * 用真实浏览器（headless Edge/Chrome）渲染工具栏图标并截图，
 * 作为自制光栅器之外的独立校验。
 *
 * 用法：node .verify/browser-icons.mjs [输出目录]
 * 需要本机存在 msedge 或 chrome。
 */
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = process.argv[2] || here

const CLIENT = readFileSync(join(root, 'client.js'), 'utf8')

/** 从 client.js 抽出两个图标的 svg 标记（与插件里渲染的一致）。 */
function svgOf(name) {
  const start = CLIENT.indexOf(`function ${name}(`)
  const end = CLIENT.indexOf('\n    }', start)
  const body = CLIENT.slice(start, end)
  const paths = [...body.matchAll(/d: '([^']+)'/g)].map((m) => m[1])
  const vb = /viewBox: '([^']+)'/.exec(body)?.[1] || '0 0 16 16'
  const par = /preserveAspectRatio: '([^']+)'/.exec(body)?.[1] || 'xMidYMid meet'
  const attrs = paths
    .map((d) => `<path d="${d}" fill="currentColor"></path>`)
    .join('')
  return `<svg viewBox="${vb}" preserveAspectRatio="${par}" width="120" height="120" xmlns="http://www.w3.org/2000/svg">${attrs}</svg>`
}

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  body { margin:0; font-family: system-ui, sans-serif; background:#ffffff; }
  .row { display:flex; gap:48px; padding:28px 32px; align-items:center; }
  .cell { display:flex; flex-direction:column; align-items:center; gap:10px; }
  .label { font-size:13px; color:#555; }
  .demo { display:inline-flex; align-items:center; gap:4px; height:28px; padding:0 8px;
          border-radius:8px; color:#3c4250; font-size:13px; line-height:1; }
  .demo.on { background:#eef0f4; }
</style>
<div class="row">
  <div class="cell">
    ${svgOf('IconSparkle')}
    <div class="label">sparkle</div>
    <div class="demo on">${svgOf('IconSparkle').replace('width="120" height="120"', 'width="16" height="16"')}<span>优化提示词</span></div>
  </div>
  <div class="cell">
    ${svgOf('IconUndo')}
    <div class="label">undo</div>
    <div class="demo on">${svgOf('IconUndo').replace('width="120" height="120"', 'width="16" height="16"')}<span>撤回</span></div>
  </div>
</div>`

const work = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
const htmlPath = join(work, 'icons.html')
writeFileSync(htmlPath, html, 'utf8')
const shot = join(outDir, 'icons-browser.png')

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]
const browser = candidates.find((p) => existsSync(p))

if (!browser) {
  console.log('SKIP: no local Edge/Chrome found')
  process.exit(2)
}

try {
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      `--screenshot=${shot}`,
      '--window-size=640,320',
      `file:///${htmlPath.replace(/\\/g, '/')}`,
    ],
    { stdio: 'ignore', timeout: 60_000 },
  )
  console.log('saved', shot)
  console.log('请打开该图片目视确认两个图标：')
  console.log('  1) 视觉重量是否接近')
  console.log('  2) 图标与文字是否在同一水平线上')
} finally {
  rmSync(work, { recursive: true, force: true })
}
