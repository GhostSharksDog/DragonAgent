import React, { useEffect, useRef, useState } from 'react';
import type { Action, AgentSession, CodexCatalog, CodexModel, ModelProfile } from '../shared/contracts';
import { Icon } from './Icons';

const effortNames: Record<string, string> = { none: '关闭', minimal: '极轻', low: '轻量', medium: '均衡', high: '深入', xhigh: '超高', max: '极致', ultra: '极致+' };
export function codexLabel(session: AgentSession, catalog: CodexCatalog) {
  return catalog.models.find(m => m.model === session.model)?.name ?? session.model ?? catalog.models.find(m => m.isDefault)?.name ?? 'Codex';
}
function ReasoningControl({ session, model, act }: { session: AgentSession; model: CodexModel; act(a: Action): Promise<unknown> }) {
  const selected = Math.max(0, model.efforts.findIndex(e => e.value === (session.reasoningEffort ?? model.defaultEffort)));
  const [index, setIndex] = useState(selected), [burst, setBurst] = useState(false), [saving, setSaving] = useState(false);
  const pending = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setIndex(selected); }, [selected, model.model]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const options = model.efforts, max = options.length - 1;
  if (!options.length) return <p className="menu-footnote">此模型未提供可调节的推理档位。</p>;
  const change = (next: number) => { setIndex(next); if (next === max && max > 0 && index < max) { setBurst(true); clearTimeout(timer.current); timer.current = setTimeout(() => setBurst(false), 1400); } };
  const commit = async (next: number) => {
    if (pending.current || (next === selected && session.model === model.model)) return;
    pending.current = true; setSaving(true);
    try { const ok = await act({ type: 'session.codexModel', id: session.id, model: model.model, effort: options[next].value }); if (ok === undefined) setIndex(selected); }
    finally { pending.current = false; setSaving(false); }
  };
  const current = options[index] ?? options[selected];
  return <section className={`reasoning-control ${index === max && max > 0 ? 'at-max' : ''} ${burst ? 'peak-burst' : ''}`} aria-label="Codex 推理设置">
    <div className="reasoning-heading"><span><Icon name="spark" size={16}/>推理强度</span><strong>{effortNames[current.value] ?? current.value}<small>{current.value}</small></strong></div>
    <div className="reasoning-track" style={{ '--effort-fill': `${max ? index / max * 100 : 100}%` } as React.CSSProperties}>
      <div className="reasoning-glow" aria-hidden="true"/><span className="reasoning-burst" aria-hidden="true">✦</span>
      <input type="range" aria-label="Codex 推理强度" aria-valuetext={`${effortNames[current.value] ?? current.value} (${current.value})`} min={0} max={Math.max(0, max)} step={1} value={index} disabled={saving || max <= 0} onChange={e => change(Number(e.target.value))} onPointerUp={e => void commit(Number(e.currentTarget.value))} onKeyUp={e => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) void commit(Number(e.currentTarget.value)); }} onBlur={e => void commit(Number(e.currentTarget.value))}/>
    </div>
    <div className="reasoning-ticks">{options.map((e, i) => <span className={i === index ? 'active' : ''} key={e.value}>{effortNames[e.value] ?? e.value}</span>)}</div>
    <p>{index === max && max > 0 ? '最高档已开启 · 给难题多一点思考时间。' : index === 0 ? '更快响应，适合轻量任务。' : '增加思考投入，适合需要推敲的任务。'}<span title={current.description}>{saving ? '正在保存…' : '下一条消息生效'}</span></p>
  </section>;
}
export function ModelPicker({ session, profiles, catalog, act, close }: { session: AgentSession; profiles: ModelProfile[]; catalog: CodexCatalog; act(a: Action): Promise<unknown>; close(): void }) {
  const [tab, setTab] = useState(session.backend), [choosing, setChoosing] = useState(false);
  const loadRequested = useRef(false);
  useEffect(() => { if (tab === 'codex' && !loadRequested.current) { loadRequested.current = true; void act({ type: 'codex.models' }); } }, [tab]);
  const current = catalog.models.find(m => m.model === session.model) ?? (!session.model ? catalog.models.find(m => m.isDefault) : undefined);
  const choose = async (model: CodexModel) => {
    setChoosing(true);
    try {
      if (session.backend === 'codex') {
        const effort = model.efforts.some(e => e.value === session.reasoningEffort) ? session.reasoningEffort : undefined;
        await act({ type: 'session.codexModel', id: session.id, model: model.model, effort });
      } else { const id = await act({ type: 'session.create', backend: 'codex', model: model.model, carryFrom: session.id }); if (typeof id === 'string') close(); }
    } finally { setChoosing(false); }
  };
  return <div className={`model-picker ${tab}`}>
    <div className="model-tabs" role="tablist" aria-label="模型通道"><button role="tab" aria-selected={tab === 'codex'} onClick={() => setTab('codex')}><Icon name="model" size={16}/>Codex</button><button role="tab" aria-selected={tab === 'dragon'} onClick={() => setTab('dragon')}><Icon name="spark" size={16}/>其他模型</button></div>
    {tab === 'codex' ? <><div className="catalog-heading"><span>CODEX MODELS</span><button aria-label="刷新 Codex 模型列表" disabled={catalog.status === 'loading'} onClick={() => void act({ type: 'codex.models' })}>刷新</button></div>
      {catalog.status === 'loading' && <p className="menu-footnote">正在读取 Codex 模型…</p>}
      {catalog.status === 'error' && <p className="catalog-error" role="alert">{catalog.error || '暂时无法读取模型列表，请刷新重试。'}</p>}
      <div className="model-catalog" role="group" aria-label="Codex 模型">{catalog.models.map(m => <button key={m.model} role="menuitemradio" aria-checked={session.backend === 'codex' && current?.model === m.model} className={`menu-option ${session.backend === 'codex' && current?.model === m.model ? 'selected' : ''}`} disabled={choosing || catalog.status !== 'ready'} title={m.description} onClick={() => void choose(m)}><span className="menu-option-icon"><Icon name="model" size={18}/></span><span className="menu-option-copy"><strong>{m.name}{m.isDefault && <em>默认</em>}</strong><small>{m.model}</small></span><span className="menu-check">{session.backend === 'codex' && current?.model === m.model && <Icon name="check" size={16}/>}</span></button>)}</div>
      {catalog.status === 'ready' && !catalog.models.length && <p className="menu-footnote">Codex 未返回模型，可在设置中检查账号连接。</p>}
      {session.backend === 'codex' && current && catalog.status === 'ready' && <ReasoningControl key={current.model} session={session} model={current} act={act}/>}
      {session.backend === 'codex' && session.model && !current && catalog.status === 'ready' && <p className="catalog-error">原模型不在当前列表中，请重新选择。</p>}
      {session.backend !== 'codex' && <p className="menu-footnote channel-hint">选择模型后，携带可审核摘录新建 Codex 聊天。原聊天和草稿保留。</p>}
    </> : <><div className="menu-heading">DRAGON · 你的 API 连接</div><div className="model-catalog" role="group" aria-label="其他模型">{profiles.map(p => <button key={p.id} role="menuitemradio" aria-checked={session.backend === 'dragon' && session.profileId === p.id} className={`menu-option ${session.backend === 'dragon' && session.profileId === p.id ? 'selected' : ''}`} onClick={async () => { if (session.backend === 'dragon') await act({ type: 'session.model', id: session.id, profileId: p.id }); else await act({ type: 'session.create', backend: 'dragon', profileId: p.id, carryFrom: session.id }); close(); }}><span className="menu-option-icon"><Icon name="spark" size={18}/></span><span className="menu-option-copy"><strong>{p.name}</strong><small>{p.model}</small></span><span className="menu-check">{session.backend === 'dragon' && session.profileId === p.id && <Icon name="check" size={16}/>}</span></button>)}</div>{!profiles.length && <p className="menu-footnote">还没有模型连接，可在设置中添加。</p>}{session.backend !== 'dragon' && <p className="menu-footnote channel-hint">选择模型后，携带可审核摘录新建 Dragon 聊天。原聊天和草稿保留。</p>}</>}
    <div className="menu-divider"/><button className="menu-action" onClick={() => { close(); void act({ type: 'window.workbench', page: 'settings' }); }}><Icon name="settings" size={17}/>管理模型连接</button>
  </div>;
}
