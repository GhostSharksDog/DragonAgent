import { randomUUID } from 'node:crypto';
import type { AgentSession, ConversationVersion } from '../shared/contracts';
export function captureVersion(s:AgentSession, checkpoint:string):ConversationVersion {
  return structuredClone({id:s.versionId??randomUUID(),label:s.messages.filter(m=>m.role==='user').at(-1)?.text.slice(0,60)??'对话版本',createdAt:Date.now(),collaborationHistory:s.collaborationHistory,collaborationState:s.collaborationState,messages:s.messages,tools:s.tools,tasks:s.tasks,nativeId:s.nativeId,nativeTurnId:s.nativeTurnId,checkpoint,status:s.status,error:s.error,usage:s.usage});
}
export function rememberVersion(s:AgentSession,version:ConversationVersion) {
  s.versions=[...(s.versions??[]).filter(v=>v.id!==version.id),version];s.versionId=version.id;
}
export function applyVersion(s:AgentSession,version:ConversationVersion) {
  Object.assign(s,structuredClone({collaborationHistory:version.collaborationHistory,collaborationState:version.collaborationState,versionId:version.id,messages:version.messages,tools:version.tools,tasks:version.tasks,nativeId:version.nativeId,nativeTurnId:version.nativeTurnId,usage:version.usage,error:version.error,status:version.status,pending:[]}));
}
