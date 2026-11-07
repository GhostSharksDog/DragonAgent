import React, { useState } from 'react';
import type { Action, AgentSession } from '../shared/contracts';
import { isBusy } from '../shared/contracts';
import { planMarkdown, type PlanVersion } from '../shared/planning';
import { Icon } from './Icons';
import { RichText } from './RichText';
import { PLAN_STATUS_LABELS, planDisplayStatus } from './plan-status';

/**
 * 回答流里的计划卡片。它跟普通正文一起滚动，属于当前这一轮回答；右侧栏
 * 仍保留完整计划版本和版本切换，卡片本身只负责确认/查看入口。
 */
export function PlanCard({ plan, session, act }: { plan: PlanVersion; session: AgentSession; act(a: Action): Promise<unknown> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const versions = session.plans ?? [];
  const latest = versions.at(-1) === plan;
  const version = versions.findIndex(item => item.id === plan.id) + 1;
  const status = planDisplayStatus(plan, session);
  const label = PLAN_STATUS_LABELS[status];
  const disabled = pending || isBusy(session) || !!session.pending.length || !!session.queuedMessages?.length || session.readOnly;
  const execute = async () => {
    setPending(true); setError('');
    try {
      await act({ type: 'session.plan.execute', id: session.id, versionId: plan.id, commandId: crypto.randomUUID() });
    } catch (reason) { setError(String(reason)); }
    finally { setPending(false); }
  };
  const modify = async () => {
    setError('');
    try {
      await act({ type: 'session.mode', id: session.id, mode: 'plan' });
      await act({ type: 'session.draft', id: session.id, text: '请修改计划：' });
    } catch (reason) { setError(String(reason)); }
  };
  const copy = () => void navigator.clipboard.writeText(planMarkdown(plan.plan))
    .then(() => setCopied(true))
    .catch(() => setError('复制失败'));
  return <section className="dragon-plan-card" data-status={status} data-plan-id={plan.id} aria-label={`实施计划：${plan.plan.goal}`}>
    <header className="dragon-plan-head">
      <span className="dragon-plan-kicker"><Icon name="spark" size={14}/>实施计划</span>
      <div className="dragon-plan-tools">
        {version > 0 && <span className="dragon-plan-version">v{version}</span>}
        <span className="plan-banner-status">{label}</span>
        <button type="button" className="plain dragon-plan-icon" aria-label="在右侧查看完整计划" title="在右侧查看完整计划"
          onClick={() => void act({ type: 'session.plan.preview', sessionId: session.id, planId: plan.id }).catch(() => undefined)}>
          <Icon name="expand" size={15}/>
        </button>
        <button type="button" className="plain dragon-plan-icon" aria-label={copied ? '已复制计划' : '复制计划'} title={copied ? '已复制计划' : '复制计划'} onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={15}/>
        </button>
      </div>
    </header>
    <div className="dragon-plan-body">
      <RichText text={planMarkdown(plan.plan)} act={act} sessionId={session.id}/>
    </div>
    {plan.plan.questions.length > 0 && <p className="hint">还有待决定事项，确认前需要先补充计划。</p>}
    {plan.stale && <p className="hint">后续讨论让这份计划过期了，请提交新版计划。</p>}
    {plan.execution && <p className="dragon-plan-execution">执行状态：{label}{plan.execution.runId ? ` · 运行 ${plan.execution.runId.slice(0, 8)}` : ''}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <footer className="dragon-plan-footer">
      <span className="dragon-plan-note">
        {plan.execution ? (status === 'completed' ? '执行完成，详情见右侧计划页。' : '已提交执行。') : latest ? '确认后才会开始执行。' : '历史版本，仅供参考。'}
      </span>
      <div className="dragon-plan-actions">
        {latest && <button type="button" className="plain" disabled={disabled || session.backend !== 'dragon' || session.collaboration?.enabled} onClick={() => void modify()}>继续修改</button>}
        {latest && <button type="button" className="primary" disabled={disabled || plan.stale || !!plan.execution || plan.plan.questions.length > 0 || session.mode !== 'plan'} onClick={() => void execute()}>
          {plan.execution ? status === 'completed' ? '已完成' : status === 'error' ? '执行失败' : status === 'cancelled' ? '已停止' : '已提交执行' : '按此计划执行'}
        </button>}
        {!latest && <span className="dragon-plan-history">仅最新计划可执行</span>}
      </div>
    </footer>
  </section>;
}
