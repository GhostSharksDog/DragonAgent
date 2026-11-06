# DragonAgent 0.7.0 实施与验收记录（未发布）

本文件只记录实际做过的修改和验证。**0.7.0 尚未交付，不得用本文件或编译通过代替验收。**

## 2026-11-06 接手批次

### 开发基线

- 修复 `tests/planning070.test.ts` 的 `TS2352`：用完整的 `AgentRecord` 取代不完整对象和双重断言。
- `runtime-package-lock.json` 补齐 `fflate@0.8.3`（官方 npmjs 地址与 integrity，root 依赖排序），并在隔离目录执行 `npm ci --omit=dev --ignore-scripts` 验证：243 个包安装成功、fflate 0.8.3 可用、未安装 electron/开发依赖。
- 归档未引用的旧桌宠素材链：`docs/archive/PetPipeline.tsx.txt`、`docs/archive/pet-pipeline.css.txt`，应用不再包含 DSH 插件安装命令。
- 构建脚本改为在其它构建完成后串行复制 `assets`，并校验两套内置桌宠的 `skin.json` 存在；此前并行复制曾出现 `dist/assets/skins` 为空但构建仍成功的情况。

### 计划模式

- 新增共享 `validatePlanSteps`：重复编号、自依赖、前向依赖、环和空计划都会拒绝；宿主 `plan_submit` 统一使用该实现。
- 新增计划模式端到端检查 `npm run test:planning`：菜单进入、只读工具可见性、`plan_submit`、确认执行、执行模式提示与工具恢复、重复确认幂等、待决问题与过期计划拦截，全部通过。
- 新增核心策略测试：三档权限下计划模式拒绝写入/未审核 MCP、执行层拒绝模型伪造的隐藏工具调用、`tool_search`/`tool_load` 不暴露未审核工具、子 Agent 继承限制。

### 云端桌宠与媒体

- `studio.update` 改为白名单更新，拒绝 `status`、`operations`、`authorization` 等内部字段；任何方案改动仍会使预算确认失效。
- 方舟错误解析：读取错误码、供应商说明和请求编号，脱敏密钥类文本；4xx 视为明确拒绝，5xx/408 提交视为结果未知。
- 媒体工具随发行包：`prepare:runtime` 从 `DRAGON_FFMPEG_DIR` 或 PATH 复制 ffmpeg/ffprobe 到 `dist/runtime/media`，写入 manifest（版本、SHA256、字节数、GPL 来源）并复制 LICENSE/README 到 `dist/licenses`；`mediaBinary` 改用显式 dev 标记，不再通过路径包含 `resources` 猜测环境。
- 真实 FFmpeg 链路测试 `npm run test:media`：蓝色背景视频 → 抠像 → 272×272 透明 webm，实测 16 帧、输出带 alpha 标记、质量检查无空帧/裁切；循环首尾提示属测试素材本身特性。

### 桌宠库

- ZIP 导入拒绝重复路径和路径穿越；目录导入不再删除用户源素材（修复：包装目录清理只对 ZIP 内部目录生效）。
- ZIP 顶层单一包装目录会被解包到素材根并删除重复副本；目录导入 → 导出 ZIP → 再导入 roundtrip 通过。
- 新增 `tests/library070.test.ts` 覆盖 zip-slip、缺失 skin.json、包装目录、flat zip、导出重导入。

### 云端状态机与恢复

- `studio.update` 白名单和预算确认失效规则同上；新增 `studio.resolve`：结果未知的操作必须由用户人工核对后处理。选择“已受理”需录入方舟任务编号，随后 `studio.resume` 只查询该任务、不会重复提交；选择“未受理”会释放预留费用、标记取消并记录核对审计（时间、结论、备注）。
- 新增 `tests/studio-flow070.test.ts` 用本地模拟方舟跑通完整链路：立绘生成 → 角色确认 → 视频任务提交/查询/下载 → 真实 FFmpeg 抠像 → 技术检查 → 人工确认 → 发布为桌宠；同时验证未受理的 503 会保留预留且禁止 resume、录入任务编号后恢复只查询不重提、确认未受理后预留释放、取消运行中任务后恢复不重提、同一生成 commandId 幂等。
- 内置/导入的视频型桌宠会从待机视频首帧生成库内缩略图（FFmpeg），不再显示通用占位图；内置逐帧桌宠重命名后缩略图地址同步修正（此前库内显示破图）。
- 新增 `test:media` 与 `test:planning` 已并入集中验收脚本。

### 打包与发行候选

