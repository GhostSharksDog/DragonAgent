import React from 'react';
import type {Action, AppSettings, Snapshot} from '../shared/contracts';
import {Icon} from './Icons';

type Props = { state: Snapshot; act(a: Action): Promise<unknown> };

const THEMES: { id: AppSettings['theme']; title: string; caption: string }[] = [
  { id: 'light', title: '银白', caption: '高对比，白天用' },
  { id: 'dark', title: '月夜紫', caption: '深色，晚上用' },
  { id: 'system', title: '跟随系统', caption: '跟着电脑切换' },
];
const ACCENTS: { id: AppSettings['accent']; label: string; dot: string }[] = [
  { id: 'violet', label: '雾紫', dot: '#7250a4' },
  { id: 'teal', label: '青碧', dot: '#2f7d72' },
  { id: 'amber', label: '琥珀', dot: '#a2661f' },
  { id: 'ink', label: '墨蓝', dot: '#3f5a8a' },
];

export function wallpaperUrl(file: string) { return 'wallpaper://bg/' + encodeURIComponent(file); }

export function Appearance({state, act}: Props) {
  const wallpaper = state.settings.wallpaper;
  const accent = state.settings.accent ?? 'violet';
  const tune = (patch: {opacity?: number; blur?: number; dim?: number}) => void act({ type: 'wallpaper.tune', ...patch });
  return <section className="appearance-page">
    <div className="appearance-head">
      <div className="eyebrow">APPEARANCE STUDIO</div>
      <h1>把这间屋子调成你喜欢的样子</h1>
      <p className="subtitle">主题、配色和壁纸会立刻应用，并保存在本机。</p>
    </div>
    <div className="appearance-grid">
      <div className="appearance-controls">
        <section className="settings-card">
          <div className="section-title"><h2>主题</h2><span className="tag">{state.settings.theme === 'system' ? '跟随系统 · 当前' + (state.resolvedTheme === 'dark' ? '深色' : '浅色') : state.settings.theme === 'dark' ? '深色' : '浅色'}</span></div>
          <div className="theme-grid">{THEMES.map(theme => <button key={theme.id} className={'theme-card' + (state.settings.theme === theme.id ? ' active' : '')} onClick={() => void act({ type: 'settings.save', theme: theme.id })}><span className={'theme-thumb ' + theme.id}><i/><i/><i/></span><strong>{theme.title}</strong><small>{theme.caption}</small></button>)}</div>
        </section>
        <section className="settings-card">
          <div className="section-title"><h2>配色</h2><span className="tag">{ACCENTS.find(item => item.id === accent)?.label}</span></div>
          <div className="accent-row-list">{ACCENTS.map(item => <button key={item.id} className={'accent-choice' + (accent === item.id ? ' active' : '')} onClick={() => void act({ type: 'settings.save', accent: item.id })}><i style={{ background: item.dot }}/><span>{item.label}</span></button>)}</div>
        </section>
        <section className="settings-card">
          <div className="section-title"><h2>壁纸</h2>{wallpaper && <button className="plain danger" onClick={() => void act({ type: 'wallpaper.clear' })}>移除</button>}</div>
          {wallpaper ? <>
            <p className="hint">{wallpaper.name}</p>
            <label>不透明度 · {Math.round(wallpaper.opacity * 100)}%<input type="range" min="0" max="1" step="0.05" value={wallpaper.opacity} onChange={e => tune({ opacity: +e.target.value })}/></label>
            <label>模糊 · {Math.round(wallpaper.blur)} px<input type="range" min="0" max="24" step="1" value={wallpaper.blur} onChange={e => tune({ blur: +e.target.value })}/></label>
            <label>压暗 · {Math.round(wallpaper.dim * 100)}%<input type="range" min="0" max="0.8" step="0.05" value={wallpaper.dim} onChange={e => tune({ dim: +e.target.value })}/></label>
          </> : <>
            <p className="hint">选一张图作为工作台背景。图片会复制到本机数据目录，原图移动或删除都不影响。</p>
            <button onClick={() => void act({ type: 'wallpaper.choose' })}><Icon name="folder" size={16}/>选择壁纸</button>
          </>}
        </section>
      </div>
      <aside className="appearance-preview">
        <div className="preview-frame" style={wallpaper ? { backgroundImage: 'url(' + wallpaperUrl(wallpaper.file) + ')' } : undefined}>
          {wallpaper && <div className="preview-veil" style={{ opacity: wallpaper.dim }}/>}
          <div className="preview-app">
            <div className="preview-rail"><span className="preview-avatar"/><i/><i/><i/><i/></div>
            <div className="preview-main"><div className="preview-bar"/><div className="preview-card"/><div className="preview-card short"/><div className="preview-bubble"/></div>
          </div>
        </div>
        <p className="hint">预览会随主题和配色变化；壁纸会铺在整个工作台后面。</p>
      </aside>
    </div>
  </section>;
}
