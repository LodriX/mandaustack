import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import type { NginxStatus, Site } from '../shared/types';
import { NginxConfigManager } from './nginx-config';

const execute = promisify(execFile);

async function checkPort(port: number): Promise<void> {
  const probe = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    throw new Error(`Cannot use 127.0.0.1:${port}: ${(error as Error).message}`);
  } finally {
    if (probe.listening) await new Promise<void>(resolve => probe.close(() => resolve()));
  }
}

function probeTls(port: number, ca: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: '127.0.0.1', port, servername: 'localhost',
      headers: { host: 'localhost' }, ca, agent: false }, response => {
      response.resume();
      response.on('end', () => response.statusCode === 421 ? resolve() : reject(new Error(`Unexpected nginx health status: ${response.statusCode}`)));
    });
    request.setTimeout(500, () => request.destroy(new Error('nginx health check timed out.')));
    request.on('error', reject);
  });
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    if (child.exitCode !== null || child.signalCode !== null) { clearTimeout(timer); resolve(); }
  });
}

export class NginxService {
  private child: ChildProcess | null = null;
  private pending: Promise<NginxStatus> | null = null;
  private port: number | null = null;
  private lastError: string | null = null;
  private stopping = false;

  constructor(private readonly config: NginxConfigManager) {}

  status(): NginxStatus {
    return { running: Boolean(this.child && this.port), port: this.port, error: this.lastError };
  }

  async start(sites: Site[], gatewayPort: number, caPath: string, binary: string): Promise<NginxStatus> {
    if (this.port) return this.status();
    if (this.pending) return this.pending;
    this.pending = this.launch(sites, gatewayPort, caPath, binary);
    try { return await this.pending; }
    finally { this.pending = null; }
  }

  private async launch(sites: Site[], gatewayPort: number, caPath: string, binary: string): Promise<NginxStatus> {
    const plan = this.config.plan(sites, gatewayPort);
    if (plan.changed) throw new Error('Review and validate the nginx configuration for this gateway session before starting.');
    if (!path.isAbsolute(binary) || !fs.existsSync(binary) || !fs.statSync(binary).isFile()) throw new Error('A local nginx executable is required.');
    const ca = fs.readFileSync(caPath);
    const directory = path.dirname(plan.file);
    let child: ChildProcess | null = null;
    let output = '';
    try {
      await checkPort(plan.listenPort);
      await execute(binary, ['-t', '-q', '-p', `${directory}${path.sep}`, '-c', plan.file],
        { timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true });
      child = spawn(binary, ['-g', 'daemon off;', '-p', `${directory}${path.sep}`, '-c', plan.file],
        { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      const running = child;
      running.stderr?.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4096); });
      running.on('error', error => { output = (output + error.message).slice(-4096); });
      running.once('exit', (code, signal) => {
        if (this.child === running) {
          this.child = null;
          this.port = null;
          if (!this.stopping) this.lastError = `nginx stopped unexpectedly (${code ?? signal}). ${output.trim()}`.trim();
        }
      });
      const deadline = Date.now() + 8000;
      let lastProbe = '';
      while (Date.now() < deadline) {
        if (running.exitCode !== null || running.signalCode !== null) throw new Error(`nginx exited before becoming healthy. ${output.trim()}`);
        try {
          await probeTls(plan.listenPort, ca);
          if (running.exitCode !== null || running.signalCode !== null) continue;
          this.child = running;
          this.port = plan.listenPort;
          this.lastError = null;
          return this.status();
        } catch (error) { lastProbe = (error as Error).message; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`nginx did not pass its HTTPS health check. ${output.trim()} ${lastProbe}`.trim());
    } catch (error) {
      if (child) await terminate(child);
      let message = (error as Error).message;
      if (plan.restoreAvailable) {
        try { this.config.restore(plan.originalSha256); message += ' Previous validated configuration was restored.'; }
        catch (rollbackError) { message += ` Configuration recovery failed: ${(rollbackError as Error).message}`; }
      }
      this.lastError = message;
      throw new Error(message);
    }
  }

  async stop(): Promise<void> {
    if (this.pending) await this.pending.catch(() => undefined);
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    try { await terminate(child); }
    finally {
      if (this.child === child) this.child = null;
      this.port = null;
      this.lastError = null;
      this.stopping = false;
    }
  }
}
