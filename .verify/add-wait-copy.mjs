/**
 * 为四个语言文件补充「最大等待时长」与「点击中断」的词条。
 * 用法：node .verify/add-wait-copy.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const COPY = {
  'zh-cn': {
    'settings.maxWait': '最大等待时长',
    'settings.maxWaitUnit': '秒',
    'settings.maxWaitHint': '优化过程超过该时长会自动中止。默认 15 秒，最低 10 秒。',
    'tool.cancel': '中断优化',
    'tool.cancelHint': '点击中断优化',
    'tool.cancelled': '已中断优化，草稿已恢复。',
  },
  'zh-tw': {
    'settings.maxWait': '最大等待時長',
    'settings.maxWaitUnit': '秒',
    'settings.maxWaitHint': '最佳化過程超過該時長會自動中止。預設 15 秒，最低 10 秒。',
    'tool.cancel': '中止最佳化',
    'tool.cancelHint': '點擊中止最佳化',
    'tool.cancelled': '已中止最佳化，草稿已恢復。',
  },
  ja: {
    'settings.maxWait': '最大待機時間',
    'settings.maxWaitUnit': '秒',
    'settings.maxWaitHint': '最適化がこの時間を超えると自動的に中止します。既定は 15 秒、最低 10 秒。',
    'tool.cancel': '最適化を中止',
    'tool.cancelHint': 'クリックして最適化を中止',
    'tool.cancelled': '最適化を中止しました。下書きは元に戻しました。',
  },
  en: {
    'settings.maxWait': 'Maximum wait',
    'settings.maxWaitUnit': 'seconds',
    'settings.maxWaitHint': 'The optimization is stopped automatically after this long. 15 seconds by default, 10 seconds at minimum.',
    'tool.cancel': 'Cancel optimization',
    'tool.cancelHint': 'Click to cancel the optimization',
    'tool.cancelled': 'Optimization cancelled; the draft was restored.',
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
