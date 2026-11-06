import type {SkinManifest} from '../pet/shared/types';
import type {MotionKey,QualityReport} from './workshop';
export interface ArkModel {id:string;kind:'image'|'video';name:string;price:number;priceDate:string;source:string;resolutions:string[];durations:number[];imageSize:string;audioParameter:boolean}
export interface StudioSettings {endpoint:string;models:ArkModel[];imageModel:string;videoModel:string;hasKey:boolean}
export interface StudioSkin {id:string;name:string;source:'builtin'|'imported'|'generated'|'legacy';manifest:SkinManifest;baseUrl:string;thumbnail?:string}
export interface MatteOptions {color:string;similarity:number;blend:number;start:number;end?:number}
export interface CloudOperation {manualReview?:{outcome:'accepted'|'not-accepted';at:number;taskId?:string;note?:string};characterHash?:string;id:string;commandId:string;stage:'image'|'video';motion?:MotionKey;model:ArkModel;endpoint:string;prompt:string;seed:number;resolution:string;duration:number;createdAt:number;state:'submitting'|'submitted'|'unknown'|'download'|'processing'|'ready'|'needs-attention'|'error'|'cancelled';taskId?:string;error?:string;reserved:number;usage?:unknown;raw?:string;result?:string;downloadUrl?:string;imageData?:string;quality?:QualityReport;matte:MatteOptions;animation?:import('../pet/shared/types').SkinAnimation;frames?:string[];elapsedMs?:number;reviewed?:boolean}
export interface StudioProject {id:string;commandId:string;name:string;description:string;prompt:string;createdAt:number;updatedAt:number;character?:string;characterHash?:string;characterConfirmed:boolean;motions:MotionKey[];prompts:Partial<Record<MotionKey,string>>;resolution:string;duration:number;budget:number;retries:0|1;operations:CloudOperation[];status:'draft'|'character'|'running'|'paused'|'review'|'completed'|'error';error?:string;cancelled?:boolean;authorization?:{id:string;at:number;characterHash:string;budget:number;retries:number;motions:MotionKey[];prompts:Partial<Record<MotionKey,string>>;model:ArkModel;endpoint:string;resolution:string;duration:number};skinId?:string;matte:MatteOptions}
export interface StudioSnapshot {settings:StudioSettings;projects:StudioProject[];skins:StudioSkin[];selectedSkinId?:string;busy?:string;error?:string;catalog?:string[]}
export type StudioAction=
 | {type:'studio.settings';settings:StudioSettings;apiKey?:string}
 | {type:'studio.catalog'}
 | {type:'studio.create';commandId:string;description:string}
 | {type:'studio.update';id:string;patch:Partial<Pick<StudioProject,'name'|'description'|'prompt'|'motions'|'prompts'|'resolution'|'duration'|'budget'|'retries'|'matte'>>}
 | {type:'studio.character.upload';id:string}
 | {type:'studio.character.illustration';id:string;projectId:string;runId:string}
 | {type:'studio.prompt';id:string;profileId:string}
 | {type:'studio.character.generate';id:string;commandId:string;budget:number}
 | {type:'studio.character.confirm';id:string}
 | {type:'studio.generate';id:string;commandId:string}
 | {type:'studio.resume'|'studio.cancel'|'studio.publish';id:string}
 | {type:'studio.resolve';id:string;operationId:string;outcome:'accepted'|'not-accepted';taskId?:string;note?:string}
 | {type:'studio.process';id:string;operationId:string;matte:MatteOptions}
 | {type:'studio.review';id:string;operationId:string;accepted:boolean}
 | {type:'studio.skin.import';kind:'directory'|'zip'}
 | {type:'studio.skin.apply'|'studio.skin.delete'|'studio.skin.export';id:string}
 | {type:'studio.skin.edit';id:string;name?:string;anchor?:{x:number;y:number}};
export const DEFAULT_STUDIO_SETTINGS:StudioSettings={endpoint:'https://ark.cn-beijing.volces.com/api/v3',models:[],imageModel:'',videoModel:'',hasKey:false};
export const DEFAULT_MATTE:MatteOptions={color:'#00ff00',similarity:.18,blend:.08,start:0};
export const studioUrl=(file:string)=>'studio://asset/'+file.split('/').map(encodeURIComponent).join('/');
