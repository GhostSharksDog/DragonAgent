import React from 'react';
import type {Action,Snapshot} from '../shared/contracts';
import {Appearance} from './Appearance';
import {PetBehavior} from './PetBehavior';
import {CloudPetStudio,PetLibrary} from './StudioPanels';
import './studio-page.css';
export function StudioPage({state,act}:{state:Snapshot;act(a:Action):Promise<unknown>}){
 const tab=state.settings.appearance?.tab??'desk';
 const tabs=[['desk','工作台外观'],['behavior','桌宠行为'],['library','桌宠库'],['make','制作桌宠']] as const;
 return <div className="studio-page"><nav className="studio-page-tabs" aria-label="外观工坊分区">{tabs.map(([id,label])=><button key={id} className={tab===id?'active':''} aria-pressed={tab===id} onClick={()=>void act({type:'appearance.save',values:{},tab:id})}>{label}</button>)}</nav><div className="studio-page-body">{tab==='desk'?<Appearance state={state} act={act}/>:tab==='behavior'?<PetBehavior state={state} act={act}/>:tab==='library'?<PetLibrary state={state} act={act}/>:<CloudPetStudio state={state} act={act}/>}</div></div>;
}
