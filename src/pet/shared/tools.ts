import type { TaskGrant } from './types';
export interface ApprovalInput { title: string; description: string; details: string[] }
export interface ToolContext { strictScope?: boolean; getGrant(): TaskGrant; getTaskId?(): string | null; requestApproval(input: ApprovalInput): Promise<boolean>; onBrowserChange(status: 'disconnected' | 'connecting' | 'connected'): void }
export interface DynamicTool { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ToolOutput { errorKind?:import('../../../packages/agent-core/src/types').ToolErrorKind; facts?:import('../../../packages/agent-core/src/types').ToolFacts; contentItems: ({ type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string })[]; success: boolean }
