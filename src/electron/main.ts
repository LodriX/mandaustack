import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDirectory } from '../core/paths';
import { planHosts, systemHostsPath } from '../core/hosts';
import { HttpsGateway } from '../core/https-gateway';
import { MacCaTrust } from '../core/mac-ca-trust';
import { NginxConfigManager } from '../core/nginx-config';
import { NginxService } from '../core/nginx-service';
import { authorizedHostsOperation } from '../core/mac-hosts';
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
const gateway = new HttpsGateway(dataDirectory(), () => store.list(), previews);
const nginx = new NginxConfigManager(dataDirectory());
const nginxService = new NginxService(nginx);
let updatingNginx = false;
let caTrust: MacCaTrust | null = null;
let updatingCaTrust = false;
let gatewayError: string | null = null;
const hostsStatePath = path.join(dataDirectory(), 'hosts-installation.json');
let updatingHosts = false;

function savedHostsOperation(): { backupPath: string; appliedSha256: string } | null {
  if (!fs.existsSync(hostsStatePath)) return null;
  const saved: unknown = JSON.parse(fs.readFileSync(hostsStatePath, 'utf8'));
  if (!saved || typeof saved !== 'object' || !('backupPath' in saved) || !('appliedSha256' in saved) ||
    typeof saved.backupPath !== 'string' || typeof saved.appliedSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(saved.appliedSha256)) throw new Error('Saved hosts recovery record is damaged; it was preserved.');
  return { backupPath: saved.backupPath, appliedSha256: saved.appliedSha256 };
}

