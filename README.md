# dsh-promt-refine · 提示词优化

> DeepSeek Harness 提示词优化插件：将自然语言的用户提示词转换为模型易懂、条理清晰的专业提示词。

一个 DeepSeek Harness（DSH）Web 插件：在输入框工具栏中加入「优化提示词」按钮（位于权限/计划控件与模型选择器之间、紧挨模型选择器），把口语化的自然语言需求改写成任务明确、主旨清晰、无歧义、条理清晰、计划合理、目标准确的专业提示词；一键「撤回」即可恢复原始输入。插件在「设置」中注册独立页面，可自定义优化所用的模型与 API Key，支持本地或在线 OpenAI 兼容接口。

插件界面与词典均提供中文和英文。

## 功能

- **输入框工具栏按钮**：注册在 `conversation.input.right`，即输入框工具行内、模型选择器左侧；空闲时显示「优化提示词」，点击后调用模型改写当前草稿。
- **一键撤回**：改写成功后按钮变为「撤回」，点击后恢复优化前的原始草稿，按钮恢复为「优化提示词」。
- **可反复优化**：撤回后可再次优化；也可以先手动修改再优化。
- **多候选评估**：设置页可开启「多候选评估」，先并行生成 2–5 份改写结果，再由评审模型选出最好的一份；会显著增加耗时与 token 消耗，界面会明确提示。
- **按钮文字开关**：设置页可关闭「显示『优化提示词』文字」，关闭后工具栏按钮只显示图标（撤回时仍显示「撤回」）。
- **含引用时保护**：草稿里插入文件/会话引用芯片时按钮自动禁用，避免改写导致引用丢失。
- **设置页**：设置 → 提示词优化，可配置：
  - 模型来源：`跟随主程序`（默认，使用登录账户的 DeepSeek 模型或输入框当前选择的模型）或 `自定义模型`。
  - 自定义模式：API 地址（OpenAI 兼容，如 `https://api.deepseek.com/v1`、`http://127.0.0.1:11434/v1`）、模型名、API Key、温度、最大输出 token。
  - 跟随模式：可选填 provider / model 覆盖「自动选择」，留空即自动。
  - 自定义优化指令（system prompt）与「测试连接」。
  - 多候选评估开关与候选份数。
- **API Key 安全**：优先存放在宿主凭据服务（`keyStorage: credential`），`settings.json` 只记录是否已配置；没有凭据服务时降级为写入 `$DSH_HOME/dsh-promt-refine/settings.json`（POSIX 下 0600）。浏览器端始终只能看到掩码。
- **请求防护**：所有接口需要页面从 `/status` 取得的请求票据，并校验 Origin；模型调用按来源限流（10 次/分钟）。请求可随页面关闭或切换会话立即中止。

## 安装

### 从插件管理器安装（推荐）

在 DSH 中打开「设置 → 插件 → 市场 / Discover」，搜索 `dsh-promt-refine` 并安装；或在插件管理器中填入包坐标：

```text
plugin_manager install_bundle target=dsh-promt-refine@1.0.0
```

需要国内网络加速时可指定镜像源：

```text
plugin_manager install_bundle target=dsh-promt-refine@1.0.0 registry=https://registry.npmmirror.com
```

安装后插件行 `dsh-promt-refine` 会出现在「设置 → 插件」，设置页出现在「设置 → 提示词优化」。首次使用请在设置页确认模型来源（默认「跟随主程序」）。

### 从源码安装

```bash
git clone https://github.com/KukaNo996/dsh-promt-refine.git
```

```text
plugin_manager install_bundle target=<克隆目录的绝对路径>
```

## 环境要求

- DeepSeek Harness 0.2.1 及以上（插件使用 `conversation.input.right`、`settings.section` 插槽与 `inputActions.setDraft`）。
- 「跟随主程序」模式需要已登录 DeepSeek 账户，或已在「设置 → 模型」配置可用模型；否则请改用「自定义模型」。

## 模型解析顺序（跟随模式）

1. 设置页显式填写的 provider + model；
2. 当前会话最近一次请求使用的模型（即输入框模型选择器所选模型）；
3. 主程序默认模型（设置 → 模型）；
4. 兜底 `deepseek-account` / `deepseek-flash`。

