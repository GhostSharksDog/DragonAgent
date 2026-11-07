import React, { useEffect, useState } from 'react';
import type { Action, AgentSession, Snapshot } from '../shared/contracts';
import { isBusy } from '../shared/contracts';
import { planMarkdown } from '../shared/planning';
import { Icon } from './Icons';
import { RichText } from './RichText';
import { PLAN_STATUS_LABELS, planDisplayStatus } from './plan-status';

/**
 * 右侧栏的完整计划视图。回答流里的 PlanCard 负责当前轮次，这里保留版本切换和完整操作。
 */
export function PlanInspector({ state, session, act }: { state: Snapshot; session: AgentSession; act(a: Action): Promise<unknown> }) {
  const versions = session.plans ?? [];
  const previewId = state.planPreview?.sessionId === session.id ? state.planPreview.planId : undefined;
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (previewId && versions.some(plan => plan.id === previewId)) setSelected(previewId);
  }, [previewId, versions.map(plan => plan.id).join('|'), session.id]);
  const plan = versions.find(item => item.id === selected) ?? versions.at(-1);
  if (!plan) return <p className="hint">本会话还没有计划。</p>;
  const latest = plan === versions.at(-1);
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
  const copiedLabel = copied ? '已复制' : '复制计划';
  return <section className="plan-inspector" data-status={status}>
    <header className="plan-inspector-head">
      <div><span className="plan-banner-badge"><Icon name="spark" size={14}/>Plan</span><strong>实施计划</strong></div>
      <span className="plan-banner-status">{label}</span>
    </header>
    <label className="plan-version-picker">计划版本
      <select aria-label="计划版本" value={plan.id} onChange={event => { setCopied(false); setSelected(event.target.value); }}>
        {versions.map((item, index) => <option key={item.id} value={item.id}>版本 {index + 1}{item === versions.at(-1) ? ' · 最新' : ''}{item.stale ? ' · 待修订' : ''}</option>)}
      </select>
    </label>
    <div className="plan-inspector-meta">
      <span>{latest ? '当前最新计划' : '历史计划'}</span>
      {plan.execution && <span>提交于 {new Date(plan.execution.at).toLocaleString('zh-CN')}</span>}
      {plan.execution?.finishedAt && <span>结束于 {new Date(plan.execution.finishedAt).toLocaleString('zh-CN')}</span>}
    </div>
    <div className="plan-inspector-body"><RichText text={planMarkdown(plan.plan)} act={act} sessionId={session.id}/></div>
    {plan.plan.questions.length > 0 && <p className="hint">请先明确待决定事项，再提交新版计划。</p>}
    {plan.stale && <p className="hint">已有后续讨论，请提交更新后的计划。</p>}
    {plan.execution && <p className="hint">执行状态：{label}{plan.execution.runId ? ` · 运行 ${plan.execution.runId.slice(0, 8)}` : ''}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <footer className="plan-inspector-actions">
      <button type="button" onClick={() => void navigator.clipboard.writeText(planMarkdown(plan.plan)).then(() => { setCopied(true); }).catch(() => setError('复制失败'))}>{copiedLabel}</button>
      <button type="button" disabled={disabled || session.backend !== 'dragon' || session.collaboration?.enabled} onClick={() => void modify()}>继续修改</button>
      <button type="button" className="primary" disabled={disabled || !latest || plan.stale || !!plan.execution || plan.plan.questions.length > 0 || session.mode !== 'plan'} onClick={() => void execute()}>
        {plan.execution ? status === 'completed' ? '已完成' : status === 'error' ? '执行失败' : status === 'cancelled' ? '已停止' : '已提交执行' : '按此计划执行'}
      </button>
    </footer>
  </section>;
}
