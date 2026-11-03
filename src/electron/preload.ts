import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/types';

const api: DesktopApi = {
  getInfo: () => ipcRenderer.invoke('app:info'),
  listSites: () => ipcRenderer.invoke('sites:list'),
  chooseDirectory: () => ipcRenderer.invoke('sites:chooseDirectory'),
  addSite: location => ipcRenderer.invoke('sites:add', location),
  removeSite: id => ipcRenderer.invoke('sites:remove', id),
  openDirectory: location => ipcRenderer.invoke('sites:openDirectory', location),
  previewHosts: () => ipcRenderer.invoke('sites:previewHosts'),
  applyHosts: expectedSha256 => ipcRenderer.invoke('sites:applyHosts', expectedSha256),
  restoreHosts: () => ipcRenderer.invoke('sites:restoreHosts'),
  installCaTrust: () => ipcRenderer.invoke('ca:installTrust'),
  removeCaTrust: () => ipcRenderer.invoke('ca:removeTrust'),
  previewNginx: () => ipcRenderer.invoke('nginx:preview'),
  prepareNginx: (expectedSha256, expectedConfigurationSha256) => ipcRenderer.invoke('nginx:prepare', expectedSha256, expectedConfigurationSha256),
  restoreNginx: expectedSha256 => ipcRenderer.invoke('nginx:restore', expectedSha256),
  nginxStatus: () => ipcRenderer.invoke('nginx:status'),
  startNginx: () => ipcRenderer.invoke('nginx:start'),
  stopNginx: () => ipcRenderer.invoke('nginx:stop'),
  detectRuntimes: () => ipcRenderer.invoke('runtimes:detect'),
  listManagedRuntimes: () => ipcRenderer.invoke('runtimes:managed'),
  installRuntime: id => ipcRenderer.invoke('runtimes:install', id),
  listPreviews: () => ipcRenderer.invoke('previews:list'),
  startPreview: id => ipcRenderer.invoke('previews:start', id),
  stopPreview: id => ipcRenderer.invoke('previews:stop', id),
  openPreview: id => ipcRenderer.invoke('previews:open', id)
};

contextBridge.exposeInMainWorld('mandaustack', api);
