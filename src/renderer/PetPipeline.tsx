import React, { useState } from 'react';
import type { Action, Snapshot } from '../shared/contracts';
import { Icon } from './Icons';
import avatar from '../../assets/branding/dragon-avatar.png';
import './pet-pipeline.css';

type Props = { state: Snapshot; act(a: Action): Promise<unknown> };

const REPO = 'https://github.com/PC2005-cloud/dsh-pet';
const blob = (file: string) => REPO + '/blob/main/' + file.split('/').map(encodeURIComponent).join('/');

const PROMPTS = [
  { title: '桌面宠物 · 10 秒动作提示词', file: 'prompts/桌面宠物 10 秒动作提示词.md', note: '11 个动作的主配方' },
  { title: '睡觉动作提示词', file: 'prompts/睡觉动作提示词.md', note: '入睡 / 循环 / 醒来三段' },
  { title: '系统通知图标提示词', file: 'prompts/系统通知图标 AI 生成提示词.md', note: '通知小图标素材' },
];

const CHAIN = `cd scripts
python watermark_step01.py   # 填充水印遮罩
python chroma_step02.py      # 绿幕抠像，产出 step02/
# 抠像不理想时改用 PR 手工抠像：
# python pr_import_step02.py
python normalize_step03.py   # 统一 2160×1215，站立居中
python encode_thumbs.py      # 转码 640×360 播放变体`;

const APPLY = `# 播放变体同步进插件包
cp step04/*.webm dsh-pet/assets/webm/

# 本地安装插件，profile 换成你在用的那个
dsh plugin --profile desktop add file:D:/path/to/dsh-pet/dsh-pet`;

function useCopy() {
  const [copied, setCopied] = useState<string>();
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(current => current === key ? undefined : current), 1800);
    } catch {
      setCopied(undefined);
    }
  };
  return { copied, copy };
}

export function PetPipeline({ state, act }: Props) {
  const { copied, copy } = useCopy();
  const open = (url: string) => void act({ type: 'external.open', url });
  const skins = state.workshop?.skins ?? [];
  const selected = state.workshop?.selectedSkinId ?? null;
  return <section className="pipeline-page">
    <header className="pipeline-head">
      <div>
        <div className="eyebrow">DSH-PET · 素材链</div>
        <h1>生成桌宠</h1>
        <p className="subtitle">一段 AI 视频，走到桌宠身上的一整套透明动画。配方和脚本都在 dsh-pet 仓库里，这里是它的操作台。</p>
      </div>
      <div className="pipeline-actions">
        <button onClick={() => open(REPO)}>打开仓库<Icon name="external" size={15}/></button>
        <button className="plain" onClick={() => open(blob('MAKE-YOUR-OWN-PET.md'))}>工作流说明</button>
      </div>
    </header>

    <div className="pipeline-steps">
      <article className="pipeline-step">
        <span className="pipeline-index">01</span>
        <div>
          <h2>提示词 → 源视频</h2>
          <p>用可灵、Runway、豆包这类工具，一个动作生成一段 10 秒绿幕视频。规格照配方来，后面抠像才干净。</p>
          <ul className="pipeline-specs">
            <li>16:9</li><li>纯绿幕 #00FF00</li><li>头顶约 20%</li><li>脚底约 85%</li><li>首尾正面站立</li><li>按秒分解</li>
          </ul>
          <div className="pipeline-links">{PROMPTS.map(item => <button key={item.file} className="pipeline-link" onClick={() => open(blob(item.file))}><Icon name="book" size={15}/><span>{item.title}<small>{item.note}</small></span></button>)}</div>
        </div>
      </article>

      <article className="pipeline-step">
        <span className="pipeline-index">02</span>
        <div>
          <h2>源视频 → 透明动画</h2>
          <p>把 mp4 放进仓库的 video/，在 scripts/ 里按顺序跑一遍。依赖 Python 3、ffmpeg、numpy、scipy，脚本会自动找工作区的 ffmpeg。</p>
          <div className="pipeline-code">
            <pre>{CHAIN}</pre>
            <button className="plain" onClick={() => void copy(CHAIN, 'chain')}>{copied === 'chain' ? '已复制' : '复制命令'}</button>
          </div>
          <p className="pipeline-note">自动抠像适合边缘干净的动作；带第三方物品、边缘复杂的，用 PR 导出的带 alpha 的 .mov 覆盖同名动作更稳。</p>
        </div>
      </article>

      <article className="pipeline-step">
        <span className="pipeline-index">03</span>
        <div>
          <h2>透明动画 → 桌宠</h2>
          <p>把 step04 的播放变体同步进插件包，再以本地路径装插件。macOS 需要 HEVC 版 .mov，从 Release 的 assets-mov 下。</p>
          <div className="pipeline-code">
            <pre>{APPLY}</pre>
            <button className="plain" onClick={() => void copy(APPLY, 'apply')}>{copied === 'apply' ? '已复制' : '复制命令'}</button>
          </div>
        </div>
      </article>

      <article className="pipeline-step pipeline-step-sleep">
        <span className="pipeline-index">04</span>
        <div>
          <h2>睡觉是三步接力</h2>
          <p>入睡、循环、醒来各一段。入睡段和循环段结尾不回站立，循环段首尾两帧必须一致，醒来段才回站立；三段共用同一条地面线。生成后先比对帧再进素材链，三个名字写进 config.jsonc 的 animations.sleep。</p>
        </div>
      </article>
    </div>

    <section className="pipeline-pets">
      <div className="pipeline-pets-head"><h2>当前桌宠</h2><span>原版龙娘始终保留</span></div>
      <div className="pipeline-skin-grid">
        <button className={'pipeline-skin' + (selected === null ? ' selected' : '')} aria-pressed={selected === null} onClick={() => void act({ type: 'skin.select', id: null })}>
          <img src={avatar} alt="银白龙娘"/>
          <div><strong>银白龙娘 · 霜璃</strong><small>{selected === null ? '当前桌宠' : '恢复原版'}</small></div>
          {selected === null && <Icon name="check" size={17}/>}
        </button>
        {skins.map(skin => <button key={skin.id} className={'pipeline-skin' + (selected === skin.id ? ' selected' : '')} aria-pressed={selected === skin.id} onClick={() => void act({ type: 'skin.select', id: skin.id })}>
          <img src={skin.thumbnail} alt={skin.name}/>
          <div><strong>{skin.name}</strong><small>{selected === skin.id ? '当前桌宠' : '应用'}</small></div>
          {selected === skin.id && <Icon name="check" size={17}/>}
        </button>)}
      </div>
    </section>
  </section>;
}
