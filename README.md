# dsh-prompt-optimization · 提示词优化

中文 | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![DSH](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1%2B-purple)

把输入框里那句“帮我把周报弄一下”，变成一份任务明确、主旨清晰、无歧义、计划合理、目标准确的专业提示词——点一下就完成，不满意一键撤回。

这是一个 **DeepSeek Harness（DSH）Web 插件**：「优化提示词」按钮位于输入框工具栏、紧挨模型选择器；改写结果直接回填草稿，草稿不被覆盖（改写前后可随时撤回）。插件的设置页可配置模型来源、API Key 与多候选评估，支持本地或在线 OpenAI 兼容接口。

---

## 为什么需要它

自然语言需求往往含糊：缺背景、缺范围、缺验收标准，模型只能猜。这个插件把“猜”前置成一次显式改写：

- **改写目标**：任务明确 / 主旨清晰 / 无歧义 / 条理清晰 / 计划合理 / 目标准确
- **改写原则**：忠实原意（不新增需求、不编造事实），信息不足时给标注假设或最多 3 条关键待确认问题，绝不把“反问用户”当成输出
- **深度自适应**：短需求给短提示词，复杂需求才展开「目标 / 背景 / 任务 / 约束 / 步骤 / 输出格式 / 验收标准」结构

---

## 功能

| 功能 | 说明 |
| --- | --- |
| **一键优化** | 工具栏按钮点击后调用模型改写当前草稿并回填 |
| **一键撤回** | 改写后按钮变为「撤回」，点击恢复原文，再点又可优化 |
| **多候选评估** | 可开启：并行生成 2–5 份结果，再由评审模型选出最优；会明确提示 token 成本 |
| **模型来源可配置** | `跟随输入框`（默认）/ `跟随主程序` / `自定义模型`（任意 OpenAI 兼容端点） |
| **本地模型支持** | 由主机侧直接请求端点，不受浏览器 CORS 限制，Ollama / LM Studio / vLLM 均可 |
| **显示提示文字** | 默认只显示图标；开启后同时显示「优化提示词」和「撤回」文字 |
| **空输入引导** | 未填写内容时点击优化，提示语会逐字写入输入框，停留 2 秒后逐字删除；开始输入即自动停止 |
| **流式输出** | 模型边生成边写入输入框，无需等待整段完成；多候选时只输出评审选中的那一份 |
| **根据上下文优化（Beta）** | 可开启：先压缩当前会话上下文再据此改写，使结果更贴合你的表达习惯；默认关闭 |
| **引用保护** | 草稿含文件/会话引用芯片时自动禁用，避免改写丢失引用 |
| **失败安全** | 草稿在请求期间被修改则不覆盖本次结果；请求可随页面关闭/切会话立即中止 |
| **可中断优化** | 优化过程中点击转圈即可中断，草稿恢复为原文 |
| **最大等待时长** | 可设置单次优化的最长等待时间，默认 15 秒、最低 10 秒，超时自动中止 |
| **检查更新** | 设置页可检查是否有新版本，**更新源可自定义**（npm registry / GitHub Releases / 任意镜像），只读版本号、不下载安装 |

插件界面与词典提供**简体中文、繁体中文、日语和英语**。

---

## 安装

### 方式一：插件管理器（推荐）

在 DSH 中打开「设置 → 插件」安装，或使用包坐标：

```text
plugin_manager install_bundle target=dsh-prompt-optimization
```

国内网络可指定镜像源：

```text
plugin_manager install_bundle target=dsh-prompt-optimization registry=https://registry.npmmirror.com
```

需要固定版本时写完整版本号，例如 `target=dsh-prompt-optimization@1.1.0`。

### 方式二：源码安装

```bash
git clone https://github.com/KukaNo996/dsh-prompt-optimization
```

```text
plugin_manager install_bundle target=<克隆目录的绝对路径>
```

安装后：插件行出现在「设置 → 插件」，设置页出现在「设置 → 提示词优化」。

---

## 快速开始

1. 在输入框写下需求，例如 `帮我把周报弄一下`
2. 点击工具栏「优化提示词」
3. 查看改写结果，满意直接发送；不满意点「撤回」
4. 首次使用若提示模型不可用，前往「设置 → 提示词优化」选择模型来源