- `npm run package` 成功：`release/0.7.0/win-unpacked`、`DragonAgent-Setup-0.7.0.exe`（312.9 MB）、`DragonAgent-0.7.0-win.zip`（423.6 MB）、`dragon-agent-core-0.4.0.tgz`；`SHA256SUMS.txt` 已生成。`scripts/package.mjs` 现在会同时打包 agent-core，避免发行校验缺件。
- `node scripts/release-check.mjs`：6783 个文件、违禁文件 0、主进程编译产物一致、图标尺寸一致、3 个产物哈希写入 `test-results/release-check.json`。
- `scripts/promote-release.ps1` 的固定入口替换流程已加入云端桌宠未完成操作检查（运行中/未核对/未知状态都会拒绝替换），仍**未执行**替换。
- 发行包抽查包含：`node_modules/fflate`、`dist/runtime/media/ffmpeg.exe`/`ffprobe.exe`/`manifest.json`、FFmpeg 许可与 README、Codex 运行时、两套内置桌宠素材；抽查未发现数据库/密钥/测试用户数据。
- 打包后冒烟：`win-unpacked/DragonAgent.exe` 以独立数据目录启动，欢迎页视频皮肤与桌宠窗口正常，版本 0.7.0；从 ZIP 导入桌宠成功（验证 fflate 在发行包内可用）；打包版桌宠库中两套内置素材缩略图均能加载（逐帧 atlas 1632×，视频首帧 272×），验证发行包内 FFmpeg 路径。
- **未替换固定入口 `release\win-unpacked`，未发布。**

### 插画真实生成

- 真实 ComfyUI 冷启动验收：自动检测本机 Comfy Desktop 安装（`standalone-env` 之外的 `.venv`），启动 ComfyUI，使用 Animagine XL 4.0 Opt 生成 768×1024 单图，102 秒完成；生成文件统一转码为 PNG 保存（此前 ComfyUI 返回 JPEG 却以 `.png` 落盘）。
- 新增 `scripts/comfy-live-check.mjs`（`npm run test:comfy-live`）：需要本机 ComfyUI + GPU，不属于常规 `npm test`；运行结束只停止自己启动的 ComfyUI。
- 恢复插画布局检查的测试依赖 `ws`，并把异步 `waitForFunction` 改为显式轮询；24 组窗口/主题/缩放组合通过。

### 外观与输入

- 自定义强调色按亮/暗主题收敛到可读亮度范围，避免白底白字/深底暗字；自定义色仍保留色相。
- 滑杆提交去重：pointerup/keyup/blur 不再重复保存同一档位，保存失败可重试。
- 输入框草稿改回声台账：只忽略自己 IPC 回传的旧值，外部设置（切换聊天、恢复草稿）即使聚焦也同步；组合输入期间不动。
- 欢迎页改用 `SkinSprite` 按 rig/webm/图集分流（此前视频皮肤在欢迎页空白）；VideoSprite 首帧绘制后设置 `data-ready`。
- 新增 `test:appearance`：亮/暗主题强调色可读性、输入栏实色、跟随系统主题、900/1100/1440px 与 150%/200% 缩放无横向溢出。

### 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过（Vite 主包 >500 KB 警告仍在）。
- `npm test`：**66 通过、0 失败**。
- `npm run test:workbench`、`test:queue`、`test:ui`、`test:planning`、`test:media`、`test:composer`、`test:reasoning`、`test:context-bar`、`test:appearance`：全部通过。
- 真实方舟、真实 Pixiv、真实 ComfyUI 冷启动：**未执行/未验收**；固定入口替换**未执行**。
- 源码已按核心、云端制作、外观界面、发行文档分提交并推送到 GitHub `main`；候选验收报告见 [ACCEPTANCE-0.7.0.md](ACCEPTANCE-0.7.0.md)。

## 仍未完成

1. 云端桌宠 UI 状态机集中验收（模拟方舟）：预算确认与表单竞态、unknown/取消/恢复、动作版本选择、错误展示。
2. 外观矩阵：900/1100/1440px、短窗口、100/150/200% 缩放、跟随系统主题的真实窗口检查。
3. Pixiv 真实站点、识图、ComfyUI 冷启动与 Anima 单图验收。
4. 安装包/便携 ZIP/SHA256/截图/版本说明，确认发行包含 fflate、媒体工具、不含密钥与测试数据。
5. 分提交推送 GitHub；仅在任务空闲、备份完成且用户确认后替换 `release/win-unpacked`。
6. 真实方舟付费验收需要应用内凭据和用户确认的预算，当前没有。
