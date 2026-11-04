import type { SkinAnimation, SkinData } from '../pet/shared/types';

export const PET_WORKFLOW_VERSION = 1;
export const MOTIONS = [
  { key: 'idle', name: '待机', loop: true, prompt: 'Gentle breathing, occasional blinking, subtle hair and tail sway. Remain standing in the same place, relaxed neutral pose. Seamless idle loop.' },
  { key: 'walking-left', name: '向左走', loop: true, prompt: 'Turn to face screen left, then walk in place facing left. Complete alternating footfalls, natural arm swing, consistent body proportions. Fixed ground level, no camera movement.' },
  { key: 'walking-right', name: '向右走', loop: true, prompt: 'Turn to face screen right, then walk in place facing right. Complete alternating footfalls, natural arm swing, consistent body proportions. Fixed ground level, no camera movement.' },
  { key: 'running-left', name: '向左跑', loop: true, prompt: 'Run in place facing screen left. A lively complete running cycle with alternating legs and arms, hair and tail following the movement. Fixed ground level.' },
  { key: 'running-right', name: '向右跑', loop: true, prompt: 'Run in place facing screen right. A lively complete running cycle with alternating legs and arms, hair and tail following the movement. Fixed ground level.' },
  { key: 'thinking', name: '思考', loop: true, prompt: 'Standing still, thoughtfully tilt the head a little, one hand near the chin. Gentle breathing and blinking. Return to the initial thoughtful pose.' },
  { key: 'speaking', name: '说话', loop: true, prompt: 'Standing in place, gently talk with small mouth movements and restrained hand gestures, natural blinking. Keep the face and body consistent.' },
  { key: 'awaiting-input', name: '等待输入', loop: true, prompt: 'Patiently waiting in place, curious gentle expression, small head tilt, occasional blink, return to the same relaxed pose.' },
  { key: 'awaiting-approval', name: '等待审批', loop: true, prompt: 'An expectant expression, gently offer one open palm, hold the gesture, blink, subtle breathing. Stay in place.' },
  { key: 'success', name: '成功', loop: false, prompt: 'A small cheerful smile and friendly wave, then lower the hand and return to a relaxed standing pose. A single complete gesture, no jump.' },
  { key: 'error', name: '失败', loop: false, prompt: 'A brief apologetic expression and slight head shake, then return to a relaxed standing pose. A single subtle gesture, remain standing in place.' },
] as const;
export type MotionKey = typeof MOTIONS[number]['key'];
export type WorkshopStatus = 'draft' | 'character' | 'awaiting-character' | 'queued' | 'running' | 'stopping' | 'paused' | 'review' | 'needs-attention' | 'completed' | 'cancelled' | 'error';
export type CharacterBackend = 'anima' | 'animagine';
export interface CharacterSettings { backend: CharacterBackend; model: string; encoder: string; vae: string; width: number; height: number; steps: number; cfg: number; sampler: string; scheduler: string }
export const ANIMA_SETTINGS: CharacterSettings = {backend:'anima',model:'anima-base-v1.0.safetensors',encoder:'qwen_3_06b_base.safetensors',vae:'qwen_image_vae.safetensors',width:1024,height:1024,steps:30,cfg:4,sampler:'dpmpp_2m_sde_gpu',scheduler:'normal'};
export const ANIMAGINE_SETTINGS: CharacterSettings = {backend:'animagine',model:'animagineXL40_v4Opt.safetensors',encoder:'',vae:'',width:1024,height:1024,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal'};
export function characterSettings(s: WorkshopSettings): CharacterSettings { return s.character ?? {...ANIMAGINE_SETTINGS,model:s.checkpoint}; }
export function characterDefaults(backend: CharacterBackend) { return {characterPrompt: backend==='anima' ? 'masterpiece, best quality, safe, 1girl, adult woman, silver hair, purple eyes, small dragon horns, gentle playful expression, simple costume, full body, feet visible, solo, centered, simple plain background' : '1girl, adult woman, silver hair, purple eyes, small dragon horns, gentle playful expression, simple costume, full body, feet visible, solo, centered, simple plain background, safe, masterpiece, high score, great score', negativePrompt:'worst quality, low quality, blurry, bad anatomy, extra limbs, extra fingers, cropped, text, watermark, multiple characters'}; }
export interface WorkshopSettings {
  character?: CharacterSettings;
  modelsRoot?:string;
  endpoint: string; checkpoint: string; videoModel: string; textEncoder: string; vae: string; matteModel: string;
}
export const DEFAULT_WORKSHOP_SETTINGS: WorkshopSettings = {
  character: {...ANIMA_SETTINGS}, endpoint: 'http://127.0.0.1:8188', checkpoint: 'animagine-xl-4.0.safetensors',
  videoModel: 'wan2.2_ti2v_5B_fp16.safetensors', textEncoder: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  vae: 'wan2.2_vae.safetensors', matteModel: 'BiRefNet_toonout',
};
export const WORKSHOP_LINKS = {
  install: 'https://docs.comfy.org/installation/desktop/windows',
  wan: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files',
  character: 'https://huggingface.co/cagliostrolab/animagine-xl-4.0/tree/main',
  rmbg: 'https://github.com/1038lab/ComfyUI-RMBG',
  matte: 'https://huggingface.co/1038lab/BiRefNet/tree/main',
};
export interface EnvironmentIssue { name: string; detail: string; severity: 'error' | 'warning'; url?: string }
export interface ComfyEnvironment {
  status: 'unchecked' | 'checking' | 'ready' | 'incomplete' | 'offline'; checkedAt?: number; endpoint: string;
  issues: EnvironmentIssue[]; checkpoints: string[]; gpu?: string; vramTotal?: number; vramFree?: number; ramTotal?: number; ramFree?: number;
  version?: string; supportsTargetedCancel?: boolean;
}
export interface CharacterAsset { id: string; file: string; source: 'upload' | 'generated'; seed?: number; model?: string; settings?:CharacterSettings; prompt?: string; negativePrompt?:string; lora?:WorkshopProject['lora']; sha256: string; createdAt: number }
export interface QualityReport {
  warnings: string[]; passed: boolean; frameCount: number; emptyFrames: number; clippedFrames: number;
  opaqueCorners: number; positionJump: number; alphaFlicker: number; seam?: number; motion: number;
}
export interface MotionVersion {
  id: string; seed: number; createdAt: number; prompt: string; model: string; characterId: string;
  status: 'generating' | 'matting' | 'processing' | 'ready' | 'needs-attention' | 'error' | 'cancelled';
  rawFiles: string[]; matteFiles: string[]; frames: string[]; animation?: SkinAnimation; quality?: QualityReport;
  error?: string; elapsedMs?: number; reviewed?: boolean;
}
export interface MotionTask { key: MotionKey; prompt: string; versions: MotionVersion[]; selectedVersionId?: string; attempts: number }
export interface ComfyFile { filename: string; subfolder: string; type: 'output' | 'input' | 'temp' }
export interface ComfyOperation {
  id: string; clientId: string; endpoint: string; stage: 'character' | 'video' | 'matte'; prefix: string;
  actionKey?: MotionKey; versionId?: string; batchStart?: number; promptId?: string; startedAt: number;
  state: 'submitting' | 'submitted' | 'unknown' | 'finished'; outputs?: ComfyFile[];
}
export interface WorkshopParameters {characterPrompt:string;negativePrompt:string;description:string;actions?:Partial<Record<MotionKey,string>>;seed?:number}
export interface WorkshopProject {
  download?: {state:'running'|'completed'|'error'|'cancelled';received:number;total:number;error?:string};
  assistant?: { status: 'idle'|'running'|'error'; messages: {role:'user'|'assistant';text:string}[]; error?:string };
  revisions?: WorkshopParameters[];
  draft?: WorkshopParameters;
  lora?: {authorNotes?:string;sourceUrl?:string;backend?:CharacterBackend;file:string;sha256:string;name:string;strength:number;triggerWords:string[];versionId?:number};
  candidates?: LoraCandidate[];
  id: string; commandId: string; templateId: 'pet-2d'; templateVersion: number; name: string; description: string;
  characterPrompt: string; negativePrompt: string; seed: number; settings: WorkshopSettings;
  status: WorkshopStatus; characters: CharacterAsset[]; characterId?: string; characterConfirmed: boolean;
  actions: MotionTask[]; operation?: ComfyOperation; operationLog: ComfyOperation[];
  requestedActions?: MotionKey[]; cancelRequested?: boolean; generationRequested?: boolean;
  progress: { label: string; value?: number; maximum?: number; node?: string };
  anchor: { x: number; y: number }; createdAt: number; updatedAt: number; error?: string;
  metrics: { elapsedMs: number; peakVramBytes: number; minRamFreeBytes?: number; gpu?: string };
  reviewedAt?: number; skinId?: string;
}
export interface WorkshopSkin { id: string; name: string; projectId: string; createdAt: number; manifest: SkinData['manifest']; thumbnail: string }
export interface WorkshopSnapshot {
  settings: WorkshopSettings; environment: ComfyEnvironment; projects: WorkshopProject[]; skins: WorkshopSkin[];
  selectedSkinId: string | null; activeProjectId?: string; civitaiKeySaved?: boolean;
}
export type WorkshopAction =
  | { type:'workshop.parameters'; id:string; parameters:Partial<WorkshopParameters> }
  | { type:'workshop.character.settings'; id:string; settings:CharacterSettings }
  | { type:'workshop.civitai.key'; apiKey:string }
  | { type:'workshop.civitai.clear' }
  | { type:'workshop.lora.import'; id:string }
  | { type: 'workshop.assistant.send'; id:string; text:string; profileId:string }
  | { type: 'workshop.assistant.stop'|'workshop.undo'|'workshop.draft.apply'|'workshop.lora.clear'|'workshop.lora.cancel'; id:string }
  | { type: 'workshop.lora.search'; id:string; query:string }
  | { type: 'workshop.lora.install'; id:string; versionId:number }
  | { type: 'workshop.lora.weight'; id:string; strength:number }
  | { type: 'workshop.settings'; settings: WorkshopSettings }
  | { type: 'workshop.check' }
  | { type: 'workshop.create'; commandId: string; name: string; description?: string }
  | { type: 'workshop.update'; id: string; name?: string; description?: string; characterPrompt?: string; negativePrompt?: string; seed?: number; anchor?: { x: number; y: number } }
  | { type: 'workshop.prompt'; id: string; profileId: string }
  | { type: 'workshop.upload'; id: string }
  | { type: 'workshop.character'; id: string }
  | { type: 'workshop.confirmCharacter'; id: string; characterId: string }
  | { type: 'workshop.run'; id: string }
  | { type: 'workshop.cancel'; id: string }
  | { type: 'workshop.resume'; id: string }
  | { type: 'workshop.retry'; id: string; key: MotionKey; prompt?: string }
  | { type: 'workshop.selectVersion'; id: string; key: MotionKey; versionId: string }
  | { type: 'workshop.review'; id: string; key?: MotionKey; accepted: boolean }
  | { type: 'workshop.resolveUnknown'; id: string }
  | { type: 'workshop.export'; id: string }
  | { type: 'workshop.publish'; id: string }
  | { type: 'workshop.delete'; id: string }
  | { type: 'skin.select'; id: string | null };
export const workshopBusy = (p: WorkshopProject) => ['character', 'queued', 'running', 'stopping'].includes(p.status);
export const motionVersion = (action: MotionTask) => action.versions.find(v => v.id === action.selectedVersionId);
export function workshopAsset(projectId: string, file: string) { return `workshop://projects/${encodeURIComponent(projectId)}/${file.split('/').map(encodeURIComponent).join('/')}`; }
export const WORKSHOP_STATUS: Record<WorkshopStatus, string> = {
  draft: '角色设定', character: '正在绘制角色', 'awaiting-character': '确认角色', queued: '排队中', running: '制作中', stopping: '正在收尾', paused: '已暂停',
  review: '等待预览确认', 'needs-attention': '有动作需要处理', completed: '已完成', cancelled: '已取消', error: '制作遇到问题',
};
export interface LoraCandidate { preview?:string; suggestedStrength?:number; backend?:CharacterBackend; versionId:number; name:string; author:string; baseModel:string; triggerWords:string[]; description:string; url:string; sizeKB:number; sha256:string; downloadUrl:string; compatible:boolean }
