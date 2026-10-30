# @dragon-agent/core

独立 TypeScript Agent 框架；不导入 Electron / React，不依赖 DSH。需要 Node 24+。主仓库 `pnpm build` 生成 ESM 和声明文件，`npm pack ./packages/agent-core` 生成可供其他项目安装的包。

```ts
import { AgentRuntime, HttpModelAdapter, MemorySessionStore, ToolRegistry } from '@dragon-agent/core';
import { SqliteSessionStore } from '@dragon-agent/core/sqlite';

const tools = new ToolRegistry();
tools.register({
  name: 'add', description: 'Add two numbers.', effect: 'read',
  parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  execute: async ({ a, b }) => ({ text: String(Number(a) + Number(b)) }),
});
const runtime = new AgentRuntime({
  profiles: () => [{ id: 'default', model: 'your-model', protocol: 'openai-completions', baseUrl: 'https://your-provider/v1', contextWindow: 65536, maxOutput: 4096 }],
  key: async () => process.env.MODEL_API_KEY,
  adapter: new HttpModelAdapter(), tools, store: new MemorySessionStore(),
  approve: async () => false,
  question: async () => ({}),
  event: event => { if (event.type === 'text') process.stdout.write(event.text); },
});
try {
  await runtime.run({ sessionId: 'example', profileId: 'default', prompt: 'Use add to calculate 2 + 3.', grant: { folders: [], origins: [], browserInput: false, terminal: false } });
} finally { await runtime.dispose(); }
```

`examples/node.mjs` 在普通 Node 中启动本地 HTTP 模型模拟器，验证两轮对话、连续两次工具调用；加 `--live` 使用显式提供的 `DRAGON_BASE_URL`、`DRAGON_MODEL`、`DRAGON_PROTOCOL`、`DRAGON_API_KEY` 和可选 `DRAGON_CONTEXT`。

接口边界：

- `ModelAdapter.generate`：协议归一化、流式文本、工具参数、用量与结束原因。`countTokens` 可选；没有精确计数时对系统提示、历史、工具和附件用保守估算并预留空间。HTTP 适配器保留 Responses 原生输出与加密推理、Anthropic 签名 thinking、Chat `reasoning_content`，只向同一配置回传。
- `ToolRegistry`：JSON Schema 校验、可选 `authorize` 授权回调、审批、执行和共享效果队列。`write/unknown` 默认须批准；`approval: 'managed'` 仅用于已经负责细粒度审批的可信宿主实现。实现者必须在工具中核对目标范围，并在副作用前检查取消信号。
- `AgentRuntime`：独立会话循环、重试预算、摘要、审批事件、子 Agent 管理。`cancel(sessionId, agentId?)` 可停止整树或一个子任务。`approveTool` 供宿主把内部审批请求送回同一个持久化审批通道。
- `SessionStore`：内存实现与 SQLite 实现。SQLite 恢复只标记中断，不自动继续；缺失结果会以“结果未知”补齐。大结果和压缩前原文保存为附件，`attachment_read` 分页读取。
- `McpManager`：官方协议 SDK 的 stdio/Streamable HTTP 客户端，发现、校验、审批、超时、重连由框架管理。失败后只在下一次明确调用时重连，不重发失败操作。

默认每棵任务树允许 3 个并行子任务、12 个总子任务、64 次模型请求（包括摘要和重试）；子 Agent 不能递归派生或扩大父任务授权。暂停后再次 `run` 才会继续，缩小后的授权会重新核对。自定义命令和 MCP 服务本身按宿主账号权限运行；框架的范围限制和审批不是操作系统容器。

原始历史在当前 Agent 记录及压缩附件中保留；生命周期事件的 `agent.messages` 为空，避免每次状态更新复制巨大上下文。完整消息通过 `SessionStore.getAgent` 获取。
