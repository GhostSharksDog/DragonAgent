# DragonAgent 0.7.0 候选发布说明（未交付）

> **状态：候选构建，不是已交付版本。** 真实方舟付费验收、真实 Pixiv/ComfyUI 验收尚未完成；固定启动目录 `release\win-unpacked` 未替换。安装包只用于内部验收。

## 本版内容

- **Dragon 计划模式**：输入栏“＋”菜单开启；计划期只读调查，`plan_submit` 提交结构化计划；用户确认后才进入执行。计划版本、过期、待决问题、双窗口重复确认均由宿主校验；子 Agent 继承限制。
- **云端桌宠制作（火山方舟）**：Seedream 立绘 + Seedance 动作视频，预算上限与人工核对入口；未知提交保留预留，录入远端任务编号后只查询不重提；确认未受理可释放预留并留下审计记录。本地用 FFmpeg 抠像/透明 WebM，原片保留，重新整理不重新收费。
- **媒体工具随包**：`dist/runtime/media` 包含 ffmpeg/ffprobe 及 SHA256/许可材料；发行版不依赖系统 FFmpeg。
- **桌宠库**：目录/ZIP 导入、导出、应用、删除；ZIP 路径穿越与重复路径拒绝；内置两套桌宠素材保留。
- **外观工坊**：壁纸、区域透明度、主题、强调色、字号/密度、预设；输入栏始终不透明；自定义强调色自动收敛到可读范围。
- **输入与上下文**：输入法组合期间草稿不回灌，外部草稿可同步；上下文/Token 状态条、Token 分析、请求重试与预算记录。

## 验证记录

- `npm run typecheck` / `npm run build`：通过。
- `npm test`：66 通过、0 失败。
- 集成脚本：`test:workbench`、`test:queue`、`test:ui`、`test:planning`、`test:media`、`test:composer`、`test:reasoning`、`test:context-bar`、`test:appearance` 全部通过。
- 安装包冒烟：`release/0.7.0/win-unpacked/DragonAgent.exe` 可启动，欢迎页视频皮肤与桌宠窗口正常，版本 0.7.0；发行包内的 ZIP 桌宠导入成功（fflate 可用）。
- 发行包抽查：含 fflate、ffmpeg/ffprobe 与 manifest、内置桌宠素材、Codex 运行时、FFmpeg 许可材料；抽查未发现数据库、密钥或测试用户数据。

## 候选产物

| 文件 | 大小 | SHA256 |
|---|---|---|
| `DragonAgent-Setup-0.7.0.exe` | 312.9 MB | `da0604d687ac15021b25c95e19fb5d44010b8d01c8669fad4e1a11393d8320af` |
| `DragonAgent-0.7.0-win.zip` | 423.6 MB | `793055b6d0722b13a78d9ed0c60c6fdfd0435c5d7b828bc298ae8398889d386b` |

校验文件：`release/0.7.0/SHA256SUMS.txt`。

## 未完成 / 阻塞

1. 真实方舟付费验收：需要在应用内填写方舟 Key、开通 Seedream/Seedance，并由用户确认预算；没有实际账单结果前不得标记通过。
2. 真实 Pixiv 登录/检索/识图与 ComfyUI 冷启动、Anima 单图：仍需集中验收。
3. 固定入口替换与正式 Release：源码已推送 GitHub；安装包/Release 与固定入口仍未发布，需在验收完成、任务空闲并备份后执行。
4. FFmpeg 为 GPL-3.0 独立可执行文件；发行包已附许可与源码地址，正式发布前仍需确认分发合规。
5. 详细验收状态见 [ACCEPTANCE-0.7.0.md](ACCEPTANCE-0.7.0.md)。
