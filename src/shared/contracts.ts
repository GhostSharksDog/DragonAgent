import type { SkinData, QuotaSnapshot } from '../pet/shared/types';
import type { WorkshopAction, WorkshopSnapshot } from './workshop';
import type { CompactBubbleLayout } from './compact-bubble';

export const CONTEXT_LIMIT = 524_288;
export type BackendKind = 'dragon' | 'codex';
export type PermissionMode = 'ask' | 'auto' | 'full';
export interface CodexModel { id: string; model: string; name: string; description: string; isDefault: boolean; defaultEffort: string; efforts: { value: string; description: string }[] }
export interface CodexCatalog { status: 'idle' | 'loading' | 'ready' | 'error'; models: CodexModel[]; error?: string }
export interface ChatAttachment { id: string; kind: 'file' | 'chat'; name: string; size: number; mime: string; sourceSessionId?: string; createdAt: number; extractionError?: string }
export interface DroppedFile { path?: string; name: string; mime?: string; data?: Uint8Array }
export type RunStatus = 'idle' | 'running' | 'waiting' | 'stopping' | 'completed' | 'cancelled' | 'error' | 'interrupted' | 'paused';
export interface AgentTask {
  id: string;
  parentId?: string;
  runId: string;
  title: string;
  goal?: string;
  steps?: import('../../packages/agent-core/src/types').TaskStep[];
  profileId: string;
  status: import('../../packages/agent-core/src/types').AgentStatus;
  result?: string;
  error?: string;
  requests: number;
  usage: import('../../packages/agent-core/src/types').Usage;
}
export interface ModelProfile {
  pricing?:import('./token-pricing').TokenPricing;
  id: string; name: string; provider: string; protocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  baseUrl: string; model: string; contextWindow: number; maxOutput: number; hasKey: boolean; deepseekSearch?: boolean;
}
export interface McpConfig {
  id: string; name: string; enabled: boolean; transport: 'stdio' | 'streamable-http';
  command?: string; args?: string[]; url?: string; hasKey: boolean;
}
export interface McpStatus { id: string; state: 'disabled' | 'connecting' | 'connected' | 'error'; tools: number; error?: string }
export interface AppSettings {
  appearance?:import('./appearance').AppearanceSettings;
  layout?: { leftCollapsed: boolean; rightCollapsed: boolean };
  assistant?: import('./persona').AssistantPreferences;
  selectedBackend?: BackendKind;
  selectedCodexModel?: string; selectedCodexEffort?: string;
  limits: { concurrency: number; children: number; requests: number | null };
  profiles: ModelProfile[]; selectedProfile: string; mcp: McpConfig[]; codexPath: string;
  pet: { visible: boolean; scale: number; alwaysOnTop: boolean; x?: number; y?: number; shortcut: string; chatMode?: 'simple' | 'detailed' };
  theme: 'light' | 'dark' | 'system';
  accent: 'violet' | 'teal' | 'amber' | 'ink';
  wallpaper?: { file: string; name: string; opacity: number; blur: number; dim: number } | null;
}
export interface ChatMessage { sequence?: number; id: string; commandId?: string; role: 'user' | 'assistant' | 'notice'; text: string; createdAt: number; runId?: string; partial?: boolean; attachments?: ChatAttachment[]; contextCheckpoint?: string; beforeNativeTurnId?: string; beforeNativeId?: string }
export interface ConversationVersion { mode?:AgentSession['mode'];plans?:AgentSession['plans']; collaborationState?: AgentSession['collaborationState']; collaborationHistory?:AgentSession['collaborationHistory']; id: string; label: string; createdAt: number; messages: ChatMessage[]; tools: ToolEvent[]; tasks?: AgentTask[]; nativeId?: string; nativeTurnId?: string; checkpoint: string; status: RunStatus; error?: string; usage?: AgentSession['usage'] }
export interface ToolEvent { sequence?: number; id: string; name: string; arguments: string; result?: string; status: 'queued' | 'approval' | 'running' | 'completed' | 'declined' | 'error' | 'cancelled' | 'unknown'; createdAt: number; startedAt?: number; completedAt?: number; cwd?: string; exitCode?: number | null; runId: string; agentId?: string }
export interface PendingRequest {
  source?: {agentId:string;title:string};
  operation?: {name:string;arguments:string};
  toolId?: string;
  id: string; kind: 'approval' | 'question'; title: string; details: string;
  questions?: { id: string; question: string; options?: string[] }[];
  sessionId: string; runId: string;
}
export interface AgentSession {
  mode?:'execute'|'plan'; planArmed?:boolean; handoff?:string; plans?:import('./planning').PlanVersion[];
  queuedMessages?: {commandId:string;text:string;attachments?:ChatAttachment[];paused:boolean}[];
  attempts?: (import('../../packages/agent-core/src/types').RequestAttempt & {runId:string;agentId:string})[];
  collaboration?: import('./collaboration').CollaborationConfig;
  collaborationState?: import('./collaboration').CollaborationState;
  collaborationHistory?: import('./collaboration').CollaborationState[];
  artifacts?: FileArtifact[];
  versions?: ConversationVersion[];
  versionId?: string;
  nativeTurnId?: string;
  reasoningEffort?: string;
  permissionMode?: PermissionMode; draftAttachments?: ChatAttachment[];
  tasks?: AgentTask[]; readOnly?: boolean; sourceEngine?: string;
  id: string; title: string; backend: BackendKind; nativeId?: string; workspace: string;
  profileId: string; model?: string; draft: string; createdAt: number; updatedAt: number;
  status: RunStatus; runId?: string; error?: string; archived?: boolean;
  messages: ChatMessage[]; tools: ToolEvent[]; pending: PendingRequest[];
  origins: string[]; browserInput: boolean; terminalEnabled: boolean;
  usage?: import('../../packages/agent-core/src/types').Usage;
}
export interface MemoryFact { id: string; text: string; tags: string[]; createdAt: number; source?: string }
export interface FileArtifact { id: string; name: string; path: string; size: number; mime: string; createdAt: number; runId: string; modifiedAt: number }
export interface ArtifactPreview { offset?:number; nextOffset?:number; page?:number; pages?:number; artifact: FileArtifact; text?: string; url?: string; truncated?: boolean }
export interface ProviderBalance { profileId: string; status: 'loading' | 'ready' | 'error' | 'unsupported'; available?: boolean; updatedAt?: number; error?: string; balances: { currency: string; total: string; granted: string; toppedUp: string }[] }
export interface BackendState { state: 'stopped' | 'starting' | 'ready' | 'error'; message: string }
export interface Snapshot {
  studio?:import('./studio').StudioSnapshot;
  illustration?: import('./illustration').IllustrationSnapshot;
  petChat?: {sessionId?:string;pinned?:boolean;draft?:string;notice?:string;attachments?:ChatAttachment[];queue?:{commandId:string;sessionId:string;text:string;attachments?:ChatAttachment[]}[]};
  artifactPreview?: ArtifactPreview;
  balances?: ProviderBalance[];
  codexCatalog: CodexCatalog;
  resolvedTheme: 'light' | 'dark';
  workbenchPage?: 'chat' | 'settings' | 'workshop' | 'illustration';
  workshop?: WorkshopSnapshot;
  workbenchPageRevision?: number;
  revision: number; settings: AppSettings; sessions: AgentSession[]; selectedSessionId: string | null;
  memory: MemoryFact[]; backends: { dragon: BackendState; codex: BackendState };
  mcp: McpStatus[]; quota: QuotaSnapshot; account: string; skin: SkinData | null;
  petView: 'hidden' | 'compose' | 'reply' | 'quota'; animationStartedAt: number; version: string;
  compactBubbleLayout?: CompactBubbleLayout;
}
export interface BackendHooks {
  plan?(plan:import('./planning').DragonPlan):void;
  attempt?(attempt:import('../../packages/agent-core/src/types').RequestAttempt,agentId:string):void;
  nativeTurnId?(id: string): void;
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
export type Action = import('./studio').StudioAction | {type:'window.exit'} | import('./illustration').IllustrationAction | WorkshopAction
  | {type:'pet.chat.bind';id?:string;pinned:boolean}
  | {type:'pet.chat.draft';text:string}
  | {type:'pet.chat.send';text:string;commandId:string}
  | {type:'pet.chat.cancelQueued';commandId:string}
  | {type:'pet.chat.attach';files:DroppedFile[]}
  | {type:'pet.chat.pickFiles'}
  | {type:'pet.chat.removeAttachment';id:string}
  | {type:'session.mode';id:string;mode:'execute'|'plan'}
  | {type:'session.plan.execute';id:string;versionId:string;commandId:string}
  | { type:'session.collaboration'; id:string; config:import('./collaboration').CollaborationConfig }
  | { type: 'artifact.preview'; sessionId: string; artifactId: string; offset?:number; page?:number }
  | { type: 'artifact.reveal'; sessionId: string; artifactId: string }
  | { type: 'artifact.save'; sessionId: string; artifactId: string }
  | { type: 'session.resend'; id: string; messageId: string; text: string; commandId: string }
  | { type: 'session.version'; id: string; versionId: string }
  | { type: 'provider.balance.refresh'; profileId: string; force?: boolean }
  | { type: 'layout.save'; leftCollapsed?: boolean; rightCollapsed?: boolean }
  | { type: 'assistant.preferences.save'; preferences: import('./persona').AssistantPreferences }
  | { type: 'codex.models' }
  | { type: 'session.codexModel'; id: string; model: string; effort?: string }
  | { type: 'session.model'; id: string; profileId: string }
  | { type: 'session.switch'; id: string; backend: 'dragon' | 'codex'; profileId?: string; model?: string; effort?: string }
  | { type: 'session.reasoning'; id: string; effort?: string }
  | { type: 'session.permissionMode'; id: string; mode: PermissionMode }
  | { type: 'session.attachDrop'; id: string; files: DroppedFile[] }
  | { type: 'session.attachFiles'; id: string }
  | { type: 'session.attachChat'; id: string; sourceId: string }
  | { type: 'session.removeAttachment'; id: string; attachmentId: string }
  | { type: 'session.create'; backend: BackendKind; profileId?: string; workspace?: string; carryFrom?: string; model?: string; reasoningEffort?: string }
  | { type: 'session.select'; id: string }
  | { type: 'session.archive'; id: string }
  | { type: 'session.delete'; id: string }
  | { type: 'session.draft'; id: string; text: string }
  | { type: 'session.workspace'; id: string }
  | { type: 'session.permissions'; id: string; origins: string[]; browserInput: boolean; terminalEnabled: boolean }
  | { type:'session.cancelQueued';id:string;commandId:string }
  | { type:'session.resumeQueued';id:string }
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
  | { type: 'settings.save'; theme?: AppSettings['theme']; accent?: AppSettings['accent']; codexPath?: string; pet?: Partial<AppSettings['pet']>; limits?: AppSettings['limits'] }
  | {type:'appearance.save';values:Partial<import('./appearance').AppearanceValues>;tab?:import('./appearance').AppearanceSettings['tab']}
  | {type:'appearance.preset.save';name:string;id?:string}
  | {type:'appearance.preset.apply'|'appearance.preset.delete';id:string}
  | {type:'appearance.reset'}
  | {type:'wallpaper.select'|'wallpaper.delete';file:string}
  | { type: 'wallpaper.choose' }
  | { type: 'wallpaper.clear' }
  | { type: 'wallpaper.tune'; opacity?: number; blur?: number; dim?: number }
  | { type: 'pet.toggle' }
  | { type: 'pet.view'; view: Snapshot['petView'] }
  | { type: 'pet.chatMode'; mode: 'simple' | 'detailed' }
  | { type: 'pet.drag'; dx: number; dy: number }
  | { type: 'window.workbench'; page?: 'chat' | 'settings' | 'workshop' }
  | { type: 'window.menu' }
  | { type: 'quota.refresh' }
  | { type: 'codex.login' }
  | { type: 'external.open'; url: string };
export interface DragonBridge { snapshot(): Promise<Snapshot>; action(action: Action): Promise<unknown>; subscribe(listener: (state: Snapshot) => void): () => void; filePath(file: File): string }
declare global { interface Window { dragon: DragonBridge } }

export function contextPolicy(profile: Pick<ModelProfile, 'contextWindow' | 'maxOutput'>) {
  if (!Number.isSafeInteger(profile.contextWindow) || profile.contextWindow < 4096) throw new Error('模型上下文窗口需要是至少 4096 的整数。');
  if (!Number.isSafeInteger(profile.maxOutput) || profile.maxOutput < 1) throw new Error('最大输出需要是正整数。');
  const window = Math.min(CONTEXT_LIMIT, profile.contextWindow);
  const output = Math.max(1, Math.min(32768, profile.maxOutput, Math.floor(window / 8)));
  const headroom = Math.min(65536, Math.floor(window / 8));
  return { window, output, headroom, threshold: Math.floor(Math.min(window * .5, window - output - headroom)), retainRatio: .16 };
}
export function isBusy(session: AgentSession) { return ['running', 'waiting', 'stopping'].includes(session.status); }
