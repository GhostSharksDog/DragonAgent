import { contextBridge, ipcRenderer } from 'electron';
import type { Action } from '../shared/contracts';
const action = (value: Action) => ipcRenderer.invoke('dragon:action', value);
contextBridge.exposeInMainWorld('dragon', { snapshot: () => ipcRenderer.invoke('dragon:snapshot'), action, subscribe: (listener: (value: unknown) => void) => { const receive = (_event: unknown, value: unknown) => listener(value); ipcRenderer.on('dragon:state', receive); return () => ipcRenderer.off('dragon:state', receive); } });
contextBridge.exposeInMainWorld('pet', {
  drag: (dx: number, dy: number) => action({ type: 'pet.drag', dx, dy }),
  setBubbleMode: (mode: string) => action({ type: 'pet.view', view: mode === 'hidden' ? 'hidden' : 'reply' }),
  showReply: () => action({ type: 'pet.view', view: 'reply' }), openComposer: () => action({ type: 'pet.view', view: 'compose' }), openQuota: () => action({ type: 'pet.view', view: 'quota' }),
  refreshQuota: () => action({ type: 'quota.refresh' }), showContextMenu: () => action({ type: 'window.menu' }),
  layoutQuickBubble: async () => undefined, confirmQuickLayout: async () => undefined,
});
