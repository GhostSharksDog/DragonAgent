# 创作工坊 · 本地 2D 桌宠

DragonAgent 0.4.0 的「创作工坊」提供第一个内置工作流：创作对话与参数 → 角色 LoRA → 确定立绘 → 连贯动作生成 → 透明抠图 → 循环与位置整理 → 预览、导出、应用。应用使用 TypeScript，通过本机 API 调度独立安装的 ComfyUI。ComfyUI 自身使用其 Python 环境；无需为 DragonAgent 编写 Python 脚本。

只有立绘、视频和 AI 抠图需要 ComfyUI。聊天、提示词整理、项目记录、LoRA 管理、已有素材预览、本地整理与导出、皮肤切换无需服务在线。模型、节点检测按实际制作阶段执行。

## 首次准备

1. 从 [ComfyUI 官方 Windows 指南](https://docs.comfy.org/installation/desktop/windows)安装并启动本地 ComfyUI。选择 NVIDIA GPU，使用原生模型卸载；不要开启强制所有模型常驻显存。服务地址在 ComfyUI 启动日志中查看，常用地址为 `http://127.0.0.1:8188`，桌面版可能使用其他端口。
2. 准备以下模型。文件名有子目录或不同名称时，在工坊「模型位置与名称」中填写节点菜单里的完整名称。

| 功能 | 默认文件 / 选项 | ComfyUI 位置 | 官方 / 作者来源 |
|---|---|---|---|
| Anima 立绘（新项目默认） | `anima-base-v1.0.safetensors` | `models/diffusion_models` | [Anima](https://huggingface.co/circlestone-labs/Anima) |
| Anima 编码器 | `qwen_3_06b_base.safetensors` | `models/text_encoders` | 使用与 Anima 兼容的本地文件 |
| Anima VAE | `qwen_image_vae.safetensors` | `models/vae` | 使用与 Anima 兼容的本地文件 |
| Animagine 立绘（可选） | `animagineXL40_v4Opt.safetensors` | `models/checkpoints` | [Cagliostro Labs](https://huggingface.co/cagliostrolab/animagine-xl-4.0/tree/main) |
| 视频生成 | `wan2.2_ti2v_5B_fp16.safetensors` | `models/diffusion_models` | [ComfyOrg Wan 2.2](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files/diffusion_models) |
| 文字编码 | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders` | [ComfyOrg Wan 2.2](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files/text_encoders) |
| 视频解码 | `wan2.2_vae.safetensors` | `models/vae` | [ComfyOrg Wan 2.2](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files/vae) |
| 卡通抠图 | `BiRefNet_toonout` | 由 ComfyUI-RMBG 管理 | [1038lab / BiRefNet](https://huggingface.co/1038lab/BiRefNet/tree/main) |

3. 使用 ComfyUI 节点管理器安装 [1038lab/ComfyUI-RMBG](https://github.com/1038lab/ComfyUI-RMBG)，按作者说明安装其依赖并重启 ComfyUI。必须能找到 `BiRefNetRMBG` 节点以及 `BiRefNet_toonout` 选项。权重未缓存时，节点会在首次运行下载；离线使用需事先准备权重。
4. 在 DragonAgent → 创作工坊 → 准备本地引擎中填写地址，点击「保存并检测」。检测核对服务、节点接口与模型选项；只有真实生成才能验证权重是否可加载。上传立绘可以跳过角色绘图模型，但其余视频和抠图依赖仍需准备。

模型和节点各自的许可见链接中的模型卡和 LICENSE。DragonAgent 不分发这些权重，也不复制第三方 Python 节点源码。

## 本机配置与制作方式

目标机器是 RTX 4060 Laptop 8GB 显存、16GB 系统内存。Wan 2.2 5B 的 [ComfyUI 官方示例](https://docs.comfy.org/tutorials/video/wan/wan2_2)说明可通过卸载适配 8GB 显存，实际耗时仍取决于可用内存和其他 GPU 程序。

- Anima 立绘：1024×1024、30 步、CFG 4、dpmpp_2m_sde_gpu、normal。正负面提示词独立编码，LoRA 通过加载节点生效；文本里的 `<lora:…>` 不会加载文件。
- Animagine 立绘：1024×1024、batch 1、Euler a、28 步、CFG 5、分块 VAE 解码。可选择其他兼容 SDXL 的 checkpoint，不能把 FLUX 等其他架构文件直接替换到这个模板中。旧项目保留自己的模型与采样设置。
- 动作生成：Wan 2.2 **TI2V 5B**、512×512、49 帧、24fps、30 步、CFG 5、uni_pc、simple、sampling shift 8、分块 VAE 解码。不是 14B I2V 或 Wan Animate。
- 抠图：BiRefNet ToonOut，最多 8 帧一批，Alpha 背景，保留原色，不灰度化、不做逐帧独立缩放。
- 同时只制作一个项目。各动作依次执行；检测出质量问题时每项最多自动重试两次。显存不足会报错并保留素材，不静默切换云端或偷偷降低参数。

## 创作步骤

上传完整全身立绘，或填写中文描述、选用已有 Dragon 文字模型整理英文绘图提示词，再生成立绘。文字整理仅发送文字，不发送角色图片；也可以直接手填绘图提示词。确认角色后制作动作包。

每个项目有独立创作对话。助手与面板共同修改正负面提示词、角色设定和动作描述，保留修订并可撤销；制作期间的修改进入下一次草稿。停止助手与停止制作分别控制。

角色 LoRA 可搜索 Civitai、粘贴模型链接或导入本地 SafeTensors。Anima 和 Animagine／SDXL 分别校验，用户选择后才下载。需要认证时在准备环境中保存 Civitai 密钥；下载完成且 SHA256 与格式校验通过后才启用。

选定 LoRA 后优先参考作者触发词和对应服装说明。面板可逐组加入触发词、复制并查看来源，最终正负面提示词完整可见。明确的单值作者权重优先使用；无推荐值时才默认 0.8，可手动修改。多个服装方案不要全部堆入一张图。触发词能帮助保持角色特征，但不能保证瞳色、服装或肢体完全一致，仍需确认立绘。

动作包括待机、左右走路、左右跑动、思考、说话、等待输入、等待审批、成功、失败。每项动作保留种子、提示词、模型、原始帧、抠图帧、整理结果和检查报告。用户可重做单项、切换候选版本及并排比较。

自动检查覆盖空帧、边角透明度、边界裁切、位置突变、轮廓面积突变和循环首尾差异。这些是数值检查，**不能证明人物身份、肢体或走路姿态正确**。请在浅色、深色与透明预览上亲自查看。空帧或不透明边角不能通过人工确认绕过；其他提示可在用户核对后接受。

全部 11 项动作确认后可以导出 ZIP 或应用到桌面。ZIP 根目录包含 `skin.json`、`provenance.json`，`actions` 内含透明 PNG 帧和图集。运行时使用 272×272 逻辑画布，默认落脚锚点为 `(136,264)`；保留生成的 PNG 原色与透明通道。非循环动作播放到末帧，应用活动改变时继续切换动作。

## 中断、恢复和数据

- 每次提交前持久化本地操作编号，收到响应后保存 ComfyUI `prompt_id`。重启后项目暂停，用户继续时先查询原任务或通过操作标记寻找提交结果。
- 断线、超时、服务重启导致找不到任务时，标记「结果未知」，不自动重复生成。先核对 ComfyUI 队列和历史，再选择「我已核实，允许重新提交」。
- 停止本项目会删除它自己的待执行队列项。兼容的服务仅提供全局中断接口时，不调用全局 `/interrupt`；当前运行阶段收尾后停止后续步骤。不会清空 ComfyUI 队列或历史。
- 应用退出不关闭独立运行的 ComfyUI。其正在执行的任务可能继续完成，重启后可按任务编号获取结果。
- 工坊记录保存在应用数据目录下 `workshop/workshop.db`，项目素材在 `workshop/projects`，已发布桌宠在 `workshop/skins`。与聊天数据库、密钥及原版龙娘资源独立。
- 删除项目会删除它的原始素材和候选版本，但不删除已复制到桌宠库的成品。原版银白龙娘可随时恢复；所选皮肤损坏时自动回退。

## 扩展边界

当前是版本化、内置的制作模板，不接受任意节点 JSON，也不提供通用节点编辑器。未来可加入其他工作流模板及更强的动作控制模型，无需改变独立 Agent 核心的公开接口。

本地接口模拟验收与真实 ComfyUI 生成验收分别记录。缺少实际环境或模型时，不能以模拟结果宣称真实动画生成通过。
