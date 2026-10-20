/**
 * 为四个语言文件补充「跟随输入框」模式的词条。
 * 用法：node .verify/add-composer-copy.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const COPY = {
  'zh-cn': {
    'settings.modeComposer': '跟随输入框',
    'settings.modeComposerHint': '使用输入框右下角当前选择的模型来优化提示词，不会自动改用其他模型。',
    'settings.composerNote': '此模式下由输入框右下角的选择决定模型，无需填写模型名称。',
  },
  'zh-tw': {
    'settings.modeComposer': '跟隨輸入框',
    'settings.modeComposerHint': '使用輸入框右下角目前選擇的模型來優化提示詞，不會自動改用其他模型。',
    'settings.composerNote': '此模式下由輸入框右下角的選擇決定模型，無需填寫模型名稱。',
  },
  ja: {
    'settings.modeComposer': '入力枠に従う',
    'settings.modeComposerHint': '入力枠の右下角で現在選択されているモデルでプロンプトを最適化します。他のモデルに自動的に切り替わりません。',
    'settings.composerNote': 'このモードでは入力枠の右下角の選択でモデルが決まります。モデル名を入力する必要はありません。',
  },
  en: {
    'settings.modeComposer': 'Follow composer',
    'settings.modeComposerHint': 'Optimize with the model currently picked in the composer; it never silently switches to another one.',
    'settings.composerNote': 'In this mode the model comes from the composer selection, so there is no model name to fill in.',
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
