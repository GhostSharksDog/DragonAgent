# DragonAgent 0.2.1 验收记录

日期：2026-10-29。环境：Windows x64；开发 Node 24.20、Electron 45。本地自动测试使用独立临时数据目录和模拟密钥；真实在线验收使用用户已配置在 DragonAgent 中的凭据，未读取两个原项目的凭据或账号。模拟服务与真实在线能力分开记录。

## 已完成的本地验证

| 项目 | 证据 / 范围 |
|---|---|
| TypeScript 编译、生产构建 | `pnpm build`，独立核心输出 ESM + 类型声明 |
| 框架脱离 Electron | `examples/node.mjs`，真实本地 HTTP 模型模拟服务，2 轮对话、连续 2 次工具执行、4 次 HTTP 请求 |
| 三种模型协议 | 每种覆盖文本流、UTF-8 分段、多工具/分段参数、用量、错误、取消；另测 reasoning/signature/encrypted continuation 与图像结果 |
| 子 Agent | 3 个同时请求模型、串行写入；单个停止不影响兄弟、主任务取消整树；不能扩大文件夹范围；不暴露递归管理工具；限额暂停与继续 |
| 预算和压缩 | 512K 总上限、小窗口比例、压缩请求预算、原始记录附件、调用/结果配对、大工具结果、可选精确计数接口 |
| 恢复与副作用 | SQLite 中断恢复；未知结果不自动执行；重复调用 ID 复用结果；文件 SHA-256 版本冲突拒绝覆盖 |
| MCP | 真实 SDK stdio + 本地 Streamable HTTP；连接失败、拒绝、断线、超时、取消、畸形结果与后续重连；失败调用不重发 |
| 旧数据迁移 | v1 数据库修改前备份；旧 DSH 只读；密钥字节和记忆保留；Legacy 只读导入和去重 |
| 桌面整条链路 | `scripts/ui-check.mjs`：工作台→后台→模拟模型→真实文件工具→龙娘气泡审批→实际落盘；两个子任务分别审批并汇总；两个窗口重复发送只生成 1 个用户任务；审批事件写入 SQLite |
| 外观 | `test-results/task-tree.png` 等实际截图；52 个原龙娘资源逐个 SHA-256 比对一致 |
| 透明窗口与手势 | 固定入口的 0.2.1 在浅色、深色主题下，龙娘和气泡的 html/body/root 背景透明、四角 alpha 为 0，人物/卡片仍有不透明内容；单击、双击和拖动通过 |
| Windows 桌面合成 | 实际屏幕捕获只保留测试窗口区域；浅色背景四角 RGB 均为 237/242/247，深色均为 23/35/52，没有矩形底板；截图 `pet-desktop-light.png`、`pet-desktop-dark.png` |
| 原启动路径 | 旧 0.1.0 完整移至 `.cache/legacy-release-0.1.0-20261029-105552`；新版本逐文件比对后替换 `release/win-unpacked`，界面实际显示 0.2.1 |
| 用户数据保留 | 原 v1 数据库自动备份后迁移到 v2；1 份模型配置、2 份加密密钥字节完全一致，记忆列表不变（原为 0 条）；原库没有 DSH 会话，旧会话只读迁移另由自动测试覆盖 |
| Codex 本地进程 | 固定版本 0.160.1 的 app-server 初始化和 account/read 成功；独立测试账号目录显示未登录，不包含在线模型请求 |

本次 27/27 自动测试通过，结果在 `.runtime/tests021.log`；固定入口桌面记录在 `.runtime/stable-ui021.log`，桌面合成记录在 `.runtime/stable-compositor021.log`。桌面测试启动的应用 PATH 不含 Node/Python。发行检查在 `test-results/release-check.json`，替换及数据保留记录在 `test-results/promotion.json`、`test-results/data-preservation021.json`。测试日志与模拟密钥不会打入发行包。

首次发行版截图测试抓到了主题切换时尚未绘制内容的透明帧，已让脚本等待有内容的帧后再检查相同的 alpha 标准，完整复跑通过。

## 真实在线验收

| 服务 | 状态 |
|---|---|
| DeepSeek `deepseek-flash` / Chat Completions | 通过。实际应用读取已保存的密钥；3 次模型请求、连续 2 次计算工具调用，结果为 400；服务返回输入 4092 / 输出 180 tokens |
| Tavily 真实搜索 | 通过。实际应用以已保存的密钥连接官方 MCP，发现并调用 `tavily_search`，返回带来源的搜索结果（2602 字符） |
| Codex 真实账号推理与额度 | 读取验收文件 1 次，正确返回校验码；额度查询 ready，1 个额度桶。随后第一次归档测试会话失败（原任务写入进程尚未退出），待该进程退出后用新连接重试归档成功。保留首次失败记录及单独的恢复结果 |
| Responses / Anthropic Messages 真实服务 | 用户当前仅配置 Chat Completions，本次没有这两种协议的真实凭据；本地协议测试通过，不能替代其在线验收 |

本次使用 `release/win-unpacked/DragonAgent.exe --verify-online`，在真实应用主进程和原 `%APPDATA%/DragonAgent` 加密环境中执行。旧隔离进程的解密失败未复现，也未要求用户重新输入密钥。在线任务只计算、搜索、读取指定验收文件；没有修改用户工作文件。报告在 `test-results/live-acceptance.json`，旧隔离进程结果另存 `live-acceptance-0.2.0.json`。只记录模型、状态、用量和脱敏错误，不记录密钥。原在线批次因归档清理错误返回退出码 1，恢复记录不覆盖这个事实。

随后用原用户数据启动实际 Dragon 独立后台：内核 ready，Tavily connected，记录在 `test-results/installed-start021.json`。中间曾连续出现 Tavily 网络超时；无凭据诊断确认主进程和独立后台同时收到 `UND_ERR_CONNECT_TIMEOUT`，而 DeepSeek 可达。Tavily 公共端点恢复响应后，重开应用连接成功。失败记录保留在 `.runtime/installed-start021-network-timeout.log`、`.runtime/network-check.log`，没有把临时连接失败当作连接成功。

## 发行验证范围

发行目录为 `release/0.2.1`，固定入口为 `E:\Projects\DragonAgent\release\win-unpacked\DragonAgent.exe`，两者均为同一新版载荷。扫描 3003 个应用文件，未发现 DSH、Cordis、旧桥接或独立 `node.exe`；主进程、后台和 preload 与本次构建 SHA-256 一致，可选 Codex 原生程序保留。ZIP 的 7-Zip 完整性测试通过。Windows 安装包、便携 ZIP、独立核心包的校验值见 `release/0.2.1/SHA256SUMS.txt`。独立核心 API 未变化，核心包版本仍为 0.2.0。

对发行载荷使用全新应用数据目录复跑启动和桌面用例。此项验证应用载荷；本机没有独立的全新 Windows 虚拟机，NSIS 安装/注册/卸载在干净系统上的全流程仍需另测。安装包未配置代码签名证书。

约束：模型窗口来自用户配置，不能超出服务商实际支持的值；默认估算较保守，可能提前压缩。命令和第三方 MCP 使用 Windows 当前用户权限，依靠范围限制与审批，不提供容器隔离。
