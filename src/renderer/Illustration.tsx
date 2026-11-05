import { IllustrationPreferences } from './IllustrationPreferences';
import React, { useState, useEffect, useRef } from 'react';
import type { Action, Snapshot } from '../shared/contracts';
import type { IllustrationParameters } from '../shared/illustration';
import { PROMPT_AGENT_PERSONA } from '../shared/illustration';
import { RichText, CopyButton } from './RichText';
import { Icon } from './Icons';
import './illustration.css';

const when = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const LAUNCH_FIELDS = [
  ['endpoint', '服务地址'],
  ['python', 'Python 路径'],
  ['entry', 'ComfyUI 入口'],
  ['modelsRoot', '模型目录'],
  ['output', '输出目录'],
] as const;

const SERVICE_LABEL = { offline: '未连接', starting: '启动中', ready: '已连接', error: '连接异常' } as const;

const RUN_LABEL: Record<string, string> = {
  completed: '生成完成', unknown: '结果待核对', error: '生成失败', cancelled: '已取消', preparing: '准备中', submitted: '已提交',
};

export function Illustration({ state, act }: { state: Snapshot; act(a: Action): Promise<unknown> }) {
  const environment=useRef<HTMLDialogElement>(null);const [environmentOpen,setEnvironmentOpen]=useState(false);
  useEffect(()=>{if(environmentOpen)environment.current?.showModal();else environment.current?.close();},[environmentOpen]);
  const pageRef=useRef<HTMLElement>(null);
  const [narrow,setNarrow]=useState(false),[panel,setPanel]=useState('prompts'),[mobilePanel,setMobilePanel]=useState('chat'),[projectSearch,setProjectSearch]=useState('');
  useEffect(()=>{const el=pageRef.current;if(!el)return;const observer=new ResizeObserver(entries=>setNarrow(entries[0].contentRect.width<960));observer.observe(el);return()=>observer.disconnect();},[!!state.illustration]);
  const studio = state.illustration, p = studio?.projects.find(p => p.id === studio.selectedId);
  const [description, setDescription] = useState(''), [text, setText] = useState(''), [url, setUrl] = useState(''), [profile, setProfile] = useState(state.settings.selectedProfile), [draft, setDraft] = useState<IllustrationParameters>(), [preview, setPreview] = useState<string>();
  useEffect(() => { setDraft(p ? structuredClone(p.parameters) : undefined); }, [p?.id, JSON.stringify(p?.parameters)]);
  useEffect(() => {
    if (!preview) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(undefined); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [preview]);
  const [deleting, setDeleting] = useState<string>();
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const deletingProject = studio?.projects.find(v => v.id === deleting);
  useEffect(() => {
    if (deletingProject) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deletingProject?.id]);
  const [launchDraft, setLaunchDraft] = useState(studio?.launch);
  useEffect(() => setLaunchDraft(studio?.launch), [JSON.stringify(studio?.launch)]);
  if (!studio) return <p className="hint">插画工作台正在准备…</p>;
  const busy = p && ['searching', 'analyzing', 'generating'].includes(p.status);
  const update = (key: keyof IllustrationParameters, value: unknown) => draft && setDraft({ ...draft, [key]: value });
  const chosen = p ? p.references.filter(r => r.selected) : [];
  const latest = p?.runs.length ? p.runs[p.runs.length - 1] : undefined;
  const progress = p?.status === 'generating' ? '正在生成，请稍候…' : p?.status === 'analyzing' ? '插画助手正在整理…' : p?.status === 'searching' ? '正在搜索…' : '';
  const send = async (organize = false) => {
    if (!p || !draft) return;
    if (!organize && !text.trim() && !draft.description.trim()) return;
    await act({ type: 'illustration.assistant', commandId:crypto.randomUUID(), id: p.id, text: text.trim(), profileId: profile, organize });
    if (!organize) setText('');
  };
  return <section ref={pageRef} className="illustration-page" data-narrow={narrow} data-panel={narrow?mobilePanel:panel}>
    <header className="illustration-head"><div><h1>角色插画</h1><p className="hint">写一句要求，让霜璃整理成提示词，再挑参考、定稿生成。对话、参考与参数分别保留，随时切换。</p></div><div className="illustration-head-actions"><button onClick={()=>setEnvironmentOpen(true)}>环境与连接</button><span className={`illustration-service ${studio.service.state}`}><i/>本地引擎 · {SERVICE_LABEL[studio.service.state]}</span><button onClick={() => void act({ type: 'illustration.pixiv.open' })}>打开 Pixiv 登录窗口</button></div></header>

    <dialog ref={environment} className="illustration-environment" onCancel={()=>setEnvironmentOpen(false)}><header><strong>本地生成环境 · {studio.service.message ?? '尚未连接'}</strong><button aria-label="关闭环境设置" onClick={()=>setEnvironmentOpen(false)}>×</button></header><div className="illustration-environment-body"><div className="actions"><button onClick={() => void act({ type: 'illustration.launch.detect' })}>识别本机 ComfyUI</button><button disabled={!studio.launch} onClick={() => void act({ type: 'illustration.launch.start' })}>连接／启动</button></div>{studio.launch && <div className="illustration-launch-info"><p>Python：{studio.launch.python}</p><p>模型：{studio.launch.modelsRoot}</p><p>服务：{studio.launch.endpoint}</p></div>}{launchDraft && <div className="illustration-launch-fields">{LAUNCH_FIELDS.map(([key, label]) => <label key={key}>{label}<input value={launchDraft[key]} onChange={e => setLaunchDraft({ ...launchDraft, [key]: e.target.value, source: 'manual' })}/></label>)}<button onClick={() => void act({ type: 'illustration.launch.save', config: launchDraft })}>保存启动配置</button></div>}</div></dialog>

    <div className="illustration-bar"><div className="illustration-create"><input aria-label="新插画描述" placeholder="例如：芙莉莲坐在窗边读书，午后暖光…" value={description} onChange={e => setDescription(e.target.value)}/><button className="primary" disabled={!description.trim()} onClick={async () => { await act({ type: 'illustration.create', description, commandId: crypto.randomUUID() }); setDescription(''); }}>创建插画</button></div>{studio.projects.length > 0 && <details className="illustration-history"><summary>切换插画项目 · {p?.name ?? "选择项目"}</summary><input aria-label="搜索插画项目" placeholder="搜索项目…" value={projectSearch} onChange={e=>setProjectSearch(e.target.value)}/><div className="illustration-history-head"><span>插画项目 · {studio.projects.length}</span><small>点名称切换 · × 删除</small></div><div className="illustration-tabs">{studio.projects.filter(item=>item.name.toLowerCase().includes(projectSearch.toLowerCase())).map(item => { const working = ['searching', 'analyzing', 'generating'].includes(item.status); return <div key={item.id} className={`illustration-tab ${item.id === p?.id ? 'selected' : ''}`}><button className="illustration-tab-main" title={item.name} onClick={() => void act({ type: 'illustration.select', id: item.id })}><strong>{item.name}</strong><small>{when(item.updatedAt)} · {item.messages.filter(m => m.role === 'user').length} 条对话</small></button><button className="illustration-tab-delete" aria-label={`删除插画项目：${item.name}`} title={working ? '处理中，暂时不能删除' : '删除项目'} disabled={working} onClick={() => setDeleting(item.id)}>×</button></div>; })}</div></details>}</div>

    {!p || !draft ? <div className="illustration-empty"><strong>{studio.projects.length ? '选一个插画项目继续' : '还没有插画项目'}</strong><p className="hint">在上面的输入框写一句要求——角色、动作、场景都行——然后点「创建插画」。</p></div> : <div className="illustration-work"><nav className="illustration-panel-tabs" aria-label="插画面板">{[['chat','对话'],['references','参考图'],['prompts','提示词与参数'],['results','生成结果']].map(([id,label])=><button key={id} className={(narrow?mobilePanel:panel)===id?'selected':''} data-tab={id} onClick={()=>{if(narrow)setMobilePanel(id);else setPanel(id);}}>{label}</button>)}</nav>

      <section className="illustration-column illustration-chat" data-pane="chat">
        <div className="illustration-column-head"><span className="illustration-step">1</span><h2>创作对话</h2><small className="illustration-count">整理提示词 Agent</small></div>
        <label className="illustration-profile">文字／识图服务<select value={profile} onChange={e => setProfile(e.target.value)}>{state.settings.profiles.map(v => <option key={v.id} value={v.id}>{v.name} · {v.model}</option>)}</select></label>
        <details className="illustration-intro"><summary>创作说明</summary><p className="hint">想画什么就怎么说，也可以像平常聊天一样问她：角色、关系、神情、姿势、氛围，成年人的虚构创作也可以直接讲。霜璃会正常回答；整理出提示词时会自动写进右侧草稿。参考图只在「分析参考并生成」时发送给识图服务。</p></details>
        <IllustrationPreferences preferences={studio.preferences} project={p} act={act}/>
        <div className="illustration-messages">{p.messages.length ? p.messages.map(m => <article key={m.id} className={m.role === 'user' ? 'from-user' : 'from-assistant'}>{m.role === 'user' && <small>你</small>}<RichText text={m.text.split(/```prompt\s*\n/i)[0]}/></article>) : <p className="hint empty-note">还没有对话。写一句你的想法，会像平常聊天一样回答你。</p>}</div>
        <textarea rows={3} aria-label="补充要求" placeholder="像聊天一样说你的想法：角色、关系、神情、姿势、氛围…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}/>
        <div className="actions"><button className="primary" disabled={!!busy || !(text.trim() || draft.description.trim())} onClick={() => void send()}>发送</button><button disabled={!!busy} onClick={() => void send(true)}>整理提示词</button><button disabled={!busy} onClick={() => void act({ type: p.activeJob==='assistant'?'illustration.assistant.stop':p.activeJob==='generation'?'illustration.generation.stop':'illustration.cancel', id: p.id })}>{p.activeJob==='assistant'?'停止助手':p.activeJob==='generation'?'停止生成流程':'停止处理'}</button></div>
        {progress && <p className="illustration-progress"><i/>{progress}</p>}
        {p.error && <p role="alert" className="illustration-error">{p.error}</p>}
      </section>

      <section className="illustration-column" data-pane="references">
        <div className="illustration-column-head"><span className="illustration-step">2</span><h2>参考作品</h2><small className="illustration-count">{chosen.length}/{p.references.length} 已选</small></div>
        <div className="actions start"><button onClick={() => void act({ type: 'illustration.pixiv.open', query: draft.character || draft.description, artistId:draft.artist?.pixivId })}>搜索 Pixiv</button><button disabled={!!busy} onClick={() => void act({ type: 'illustration.references', id: p.id })}>读取当前页（最多六张）</button></div>
        <div className="illustration-create small"><input aria-label="Pixiv 作品链接" placeholder="或粘贴 Pixiv 作品链接" value={url} onChange={e => setUrl(e.target.value)}/><button disabled={!!busy || !url} onClick={() => void act({ type: 'illustration.references', id: p.id, url })}>添加作品</button></div>
        {p.references.length === 0 ? <p className="hint empty-note">还没有参考。用 Pixiv 登录窗口搜一张喜欢的画，再点「读取当前页」，勾选想要的作画参考。</p> : <div className="illustration-references">{p.references.map(r => <article key={r.id} className={`illustration-reference${r.selected ? ' selected' : ''}`}><label className="illustration-reference-check"><input type="checkbox" checked={r.selected} onChange={e => void act({ type: 'illustration.reference.select', id: p.id, referenceId: r.id, selected: e.target.checked })}/><span>{r.selected ? '已选作参考' : '选作参考'}</span></label>{r.thumbnail?.startsWith('data:image/png;base64,') && <img src={r.thumbnail} alt={r.title}/>}<strong>{r.title}</strong><span>{r.artist}</span><small>{r.characterMatched?'作品标签或标题匹配角色':'角色尚未核实，请查看作品确认'}</small><small>{r.tags.join(' · ')}</small><button className="plain" onClick={() => void act({ type: 'external.open', url: r.url })}>查看原作 ↗</button></article>)}</div>}
        <div className="illustration-generate"><button className="primary" disabled={!!busy || !chosen.length} onClick={() => void act({ type: 'illustration.generate', id: p.id, commandId: crypto.randomUUID(), profileId: profile, analyze: true })}>分析参考并生成一张</button><p className="hint">会先让识图服务读参考，把结论写进提示词再提交生成。</p></div>
      </section>

      <section className="illustration-column" data-pane="prompts">
        {p.pendingUpdate&&<details className="illustration-section"><summary>助手有一份待应用的建议</summary><RichText text={'正面提示词：\n'+p.pendingUpdate.positive+'\n\n负面提示词：\n'+p.pendingUpdate.negative}/><button onClick={()=>void act({type:'illustration.pending.apply',id:p.id})}>用这份建议替换草稿</button></details>}<div className="illustration-column-head"><span className="illustration-step">3</span><h2>提示词与生成</h2></div>

        <div className="illustration-generate"><button className="primary" disabled={!!busy || !draft.positive.trim()} onClick={async () => { if (await act({ type: 'illustration.update', id: p.id, parameters: draft }) !== true) return; await act({ type: 'illustration.generate', id: p.id, commandId: crypto.randomUUID() }); }}>按当前提示词生成</button><p className="hint">用下面这版提示词直接出图，不改动参考。</p></div>
        <details className="illustration-section" open><summary>提示词</summary>
          <label>创作要求<textarea rows={2} value={draft.description} onChange={e => update('description', e.target.value)}/></label>
          <div className="illustration-field"><div className="illustration-field-head"><span>正面提示词</span><CopyButton text={draft.positive} iconOnly/></div><textarea aria-label="正面提示词" rows={6} value={draft.positive} onChange={e => update('positive', e.target.value)}/></div>
          <div className="illustration-field"><div className="illustration-field-head"><span>负面提示词</span><CopyButton text={draft.negative} iconOnly/></div><textarea aria-label="负面提示词" rows={3} value={draft.negative} onChange={e => update('negative', e.target.value)}/></div>
          <label>角色名／作品别名<input value={draft.character} onChange={e=>update('character',e.target.value)}/></label><label>动作与姿势<input value={draft.pose} onChange={e=>update('pose',e.target.value)}/></label><label>指定 Pixiv 画师昵称（留空不限）<input value={draft.artist?.nickname??''} onChange={e=>update('artist',{...draft.artist,nickname:e.target.value,tag:draft.artist?.tag??'',verified:false})}/></label><label>Pixiv 画师 ID（可选，主页 users/ 后的数字）<input inputMode="numeric" value={draft.artist?.pixivId??''} onChange={e=>update('artist',{...draft.artist,nickname:draft.artist?.nickname??'',tag:draft.artist?.tag??'',pixivId:e.target.value,verified:false})}/></label><p className="hint">先保存草稿再搜索；指定画师时按来源信息筛选，不把模型画师标签当作 Pixiv 昵称。</p><label>画师模型标签（未核实映射）<input placeholder="@artist tag" value={draft.artist?.tag ?? ''} onChange={e => update('artist', { ...draft.artist, nickname: draft.artist?.nickname ?? '', tag: e.target.value, verified: false })}/></label>
        </details>
        <details className="illustration-section"><summary>采样参数 · {draft.model.width}×{draft.model.height} · {draft.model.steps} 步 · CFG {draft.model.cfg}</summary>
          <div className="illustration-sampling">{(['width', 'height', 'steps', 'cfg'] as const).map(key => <label key={key}>{({ width: '宽度', height: '高度', steps: '步数', cfg: 'CFG' })[key]}<input type="number" value={draft.model[key]} onChange={e => update('model', { ...draft.model, [key]: Number(e.target.value) })}/></label>)}</div>
          <label>种子<input type="number" value={draft.seed} onChange={e => update('seed', Number(e.target.value))}/></label>
          <p className="hint">{draft.model.model}</p>
        </details>
        <details className="illustration-section"><summary>角色 LoRA · {p.parameters.lora ? p.parameters.lora.name : '未使用'}</summary>
          <div className="actions start"><button disabled={!!busy} onClick={() => void act({ type: 'illustration.lora.search', id: p.id, query: draft.character || draft.description })}>搜索 Civitai</button><button disabled={!!busy} onClick={() => void act({ type: 'illustration.lora.import', id: p.id })}>导入本地 LoRA</button></div>
          {p.download && <p className="hint">下载 {Math.round(p.download.received / 1024 / 1024)} / {Math.round(p.download.total / 1024 / 1024)} MB</p>}
          {p.loraCandidates?.map(c => <article key={c.versionId} className="illustration-candidate">{c.preview && <img src={c.preview} alt={c.name}/>}<strong>{c.name}</strong><p>{c.author} · {c.baseModel} · {Math.round(c.sizeKB / 1024)} MB</p><p>触发词：{c.triggerWords.join(', ')}</p><p>建议权重：{c.suggestedStrength ?? .8}</p><div className="actions"><button className="plain" onClick={() => void act({ type: 'external.open', url: c.url })}>作者说明 ↗</button><button disabled={!!busy || !c.compatible} onClick={() => void act({ type: 'illustration.lora.install', id: p.id, versionId: c.versionId })}>{c.compatible ? '选择并下载' : '体系不兼容'}</button></div></article>)}
          <label>已有角色 LoRA<select value={state.workshop?.projects.find(v => v.lora?.sha256 === p.parameters.lora?.sha256 && !!v.lora)?.id ?? ''} onChange={e => void act({ type: 'illustration.lora.reuse', id: p.id, workshopId: e.target.value || undefined })}><option value="">不使用 LoRA</option>{state.workshop?.projects.filter(v => v.lora?.backend === draft.model.backend).map(v => <option key={v.id} value={v.id}>{v.lora!.name}</option>)}</select></label>
          {p.parameters.lora && <p className="hint">作者触发词：{p.parameters.lora.triggerWords.join(', ')} · 权重 {p.parameters.lora.strength}</p>}
        </details>
        <div className="actions start"><button onClick={() => void act({ type: 'illustration.update', id: p.id, parameters: draft })}>保存草稿</button><button onClick={() => void act({ type: 'illustration.undo', id: p.id })}>撤销修改</button><button disabled={!!busy} onClick={() => void act({ type: 'illustration.resume', id: p.id })}>核对上次任务</button></div>
</section><section className="illustration-column" data-pane="results">
        {latest && <article className="illustration-preview" key={latest.id}><div className="illustration-preview-head"><strong>{RUN_LABEL[latest.state] ?? latest.state}</strong><small>{latest.elapsedMs ? `${Math.round(latest.elapsedMs / 1000)} 秒` : ''}</small></div>{latest.file && <img className="illustration-zoomable" title="双击查看大图" onDoubleClick={() => setPreview('illustration://asset/' + latest.file)} src={'illustration://asset/' + latest.file} alt={p.name}/>}{latest.error && <p role="alert" className="illustration-error">{latest.error}</p>}{latest.file && <div className="actions"><button onClick={() => void act({ type: 'illustration.save', id: p.id, runId: latest.id })}>另存图片</button></div>}</article>}
        <details className="illustration-section" open><summary>生成历史 · {p.runs.length} 张</summary>
          {p.runs.length === 0 ? <p className="hint empty-note">还没有生成记录。</p> : [...p.runs].reverse().map(r => <article className="illustration-result" key={r.id}><div className="illustration-preview-head"><strong>{RUN_LABEL[r.state] ?? r.state}</strong><small>{r.elapsedMs ? `${Math.round(r.elapsedMs / 1000)} 秒` : ''}</small></div>{r.file && <img className="illustration-zoomable" title="双击查看大图" onDoubleClick={() => setPreview('illustration://asset/' + r.file)} src={'illustration://asset/' + r.file} alt={p.name}/>}{r.error && <p role="alert" className="illustration-error">{r.error}</p>}<div className="actions">{r.file && <button className="plain" onClick={() => void act({ type: 'illustration.save', id: p.id, runId: r.id })}>另存图片</button>}</div><details><summary>实际提示词与参数</summary><RichText text={'```json\n' + JSON.stringify(r.parameters, null, 2) + '\n```'}/></details></article>)}
        </details>
      </section>

    </div>}
    <dialog className="delete-dialog" ref={deleteDialog} aria-labelledby="delete-illustration-title" onCancel={e => { e.preventDefault(); setDeleting(undefined); }} onClick={e => { if (e.target === deleteDialog.current) setDeleting(undefined); }}>
      <div><span className="delete-emblem"><Icon name="trash" size={23}/></span><h2 id="delete-illustration-title">删除这个插画项目？</h2><p className="delete-chat-name">{deletingProject?.name}</p><p>删除本项目在 DragonAgent 里的对话、参考图副本、提示词草稿和生成记录，无法撤销。已经另存到别处的图片不受影响。</p><div className="actions"><button autoFocus onClick={() => setDeleting(undefined)}>取消</button><button className="delete-confirm" disabled={!deletingProject} onClick={async () => { if (deletingProject && await act({ type: 'illustration.delete', id: deletingProject.id }) !== undefined) setDeleting(undefined); }}>确认删除</button></div></div>
    </dialog>
    {preview && <div className="illustration-lightbox" role="dialog" aria-modal="true" aria-label="插画大图预览" onClick={() => setPreview(undefined)}><button className="illustration-lightbox-close" aria-label="关闭预览" onClick={() => setPreview(undefined)}>×</button><img src={preview} alt="插画大图" onClick={e => e.stopPropagation()}/><p>Esc 或点击空白处关闭</p></div>}
  </section>;
}
