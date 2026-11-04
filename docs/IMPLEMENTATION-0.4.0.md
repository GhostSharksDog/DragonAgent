# 0.4.0 实施与验收记录

更新于 2026-11-04。0.4.0 已构建并更新固定入口；最终范围和气泡检查见 [发行记录](RELEASE-0.4.0.md)。

## 已实现

- 高对比白色／月夜紫主题，左右栏独立折叠与记忆，右侧文件预览，任务树与工具操作进入对话时间线。
- 用户消息气泡、下方时间与复制图标；Markdown/GFM、高亮代码、代码／命令／输出整块复制，网页链接与受限站点图标。
- 命令同一记录展示审批、执行、完成或失败；紧凑图标摘要、展开详情。Dragon 命令与 Codex 原生命令均接收实时输出、工作目录和退出码。
- 最后一条用户消息编辑重发、历史版本、附件保留、Dragon 上下文快照与 Codex 分支轮次；已有文件操作不会自动撤销。
- 经宿主核验的产物卡片、文本分页、代码、Markdown、图片、PDF 按页渲染与隔离 HTML 交互预览。
- Git 只读操作、SQLite 只读查询、时间、显式记忆、网页抓取、DeepSeek 搜索／图片分析、工具目录和 GitHub 官方 HTTP MCP。
- Codex 双条额度、DeepSeek 余额缓存与错误状态保留。
- GPT 规划 → 用户确认 → DeepSeek 执行 → GPT 复核，最多两次修正；只读 GPT、分阶段限额、DeepSeek 降级、取消与中断恢复记录。
- Anima／Animagine、独立创作对话、项目参数修订／草稿、人设编辑、Civitai 下载／本地 LoRA、来源与 SHA256 记录。
- 保留 LoRA 作者说明、源页面和触发词；显式单值作者权重优先使用，缺省才为 0.8。新立绘按作者资料重画后等待用户确认。
- ComfyUI 按立绘／视频／抠图阶段检查；预览、导出、提示词和聊天不要求服务在线；已有原始帧可恢复抠图。
- 数据库 v3 自动备份、未知操作不重放，公开独立内核不依赖 Electron。发行版本和运行依赖锁已同步至 0.4.0。

## 本地模拟与桌面集成验收

已通过现有 29 项核心测试、工坊协议集成、独立创作助手集成、跨窗口／审批／子任务／桌宠手势集成、权限与附件检查、工坊 UI 与人设 UI 检查。

`scripts/workbench040-check.mjs` 已通过：真实文件写入、SQLite 和命令路径，用户气泡和复制按钮，交互 HTML 隔离、PDF、UTF-8 大文件分页、编辑与版本恢复、GPT 不可用降级和首次计划确认。浅／深色与小窗口截图保存于 `test-results`。后续 Codex 输出流修改已通过现有 Codex 集成场景扩展验证。

模拟 ComfyUI 返回完整 11 项动作并导出不代表真实模型成片通过。

## 真实服务验收

| 项目 | 状态与证据 |
|---|---|
| DeepSeek 搜索、Fetch、识图、余额 | 已在实际应用系统加密环境中通过；`test-results/live040-check.json` |
| Codex 模型与额度 | 实际账号目录读取通过；返回 Astra 模型与双额度窗口 |
| GPT／DeepSeek 完整闭环 | 修正后真实重测通过：gpt-6-astra／high 规划、用户确认、DeepSeek 写入与回读、GPT 依据工具记录复核；没有降级或子任务。`test-results/online040-attached.json` |
| Tavily | 最新 0.4 实际搜索通过；`test-results/online040-attached.json` |
| GitHub MCP | 用户保存凭据后，实际应用只读仓库搜索通过；`test-results/github040-live.json`，未修改仓库／Issue／PR |
| Civitai | 实际认证下载、SafeTensors 和 SHA256 校验通过；`test-results/creative031-live.json` |
| Anima／Animagine 立绘 | 均已真实生成；旧 Anima＋LoRA 图被用户指出角色偏差，不作为角色一致性通过证据 |
| 作者触发词重绘 | Anima 真实生成完成，作者权重 1.0，用户已确认并明确继续使用 Anima；`test-results/character-redraw040.json` |
| ToonOut | 修复本机 ComfyUI 虚拟环境缺失的 timm／cv2 后已真实加载并处理 PNG 帧 |
| 11 项真实动作 | 新角色确认后已启动制作，当前报告 `test-results/motions040-live.json`。旧任务部分动作完成但中断，不能作为整包通过依据 |

旧动作验收累计约 40 分钟、峰值显存约 7.16 GiB、最低剩余内存约 1.31 GiB；这些是未完成批次数据，不是完整制作耗时。模型生成的身份、肢体和步态仍需人工确认。

## 范围调整与交付

用户已停止推进动画制作，完整 11 项动作不再作为验收要求。独立角色插画另行交付 0.5.0。新版安装包、ZIP、内核包与校验值已重新生成，固定入口已备份并替换。

## 启动与数据保护

开发版：在 `E:\Projects\DragonAgent` 执行 `pnpm start`。修改源码后先 `pnpm build`。

目标发行入口：`E:\Projects\DragonAgent\release\win-unpacked\DragonAgent.exe`。现已更新至 0.4.0。

原应用数据保留在 `%APPDATA%\DragonAgent`。本次升级前完整备份位于 `.cache/userdata-pre040-20261104-094434`；替换前已再次确认空闲并完整备份至 `.cache/userdata-pre040-final-20261104-161655`。日志不记录密钥。工作区内的 `.runtime`、`.cache` 与 `test-results` 不提交仓库。
