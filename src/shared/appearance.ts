export interface WallpaperAsset {file:string;name:string;addedAt:number;usedAt:number}
export interface AppearanceValues {
  fit:'cover'|'contain'; x:number;y:number; output:number;header:number;selection:number;
  fontSize:14|15|16|18;density:'standard'|'compact'; customAccent?:string;
}
export interface AppearancePreset {id:string;name:string;values:AppearanceValues;theme:'light'|'dark'|'system';accent:'violet'|'teal'|'amber'|'ink';wallpaper?:{file:string;name:string;opacity:number;blur:number;dim:number}|null}
export interface AppearanceSettings extends AppearanceValues {wallpapers:WallpaperAsset[];presets:AppearancePreset[];tab:'desk'|'behavior'|'library'|'make'}
export const DEFAULT_APPEARANCE:AppearanceSettings={fit:'cover',x:50,y:50,output:.48,header:.24,selection:.58,fontSize:15,density:'standard',wallpapers:[],presets:[],tab:'desk'};
export function appearanceValues(raw:Partial<AppearanceValues>):AppearanceValues {
  const n=(v:unknown,fallback:number,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
  return {fit:raw.fit==='contain'?'contain':'cover',x:n(raw.x,50,0,100),y:n(raw.y,50,0,100),output:n(raw.output,.48,0,1),header:n(raw.header,.24,0,1),selection:n(raw.selection,.58,0,1),fontSize:[14,15,16,18].includes(raw.fontSize!)?raw.fontSize!:15,density:raw.density==='compact'?'compact':'standard',customAccent:/^#[a-f\d]{6}$/i.test(raw.customAccent??'')?raw.customAccent:undefined};
}
