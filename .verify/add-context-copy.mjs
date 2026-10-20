/**
 * 为四个语言文件补充「根据上下文优化」Beta 开关的词条。
 * 用法：node .verify/add-context-copy.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const COPY = {
  'zh-cn': {
    'settings.contextAware': '根据上下文优化（Beta）',
    'settings.contextAwareHint': '开启后，会先压缩当前会话的上下文，再据此改写提示词，使结果更贴合你的表达习惯与关注点。',
    'settings.contextAwareCost': '注意：会多调用一次模型来压缩上下文，token 消耗相应增加。',
  },
  'zh-tw': {
    'settings.contextAware': '根據上下文最佳化（Beta）',
    'settings.contextAwareHint': '開啟後，會先壓縮目前工作階段的上下文，再據此改寫提示詞，使結果更貼合你的表達習慣與關注點。',
    'settings.contextAwareCost': '注意：會多呼叫一次模型來壓縮上下文，token 消耗相應增加。',
  },
  ja: {
    'settings.contextAware': 'コンテキストに基づいて最適化（Beta）',
    'settings.contextAwareHint': '有効にすると、現在のセッションのコンテキストをまず要約・圧縮し、それに基づいてプロンプトを書き換えます。あなたの表現の癖や関心に近い結果になります。',
    'settings.contextAwareCost': '注意：コンテキストを圧縮するためモデル呼び出しが 1 回増え、token 使用量も増えます。',
  },
  en: {
    'settings.contextAware': 'Optimize with context (Beta)',
    'settings.contextAwareHint': 'When on, the current conversation is compressed first and the prompt is rewritten against it, so the result fits how you actually phrase things and what you care about.',
    'settings.contextAwareCost': 'Note: this adds one model call to compress the context, and the token cost goes up accordingly.',
  },
}

for (const [locale, entries] of Object.entries(COPY)) {
  const file = join(root, 'locale', `${locale}.json`)
  const dict = JSON.parse(await readFile(file, 'utf8'))
  for (const [key, value] of Object.entries(entries)) dict[key] = value
  const sorted = {}
  for (const key of Object.keys(dict).sort()) sorted[key] = dict[key]
  await writeFile(file, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
  console.log(`${locale}: ${Object.keys(sorted).length} keys`)
}
