/**
 * 验证新指令的实际产出效果（不调真实模型，用 mock 校验指令的结构契约）。
 *
 * 这个脚本检查的是「指令本身是否把要求说清楚」——
 * 具体验证：新指令是否仍然覆盖了插件运行时依赖的每一个约束。
 */
import { readFile } from 'node:fs/promises'

const src = await readFile(new URL('../index.js', import.meta.url), 'utf8')

function extractConst(name) {
  const start = src.indexOf(`const ${name} = [`)
  const end = src.indexOf(`].join('\\n')`, start)
  const body = src.slice(start, end)
  // 逐条解析字符串字面量
  const items = []
  const re = /'((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = re.exec(body)) !== null) items.push(m[1].replace(/\\'/g, "'"))
  return items.join('\n')
}

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

const refine = extractConst('DEFAULT_REFINE_INSTRUCTION')
const judge = extractConst('JUDGE_INSTRUCTION')
const context = extractConst('CONTEXT_INSTRUCTION')

console.log('=== 主改写指令 ===')
// 用户要求的核心语义
check('保留「改写对象是整段文本」', refine.includes('整段文本'), refine)
check('保留「清晰、可直接作为你执行依据的提示词」', refine.includes('可直接作为你执行依据'), refine)
check('保留「模糊、零散或自引用」', refine.includes('模糊、零散或自引用'), refine)
check('保留「可复用、可执行」', refine.includes('可复用、可执行'), refine)
check('保留「保留原文核心意图与关键信息」', refine.includes('保留原文核心意图与关键信息'), refine)
check('保留「仅返回改写后的提示词本身」', refine.includes('仅返回改写后的提示词本身'), refine)
check('保留「不添加解释、分析或额外说明」', refine.includes('不添加解释、分析或额外说明'), refine)
check('保留「完整简洁」', refine.includes('完整简洁'), refine)
check('保留「任务目标」', refine.includes('任务目标'), refine)
check('保留「适用场景」', refine.includes('适用场景'), refine)
check('保留「必要约束」', refine.includes('必要约束'), refine)
check('保留「期望输出」', refine.includes('期望输出'), refine)
check('保留「语句收束完整」', refine.includes('语句收束完整'), refine)
check('保留「不以未完列表、悬垂连词或冒号结尾」', refine.includes('不以未完列表、悬垂连词或冒号结尾'), refine)

// 插件运行时依赖
check('声明输入标签语义', refine.includes('<原始需求>'), refine)
check('禁止代码围栏', refine.includes('代码块围栏'), refine)
check('要求同语言输出', refine.includes('相同的主要语言'), refine)
check('声明产出是提示词不是回答', refine.includes('不是回答'), refine)
check('不残留旧版「分析维度」规则', !refine.includes('至少 3 个分析维度'), refine)
check('不残留旧版「档位」规则', !refine.includes('档'), refine)
check('不残留旧版「待确认问题」尾巴', !refine.includes('待确认问题'), refine)
check('不残留旧版示例段落', !refine.includes('【示例】'), refine)

console.log('\n=== 多候选评审指令 ===')
check('保留「评审员」关键词（host-test 依赖）', judge.includes('评审员'), judge)
check('声明候选编号格式', judge.includes('【候选 N】'), judge)
check('给出忠实度维度', judge.includes('忠实度'), judge)
check('给出可执行性维度', judge.includes('可执行性'), judge)
check('给出清晰度维度', judge.includes('清晰度'), judge)
check('给出精简度维度', judge.includes('精简度'), judge)
check('给出形式完整维度', judge.includes('形式完整'), judge)
check('防止位置偏好', judge.includes('位置靠后的候选'), judge)
check('输出仅一个数字', judge.includes('只能是一个数字'), judge)
check('给出平票裁决规则', judge.includes('难分优劣'), judge)

console.log('\n=== 上下文压缩指令 ===')
check('保留空值标记「（无可用上下文）」', context.includes('（无可用上下文）'), context)
check('保留 400 字上限', context.includes('400 字以内'), context)
check('声明逐行格式', context.includes('每条一行'), context)
check('排除助手说的话', context.includes('助手说过的话'), context)
check('排除具体问答内容', context.includes('具体某次问答的内容'), context)
check('保留表达习惯维度', context.includes('表达习惯'), context)
check('保留排除项维度', context.includes('否定过或明确排除'), context)

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
