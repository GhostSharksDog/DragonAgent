export type Protocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export interface ModelProfile { id: string; model: string; protocol: Protocol; baseUrl: string; contextWindow: number; maxOutput: number }
export interface ToolCall { id: string; name: string; arguments: string }
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'; text: string; calls?: ToolCall[];
  callId?: string; name?: string; isError?: boolean; images?: string[];
  replay?: { profileId: string; configuration?: string; value: unknown };
}
export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
export interface Usage { input: number; output: number; context?: number; window?: number; estimated?: boolean }
export interface ModelRequest { profile: ModelProfile; key?: string; messages: Message[]; tools: ToolSchema[]; maxOutput: number; signal: AbortSignal; onText(text: string): void }
export interface ModelResponse { message: Message; usage: Usage; finish: 'stop' | 'tools' | 'length' }
export interface ModelAdapter { generate(request: ModelRequest): Promise<ModelResponse>; countTokens?(request: Omit<ModelRequest, 'signal' | 'onText' | 'key'>): Promise<number> }
export interface Grant { folders: string[]; origins: string[]; browserInput: boolean; terminal: boolean; approvalMode?: 'ask' | 'auto' | 'full'; allFolders?: boolean; allOrigins?: boolean }
export interface Limits { concurrency: number; children: number; requests: number }
export const DEFAULT_LIMITS: Limits = { concurrency: 3, children: 12, requests: 64 };
export type AgentStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'cancelled' | 'error' | 'paused' | 'interrupted';
export interface AgentRecord {
  id: string; sessionId: string; runId: string; rootId: string; parentId?: string; title: string; profileId: string;
  grant: Grant; messages: Message[]; status: AgentStatus; result?: string; error?: string;
  usage: Usage; requests: number; createdAt: number; updatedAt: number;
}
export type AgentEvent = { seq?: number; agentId: string; sessionId: string; runId: string; time: number } & (
  | { type: 'agent'; agent: AgentRecord }
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'tool.started'; call: ToolCall }
  | { type: 'tool.finished'; callId: string; result: ToolResult }
  | { type: 'approval.requested'; id: string; title: string; details: string }
  | { type: 'approval.resolved'; id: string; allowed: boolean }
  | { type: 'notice'; text: string }
  | { type: 'compacted'; before: number; after: number }
);
export interface SessionStore {
  getAgent(id: string): Promise<AgentRecord | undefined>; putAgent(agent: AgentRecord): Promise<void>;
  listAgents(sessionId: string): Promise<AgentRecord[]>; append(event: AgentEvent): Promise<void>;
  history(sessionId: string): Promise<AgentEvent[]>;
  putAttachment(sessionId: string, content: string): Promise<string>;
  readAttachment(sessionId: string, id: string, offset: number, limit: number): Promise<string>;
}
export interface ToolResult { text: string; isError?: boolean; images?: string[] }
export interface ToolContext {
  agent: AgentRecord; signal: AbortSignal;
  approve(title: string, details: string): Promise<boolean>;
  question(questions: { id: string; question: string; options?: string[] }[]): Promise<Record<string, string>>;
}
export interface ToolDefinition extends ToolSchema {
  effect: 'read' | 'write' | 'unknown' | 'control';
  approval?: 'managed';
  authorize?(args: Record<string, unknown>, context: ToolContext): Promise<boolean> | boolean;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
export interface RuntimeOptions {
  profiles(): ModelProfile[]; key(profileId: string): Promise<string | undefined>;
  adapter: ModelAdapter; store: SessionStore; tools: import('./tools.js').ToolRegistry;
  event?(event: AgentEvent): void;
  approve(agent: AgentRecord, request: { id: string; title: string; details: string }, signal: AbortSignal): Promise<boolean>;
  question(agent: AgentRecord, questions: { id: string; question: string; options?: string[] }[], signal: AbortSignal): Promise<Record<string, string>>;
  limits?: Limits;
}
export class BudgetExceeded extends Error { constructor(message = '任务树已达到模型请求预算，请确认后继续。') { super(message); this.name = 'BudgetExceeded'; } }
