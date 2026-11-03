import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import type { PreviewStatus, Site } from '../shared/types';
import { findPhpBinary } from './runtimes';

const execute = promisify(execFile);
const HOST = '127.0.0.1';

export function documentRoot(site: Site): string {
  // A moved or replaced project directory must be relinked, not served from another path.
  if (fs.realpathSync(site.path) !== site.path) throw new Error('Project directory has changed; relink it before starting.');
  const publicDirectory = path.join(site.path, 'public');
  if (fs.existsSync(path.join(publicDirectory, 'index.php'))) return publicDirectory;
  if (fs.existsSync(path.join(site.path, 'index.php')) || fs.existsSync(path.join(site.path, 'index.html'))) return site.path;
  throw new Error('No public/index.php, index.php, or index.html found in this project.');
}

async function availablePort(): Promise<number> {
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, HOST, () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not allocate a local port.');
    return address.port;
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function canConnect(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: HOST, port });
    socket.setTimeout(200);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

export class PreviewManager {
  private readonly running = new Map<string, { child: ChildProcess; url: string }>();
  private readonly pending = new Map<string, Promise<PreviewStatus>>();

  constructor(private readonly phpBinary?: string, private readonly locatePhp: () => Promise<string> = findPhpBinary) {}

  list(): PreviewStatus[] {
    return [...this.running].map(([siteId, { url }]) => ({ siteId, url }));
  }

  async start(site: Site): Promise<PreviewStatus> {
    const active = this.running.get(site.id);
    if (active) return { siteId: site.id, url: active.url };
    const pending = this.pending.get(site.id);
    if (pending) return pending;
    const operation = this.launch(site);
    this.pending.set(site.id, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(site.id);
    }
  }

  private async launch(site: Site): Promise<PreviewStatus> {
    const root = documentRoot(site);
    let binary: string;
    if (this.phpBinary) {
      try {
        await execute(this.phpBinary, ['-v'], { timeout: 3000, windowsHide: true });
        binary = this.phpBinary;
      } catch { throw new Error('PHP is not available. Install PHP before starting a preview.'); }
    } else binary = await this.locatePhp();
    const port = await availablePort();
    const url = `http://${HOST}:${port}/`;
    const child = spawn(binary, ['-S', `${HOST}:${port}`, '-t', root], {
      cwd: site.path,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let exited = false;
    let processError: Error | undefined;
    let output = '';
    child.stderr?.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-4096); });
    child.once('error', error => { processError = error; });
    child.once('exit', () => {
      exited = true;
      if (this.running.get(site.id)?.child === child) this.running.delete(site.id);
    });

    try {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (processError || exited) throw new Error(`PHP preview could not start. ${output.trim() || processError?.message || 'Process exited.'}`);
        if (await canConnect(port)) {
          if (processError || exited) continue;
          this.running.set(site.id, { child, url });
          return { siteId: site.id, url };
        }
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      throw new Error(`PHP preview did not become ready. ${output.trim()}`);
    } catch (error) {
      if (!exited) {
        child.kill();
        await waitForExit(child, 1500);
      }
      throw error;
    }
  }

  async stop(id: string): Promise<void> {
    const pending = this.pending.get(id);
    if (pending) await pending.catch(() => undefined);
    const active = this.running.get(id);
    if (!active) return;
    active.child.kill();
    await waitForExit(active.child, 1500);
    this.running.delete(id);
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.pending.values()]);
    await Promise.all([...this.running.keys()].map(id => this.stop(id)));
  }
}