function saveHostsOperation(value: { backupPath: string; appliedSha256: string }): void {
  fs.mkdirSync(path.dirname(hostsStatePath), { recursive: true, mode: 0o700 });
  const temporary = `${hostsStatePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, hostsStatePath);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function hostsPreview() {
  const file = systemHostsPath();
  const plan = planHosts(fs.readFileSync(file, 'utf8'), store.list().map(site => site.domain));
  return { file, added: plan.added, removed: plan.removed, changed: plan.changed,
    originalSha256: plan.originalSha256, restoreAvailable: Boolean(savedHostsOperation()) };
}

function macHelperPath(): string { return path.join(app.getAppPath(), 'dist-electron', 'hosts-helper.js'); }

function nginxPreview() {
  const status = gateway.getStatus();
  if (!status) throw new Error('Start the HTTPS gateway before preparing nginx.');
  return nginx.plan(store.list(), status.port);
}

async function localNginxBinary(): Promise<string> {
  const artifact = artifacts.find(item => item.name === 'nginx');
  const managed = artifact ? await installer.installed(artifact) : null;
  if (managed) return managed.binary;
  const binary = ['/opt/homebrew/bin/nginx', '/usr/local/bin/nginx'].find(candidate => fs.existsSync(candidate));
  if (!binary) throw new Error('Install managed nginx in the app before preparing its configuration.');
  return binary;
}

async function managedRuntimes(): Promise<RuntimeOption[]> {
  return Promise.all(artifacts.map(async artifact => ({
    id: artifact.id, name: artifact.name, version: artifact.version,
    sourceUrl: artifact.sourceUrl, license: artifact.license, buildSources: artifact.buildSources,
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

app.whenReady().then(async () => {
  try {
    const status = await gateway.start();
    if (process.platform === 'darwin') caTrust = new MacCaTrust(status.caPath, dataDirectory());
  }
  catch (error) { gatewayError = (error as Error).message; }
  ipcMain.handle('app:info', async () => {
    let caTrustStatus = null;
    let caTrustError = null;
    if (caTrust) {
      try { caTrustStatus = await caTrust.status(); }
      catch (error) { caTrustError = (error as Error).message; }
    }
    return { version: app.getVersion(), dataDirectory: dataDirectory(), platform: process.platform,
      gateway: gateway.getStatus(), gatewayError, caTrust: caTrustStatus, caTrustError };
  });
  ipcMain.handle('ca:installTrust', async () => {
    if (!caTrust) throw new Error('Local CA trust is available only while the macOS HTTPS gateway is running.');
    if (updatingCaTrust) throw new Error('A CA trust operation is already in progress.');
    updatingCaTrust = true;
    try { return await caTrust.install(); }
    finally { updatingCaTrust = false; }
  });
  ipcMain.handle('ca:removeTrust', async () => {
    if (!caTrust) throw new Error('Local CA trust is available only while the macOS HTTPS gateway is running.');
    if (updatingCaTrust) throw new Error('A CA trust operation is already in progress.');
    updatingCaTrust = true;
    try { return await caTrust.remove(); }
    finally { updatingCaTrust = false; }
  });
  ipcMain.handle('nginx:preview', nginxPreview);
  ipcMain.handle('nginx:prepare', async (_event, expected: unknown, expectedConfiguration: unknown) => {
    if (process.platform !== 'darwin') throw new Error('nginx configuration preparation is available on macOS only.');
    if (nginxService.status().running) throw new Error('Stop managed nginx before replacing its configuration.');
    const preview = nginxPreview();
    if (typeof expected !== 'string' || expected !== preview.originalSha256 ||
      typeof expectedConfiguration !== 'string' || expectedConfiguration !== preview.configurationSha256) {
      throw new Error('nginx configuration or site plan changed; review it again.');
    }
    if (updatingNginx) throw new Error('A nginx configuration operation is already in progress.');
    updatingNginx = true;
    try {
      await nginx.prepare(store.list(), gateway.getStatus()!.port, expected, expectedConfiguration, await localNginxBinary());
      return nginxPreview();
    } finally { updatingNginx = false; }
  });
  ipcMain.handle('nginx:restore', (_event, expected: unknown) => {
    if (process.platform !== 'darwin') throw new Error('nginx configuration recovery is available on macOS only.');
    if (nginxService.status().running) throw new Error('Stop managed nginx before restoring its configuration.');
    if (updatingNginx) throw new Error('A nginx configuration operation is already in progress.');
    if (typeof expected !== 'string') throw new Error('Invalid nginx recovery checksum.');
    nginx.restore(expected);
    return nginxPreview();
  });
  ipcMain.handle('nginx:status', () => nginxService.status());
  ipcMain.handle('nginx:start', async () => {
    if (process.platform !== 'darwin') throw new Error('Managed nginx is available on macOS only.');
    if (updatingNginx) throw new Error('A nginx configuration operation is already in progress.');
    const status = gateway.getStatus();
    if (!status) throw new Error('The HTTPS gateway is unavailable.');
    updatingNginx = true;
    try { return await nginxService.start(store.list(), status.port, status.caPath, await localNginxBinary()); }
    finally { updatingNginx = false; }
  });
  ipcMain.handle('nginx:stop', async () => {
    if (updatingNginx) throw new Error('A nginx operation is already in progress.');
    updatingNginx = true;
    try {
      await nginxService.stop();
      return nginxService.status();
    } finally { updatingNginx = false; }
  });
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
  ipcMain.handle('sites:previewHosts', hostsPreview);
  ipcMain.handle('sites:applyHosts', async (_event, expected: unknown) => {
    if (process.platform !== 'darwin') throw new Error('Installing .test hosts entries is not available on Windows yet.');
    const preview = hostsPreview();
    if (typeof expected !== 'string' || expected !== preview.originalSha256) throw new Error('Hosts plan changed; review it again before installing.');
    if (!preview.changed) throw new Error('The hosts file is already up to date.');
    if (updatingHosts) throw new Error('A hosts operation is already in progress.');
    updatingHosts = true;
    try {
      const domains = store.list().map(site => site.domain);
      const result = await authorizedHostsOperation(process.execPath, macHelperPath(), ['apply', expected, ...domains]);
      if (result.backupPath) saveHostsOperation({ backupPath: result.backupPath, appliedSha256: result.appliedSha256 });
      return hostsPreview();
    } finally { updatingHosts = false; }
  });
  ipcMain.handle('sites:restoreHosts', async () => {
    if (process.platform !== 'darwin') throw new Error('Hosts recovery is not available on Windows yet.');
    const saved = savedHostsOperation();
    if (!saved) throw new Error('No previous MandauStack hosts update was saved.');
    if (updatingHosts) throw new Error('A hosts operation is already in progress.');
    updatingHosts = true;
    try {
      await authorizedHostsOperation(process.execPath, macHelperPath(), ['restore', saved.appliedSha256, saved.backupPath]);
      fs.rmSync(hostsStatePath);
      return hostsPreview();
    } finally { updatingHosts = false; }
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
  void Promise.allSettled([nginxService.stop(), previews.stopAll(), gateway.stop()]).finally(() => {
    stopping = true;
    app.quit();
  });
});
