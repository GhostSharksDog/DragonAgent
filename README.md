# DragonAgent 0.7.0

银白龙娘主题的 Windows 桌面 Agent 工作台。图形界面使用 Electron + React，Agent 执行循环、工具注册、审批、预算、摘要和恢复由仓库内的自研 TypeScript 内核 `packages/agent-core` 完成；本仓库不依赖 DSH SDK 或第三方 Agent 框架。

> **当前状态：0.7.0 候选，不是正式发布。**
> 源码已推送 GitHub `main`（最新 `b80b328`）。真实火山方舟付费生成和真实 Pixiv 登录验收尚未完成，固定启动目录 `release\win-unpacked` 尚未替换。候选安装包、ZIP 与 SHA256 见下方「验证与发行状态」。

## 0.7.0 主要变化

- **一次性计划模式**：手动开启只对下一条消息生效；计划期只读调查，`plan_submit` 提交结构化计划，确认后才执行。没有产出计划时自动回到执行模式；提交计划后可确认执行或点“继续修改”再次进入；提示词明确要求“先制定计划”时只对当前轮启用。
- **聊天内切换模型**：Dragon 与 Codex 之间、不同 Dragon API 连接之间都在当前聊天内切换，不另开聊天；下一条消息携带最近对话摘录。协作模式可在模型菜单顶部直接退出。
- **云端桌宠制作**：火山方舟 Seedream 立绘 + Seedance 动作视频，预算上限、未知结果人工核对、只查询不重提、取消/恢复；本地 FFmpeg 抠像和透明 WebM，原片保留。
- **桌宠库与行为**：目录/ZIP 导入导出、缩略图、应用/删除；空闲散步、跑动、睡觉、点击/拖拽/审批等动作状态，支持安静/标准/活泼预设。
- **外观工坊**：壁纸、区域透明度、主题、强调色、字号与密度、预设；输入栏始终不透明，自定义强调色自动收敛到可读范围。
- **角色插画**：Pixiv 参考、提示词 Agent、本地 ComfyUI（Anima/Animagine）、角色 LoRA、单图生成与历史项目。
- **发行媒体**：`dist/runtime/media` 随包携带 ffmpeg/ffprobe 与 SHA256/许可材料，发行版不依赖系统 FFmpeg。

## 快速开始

### 使用发行版

- 候选解压版：`release\0.7.0\win-unpacked\DragonAgent.exe`
- 候选安装包：`release\0.7.0\DragonAgent-Setup-0.7.0.exe`
- 候选便携 ZIP：`release\0.7.0\DragonAgent-0.7.0-win.zip`

解压便携版后保留可执行文件旁的全部资源目录。本机固定入口 `release\win-unpacked` 目前仍可能是旧版本，不能当作 0.7.0 验收依据。

### 首次配置

1. **模型 API**：设置 → 模型 API，填写服务地址、模型 ID、API Key 和服务商实际上下文窗口；支持 Chat Completions、Responses、Anthropic Messages。
2. **工作文件夹**：新建聊天后选择工作文件夹。文件、命令和浏览器操作按当前对话权限审批。
3. **可选通道**：
   - Codex：在设置中登录账号后，在模型菜单的 Codex 页签选择模型和推理强度。
   - MCP：工具连接中添加 stdio / Streamable HTTP 服务。
   - 本地插画：安装 ComfyUI 并准备 Anima/Animagine 模型；模型权重不随仓库分发。
   - 云端桌宠：在「制作桌宠 → 方舟服务与价格配置」填写方舟 Key、模型 ID、价格与支持参数；没有确认预算不会发起付费生成。

网页操作需要 Google Chrome。应用本身不要求另装 Node 或 Python；可选的 ComfyUI 使用它自己的 Python 环境。

## 工作台

- 统一时间线、消息版本、任务树、文件产物预览、上下文/Token 状态条。
- 附件支持 UTF-8 文本/代码、PDF、DOCX、PNG/JPEG/WebP/GIF；单文件最多 32 MB，每条消息最多 10 份。图片导入会生成适配副本，原文件不变。
- 自研通道总上下文上限 512K tokens，并与模型配置窗口取较小值；约 80% 开始压缩，完整历史和大工具输出保存为本地附件。
- 三档权限：**全请求批准**、**帮我批准**、**完全放开**。命令以当前 Windows 账号运行，审批和范围检查不是操作系统级容器。
- 子 Agent 不扩大父任务授权；父子任务均持久化目标、状态、用量和结果。停止主任务会取消整棵任务树。
- 请求重试不会重放已执行的工具；结果未知的操作不会自动重复提交或重放审批。

