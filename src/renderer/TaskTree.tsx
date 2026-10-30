import React, { useState } from 'react';
import type { Action, AgentSession, AppSettings } from '../shared/contracts';
const names: Record<string, string> = { queued: '排队中', running: '执行中', waiting: '等待确认', completed: '已完成', cancelled: '已停止', error: '失败', paused: '等待继续', interrupted: '已中断' };
export function TaskTree({ session, act }: { session: AgentSession; act(a: Action): Promise<unknown> }) {
  const tasks = (session.tasks ?? []).filter(t => t.runId === session.runId);
  if (!tasks.length) return null;
  return <details className="task-tree" open><summary>协作任务 · {tasks.filter(t => t.parentId).length} 个子任务</summary>{tasks.map(t => <details className={`agent-card ${t.parentId ? 'child' : ''}`} key={t.id}><summary><span>{t.parentId ? '↳ ' : '✦ '}{t.title}</span><small>{names[t.status]}</small></summary><p>{t.profileId} · {t.requests} 次模型请求<br/>{t.usage.input.toLocaleString()} 输入 / {t.usage.output.toLocaleString()} 输出</p>{t.error && <p className="danger">{t.error}</p>}{t.result && <pre>{t.result}</pre>}{t.parentId && ['queued', 'running', 'waiting'].includes(t.status) && <button onClick={() => void act({ type: 'agent.stop', id: session.id, agentId: t.id })}>停止此子任务</button>}</details>)}</details>;
}
export function CollaborationSettings({ limits, act }: { limits: AppSettings['limits']; act(a: Action): Promise<unknown> }) {
  const [value, setValue] = useState(limits), [saved, setSaved] = useState(false);
  return <section className="settings-card"><h2>任务协作与调用额度</h2><p className="hint">主 Agent 可按需分派。子任务使用独立上下文，权限继承自当前任务。到达调用额度后等待你继续。</p><div className="form-grid">{([['concurrency', '同时运行的子任务', 8], ['children', '每个主任务的子任务总数', 100], ['requests', '整棵任务树的模型请求次数', 1000]] as const).map(([key, label, max]) => <label key={key}>{label}<input type="number" min="1" max={max} value={value[key]} onChange={e => { setSaved(false); setValue({ ...value, [key]: Number(e.target.value) }); }}/></label>)}</div><div className="actions"><span>{saved ? '已保存' : ''}</span><button onClick={async () => { const result = await act({ type: 'settings.save', limits: value }); if (result) setSaved(true); }}>保存协作设置</button></div></section>;
}
