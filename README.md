# dsh-promt-refine · 提示词优化

> DeepSeek Harness 提示词优化插件：将自然语言的用户提示词转换为模型易懂、条理清晰的专业提示词。

一个 DeepSeek Harness（DSH）Web 插件：在输入框工具栏中加入「优化提示词」按钮（位于权限/计划控件与模型选择器之间、紧挨模型选择器），把口语化的自然语言需求改写成任务明确、主旨清晰、无歧义、条理清晰、计划合理、目标准确的专业提示词；一键「撤回」即可恢复原始输入。插件在「设置」中注册独立页面，可自定义优化所用的模型与 API Key，支持本地或在线 OpenAI 兼容接口。

插件界面与词典均提供中文和英文。

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

- **Host 半**（`index.js`）：注册同源前缀路由 `/dsh-promt-refine/*`，负责设置读写、连接测试与模型调用。跟随模式走 DSH 的 `llm` 服务（自带账户鉴权与重试）；自定义模式由 Host 直接请求 OpenAI 兼容的 `/chat/completions`，因此不受浏览器 CORS 限制，本地模型也能用。所有写操作要求插件请求标记并校验 Origin，避免其他站点借本机端口发起跨站请求。
- **Client 半**（`client.js`）：以 `window.__ModuleLoader__.load` 形式注册两个 slot：
  - `conversation.input.right`：输入框工具行内、模型选择器左侧的优化 / 撤回按钮（含错误气泡）；
  - `settings.section`：设置页面（含「显示『优化提示词』文字」开关）。
  草稿读写使用宿主注入的标准属性 `inputActions` / `useInput`，不改 DOM。
- 样式只使用 `--dsw-alias-*` 主题 token；文案通过 Client locale 服务注册中英文字典。
- 打包只包含 `index.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`；测试脚本与本文档留在仓库、不进包。

## 开发

```bash
node .verify/host-test.mjs    # Host 半：路由、设置、自定义/账户模型调用、错误路径
node .verify/client-test.mjs  # Client 半：模块工厂与两个插槽注册
```

## 已知限制

- 优化与撤回以**纯文本**重写草稿（宿主 `inputActions.setDraft` 的契约）：如果草稿里包含文件/会话等引用芯片，优化后这些芯片会变成其文本形式，撤回也只能恢复文本。
- 「输入框当前选择的模型」取自该会话最近一次请求的 `request/header`；如果刚切换模型还没发送过消息，会使用主程序默认模型。
- 自定义接口目前仅支持 OpenAI 兼容的 `/chat/completions`（本地 Ollama、LM Studio、vLLM、DeepSeek、OpenAI 等均可）。
- 本插件仅在 Web GUI 中提供界面；未在 Electron 独立窗口中验证。

## 许可证

[MIT](LICENSE)