## 计划模式

从输入栏左下角“＋ → 计划模式”开启，或用计划卡上的“继续修改”重新进入。

- **只对下一轮生效**：这一轮结束后自动回到执行模式。
- 计划期只暴露只读工具和 `plan_submit`，隐藏终端、写入和未审核 MCP 工具。
- 计划可包含多个版本；只有最新、未过期、没有待决问题的计划可以确认执行。重复确认同一个 commandId 幂等。
- 执行阶段恢复执行模式提示和正常工具；先前计划限制结束。
- 用户提示词明确写“先制定计划”“只讨论方案，不要执行”等时，仅当前轮自动进入计划模式，不会黏到后续对话。

## 模型与协作

- 模型菜单包含 **Codex**、**其他模型**、**协作** 三个通道。
- 同一通道内切换直接生效；跨 Codex/Dragon 切换也保留当前聊天，下一条消息会带上最近 8 条对话摘录。
- Codex 模型和推理强度按会话保存；Dragon 连接支持 DeepSeek 思考档位（官方端点）和不同服务商配置。
- **协作模式**：GPT 负责规划与只读复核，DeepSeek 执行；先在计划卡确认再执行。模型菜单顶部可直接“退出协作”，不会新开聊天。
- 模型切换、协作配置在任务或审批进行中会被拒绝，需先停止或等待结束。

## 桌宠与外观

- 「召唤龙娘」或 `Ctrl + Alt + D` 显示/收起桌宠；单击、双击、拖动、右键菜单、气泡输入与审批保留。
- 气泡支持简约/详细模式；简约模式保留快速输入，详细模式展开聊天、附件和设置。
- 桌宠空闲时会按配置散步或跑动，支持睡觉/唤醒；提供安静、标准、活泼预设，可调首次等待、间隔、速度、距离、往返次数和跑动概率。皮肤缺少动作时回退到待机。
- 外观工坊支持壁纸、壁纸区域透明度、亮/暗/跟随系统、强调色、字号和密度、预设；壁纸位于原生标题按钮下方，输入栏保持不透明。

## 角色插画

- 独立插画页：创作对话、提示词整理、正负面提示词、参数、Pixiv 参考、生成结果和历史版本。
- Pixiv 登录与作品检索在独立窗口完成；参考图只保存本地副本。
- 本地生成通过 ComfyUI 调度，支持 Anima 与 Animagine/SDXL；LoRA 可搜索 Civitai、粘贴链接或导入本地 SafeTensors，校验架构与 SHA256 后才启用。
- 真实 ComfyUI 冷启动和 Animagine 768×1024 单图已在本机验收；模型和节点许可见各自来源，仓库不分发权重。

## 云端桌宠制作

「制作桌宠」使用火山方舟（Ark）生成角色立绘和动作视频：

1. 配置 API Key、已开通的 Seedream/Seedance 模型 ID、价格、分辨率和时长能力。
2. 创建立绘，确认角色后选择动作与预算。
3. 云端任务返回后下载原片，用本地 FFmpeg 抠像、整理为 272×272 透明 WebM，并做技术检查。
4. 逐项人工确认后发布到桌宠库；原片和检查报告保留。

- 提交前保存请求编号，收到远端任务号后才标记为已提交。
- 结果未知时保留预算，必须人工核对：录入远端任务号后只查询、不重提；确认未受理才释放预留并记录审计。
- 重新整理/换抠像参数不重新发起付费生成。
- 需要真实账单和人工目检；自动检查不能证明角色身份或肢体正确。

## 数据与安全

- 数据目录：`%APPDATA%\DragonAgent`。
  - `dragonagent.db`：桌面状态、配置、记忆和系统加密后的密钥。
  - `agent-core.db`：内核会话、工具/审批事件、附件索引。
  - `studio/`、`illustration/`、`workshop/`：云端桌宠、插画和历史工坊素材。
- 密钥通过 Electron `safeStorage` 加密，不写入模型配置或日志；聊天与桌宠共享本地数据。
- 仓库不包含账号、密钥、数据库或浏览器用户目录；发行包会检查违禁文件。
- 命令和 MCP 程序以当前 Windows 账号权限运行。需要更强隔离时应使用独立系统账号或虚拟机。

## 开发

要求：Windows 10/11、Node.js 24、pnpm。

```powershell
pnpm install
pnpm build
pnpm start
```

常用验证：

