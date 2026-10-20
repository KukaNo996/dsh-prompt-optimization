/**
 * 工具栏图标的结构性校验。
 *
 * 视觉平衡由 icon-weight.py 在真实 16px 渲染下测量（墨水覆盖率、边界、居中），
 * 这里只守住不容易被破坏的硬性约定：同一 viewBox、同一默认尺寸、实心填充、
 * currentColor 着色，以及标签的基线对齐样式。
 *
 * 用法：node .verify/icon-test.mjs
 */
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'client.js'), 'utf8')

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

/** 取出一个图标函数的完整源码。 */
function extractIcon(name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) return null
  const end = source.indexOf('\n    }', start)
  return source.slice(start, end + '\n    }'.length)
}

const sparkle = extractIcon('IconSparkle')
const undo = extractIcon('IconUndo')
check('IconSparkle exists', Boolean(sparkle))
check('IconUndo exists', Boolean(undo))
if (!sparkle || !undo) process.exit(1)

const viewbox = (src) => /viewBox: '([^']+)'/.exec(src)?.[1]
const size = (src) => /width: size \|\| (\d+)/.exec(src)?.[1]
const viewboxes = [viewbox(sparkle), viewbox(undo)]

check('both use the same viewBox', viewboxes[0] === viewboxes[1] && viewboxes[0], viewboxes)
check('both default to the same size', size(sparkle) === size(undo) && size(sparkle) === '16', {
  sparkle: size(sparkle),
  undo: size(undo),
})

// 两者都应是纯填充图形，避免一个描边一个填充造成的风格割裂
for (const [name, src] of [['sparkle', sparkle], ['undo', undo]]) {
  check(`${name}: uses solid fill`, src.includes("fill: 'currentColor'"), 'no fill')
  check(`${name}: has no stroke`, !src.includes('stroke:'), 'stroke present')
  check(`${name}: no opacity tricks`, !src.includes('opacity'), 'opacity present')
  check(`${name}: decorative only`, src.includes("'aria-hidden': true"), 'missing aria-hidden')
}

// 撤回图标沿用用户提供的原始图形（1024 网格），不应被再加工
check('undo keeps the supplied 1024 artwork', undo.includes('M581.056 288.32'), 'user artwork replaced')

// 标签与图标必须共用一条基线
check('control centres its children', /\.dsh-pr-tool \{[^}]*align-items: center/.test(source))
check('label uses line-height 1', /\.dsh-pr-tool > span \{[^}]*line-height: 1/.test(source))
check('icons are block-level', /\.dsh-pr-tool > svg \{[^}]*display: block/.test(source))

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
