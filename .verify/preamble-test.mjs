/**
 * 验证 cleanModelOutput 能去掉开场白，同时不误伤真正的提示词。
 *
 * 关键：这个函数会把结果直接填进输入框。删多了会把用户要用的指令切掉，
 * 删少了又会把「以下是改写后的提示词」这类开场留给用户。
 */
import { readFile } from 'node:fs/promises'

const src = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const start = src.indexOf('function cleanModelOutput(')
const end = src.indexOf('\n}\n', start) + 3
const mod = await import(
  `data:text/javascript,${encodeURIComponent(src.slice(start, end) + '\nexport { cleanModelOutput }')}`,
)
const { cleanModelOutput } = mod

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

// --- 应该被去掉的开场 ---
const mustStrip = [
  [
    '以下是改写后的提示词：\n把登录按钮改成蓝色，保持现有尺寸不变。',
    '把登录按钮改成蓝色，保持现有尺寸不变。',
  ],
  [
    '根据你的需求，以下是一份优化后的提示词。\n\n请用 Python 实现快速排序。',
    '请用 Python 实现快速排序。',
  ],
  [
    '为你的产品起名，需要先明确产品类型与目标受众。\n\n### 命名任务\n目标是起 5 个名字。',
    '### 命名任务\n目标是起 5 个名字。',
  ],
  [
    "Here's the optimized prompt:\nExplain closures in JavaScript.",
    'Explain closures in JavaScript.',
  ],
  [
    '我将为你改写这个需求。\n\n请实现一个二分查找函数。',
    '请实现一个二分查找函数。',
  ],
  [
    '这是改写后的版本：\n用 Rust 写一个 HTTP 服务。',
    '用 Rust 写一个 HTTP 服务。',
  ],
]

for (const [input, expected] of mustStrip) {
  const got = cleanModelOutput(input)
  check(`开场被去掉：${JSON.stringify(input.slice(0, 24))}…`, got === expected, { got, expected })
}

// --- 不该被误伤的提示词 ---
const mustKeep = [
  ['请把登录页主按钮改为蓝色，保持尺寸不变。', '请把登录页主按钮改为蓝色，保持尺寸不变。'],
  ['为产品起一个简洁易记的名字，附一句寓意。', '为产品起一个简洁易记的名字，附一句寓意。'],
  ['帮我写一个二分查找函数。', '帮我写一个二分查找函数。'],
  ['### 命名任务\n目标是起 5 个名字。', '### 命名任务\n目标是起 5 个名字。'],
  ['请向初学者解释什么是闭包。', '请向初学者解释什么是闭包。'],
]

for (const [input, expected] of mustKeep) {
  const got = cleanModelOutput(input)
  check(`提示词保持完整：${JSON.stringify(input.slice(0, 20))}…`, got === expected, { got, expected })
}

// --- 代码块围栏 ---
check(
  '整体代码块围栏被去掉',
  cleanModelOutput('```markdown\n请把按钮改成蓝色。\n```') === '请把按钮改成蓝色。',
  cleanModelOutput('```markdown\n请把按钮改成蓝色。\n```'),
)

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
