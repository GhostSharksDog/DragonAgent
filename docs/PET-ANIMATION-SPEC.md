# 桌宠动画素材规范（P0）

这份规范面向「给桌宠加一个新动作」：先用视频模型生成透明背景的 webm，再按本文的质检项验一遍，合格才放进 `assets/skins/<皮肤>/`。

配套命令：

```powershell
node scripts/pet-clip-check.mjs
```

它会用 Electron 真正解码每个 webm，输出尺寸、时长、透明通道覆盖率和首尾帧衔接情况，并按下面的门槛打分。

## 1. 硬指标

| 项目 | 要求 | 说明 |
|---|---|---|
| 画幅 | 640×360 | 与现有素材一致；皮肤 `skin.json` 的 `width/height` 要同步 |
| 时长 | 2–12 秒 | 循环动作 4–10 秒最稳；三段式（开始/循环/结束）每段 1–4 秒 |
| 帧率 | 24–30 fps | 低于 24 会顿，高于 30 徒增体积 |
| 编码 | VP9 + alpha（`yuva420p`） | 不要 H.264，它带不了透明通道 |
| 单文件体积 | ≤ 4 MB | 桌宠常驻内存，超过就明显掉帧 |
| 背景 | 全透明 | 不能是「近黑」或带底色，透明窗口会把它显示成灰块 |
| 主体占比 | 画面高度 50%–85% | 太小看不清，太大边缘被裁 |
| 脚底位置 | 距底边约 15% | 与 `skin.json` 的 `anchor` 对齐，否则会悬空/陷地 |
| 命名 | 小写 + 连字符，`a-z0-9-` | 例：`sleep-loop.webm`，和 `videos` 里的键名对应 |

## 2. 生成提示词模板

视频模型通常不懂「桌宠」，所以提示词要把**构图、背景、动作、镜头**全部写死，别留自由度。

### 正面提示词模板

```
{角色描述}, full body, single character, centered,
{动作描述}, looping motion, seamless start and end pose,
flat pure white background, no shadow, no ground, no props,
locked camera, no zoom, no pan, 640x360, 25fps
```

替换 `{角色描述}` 时锁死关键特征（发色、瞳色、服装、兽耳/龙角等），每次只改 `{动作描述}`，这样同一套素材才像同一个角色。

`{动作描述}` 的写法：**一个主动作 + 一个呼吸级微动**，例如：

- `idle`：`soft breathing, tail swaying slightly, blinking occasionally`
- `thinking`：`tilting head slightly, one hand on chin, thinking bubbles floating up`
- `speaking`：`talking with small hand gestures, mouth moving, cheerful expression`
- `success`：`jumping once with both fists raised, celebrating, landing back`
- `error`：`shoulders dropping, sighing, a sweat drop sliding down`
- `sleep-loop`：`lying curled up, slow breathing, eyes closed, tail curled around`

### 负面提示词

```
blurry, low resolution, multiple characters, cropped limbs,
camera movement, zoom, rotating camera, scene change, cut,
background scenery, floor shadow, text, watermark, logo,
nonseamless transition, flickering colors, extra fingers
```

生成后如果背景是白/黑底而不是透明，说明模型不支持 alpha：改用「纯色背景 + 抠像」流程，不要直接当透明素材用。

## 3. 质检项

跑 `node scripts/pet-clip-check.mjs` 会逐项给出结论，人工还要再过一遍这几条：

1. **透明通道有效**：主体不透明像素占比落在 8%–40% 属正常；低于 5% 说明主体太小或透明通道失效，高于 60% 通常是背景没抠干净。
2. **主体不贴边**：四边各留至少 8px 空白，避免缩放后被裁。
3. **循环无跳变**：`首尾帧差异` 越小越好，循环动作建议 < 8%；`loop: false` 的起止段不检查这一项。
4. **动作可读**：静音看一遍，能不能一眼说出「它在干什么」。
5. **风格统一**：和 `idle` 放在一起看不突兀（描边、饱和度、光影方向一致）。
6. **不抖**：主体包围盒中心在整段里的横向漂移应小于画面宽度的 5%。

## 4. 接入皮肤

1. 把 webm 放进 `assets/skins/<皮肤名>/`。
2. 在 `skin.json` 的 `videos` 里加一条映射：

```json
{
  "videos": {
    "thinking": { "file": "thinking.webm" },
    "walking-right": { "file": "walk-left.webm", "flipX": true },
    "success": { "file": "success.webm", "loop": false }
  }
}
```

- 键名必须是现有的 `Activity` 之一（`idle`、`walking`、`running`、`thinking`、`speaking`、`awaiting-input`、`awaiting-approval`、`success`、`error`）或 `walking-left/right`、`running-left/right`。
- `loop: false` 用于「放完就停在最后一帧」的动作（庆祝、出错、睡觉的起止段）。
- 左右对称的动作只需要一份素材，另一侧用 `flipX: true`。

3. 重新构建并重启后生效：`npm run build && npm start`。

## 5. 署名

外部素材必须写清来源和许可。当前 `blue-fish` 皮肤来自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，许可 CC BY-NC-SA 4.0，禁止商用。新增素材请同步更新该皮肤目录下的 `ATTRIBUTION.md`。

## 6. P2 动作过渡

- 切换动作时保留上一帧快照，与新动作交叉淡化 220ms，避免姿势硬跳。
- 一次性动作（清单里 `loop: false`，如 `success`、`error`、`click`）播放一遍后自动回到 `idle`，不会停在末帧。
- 淡化结束后暂停旧解码器，避免后台空转。
- `sleep-start` / `sleep-end` 不走一次性回退，由睡觉状态机接力。

## 7. P3 即时反馈

- 单击：播 `click`，同时照常弹出回复气泡；播完自动回 `idle`。
- 拖动：按住移动时播 `drag` 循环，松手立刻撤销。
- 交互反馈优先级高于任务状态（thinking / speaking 等），用户主动操作时先给回应。

## 8. P4 视线跟随

- 主进程每 250ms 读一次光标位置：相对桌宠中心偏左或偏右超过 48px 时，向渲染进程发 `pet:gaze`（`left` / `right` / `center`）。
- 渲染端只在 `idle` 时对视频做水平镜像，让鱼朝鼠标方向看；行走方向仍由 `direction` 决定，两者取异或，不会双重翻转。
- 方向没变不发消息，窗口隐藏时停止轮询，避免无谓的 IPC 和光标查询。