---

## 设置项

| 设置 | 作用 | 默认 |
| --- | --- | --- |
| 模型来源 | `跟随输入框` / `跟随主程序` / `自定义模型` | 跟随输入框 |
| API 地址 | 自定义模式的 OpenAI 兼容端点，如 `http://127.0.0.1:11434/v1` | — |
| 模型名称 | 自定义模式必填；跟随模式留空表示自动 | — |
| Provider（可选） | 跟随模式下覆盖自动选择的 provider | 自动 |
| API Key | 自定义端点密钥；本地模型可留空 | — |
| 温度 | 0–2，越低越稳定 | 0.3 |
| 最大输出 token | 0 表示交给模型默认值 | 0 |
| 优化指令 | 自定义 system prompt，留空用内置指令 | 内置 |
| 多候选评估 | 开关 + 候选份数（2–5） | 关闭 / 1 份 |
| 显示提示文字 | 开启后按钮显示「优化提示词」和「撤回」文字，关闭时只显示图标 | 关闭（仅图标） |
| 更新源 | 检查更新时使用的地址；留空按内置顺序尝试 | 自动 |
| 根据上下文优化（Beta） | 开启后先压缩会话上下文再据此改写提示词 | 关闭 |
| 最大等待时长 | 单次优化的最长等待时间，覆盖上下文压缩、多候选生成与评审 | 15 秒 |

可随时用「测试连接」验证当前配置；配置未保存到可调用状态时，保存仍会成功，但优化会返回可读的错误提示。

### 中断与等待时长

优化过程中**点击转圈即可中断**，草稿会恢复为原文。
中断会同时结束客户端请求与主机侧的模型调用，不会让模型在后台继续生成。

「最大等待时长」限制单次优化的总耗时，**默认 15 秒，最低 10 秒**。
该时长覆盖整个流程——上下文压缩、多候选生成与评审都在其中，
而不是只算最后一次模型调用。超时后插件会自动中止并明确提示。

### 流式输出

模型开始生成后，改写结果会**实时写入输入框**，不必等整段生成完。

- **单候选**：模型一产出就能看到文字，等待时间被用来阅读而非空等。
- **多候选**：先完成生成与评审，**只把被选中的那一份**流式写入输入框。
  未经选中的候选绝不会出现在输入框里——你看到的必然是最终结果。
- 生成过程中你若自行编辑，流式写入立即停止，不会覆盖你的输入。
- 请求失败时自动恢复原文，不留下半截提示词。

### 根据上下文优化提示词（Beta）

设置页的「根据上下文优化（Beta）」**默认关闭**。开启后：

1. 读取当前会话中**你真正输入过**的消息（宿主注入的运行时上下文等不参与）；
2. 交给模型压缩成一份简短偏好简报——表达习惯、常用措辞、关注的主题、已排除的做法；
3. 用这份简报作为参考改写提示词。

**只有压缩后的简报会进入改写请求，原始对话不会直接发给模型。**
压缩本身会多调用一次模型，因此 token 消耗相应增加；压缩失败时会退回普通改写，
不会让整个操作失败。

> 该功能仍处 Beta：它会改变改写结果，介意可随时关闭。

### 检查更新

设置页底部有「检查更新」区块，点击后查询是否有新版本。**它只读取版本号，不下载、不安装，也不会写入设置文件。**

更新源支持三种写法，填在「更新源」输入框即可：

| 写法 | 示例 |
| --- | --- |
| 内置别名 | `npm`、`npmmirror`、`github` |
| npm registry 包地址 | `https://registry.npmmirror.com/dsh-prompt-optimization` |
| GitHub Releases API 地址 | `https://api.github.com/repos/KukaNo996/dsh-prompt-optimization/releases/latest` |

留空时依次尝试 **npm registry → npmmirror → GitHub Releases**，任一成功即返回。

- 自定义源按**响应内容**识别格式（`dist-tags.latest` 或 `tag_name`），因此镜像站、代理都可用，不依赖域名。
- 单个源超时 10 秒，失败自动回退到下一个；全部失败会逐条列出原因。
- 版本比较遵循语义化版本优先级，正确处理预发布版本。

