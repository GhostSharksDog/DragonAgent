import type { SkinData, QuotaSnapshot } from '../pet/shared/types';

export const CONTEXT_LIMIT = 524_288;
export type BackendKind = 'dragon' | 'codex';
export type PermissionMode = 'ask' | 'auto' | 'full';
export interface CodexModel { id: string; model: string; name: string; description: string; isDefault: boolean; defaultEffort: string; efforts: { value: string; description: string }[] }
export interface CodexCatalog { status: 'idle' | 'loading' | 'ready' | 'error'; models: CodexModel[]; error?: string }
export interface ChatAttachment { id: string; kind: 'file' | 'chat'; name: string; size: number; mime: string; sourceSessionId?: string; createdAt: number; extractionError?: string }
export type RunStatus = 'idle' | 'running' | 'waiting' | 'stopping' | 'completed' | 'cancelled' | 'error' | 'interrupted' | 'paused';
export interface AgentTask { id: string; parentId?: string; runId: string; title: string; profileId: string; status: import('../../packages/agent-core/src/types').AgentStatus; result?: string; error?: string; requests: number; usage: { input: number; output: number } }
export interface ModelProfile {
  id: string; name: string; provider: string; protocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  baseUrl: string; model: string; contextWindow: number; maxOutput: number; hasKey: boolean; deepseekSearch?: boolean;
}
export interface McpConfig {
  id: string; name: string; enabled: boolean; transport: 'stdio' | 'streamable-http';
  command?: string; args?: string[]; url?: string; hasKey: boolean;
}
export interface McpStatus { id: string; state: 'disabled' | 'connecting' | 'connected' | 'error'; tools: number; error?: string }
export interface AppSettings {
  selectedBackend?: BackendKind;
  selectedCodexModel?: string; selectedCodexEffort?: string;
  limits: { concurrency: number; children: number; requests: number };
  profiles: ModelProfile[]; selectedProfile: string; mcp: McpConfig[]; codexPath: string;
  pet: { visible: boolean; scale: number; alwaysOnTop: boolean; x?: number; y?: number; shortcut: string };
  theme: 'light' | 'dark' | 'system';
}
export interface ChatMessage { id: string; commandId?: string; role: 'user' | 'assistant' | 'notice'; text: string; createdAt: number; runId?: string; partial?: boolean; attachments?: ChatAttachment[] }
export interface ToolEvent { id: string; name: string; arguments: string; result?: string; status: 'running' | 'completed' | 'error' | 'cancelled' | 'unknown'; createdAt: number; runId: string; agentId?: string }
export interface PendingRequest {
  id: string; kind: 'approval' | 'question'; title: string; details: string;
  questions?: { id: string; question: string; options?: string[] }[];
  sessionId: string; runId: string;
}
export interface AgentSession {
  reasoningEffort?: string;
  permissionMode?: PermissionMode; draftAttachments?: ChatAttachment[];
  tasks?: AgentTask[]; readOnly?: boolean; sourceEngine?: string;
  id: string; title: string; backend: BackendKind; nativeId?: string; workspace: string;
  profileId: string; model?: string; draft: string; createdAt: number; updatedAt: number;
  status: RunStatus; runId?: string; error?: string; archived?: boolean;
  messages: ChatMessage[]; tools: ToolEvent[]; pending: PendingRequest[];
  origins: string[]; browserInput: boolean; terminalEnabled: boolean;
  usage?: { input: number; output: number; context?: number; estimated?: boolean; window?: number };
}
export interface MemoryFact { id: string; text: string; tags: string[]; createdAt: number; source?: string }
export interface BackendState { state: 'stopped' | 'starting' | 'ready' | 'error'; message: string }
export interface Snapshot {
  codexCatalog: CodexCatalog;
  resolvedTheme: 'light' | 'dark';
  workbenchPage?: 'chat' | 'settings';
  workbenchPageRevision?: number;
  revision: number; settings: AppSettings; sessions: AgentSession[]; selectedSessionId: string | null;
  memory: MemoryFact[]; backends: { dragon: BackendState; codex: BackendState };
  mcp: McpStatus[]; quota: QuotaSnapshot; account: string; skin: SkinData | null;
  petView: 'hidden' | 'compose' | 'reply' | 'quota'; animationStartedAt: number; version: string;
}
export interface BackendHooks {
  text(text: string, replace?: boolean): void;
  tool(event: Partial<ToolEvent> & { id: string; name: string }): void;
  request(request: Omit<PendingRequest, 'sessionId' | 'runId'>, signal: AbortSignal): Promise<unknown>;
  usage(usage: NonNullable<AgentSession['usage']>): void;
  notice(text: string): void;
  nativeId(id: string): void;
}
export interface AgentBackend {
  run(session: AgentSession, prompt: string, hooks: BackendHooks, signal: AbortSignal): Promise<void>;
  cancel(session: AgentSession): Promise<void>;
  dispose(): Promise<void>;
}
export type Action =
  | { type: 'codex.models' }
  | { type: 'session.codexModel'; id: string; model: string; effort?: string }
  | { type: 'session.model'; id: string; profileId: string }
  | { type: 'session.permissionMode'; id: string; mode: PermissionMode }
  | { type: 'session.attachFiles'; id: string }
  | { type: 'session.attachChat'; id: string; sourceId: string }
  | { type: 'session.removeAttachment'; id: string; attachmentId: string }
  | { type: 'session.create'; backend: BackendKind; profileId?: string; workspace?: string; carryFrom?: string; model?: string; reasoningEffort?: string }
  | { type: 'session.select'; id: string }
  | { type: 'session.archive'; id: string }
  | { type: 'session.draft'; id: string; text: string }
  | { type: 'session.workspace'; id: string }
  | { type: 'session.permissions'; id: string; origins: string[]; browserInput: boolean; terminalEnabled: boolean }
  | { type: 'session.send'; id: string; text: string; commandId: string }
  | { type: 'session.stop'; id: string }
  | { type: 'agent.stop'; id: string; agentId: string }
  | { type: 'session.compact'; id: string }
  | { type: 'request.answer'; sessionId: string; id: string; value: unknown }
  | { type: 'profile.save'; profile: ModelProfile; apiKey?: string }
  | { type: 'profile.delete'; id: string }
  | { type: 'mcp.save'; server: McpConfig; apiKey?: string }
  | { type: 'mcp.delete'; id: string }
  | { type: 'mcp.connect' }
  | { type: 'memory.save'; id?: string; text: string; tags: string[] }
  | { type: 'memory.delete'; id: string }
  | { type: 'legacy.import' }
  | { type: 'settings.save'; theme?: AppSettings['theme']; codexPath?: string; pet?: Partial<AppSettings['pet']>; limits?: AppSettings['limits'] }
  | { type: 'pet.toggle' }
  | { type: 'pet.view'; view: Snapshot['petView'] }
  | { type: 'pet.drag'; dx: number; dy: number }
  | { type: 'window.workbench'; page?: 'chat' | 'settings' }
  | { type: 'window.menu' }
  | { type: 'quota.refresh' }
  | { type: 'codex.login' }
  | { type: 'external.open'; url: string };
export interface DragonBridge { snapshot(): Promise<Snapshot>; action(action: Action): Promise<unknown>; subscribe(listener: (state: Snapshot) => void): () => void }
declare global { interface Window { dragon: DragonBridge } }

export function contextPolicy(profile: Pick<ModelProfile, 'contextWindow' | 'maxOutput'>) {
  if (!Number.isSafeInteger(profile.contextWindow) || profile.contextWindow < 4096) throw new Error('模型上下文窗口需要是至少 4096 的整数。');
  if (!Number.isSafeInteger(profile.maxOutput) || profile.maxOutput < 1) throw new Error('最大输出需要是正整数。');
  const window = Math.min(CONTEXT_LIMIT, profile.contextWindow);
  const output = Math.max(1, Math.min(32768, profile.maxOutput, Math.floor(window / 8)));
  const headroom = Math.min(65536, Math.floor(window / 8));
  return { window, output, headroom, threshold: Math.floor(Math.min(window * .8, window - output - headroom)), retainRatio: .16 };
}
export function isBusy(session: AgentSession) { return ['running', 'waiting', 'stopping'].includes(session.status); }
