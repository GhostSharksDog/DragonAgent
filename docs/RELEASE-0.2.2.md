# DragonAgent 0.2.2

日期：2026-10-29。此次把 Codex 工具名称修复与人设、附件、权限和 DeepSeek 搜索一同交付。

## 行为变化

- Codex 动态工具注册使用稳定的别名，调用时映射回 Dragon 原名；界面和审批仍显示原工具名。解决启用 Tavily 后连“你好”也在注册阶段失败的问题。别名长度有界、与工具发现顺序无关，未注册的名称不会执行。恢复会话时提交当前工具列表。
- 自研 Agent 和可选 Codex 通道使用霜璃人设。旧对话继续时更新系统提示，历史资料仍作为数据。
- “+”提供文件上传和聊天引用。文件保存在本地附件目录，正文先给有界摘录，再由专门的只读附件工具分段读取。图片作为图像输入，而不是把 base64 当文本预算；保守预留每图 32768 tokens，模型实际计数仍以服务返回为准。
- 三档权限在会话级保存。默认 ask，auto 自动批准但文件/浏览器遵循范围，full 自动批准并允许其他目录/网站。原 PowerShell 工具以当前 Windows 账号运行，不提供 OS 沙箱；Codex 自身原生命令采用其对应的 read-only / workspace-write / danger-full-access 策略。子任务只能继承或缩小父任务范围。
- DeepSeek 官方 Search / Fetch 直接通过 HTTP 接入自研 ToolRegistry，复用官方模型配置密钥；关闭设置后不注册。错误不会伪装为搜索成功。其他服务的密钥不会被发往 DeepSeek。

接口参考：[Codex 动态工具约束](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental)、[DeepSeek Search / Fetch](https://api-docs.deepseek.com/guides/search/)。`mcp__` 原名的报错和别名可接受性还由随包 Codex 0.160.1 本地协议验证确认。

## 集中验收

用户要求完成全部功能后集中验收。本轮沿用现有测试；仅为最初 Codex 命名问题增加两项回归，没有为后续每个界面操作新增单元测试。

- 既有框架和命名回归共 29 项通过。协议、取消、协作、权限、恢复仍覆盖在其中。
- `scripts/features-check.mjs`：实际 Electron 界面 + 本地模型服务，在同一批次验证人设、TXT/PDF/DOCX/图片解析、关联聊天、两个窗口共享、读取审批、auto 模式无弹卡执行命令并拒绝越界文件写入、full 模式越界文件写入。记录 `test-results/features-check.json`。
- `scripts/deepseek-live-ui-check.mjs`：实际应用读取原加密密钥，Dragon 独立后台调用真实 DeepSeek Search 和 Fetch，auto 模式无审批弹卡，结果含来源；模型正确介绍银白长发、紫色眼睛的霜璃。记录 `test-results/deepseek-search-live.json`。
- Codex 与 Tavily 的组合流程用 `scripts/codex-mcp-ui-check.mjs` 验证：MCP 已连接时先问候，再在同一会话中搜索，气泡批准后返回来源。最终状态见 `test-results/codex-mcp-live-0.2.2.json`。
- 最终发行版上述 Codex 流程通过：问候成功、同一原生会话续聊成功，2 次气泡审批（范围读取和 Tavily 搜索），搜索返回来源。发行版的附件/图片与三档权限也完整通过；原跨窗口去重、子任务协作、透明背景及手势通过。
- 发行依赖、构建一致性及校验值由 `scripts/release-check.mjs` 记录；固定入口替换记录在 `test-results/promotion.json`。
- 2026-10-30 从固定入口启动 0.2.2，确认工作台窗口可响应；启动记录在 `test-results/stable-launch-0.2.2.json`。

首轮图片验收发现原估算把 base64 传输字节当成文本 tokens，已修正后完成图片完整调用；没有降低验收标准。

打包阶段下载中断曾导致 PDF 解析库不完整；实际发行程序检查识别了问题，随后从本地已安装的同版本包补齐并逐文件校验，最终发行版 PDF/DOCX/图片检查通过。发行扫描共 4185 个应用文件，没有 DSH/Cordis 执行依赖；独立核心包为 0.2.1。

## 使用与限制

固定入口：`E:\Projects\DragonAgent\release\win-unpacked\DragonAgent.exe`。安装包和 ZIP 在 `release/0.2.2`，解压 ZIP 后保留全部资源文件。原用户数据与密钥继续使用，旧入口另备份；不包含 DSH/Cordis 执行依赖。

文件正文提取最多保存 100 万字符，超限会明确标注。扫描 PDF、加密文档、无法解码的二进制文件会显示解析问题；没有默默宣称已读到内容。图片上限和保守预算可能限制小窗口模型。搜索接口受当前网络和服务额度影响。

本机验证发行载荷及全新应用数据目录；没有全新 Windows 虚拟机来执行安装/注册/卸载全流程。安装包未配置签名证书。
