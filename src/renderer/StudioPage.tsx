import React, { useState } from 'react';
import type { Action, Snapshot } from '../shared/contracts';
import { Appearance } from './Appearance';
import { PetPipeline } from './PetPipeline';
import './studio-page.css';

type Props = { state: Snapshot; act(a: Action): Promise<unknown> };

/**
 * 外观工坊的两个分区：上面是生成桌宠的工作流，下面是工作台自身的主题、配色和壁纸。
 * 生成流程较长，单独占满一屏，避免和工作台设置挤在一起。
 */
export function StudioPage({ state, act }: Props) {
  const [tab, setTab] = useState<'pet' | 'desk'>('pet');
  return <div className="studio-page">
    <nav className="studio-page-tabs" aria-label="外观工坊分区">
      <button className={tab === 'pet' ? 'active' : ''} aria-pressed={tab === 'pet'} onClick={() => setTab('pet')}>生成桌宠</button>
      <button className={tab === 'desk' ? 'active' : ''} aria-pressed={tab === 'desk'} onClick={() => setTab('desk')}>工作台外观</button>
    </nav>
    <div className="studio-page-body">
      {tab === 'pet' ? <PetPipeline state={state} act={act}/> : <Appearance state={state} act={act}/>}
    </div>
  </div>;
}