### 三种模型来源

| 模式 | 使用的模型 | 取不到时 |
| --- | --- | --- |
| **跟随输入框**（默认） | 输入框右下角当前选择的模型 | **报错**，不切换到其它模型 |
| 跟随主程序 | 见下方解析顺序 | 逐级回退 |
| 自定义模型 | 你填写的 OpenAI 兼容端点 | 报错提示缺少地址或模型名 |

「跟随输入框」**绝不回退**：选它就是为了固定用手上那个模型，
悄悄换成别的模型会违背这个意图。因此当会话还没有可识别的选择时，
插件会明确提示，而不是替你决定。

### 模型解析顺序（跟随主程序）

1. 设置页显式填写的 provider + model
2. 当前会话最近一次请求使用的模型（即模型选择器所选）
3. 主程序默认模型（设置 → 模型）
4. 兜底 `deepseek-account` / `deepseek-flash`

---

## 环境要求

- **DeepSeek Harness 0.2.1 及以上**（依赖 `conversation.input.right`、`settings.section` 插槽与 `inputActions.setDraft`）
- 「跟随主程序」模式需已登录 DeepSeek 账户或已配置可用模型；否则请改用「自定义模型」

---

## 隐私与安全

- **API Key 存储**：优先放入宿主凭据服务（`keyStorage: credential`），`settings.json` 只记录“是否已配置”；没有凭据服务时降级写入 `$DSH_HOME/dsh-prompt-optimization/settings.json`（POSIX 下 `0600`）。旧版本明文会自动迁移并清除。
- **浏览器侧**：永远只能拿到掩码（如 `sk-••••1234`），任何接口都不返回明文。
- **接口防护**：除 `/status` 外所有路由要求进程级随机票据（页面从 `/status` 获取）并校验 Origin；模型路由按来源限流 10 次/分钟。
- **数据去向**：被优化的草稿文本会**发送给你配置的模型端点**（跟随模式即主程序所用 provider）。请勿在需要保密的草稿上使用不可信的第三方端点。
- **请求中止**：页面关闭、切换会话或再次点击时立即中止在途请求，主机侧返回 499 并停止计费。

---

## 实现说明

### 主机侧（`index.js`）

注册同源前缀路由 `/dsh-prompt-optimization/*`：

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `/status` | GET | 插件健康状态 + 下发请求票据 |
| `/settings` | GET / POST | 读取 / 保存设置（密钥只写不读） |
| `/optimize` | POST | 执行改写（含多候选评估） |
| `/optimize/stream` | POST | 同上，但以 NDJSON 逐段返回改写结果 |
| `/test` | POST | 测试连接 |
| `/update-check` | GET / POST | 检查更新（不占模型调用额度） |

- 跟随模式走 DSH `llm` 服务（自带账户鉴权与重试）；自定义模式由主机侧请求 OpenAI 兼容 `/chat/completions`
- 评估：`candidates > 1` 时并行生成 N 份，再发一次只返回编号的评审请求；评审失败或无有效编号时退回确定性评分（结构 + 数字/标识符保留率 + 长度比）
- 取消：`req.on('close')` 触发 AbortSignal，透传给 `llm.stream` / `fetch`
- 检查更新：对更新源发起 HTTPS GET（10 秒超时、2 MB 上限），按响应内容识别 npm packument 或 GitHub release，用语义化版本规则比较；只读，不写设置文件
- 流式：`/optimize/stream` 以 NDJSON 返回 `delta` 与 `done` 事件。账户模式复用 `llm.stream` 的增量输出；自定义模式请求 `stream: true` 并增量解析 SSE。多候选时先完成评审，只流式输出选中项
- 上下文：开启 Beta 后先读取会话中用户真正输入的消息，交给模型压缩成偏好简报，再把简报注入改写请求；原始对话不直接发给模型

### 客户端侧（`client.js`）

以 `window.__ModuleLoader__.load` 注册两个 slot：

- `conversation.input.right`：工具栏优化 / 撤回按钮与错误气泡
- `settings.section`：设置页面