```powershell
pnpm test                    # 单元/集成测试
pnpm typecheck
pnpm test:ui                 # 真实 Electron 工作台/桌宠/审批回归
pnpm test:planning           # 计划模式端到端
pnpm test:model-switch       # 聊天内切换模型/退出协作
pnpm test:media              # 真实 FFmpeg 抠像链路
pnpm test:appearance         # 主题/尺寸/缩放矩阵
pnpm test:illustration-layout
```

发行构建：

```powershell
pnpm package                 # 构建、准备 Codex/媒体运行时、生成安装包与 ZIP
node scripts/release-check.mjs
```

`release-check` 会核对版本、违禁文件、主进程编译产物、图标和产物哈希，并把结果写入 `test-results/release-check.json`。`scripts/promote-release.ps1` 只应在验收通过、应用空闲并备份后执行。

### 目录

- `packages/agent-core`：独立 Agent 内核、协议适配、工具注册/审批、预算、摘要、SQLite/内存存储。
- `src/main/agent-worker.ts`：Electron 独立后台进程中的内核宿主。
- `src/main/dragon.ts`、`runtime.ts`：桌面与内核 RPC、会话状态和系统能力。
- `src/main/studio`：方舟客户端、预算/恢复状态机、FFmpeg 媒体与桌宠库。
- `src/main/illustration`：Pixiv、ComfyUI、提示词 Agent 和插画存储。
- `src/pet`：桌宠渲染、视频/图集/骨架、空闲行为与动作映射。
- `src/renderer`：工作台、外观工坊、计划卡/检查器和桌宠气泡。
- `assets/skins`：内置桌宠素材；`docs/`：发行、验收和素材规范。

## 验证与发行状态

以下结果基于当前源码 `b80b328`：

- `pnpm test`：**91 通过、0 失败**。
- `pnpm typecheck`、`pnpm build`：通过（Vite 主 chunk 体积警告仍在）。
- 已通过：工作台/队列、计划模式一次性与提示词触发、聊天内模型切换、云端桌宠模拟状态机、真实 FFmpeg 媒体链路、桌宠库、外观/尺寸/缩放矩阵、插画布局、原生标题栏、真实 ComfyUI 冷启动 + Animagine 单图、打包冒烟。
- **未完成**：真实方舟付费立绘/视频验收、真实 Pixiv 登录/识图验收、真实云端账单核对、安装包签名与 FFmpeg GPL 分发合规最终确认。
- **未执行**：替换固定入口 `release\win-unpacked`、创建 GitHub Release。

### 候选产物

`release/0.7.0/` 下已生成并通过 `release-check`：

| 文件 | 大小 | SHA256 |
|---|---|---|
| `DragonAgent-Setup-0.7.0.exe` | 312.9 MB | `3125e24239d15ab1a1639083dd6cac36b8499aacd957cea59f3c5cd2f36ee6f8` |
| `DragonAgent-0.7.0-win.zip` | 423.6 MB | `5c36b14b07e2d12d48a5a7ebe85224428d31f22f0090fed69d9229407416b708` |
| `dragon-agent-core-0.4.0.tgz` | 61 KB | `f4e304adb6cda52c2b5c760d66ff339710b9bf3c500193b018e5fecccb205665` |

校验文件：`release/0.7.0/SHA256SUMS.txt`。产物在 `.gitignore` 中，不随源码提交。

## 文档

- [0.7.0 实施记录](docs/IMPLEMENTATION-0.7.0.md)
- [0.7.0 验收报告](docs/ACCEPTANCE-0.7.0.md)
- [0.7.0 候选发布说明](docs/RELEASE-0.7.0.md)
- [自研内核实现](IMPLEMENTATION.md)
- [创作工坊与 ComfyUI](docs/CREATIVE-STUDIO.md)
- [桌宠动画素材规范](docs/PET-ANIMATION-SPEC.md)
- [发行记录 0.4.0](docs/RELEASE-0.4.0.md)、[0.3.0](docs/RELEASE-0.3.0.md)

## 第三方与许可

- Electron、React、Sharp 等依赖使用各自许可证。
- 可选 Codex 运行时由打包脚本复制，需遵守其许可证。
- 发行包附带 FFmpeg/ffprobe（GPL-3.0）及许可、源码地址和构建说明；正式发布前需完成分发合规确认。
- ComfyUI、Anima/Animagine、Wan、BiRefNet、Pixiv 内容等由用户自行安装或获取，仓库不分发相应模型权重和素材。
