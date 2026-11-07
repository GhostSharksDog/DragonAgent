import type { AgentSession } from '../shared/contracts';
import type { PlanVersion } from '../shared/planning';

export type PlanDisplayStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled' | 'paused' | 'stale' | 'confirmed';

export const PLAN_STATUS_LABELS: Record<PlanDisplayStatus, string> = {
  pending: '待确认',
  running: '执行中',
  completed: '已完成',
  error: '失败',
  cancelled: '已停止',
  paused: '已暂停',
  stale: '待修订',
  confirmed: '已确认',
};

/**
 * 计划终态优先使用宿主记录；旧数据没有 execution.status 时，按
 * runId 对应的会话状态回退，避免把执行中的计划误显示为已完成。
 */
export function planDisplayStatus(plan: PlanVersion, session: AgentSession): PlanDisplayStatus {
  if (plan.stale) return 'stale';
  const execution = plan.execution;
  if (!execution) return 'pending';
  if (execution.runId && execution.runId === session.runId) {
    if (['running', 'waiting', 'stopping'].includes(session.status)) return 'running';
    if (session.status === 'completed') return 'completed';
    if (session.status === 'error') return 'error';
    if (session.status === 'cancelled' || session.status === 'interrupted') return 'cancelled';
    if (session.status === 'paused') return 'paused';
  }
  if (execution.status) return execution.status;
  return 'confirmed';
}
