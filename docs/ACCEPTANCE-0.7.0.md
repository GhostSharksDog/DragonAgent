# DragonAgent 0.7.0 验收报告（候选，未交付）

日期：2026-11-06
结论：**离线、集成、模拟方舟与打包验收通过；真实方舟付费验收和真实站点验收未完成，0.7.0 不宣布交付。**

## 验收矩阵

| 项目 | 证据 | 状态 |
|---|---|---|
| 类型检查 | `npm run typecheck` | 通过 |
| 构建 | `npm run build`（主包体积警告仍存在） | 通过 |
| 单元/集成 | `npm test`：66 通过、0 失败 | 通过 |
| 计划模式 | `npm run test:planning`：进入、工具过滤、提交、确认、执行、幂等、过期/待决拦截 | 通过 |
| 云端桌宠（模拟） | `tests/studio-flow070.test.ts`：立绘→确认→视频→抠像→检查→确认→发布；未知提交核对；取消恢复；预算；幂等 | 通过 |
| 媒体链路 | `npm run test:media`：真实 FFmpeg 蓝幕视频→272×272 透明 WebM，alpha/帧数/质量 | 通过 |
| 桌宠库 | `tests/library070.test.ts`：zip-slip、重复路径、缺失清单、包装目录、导出重导入 | 通过 |
| 外观/输入 | `npm run test:workbench`、`test:composer`、`test:context-bar`、`test:appearance` | 通过 |
| 界面回归 | `npm run test:ui`（工作台、桌宠/气泡、审批、MCP、无渲染错误） | 通过 |
| 队列/并发 | `npm run test:queue` | 通过 |
| 打包 | `npm run package`：Setup 312.9 MB、ZIP 423.6 MB | 通过 |
| 打包冒烟 | 独立数据目录启动、视频皮肤、桌宠窗口、ZIP 导入、库内缩略图（含发行包 FFmpeg） | 通过 |
| 发行内容抽查 | fflate、ffmpeg/ffprobe+manifest、Codex、内置桌宠、FFmpeg 许可；无数据库/密钥 | 通过 |
| 发行完整性 | `node scripts/release-check.mjs`：6783 个文件、违禁 0、主进程编译一致、图标尺寸、3 个产物 | 通过 |
| 真实方舟立绘/视频 | 需要应用内 Key、已开通模型和用户确认预算 | **未执行** |
| 真实 ComfyUI 冷启动 + Animagine 单图 | `scripts/comfy-live-check.mjs`：本机安装检测、冷启动、768×1024 真实生成（102 秒），输出 PNG | 通过 |
| 插画页布局 | `npm run test:illustration-layout`：24 组窗口/主题/缩放，无横向溢出 | 通过 |
| 原生标题栏 | `node scripts/window-chrome-check.mjs`：原生命中、双击最大化消息、亮/暗标题像素；物理拖拽因 Windows 前台限制未验证 | 通过（拖拽待补） |
| 真实 Pixiv/识图 | 需要 Pixiv 登录后集中验收 | **未执行** |
| 固定入口替换 | `release\win-unpacked` 未替换（等待验收通过、空闲、备份） | **未执行** |
| GitHub 源码推送 | `main` 已推送（本报告所在提交） | 完成 |

## 候选产物

- `release/0.7.0/DragonAgent-Setup-0.7.0.exe`：`8eaa1a10128c01fa83d49c6b75bb02084f6d30426c6cd49b7d6fa4b513be348d`
- `release/0.7.0/DragonAgent-0.7.0-win.zip`：`34575f77b398d1a12d8931f877d1a476704eebfc369a68830a823e34447f05ad`
- `release/0.7.0/dragon-agent-core-0.4.0.tgz`：`e7c1425db943d5a7315798ceebd654b7a1d5ab42c4fd93ab6ceda531fe3215ab`
- 校验文件：`release/0.7.0/SHA256SUMS.txt`

## 已知限制

- 安装包未签名，Windows SmartScreen 可能提示；正式分发前需要签名决策。
- FFmpeg 为 GPL-3.0 独立可执行文件，发行包附许可/源码/构建说明；正式发布前仍需确认分发合规。
- 主渲染包超过 500 KB（Vite 警告），不影响功能。
- 外观密度只影响部分控件；真实方舟比例/边缘效果需要人工目检。
- 未知提交“确认未受理”会释放预留，可能低于实际账单；以方舟控制台为准，报告不替代账单核对。

## 完成交付前必须完成

1. 在应用内配置方舟 Key、Seedream/Seedance 模型与价格，用户确认预算。
2. 真实立绘 + 至少一个动作视频 + 下载/抠像/预览/导出/应用闭环，记录实际账单与异常。
3. 真实 Pixiv 登录与识别验收（按用户环境）。
4. 全部通过后更新本报告与版本说明，重新打包并推送最终提交。
5. 确认任务空闲、备份用户数据与旧目录后，替换 `release\win-unpacked`。
