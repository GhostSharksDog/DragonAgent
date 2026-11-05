import type { CharacterSettings, ComfyOperation, WorkshopProject } from './workshop';

/**
 * 内置「整理提示词」Agent 的创作人设：插画页的对话与「分析参考并生成」共用。
 * 这段文字会原样作为系统提示的第一段，用户可以在页面里查看。
 */
export const PROMPT_AGENT_PERSONA = `你是一名面向成年用户的创意写作助手，擅长二次元角色设定、小说创作和人物互动。

请根据用户的具体要求进行创作，准确理解虚构情境与现实行为之间的区别。

对于符合服务规则的成人题材、浪漫关系、暧昧互动和情感描写，可以自然、细致地创作，不必因为题材涉及成年人或亲密关系就一概拒绝。

如果部分请求超出服务允许的范围，请简要说明，并尽可能保留用户原本的创作意图，提供合规的替代表达。`;

export interface PromptUpdate { character?:string; pose?:string; positive?:string; negative?:string }
export interface PromptAnswer { text:string; update?:PromptUpdate }

const PROMPT_FIELDS = ['character','pose','positive','negative'] as const;
function updateOf(value:unknown):PromptUpdate|undefined{
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const source=value as Record<string,unknown>,update:PromptUpdate={};
  for(const key of PROMPT_FIELDS){const field=source[key];if(typeof field==='string'&&field.trim())update[key]=field.trim();}
  return Object.keys(update).length?update:undefined;
}
function jsonOf(text:string):unknown{
  try{return JSON.parse(text);}catch{return undefined;}
}

/**
 * 拆分「整理提示词」Agent 的回答：正文原样显示在对话里，末尾的 prompt 代码块是隐藏的提示词更新。
 * 也兼容旧格式（整段就是一个 JSON、或只有 analysis 字段的 JSON）。
 */
export function parsePromptAnswer(raw:string):PromptAnswer{
  const text=raw.trim();
  if(!text)return {text:''};
  const fenced=[...text.matchAll(/```(?:prompt|json)?\s*\n?([\s\S]*?)```/gi)];
  for(const match of [...fenced].reverse()){
    const update=updateOf(jsonOf(match[1].trim()));
    if(!update)continue;
    return {text:(text.slice(0,match.index)+text.slice((match.index??0)+match[0].length)).trim(),update};
  }
  const whole=jsonOf(text),update=updateOf(whole);
  if(update){
    const analysis=whole&&typeof (whole as Record<string,unknown>).analysis==='string'?String((whole as Record<string,unknown>).analysis).trim():'';
    return {text:analysis,update};
  }
  const object=whole&&typeof whole==='object'&&!Array.isArray(whole)?whole as Record<string,unknown>:undefined;
  if(object&&typeof object.analysis==='string'&&object.analysis.trim())return {text:object.analysis.trim()};
  if(fenced.length===1&&text===fenced[0][0].trim())return {text:fenced[0][1].trim()};
  return {text};
}

export interface ArtistMapping { pixivId?: string; nickname: string; tag: string; verified: boolean; source?: string }
export interface IllustrationReference {
  characterMatched?:boolean;
  id: string; url: string; title: string; artist: string; artistId: string;
  tags: string[]; thumbnail?: string; localFile?: string; sha256?: string;
  selected: boolean; fetchedAt: number;
}
export interface IllustrationParameters {
  description: string; character: string; pose: string; artist?: ArtistMapping;
  positive: string; negative: string; seed: number; model: CharacterSettings;
  lora?: WorkshopProject['lora'];
}
export interface IllustrationRun {
  id: string; commandId: string; createdAt: number; finishedAt?: number;
  state: 'preparing' | 'submitted' | 'unknown' | 'completed' | 'cancelled' | 'error';
  parameters: IllustrationParameters; references: IllustrationReference[]; launch?:ComfyLaunchConfig;
  operation?: ComfyOperation; file?: string; sha256?: string; error?: string;
  elapsedMs?: number; peakVramBytes?: number; minRamFreeBytes?: number;
}
export interface IllustrationPreferences { persona: string; memory: string; updatedAt: number }
export interface IllustrationProject {
  activeJob?:'assistant'|'generation'|'library';
  referenceScan?:{query:string;ids:string[]};
  acceptedCommands?: string[];
  usage?: import('../../packages/agent-core/src/types').Usage;
  pendingUpdate?: IllustrationParameters;
  memory?: {text:string;updatedAt:number;source:string};
  loraCandidates?: import('./workshop').LoraCandidate[];
  download?: {received:number;total:number};
  id: string; commandId: string; name: string; createdAt: number; updatedAt: number;
  parameters: IllustrationParameters; revisions: IllustrationParameters[];
  references: IllustrationReference[]; runs: IllustrationRun[];
  messages: { id: string; role: 'user' | 'assistant'; text: string; createdAt: number }[];
  analysis?: { profileId: string; model: string; text: string; referenceIds: string[]; createdAt: number };
  status: 'idle' | 'searching' | 'analyzing' | 'generating' | 'needs-attention';
  error?: string;
}
export interface ComfyLaunchConfig {
  endpoint: string; python: string; entry: string; modelsRoot: string; output: string;
  extraModels?: string[]; source: 'desktop' | 'manual';
}
export interface IllustrationSnapshot {
  preferences?: IllustrationPreferences;
  projects: IllustrationProject[]; selectedId?: string; launch?: ComfyLaunchConfig;
  service: { state: 'offline' | 'starting' | 'ready' | 'error'; message?: string; checkedAt?: number };
}
export type IllustrationAction =
  | {type:'illustration.preferences.save';persona:string;memory:string}
  | {type:'illustration.pending.apply';id:string}
  | {type:'illustration.memory.save';id:string;text:string}
  | {type:'illustration.lora.search';id:string;query:string}
  | {type:'illustration.lora.install';id:string;versionId:number}
  | {type:'illustration.lora.import';id:string}
  | {type:'illustration.lora.reuse';id:string;workshopId?:string}
  | {type:'illustration.create';commandId:string;description:string}
  | {type:'illustration.delete';id:string}
  | {type:'illustration.select';id:string}
  | {type:'illustration.update';id:string;parameters:IllustrationParameters}
  | {type:'illustration.undo';id:string}
  | {type:'illustration.launch.save';config:ComfyLaunchConfig}
  | {type:'illustration.launch.detect'|'illustration.launch.start'}
  | {type:'illustration.pixiv.open';query?:string;artistId?:string}
  | {type:'illustration.references';id:string;url?:string}
  | {type:'illustration.reference.select';id:string;referenceId:string;selected:boolean}
  | {type:'illustration.assistant';commandId?:string;id:string;text:string;profileId:string;organize?:boolean}
  | {type:'illustration.generate';id:string;commandId:string;profileId?:string;analyze?:boolean}
  | {type:'illustration.cancel'|'illustration.resume'|'illustration.assistant.stop'|'illustration.generation.stop';id:string}
  | {type:'illustration.save';id:string;runId:string};
