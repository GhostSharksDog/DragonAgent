import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import type { ToolContext, ToolDefinition, ToolResult, ToolSchema } from './types.js';
import { BudgetExceeded } from './types.js';
/** One shared gate for effects whose conflicts cannot be proven disjoint. Reads may overlap. */
export class ExecutionGate {
  private tail: Promise<unknown> = Promise.resolve();
  execute<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => { signal.throwIfAborted(); return task(); });
    this.tail = run.catch(() => undefined);
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      run.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
}
export class ToolRegistry {
  private tools = new Map<string, { definition: ToolDefinition; validate: ValidateFunction }>();
  private ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  readonly gate = new ExecutionGate();
  register(definition: ToolDefinition) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(definition.name)) throw new Error('无效工具名称。');
    if (this.tools.has(definition.name)) throw new Error(`工具重复注册：${definition.name}`);
    this.tools.set(definition.name, { definition, validate: this.ajv.compile(definition.parameters) });
    return () => { if (this.tools.get(definition.name)?.definition === definition) this.tools.delete(definition.name); };
  }
  schemas(): ToolSchema[] { return [...this.tools.values()].map(({ definition: d }) => ({ name: d.name, description: d.description, parameters: d.parameters })); }
  async call(name: string, args: unknown, context: ToolContext): Promise<ToolResult> {
    context.signal.throwIfAborted(); const item = this.tools.get(name);
    if (!item) return { isError: true, text: `工具不存在：${name}` };
    if (!item.validate(args)) return { isError: true, text: `工具参数无效：${this.ajv.errorsText(item.validate.errors)}` };
    const execute = async () => {
      context.signal.throwIfAborted();
      if (item.definition.authorize && !await item.definition.authorize(args as Record<string, unknown>, context)) return { isError: true, text: '此工具不在当前 Agent 的授权范围内。' };
      if (item.definition.effect === 'read' && context.agent.grant?.approvalMode === 'ask' && !await context.approve(name, JSON.stringify(args, null, 2))) return { isError: true, text: '用户拒绝了本次读取。' };
      if (['write', 'unknown'].includes(item.definition.effect) && item.definition.approval !== 'managed' && !await context.approve(name, JSON.stringify(args, null, 2))) return { isError: true, text: '用户拒绝了本次操作。' };
      context.signal.throwIfAborted();
      const result = await item.definition.execute(args as Record<string, unknown>, context);
      if (!result || typeof result.text !== 'string') throw new Error('工具返回格式无效。');
      return result;
    };
    try { return await (['write', 'unknown'].includes(item.definition.effect) ? this.gate.execute(context.signal, execute) : execute()); }
    catch (error) { if (context.signal.aborted || error instanceof BudgetExceeded) throw error; return { isError: true, text: (error as Error).message }; }
  }
}
