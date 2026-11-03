import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { dataDirectory } from '../core/paths';
import { PreviewManager } from '../core/previews';
import { availableArtifacts, RuntimeInstaller } from '../core/runtime-installer';
import { detectRuntimes, findPhpBinary } from '../core/runtimes';
import { SiteStore } from '../core/sites';
import type { RuntimeOption } from '../shared/types';

app.setName('MandauStack');
app.setPath('userData', dataDirectory());
const store = new SiteStore(dataDirectory());
const artifacts = availableArtifacts();
const installer = new RuntimeInstaller(path.join(dataDirectory(), 'runtimes'));
const previews = new PreviewManager(undefined, async () => {
  const php = artifacts.find(artifact => artifact.name === 'PHP');
  const managed = php ? await installer.installed(php) : null;
  return managed ? { binary: managed.binary, mode: php?.archive === 'binary' ? 'frankenphp' as const : 'php' as const } : findPhpBinary();
});

async function managedRuntimes(): Promise<RuntimeOption[]> {
  return Promise.all(artifacts.map(async artifact => ({
    id: artifact.id, name: artifact.name, version: artifact.version,
    sourceUrl: artifact.sourceUrl, license: artifact.license,
    installed: Boolean(await installer.installed(artifact))
  })));
}

function linkedSite(id: unknown) {
  if (typeof id !== 'string') throw new Error('Invalid project ID.');
  const site = store.list().find(item => item.id === id);
  if (!site) throw new Error('Project not found.');
  return site;
}

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'MandauStack',
    width: 1120,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#faf9f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  if (!app.isPackaged && process.env.MANDAUSTACK_DEV_URL) {
    void window.loadURL(process.env.MANDAUSTACK_DEV_URL);
  } else if (!app.isPackaged) {
    void window.loadURL('http://127.0.0.1:5173');
  } else {
    void window.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDirectory: dataDirectory() }));
  ipcMain.handle('sites:list', () => store.list());
  ipcMain.handle('sites:chooseDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('sites:add', (_event, location: unknown) => {
    if (typeof location !== 'string') throw new Error('Invalid directory.');
    return store.add(location);
  });
  ipcMain.handle('sites:remove', async (_event, id: unknown) => {
    const site = linkedSite(id);
    await previews.stop(site.id);
    store.remove(site.id);
  });
  ipcMain.handle('sites:openDirectory', async (_event, location: unknown) => {
    if (typeof location !== 'string' || !store.list().some(site => site.path === location)) {
      throw new Error('Project not found.');
    }
    const error = await shell.openPath(location);
    if (error) throw new Error(error);
  });
  ipcMain.handle('runtimes:detect', detectRuntimes);
  ipcMain.handle('runtimes:managed', managedRuntimes);
  ipcMain.handle('runtimes:install', async (_event, id: unknown) => {
    const artifact = artifacts.find(item => item.id === id);
    if (!artifact) throw new Error('Unknown runtime.');
    await installer.install(artifact);
    return managedRuntimes();
  });
  ipcMain.handle('previews:list', () => previews.list());
  ipcMain.handle('previews:start', (_event, id: unknown) => previews.start(linkedSite(id)));
  ipcMain.handle('previews:stop', (_event, id: unknown) => previews.stop(linkedSite(id).id));
  ipcMain.handle('previews:open', async (_event, id: unknown) => {
    const site = linkedSite(id);
    const preview = previews.list().find(item => item.siteId === site.id);
    if (!preview) throw new Error('Start the preview before opening it.');
    await shell.openExternal(preview.url);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let stopping = false;
app.on('before-quit', event => {
  if (stopping) return;
  event.preventDefault();
  void previews.stopAll().finally(() => {
    stopping = true;
    app.quit();
  });
});