若账户未登录且未配置自定义模型，优化会返回可读的错误提示，页面不会丢失草稿。

## 实现说明

- **Host 半**（`index.js`）：注册同源前缀路由 `/dsh-promt-refine/*`，负责设置读写、连接测试与模型调用。跟随模式走 DSH 的 `llm` 服务（自带账户鉴权与重试）；自定义模式由 Host 直接请求 OpenAI 兼容的 `/chat/completions`，因此不受浏览器 CORS 限制，本地模型也能用。
  - 鉴权：除 `/status` 外所有路由都要求 `x-dsh-promt-refine-ticket`（进程启动随机生成，页面从 `/status` 获取），并校验 Origin；模型路由按 `来源 IP + UA` 限流 10 次/分钟。
  - 密钥：优先 `ctx.credentials`；`settings.json` 只保存非密字段，旧版本明文自动迁移并清除。
  - 评估：`candidates > 1` 时并行生成 N 份草稿，再发一次评审请求（只返回编号）；评审失败或无有效编号时退回确定性评分（结构 + 数字/标识符保留率 + 长度比）。
  - 取消：`req.on('close')` 触发 AbortSignal 透传给 `llm.stream` / `fetch`，返回 499。
- **Client 半**（`client.js`）：以 `window.__ModuleLoader__.load` 形式注册两个 slot：
  - `conversation.input.right`：输入框工具行内、模型选择器左侧的优化 / 撤回按钮（含错误气泡）；
  - `settings.section`：设置页面（显示开关、多候选评估、模型与密钥配置）。
  草稿读写使用宿主注入的标准属性 `inputActions` / `useInput`，不改 DOM；`occurrences` 非空时禁用优化。
- 样式只使用 `--dsw-alias-*` 主题 token；文案通过 Client locale 服务注册中英文字典。
- 打包只包含 `index.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`；测试脚本与本文档留在仓库、不进包。

## 开发

```bash
node .verify/host-test.mjs    # Host 半：路由、票据/限流、密钥存储、取消、多候选评估
node .verify/client-test.mjs  # Client 半：模块工厂与两个插槽注册
```

### 提交代码

本目录已是完整的 Git 仓库，`origin` 指向 <https://github.com/KukaNo996/dsh-promt-refine>，默认分支 `main`。

```bash
git status              # 查看改动
git add -A -- . ':!.workbuddy'   # 或按文件单独 add
git commit -m "fix: 说明改了什么"
git push origin main
```

- **Windows 已配置本地代理**：仓库级 `http.proxy = http://127.0.0.1:7897`（Clash 等本地代理端口）。若你的代理端口不同，执行：

  ```bash
  git config --local http.proxy http://127.0.0.1:<你的端口>
  git config --local https.proxy http://127.0.0.1:<你的端口>
  ```

  网络恢复直连后可用 `git config --local --unset http.proxy` 与 `--unset https.proxy` 去掉。
- **凭据**：Git Credential Manager 已保存 GitHub 账号，推送时通常无需再次输入；若失效执行 `git push` 按提示登录即可。
- **提交身份**：已在本仓库配置 `user.name=KukaNo996`、`user.email=1274666494@qq.com`。
- **换行**：`core.autocrlf=false`，避免 Windows 下把整仓文件改成 CRLF 产生无意义 diff。
- `.workbuddy/`、`*.tgz`、`node_modules/` 已在 `.gitignore` 中忽略，不会被误提交。

## 已知限制

- 优化与撤回以**纯文本**重写草稿；含文件/会话引用芯片时优化按钮会禁用（撤回也只恢复文本）。
- 「输入框当前选择的模型」取自该会话最近一次请求的 `request/header`；如果刚切换模型还没发送过消息，会使用主程序默认模型。
- 自定义接口目前仅支持 OpenAI 兼容的 `/chat/completions`（本地 Ollama、LM Studio、vLLM、DeepSeek、OpenAI 等均可）。
- 多候选评估的成本约为单次的 `N + 1` 倍 token，适合对质量要求高、不追求速度的场景。
- 本插件仅在 Web GUI 中提供界面；未在 Electron 独立窗口中验证。

## 许可证

[MIT](LICENSE)
