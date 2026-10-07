import { contextBridge, ipcRenderer } from 'electron';
import type { Snapshot, TerrariumAction, TerrariumBridge } from '../shared/types.js';
const bridge: TerrariumBridge = {
  getSnapshot: () => ipcRenderer.invoke('terrarium:get'),
  dispatch: (action: TerrariumAction) => ipcRenderer.invoke('terrarium:action', action),
  finishInteraction: () => ipcRenderer.invoke('terrarium:finish-interaction'),
  subscribe(listener) {
    const handler = (_event: unknown, snapshot: Snapshot): void => listener(snapshot);
    ipcRenderer.on('terrarium:update', handler);
    return () => { ipcRenderer.removeListener('terrarium:update', handler); };
  },
  openWorkshop: () => { ipcRenderer.send('terrarium:open'); },
  hideWidget: () => { ipcRenderer.send('terrarium:hide'); },
  setWidgetPassthrough: (ignore: boolean) => { ipcRenderer.send('terrarium:passthrough', ignore); },
  moveWidget: (dx: number, dy: number) => { ipcRenderer.send('terrarium:move-widget', dx, dy); },
  exportSave: () => ipcRenderer.invoke('terrarium:export'),
  importSave: () => ipcRenderer.invoke('terrarium:import'),
};
contextBridge.exposeInMainWorld('terrarium', Object.freeze(bridge));
