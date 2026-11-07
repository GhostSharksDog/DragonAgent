import React,{useEffect,useState} from 'react';
import type {Action,Snapshot} from '../shared/contracts';
import {
  DEFAULT_PET_BEHAVIOR,
  PET_BEHAVIOR_LIMITS,
  PET_BEHAVIOR_PRESETS,
  validPetBehavior,
  type PetBehavior,
  type PetBehaviorPresetId,
} from '../shared/pet-behavior';

function Slider({label,value,min,max,step,format,change}:{label:string;value:number;min:number;max:number;step:number;format:(value:number)=>string;change(value:number):void}){
  return <label className="behavior-slider">{label} · {format(value)}<input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e=>change(+e.target.value)}/></label>;
}

export function PetBehavior({state,act}:{state:Snapshot;act(a:Action):Promise<unknown>}){
  const saved = validPetBehavior(state.settings.pet.behavior);
  const savedKey = JSON.stringify(saved);
  const [draft,setDraft] = useState<PetBehavior>(saved);
  const [status,setStatus] = useState('');
  useEffect(()=>{setDraft(saved);},[savedKey]);
  const update = (patch:Partial<PetBehavior>)=>setDraft(current=>validPetBehavior({...current,...patch}));
  const save = async (next:PetBehavior = draft) => {
    setStatus('保存中…');
    const result = await act({type:'pet.behavior',behavior:validPetBehavior(next)});
    setStatus(result === undefined ? '保存失败，请查看页面提示。' : '已保存，下一次空闲跑动按新设置执行。');
  };
  const preset = (id:PetBehaviorPresetId) => {
    const next = validPetBehavior(PET_BEHAVIOR_PRESETS[id]);
    setDraft(next);
    void save(next);
  };
  const reset = () => {
    const next = validPetBehavior(DEFAULT_PET_BEHAVIOR);
    setDraft(next);
    void save(next);
  };
  const minutes = (seconds:number) => seconds / 60;
  return <section className="studio-content pet-behavior">
    <header className="studio-toolbar"><h1>桌宠行为</h1><p className="hint">控制空闲跑动的节奏和速度。配置对所有皮肤生效，保存后无需重启。</p></header>
    <section className="settings-card behavior-card">
      <div className="behavior-card-head"><div><h2>空闲跑动</h2><p className="hint">只在没有任务、气泡关闭、没人操作且窗口可见时触发。</p></div><label className="check"><input aria-label="启用空闲跑动" type="checkbox" checked={draft.enabled} onChange={e=>update({enabled:e.target.checked})}/>启用</label></div>
      <div className="behavior-presets" aria-label="行为预设">
        {(['calm','standard','lively'] as const).map((id,i)=><button key={id} className={JSON.stringify(validPetBehavior(PET_BEHAVIOR_PRESETS[id]))===savedKey?'active':''} onClick={()=>preset(id)}>{['安静','标准','活泼'][i]}</button>)}
      </div>
      <div className="behavior-grid">
        <fieldset><legend>首次等待</legend><div className="behavior-pair"><label>最短（分钟）<input aria-label="首次等待最短分钟" type="number" min={PET_BEHAVIOR_LIMITS.firstDelaySec.min/60} max={PET_BEHAVIOR_LIMITS.firstDelaySec.max/60} step=".5" value={minutes(draft.firstDelayMinSec)} onChange={e=>update({firstDelayMinSec:(+e.target.value||0)*60})}/></label><span>–</span><label>最长（分钟）<input aria-label="首次等待最长分钟" type="number" min={PET_BEHAVIOR_LIMITS.firstDelaySec.min/60} max={PET_BEHAVIOR_LIMITS.firstDelaySec.max/60} step=".5" value={minutes(draft.firstDelayMaxSec)} onChange={e=>update({firstDelayMaxSec:(+e.target.value||0)*60})}/></label></div></fieldset>
        <fieldset><legend>两次跑动间隔</legend><div className="behavior-pair"><label>最短（分钟）<input aria-label="跑动间隔最短分钟" type="number" min={PET_BEHAVIOR_LIMITS.intervalSec.min/60} max={PET_BEHAVIOR_LIMITS.intervalSec.max/60} step=".5" value={minutes(draft.intervalMinSec)} onChange={e=>update({intervalMinSec:(+e.target.value||0)*60})}/></label><span>–</span><label>最长（分钟）<input aria-label="跑动间隔最长分钟" type="number" min={PET_BEHAVIOR_LIMITS.intervalSec.min/60} max={PET_BEHAVIOR_LIMITS.intervalSec.max/60} step=".5" value={minutes(draft.intervalMaxSec)} onChange={e=>update({intervalMaxSec:(+e.target.value||0)*60})}/></label></div></fieldset>
        <Slider label="偶尔跑步概率" value={draft.runChancePct} min={PET_BEHAVIOR_LIMITS.runChancePct.min} max={PET_BEHAVIOR_LIMITS.runChancePct.max} step={5} format={value=>value+'%'} change={value=>update({runChancePct:value})}/>
        <Slider label="奔跑速度" value={draft.speed} min={PET_BEHAVIOR_LIMITS.speed.min} max={PET_BEHAVIOR_LIMITS.speed.max} step={.1} format={value=>value.toFixed(1)+'×'} change={value=>update({speed:value})}/>
        <Slider label="单程距离" value={draft.distancePx} min={PET_BEHAVIOR_LIMITS.distancePx.min} max={PET_BEHAVIOR_LIMITS.distancePx.max} step={10} format={value=>value+' px'} change={value=>update({distancePx:value})}/>
        <label>每次来回<select aria-label="每次来回" value={draft.rounds} onChange={e=>update({rounds:+e.target.value})}>{[1,2,3].map(n=><option key={n} value={n}>{n} 次</option>)}</select></label>
        <label className="check behavior-wake"><input aria-label="睡觉时叫醒" type="checkbox" checked={draft.wake} onChange={e=>update({wake:e.target.checked})}/>睡觉时也允许被跑动叫醒</label>
      </div>
      <p className="hint">首次等待和间隔使用分钟；速度同时影响窗口位移和动画播放速度。每次去程先慢走一段，只有按“偶尔跑步概率”命中时才切跑；回程始终慢走。单程距离是目标值，实际会在 92%–100% 之间轻微随机。</p>
      <div className="actions"><button className="primary" onClick={()=>void save()}>保存行为</button><button onClick={reset}>恢复默认</button><span role="status">{status}</span></div>
    </section>
    <section className="settings-card behavior-note"><h2>方向自检</h2><p className="hint">左右朝向由皮肤自己的 <code>flipX</code> 决定。修改素材后到「桌宠库」选择 <code>running-left</code> / <code>running-right</code> 各看一遍；预览现在会显示真实翻转。</p></section>
  </section>;
}