草稿读写使用宿主注入的 `inputActions` / `useInput`，不改 DOM；`occurrences` 非空时禁用优化。样式只用 `--dsw-alias-*` 主题 token。

### 打包内容

只包含 `index.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`；测试脚本与文档留在仓库、不进包。

---

## 开发

```bash
node --check index.js
node --check client.js
node .verify/host-test.mjs            # 主机侧：路由、票据/限流、密钥存储、取消、多候选评估（46 项）
node .verify/client-test.mjs          # 客户端侧：模块工厂与插槽注册（14 项）
node .verify/hint-animation-test.mjs  # 空输入提示动画：打字/停留/逐字删除与打断（31 项）
node .verify/icon-test.mjs            # 图标结构约定（16 项）
node .verify/locale-test.mjs          # 多语言解析与键一致性（36 项）
node .verify/translate-sim.mjs        # 各语言实际输出（14 项）
node .verify/rename-migration-test.mjs # 改名迁移：设置与 API Key 无损（9 项）
node .verify/update-test.mjs          # 检查更新：源解析、版本比较、超时与鉴权（37 项）
node .verify/composer-mode-test.mjs   # 跟随输入框模式（19 项）
node .verify/stream-context-test.mjs  # 流式输出与上下文优化（28 项）
node .verify/stream-throttle-test.mjs # 流式写入节流，避免界面卡死（14 项）
node .verify/disconnect-test.mjs      # 客户端断开必须被主机侧感知（5 项）
node .verify/wait-budget-test.mjs     # 等待时长与中断（35 项）
python3 .verify/icon-weight.py        # 真实 16px 渲染下的图标视觉平衡
```

或者一次跑完（与 CI 一致）：

```bash
npm run verify
```

### 提交代码

本目录已是完整 Git 仓库，`origin` 指向 <https://github.com/KukaNo996/dsh-prompt-optimization>，默认分支 `main`。

```bash
git status
git add -A -- . ':!.workbuddy'
git commit -m "fix: 说明改了什么"
git push origin main
```

- **本机代理**：仓库级 `http.proxy = http://127.0.0.1:7897`。端口不同时：

  ```bash
  git config --local http.proxy http://127.0.0.1:<端口>
  git config --local https.proxy http://127.0.0.1:<端口>
  ```

  可直连后：`git config --local --unset http.proxy` 与 `--unset https.proxy`。
- **凭据**：Git Credential Manager 已保存 GitHub 账号；失效时按 `git push` 提示登录。
- **身份与换行**：仓库级 `user.name=KukaNo996`、`user.email=1274666494@qq.com`、`core.autocrlf=false`。
- `.workbuddy/`、`*.tgz`、`node_modules/` 已在 `.gitignore` 忽略。

---

## 常见问题

**Q：按钮点了没反应/报“模型不可用”？**
A：账户未登录或未配置模型。到「设置 → 提示词优化」改用「自定义模型」，填写 API 地址与模型名后点「测试连接」。

**Q：优化后按钮为什么是灰的？**
A：草稿中存在文件/会话引用芯片，纯文本改写会丢失引用，因此禁用；移除引用后可继续优化。

**Q：多候选评估值得开吗？**
A：值得在“结果要交付给别人”的场景开启；N 份候选成本约为单次的 `N + 1` 倍 token，耗时也更长。

**Q：改写结果被扩写得过多？**
A：默认指令已要求“篇幅与原文信息量匹配”。仍不满意可在设置页自定义「优化指令」，明确字数上限或删减段落。

---

## 已知限制

- 优化与撤回以**纯文本**重写草稿；含引用芯片时按钮禁用（撤回也只恢复文本）
- 「输入框当前选择的模型」取自会话最近一次请求的 `request/header`；刚切换模型且未发送时会使用默认模型
- 自定义接口目前仅支持 OpenAI 兼容 `/chat/completions`
- 多候选评估成本约为单次 `N + 1` 倍 token，适合重质量、不重速度的场景
- 仅在 Web GUI 验证；未在 Electron 独立窗口中验证

---

## 许可证

[MIT](LICENSE) © 2026 KukaNo996
