# dsh-promt-refine · 提示词优化

一个 DeepSeek Harness（DSH）Web 插件：在输入框工具栏中加入「优化提示词」按钮（位于权限/计划控件与模型选择器之间、紧挨模型选择器），把口语化的自然语言需求改写成任务明确、主旨清晰、无歧义、条理清晰、计划合理、目标准确的专业提示词；一键「撤回」即可恢复原始输入。插件在「设置」中注册独立页面，可自定义优化所用的模型与 API Key，支持本地或在线 OpenAI 兼容接口。

## 功能

- **输入框工具栏按钮**：注册在 `conversation.input.right`，即输入框工具行内、模型选择器左侧；空闲时显示「优化提示词」，点击后调用模型改写当前草稿。
- **一键撤回**：改写成功后按钮变为「撤回」，点击后恢复优化前的原始草稿，按钮恢复为「优化提示词」。
- **可反复优化**：撤回后可再次优化；也可以先手动修改再优化。
- **按钮文字开关**：设置页可关闭「显示『优化提示词』文字」，关闭后工具栏按钮只显示图标（撤回时仍显示「撤回」）。
- **设置页**：设置 → 提示词优化，可配置：
  - 模型来源：`跟随主程序`（默认，使用登录账户的 DeepSeek 模型或输入框当前选择的模型）或 `自定义模型`。
  - 自定义模式：API 地址（OpenAI 兼容，如 `https://api.deepseek.com/v1`、`http://127.0.0.1:11434/v1`）、模型名、API Key、温度、最大输出 token。
  - 跟随模式：可选填 provider / model 覆盖「自动选择」，留空即自动。
  - 自定义优化指令（system prompt）与「测试连接」。
- **API Key 安全**：只保存在本机 `$DSH_HOME/dsh-promt-refine/settings.json`，浏览器端仅能看到掩码；任何接口都不会把明文密钥返回给页面。

## 安装

在 DSH 中把本目录作为本地 bundle 安装：

```text
plugin_manager install_bundle target=<本目录的绝对路径>
```

安装后插件行 `dsh-promt-refine` 会出现在「设置 → 插件」，设置页出现在「设置 → 提示词优化」。

## 模型解析顺序（跟随模式）

1. 设置页显式填写的 provider + model；
2. 当前会话最近一次请求使用的模型（即输入框模型选择器所选模型）；
3. 主程序默认模型（设置 → 模型）；
4. 兜底 `deepseek-account` / `deepseek-flash`。

若账户未登录且未配置自定义模型，优化会返回可读的错误提示，页面不会丢失草稿。

## 实现说明

- **Host 半**（`index.js`）：注册同源前缀路由 `/dsh-promt-refine/*`，负责设置读写、连接测试与模型调用。跟随模式走 DSH 的 `llm` 服务（自带账户鉴权与重试）；自定义模式由 Host 直接请求 OpenAI 兼容的 `/chat/completions`，因此不受浏览器 CORS 限制，本地模型也能用。
- **Client 半**（`client.js`）：以 `window.__ModuleLoader__.load` 形式注册两个 slot：
  - `conversation.input.right`：输入框工具行内、模型选择器左侧的优化 / 撤回按钮（含错误气泡）；
  - `settings.section`：设置页面（含「显示『优化提示词』文字」开关）。
  草稿读写使用宿主注入的标准属性 `inputActions` / `useInput`，不改 DOM。
- 样式只使用 `--dsw-alias-*` 主题 token；文案通过 Client locale 服务注册中英文字典。

## 已知限制

- 优化与撤回以**纯文本**重写草稿（宿主 `inputActions.setDraft` 的契约）：如果草稿里包含文件/会话等引用芯片，优化后这些芯片会变成其文本形式，撤回也只能恢复文本。
- 「输入框当前选择的模型」取自该会话最近一次请求的 `request/header`；如果刚切换模型还没发送过消息，会使用主程序默认模型。
- 自定义接口目前仅支持 OpenAI 兼容的 `/chat/completions`（本地 Ollama、LM Studio、vLLM、DeepSeek、OpenAI 等均可）。
- 本插件仅在 Web GUI 中提供界面；未在 Electron 独立窗口中验证。
