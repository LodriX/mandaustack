import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/types';

const api: DesktopApi = {
  getInfo: () => ipcRenderer.invoke('app:info'),
  listSites: () => ipcRenderer.invoke('sites:list'),
  chooseDirectory: () => ipcRenderer.invoke('sites:chooseDirectory'),
  addSite: location => ipcRenderer.invoke('sites:add', location),
  removeSite: id => ipcRenderer.invoke('sites:remove', id),
  openDirectory: location => ipcRenderer.invoke('sites:openDirectory', location),
  detectRuntimes: () => ipcRenderer.invoke('runtimes:detect'),
  listManagedRuntimes: () => ipcRenderer.invoke('runtimes:managed'),
  installRuntime: id => ipcRenderer.invoke('runtimes:install', id),
  listPreviews: () => ipcRenderer.invoke('previews:list'),
  startPreview: id => ipcRenderer.invoke('previews:start', id),
  stopPreview: id => ipcRenderer.invoke('previews:stop', id),
  openPreview: id => ipcRenderer.invoke('previews:open', id)
};

contextBridge.exposeInMainWorld('mandaustack', api);
