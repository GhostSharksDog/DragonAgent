import React, { useState } from 'react';
import type { Action, AppSettings } from '../shared/contracts';
import { DEFAULT_ASSISTANT_PREFERENCES, assistantPrompt } from '../shared/persona';

export function AssistantSettings({ settings, act }: { settings: AppSettings; act(a: Action): Promise<unknown> }) {
  const [draft, setDraft] = useState(settings.assistant ?? DEFAULT_ASSISTANT_PREFERENCES);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  return <section className="settings-card"><h2>龙娘人设与创作偏好</h2><p>主聊天、桌宠和工坊共用。从下一轮回复生效，正在执行的任务保持原设置。</p>
    <label>龙娘人设<textarea rows={7} maxLength={8000} value={draft.persona} onChange={e => setDraft({ ...draft, persona: e.target.value })}/></label>
    <label>创作偏好<textarea rows={4} maxLength={4000} value={draft.creativePreferences} onChange={e => setDraft({ ...draft, creativePreferences: e.target.value })}/></label>
    <div className="actions"><button disabled={pending || !draft.persona.trim()} onClick={async () => { setPending(true); setMessage(''); try { const result=await act({ type: 'assistant.preferences.save', preferences: draft }); setMessage(result===undefined?'保存未完成，请查看错误提示。':'已保存，下一轮回复生效。'); } finally { setPending(false); } }}>保存偏好</button><button disabled={pending} onClick={() => { setDraft({ ...DEFAULT_ASSISTANT_PREFERENCES }); setMessage('已恢复默认草稿，保存后生效。'); }}>恢复默认</button></div>
    <p role="status">{message}</p><details><summary>预览基础提示词</summary><pre style={{ whiteSpace:'pre-wrap',overflowWrap:'anywhere' }}>{assistantPrompt(draft)}</pre><p>各入口另附当前任务与权限说明。人设设置不改变工具授权。</p></details>
  </section>;
}
