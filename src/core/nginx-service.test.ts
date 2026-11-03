import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Site } from '../shared/types';
import { HttpsGateway } from './https-gateway';
import { NginxConfigManager } from './nginx-config';
import { NginxService } from './nginx-service';
import { PreviewManager } from './previews';

const binary = ['/opt/homebrew/bin/nginx', '/usr/local/bin/nginx'].find(candidate => fs.existsSync(candidate));
const phpAvailable = spawnSync('php', ['-v'], { timeout: 3000, windowsHide: true }).status === 0;
const enabled = process.platform === 'darwin' && Boolean(binary);

async function freePort(): Promise<number> {
  const server = net.createServer();
  try {
    return await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
    });
  } finally { if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); }
}

const site = (root: string, domain = 'alpha.test'): Site => ({
  id: domain, name: domain, domain, path: root, createdAt: new Date().toISOString()
});

test('managed nginx starts only from the reviewed config, serves verified TLS, detects a crash and stops cleanly',
  { skip: !enabled || !phpAvailable, timeout: 30_000 }, async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mandau nginx service ')));
    const project = path.join(root, 'alpha');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'index.php'), '<?php echo "managed:" . $_SERVER["HTTP_HOST"];');
    const linked = site(project);
    const previews = new PreviewManager();
    const gateway = new HttpsGateway(root, () => [linked], previews);
    const port = await freePort();
    const config = new NginxConfigManager(root, undefined, port);
    const service = new NginxService(config);
    try {
      const gatewayStatus = await gateway.start();
      await previews.start(linked);
      await assert.rejects(service.start([linked], gatewayStatus.port, gatewayStatus.caPath, binary!), /Review and validate/);
      const plan = config.plan([linked], gatewayStatus.port);
      await config.prepare([linked], gatewayStatus.port, plan.originalSha256, plan.configurationSha256, binary!);
      assert.deepEqual(await service.start([linked], gatewayStatus.port, gatewayStatus.caPath, binary!),
        { running: true, port, error: null });
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = https.get({ hostname: '127.0.0.1', port, servername: linked.domain,
          headers: { host: linked.domain }, ca: fs.readFileSync(gatewayStatus.caPath) }, result => {
          let body = '';
          result.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          result.on('end', () => resolve({ status: result.statusCode || 0, body }));
        });
        request.on('error', reject);
      });
      assert.deepEqual(response, { status: 200, body: 'managed:alpha.test' });
      const pid = Number(fs.readFileSync(path.join(root, 'nginx', 'nginx.pid'), 'utf8').trim());
      assert.ok(Number.isSafeInteger(pid) && pid > 1);
      process.kill(pid, 'SIGTERM');
      for (let i = 0; i < 30 && service.status().running; i++) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(service.status().running, false);
      assert.match(service.status().error || '', /stopped unexpectedly/);
      assert.equal((await service.start([linked], gatewayStatus.port, gatewayStatus.caPath, binary!)).running, true);
      await service.stop();
      assert.deepEqual(service.status(), { running: false, port: null, error: null });
      await assert.rejects(new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ port, host: '127.0.0.1' });
        socket.once('connect', () => { socket.destroy(); resolve(); });
        socket.once('error', reject);
      }));
    } finally {
      await service.stop();
      await previews.stopAll();
      await gateway.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

test('port collision preserves the other listener and restores the previous validated config',
  { skip: !enabled, timeout: 15_000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandau-nginx-collision-'));
    const port = await freePort();
    const config = new NginxConfigManager(root, undefined, port);
    const service = new NginxService(config);
    const first = [site(root)];
    const second = [site(root, 'bravo.test')];
    const occupying = net.createServer();
    try {
      const before = config.plan(first, 32122);
      await config.prepare(first, 32122, before.originalSha256, before.configurationSha256, binary!);
      const previous = fs.readFileSync(before.file, 'utf8');
      const next = config.plan(second, 32123);
      await config.prepare(second, 32123, next.originalSha256, next.configurationSha256, binary!);
      await new Promise<void>((resolve, reject) => {
        occupying.once('error', reject);
        occupying.listen(port, '127.0.0.1', resolve);
      });
      await assert.rejects(service.start(second, 32123, path.join(root, 'certificates', 'ca.pem'), binary!), /Previous validated configuration was restored/);
      assert.equal(occupying.listening, true);
      assert.equal(fs.readFileSync(before.file, 'utf8'), previous);
      assert.equal(service.status().running, false);
    } finally {
      await service.stop();
      if (occupying.listening) await new Promise<void>(resolve => occupying.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
