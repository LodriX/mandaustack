import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Site } from '../shared/types';
import { HttpsGateway } from './https-gateway';
import { NginxConfigManager, renderNginxConfig } from './nginx-config';
import { PreviewManager } from './previews';

const site = (domain: string): Site => ({ id: domain, name: domain, path: '/project', domain, createdAt: '' });

test('renders deterministic, loopback-only TLS sites and rejects unsafe input', () => {
  const directory = '/tmp/Mandau Stack';
  const result = renderNginxConfig(directory, [site('zulu.test'), site('alpha.test')], 32222);
  assert.match(result, /listen 127\.0\.0\.1:8443 ssl default_server/);
  assert.match(result, /server_name alpha\.test;[\s\S]+server_name zulu\.test;/);
  assert.match(result, /proxy_ssl_verify on;/);
  assert.match(result, /if \(\$ssl_server_name != \$host\) \{ return 421; \}/);
  assert.match(result, /proxy_ssl_name \$host;/);
  assert.match(result, /proxy_pass https:\/\/127\.0\.0\.1:32222;/);
  assert.match(result, /ssl_certificate "\/tmp\/Mandau Stack\/certificates\/alpha\.test\.pem";/);
  assert.equal(result, renderNginxConfig(directory, [site('alpha.test'), site('zulu.test')], 32222));
  assert.throws(() => renderNginxConfig(directory, [site('alpha.test; return 200')], 32222), /Invalid or duplicate/);
  assert.throws(() => renderNginxConfig(directory, [site('alpha.test'), site('alpha.test')], 32222), /Invalid or duplicate/);
  assert.throws(() => renderNginxConfig('/tmp/unsafe$variable', [], 32222), /Unsafe/);
  assert.throws(() => renderNginxConfig(directory, [], 32222, 443), /port/);
  assert.throws(() => renderNginxConfig(directory, [], 32222, 32222), /port/);
});

test('validates staged config, rejects stale plans, and restores the previous version', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandau-nginx-'));
  let fail = false;
  const calls: string[][] = [];
  const manager = new NginxConfigManager(root, async (_binary, args) => {
    calls.push(args);
    assert.deepEqual(args.slice(0, 4), ['-t', '-q', '-p', `${path.join(root, 'nginx')}${path.sep}`]);
    assert.match(fs.readFileSync(args[5], 'utf8'), /proxy_ssl_verify on/);
    if (fail) throw new Error('nginx -t failed');
  });
  const fakeBinary = process.execPath;
  try {
    const initial = manager.plan([site('alpha.test')], 32123);
    assert.equal(initial.changed, true);
    assert.equal(fs.existsSync(initial.file), false);
    fail = true;
    await assert.rejects(manager.prepare([site('alpha.test')], 32123, initial.originalSha256, initial.configurationSha256, fakeBinary), /nginx -t failed/);
    assert.equal(fs.existsSync(initial.file), false);
    assert.deepEqual(fs.readdirSync(path.join(root, 'nginx')), []);
    fail = false;
    assert.equal((await manager.prepare([site('alpha.test')], 32123, initial.originalSha256, initial.configurationSha256, fakeBinary)).changed, false);
    const first = fs.readFileSync(initial.file, 'utf8');
    const changed = manager.plan([site('bravo.test')], 32124);
    fail = true;
    await assert.rejects(manager.prepare([site('bravo.test')], 32124, changed.originalSha256, changed.configurationSha256, fakeBinary), /nginx -t failed/);
    assert.equal(fs.readFileSync(initial.file, 'utf8'), first);
    fail = false;
    await assert.rejects(manager.prepare([site('bravo.test')], 32124, '0'.repeat(64), changed.configurationSha256, fakeBinary), /changed; review/);
    await assert.rejects(manager.prepare([site('bravo.test')], 32124, changed.originalSha256, initial.configurationSha256, fakeBinary), /site plan changed/);
    await manager.prepare([site('bravo.test')], 32124, changed.originalSha256, changed.configurationSha256, fakeBinary);
    assert.equal(manager.plan([site('bravo.test')], 32124).restoreAvailable, true);
    assert.equal(fs.readFileSync(path.join(root, 'nginx', 'nginx.conf.previous'), 'utf8'), first);
    assert.throws(() => manager.restore('0'.repeat(64)), /changed; review/);
    manager.restore(manager.plan([site('bravo.test')], 32124).originalSha256);
    assert.equal(fs.readFileSync(initial.file, 'utf8'), first);
    assert.equal(manager.plan([site('alpha.test')], 32123).restoreAvailable, false);
    assert.equal(calls.length, 4);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const nginxBinary = ['/opt/homebrew/bin/nginx', '/usr/local/bin/nginx'].find(binary => fs.existsSync(binary));
test('validates actual generated TLS config using installed nginx without starting a listener',
  { skip: process.platform !== 'darwin' || !nginxBinary, timeout: 15_000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandau nginx '));
    const manager = new NginxConfigManager(root);
    try {
      const initial = manager.plan([site('alpha.test'), site('bravo.test')], 32123);
      const result = await manager.prepare([site('alpha.test'), site('bravo.test')], 32123, initial.originalSha256, initial.configurationSha256, nginxBinary!);
      assert.equal(result.changed, false);
      assert.equal(fs.existsSync(path.join(root, 'certificates', 'alpha.test.pem')), true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

const phpAvailable = spawnSync('php', ['-v'], { timeout: 3000, windowsHide: true }).status === 0;
test('real nginx terminates local TLS and proxies a PHP preview through the gateway',
  { skip: process.platform !== 'darwin' || !nginxBinary || !phpAvailable, timeout: 25_000 }, async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mandau nginx proxy ')));
    const project = path.join(root, 'alpha');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'index.php'), '<?php echo "nginx:" . $_SERVER["HTTP_HOST"] . ":" . $_SERVER["HTTP_X_FORWARDED_PROTO"];');
    const linked: Site = { ...site('alpha.test'), path: project };
    const previews = new PreviewManager();
    const gateway = new HttpsGateway(root, () => [linked], previews);
    const probe = net.createServer();
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const gatewayStatus = await gateway.start();
      await previews.start(linked);
      const port = await new Promise<number>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => resolve((probe.address() as net.AddressInfo).port));
      });
      await new Promise<void>(resolve => probe.close(() => resolve()));
      const manager = new NginxConfigManager(root, undefined, port);
      const plan = manager.plan([linked], gatewayStatus.port);
      await manager.prepare([linked], gatewayStatus.port, plan.originalSha256, plan.configurationSha256, nginxBinary!);
      child = spawn(nginxBinary!, ['-g', 'daemon off;', '-p', `${path.join(root, 'nginx')}${path.sep}`, '-c', plan.file],
        { stdio: ['ignore', 'ignore', 'pipe'] });
      let output = '';
      child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.on('error', error => { output += error.message; });
      let body: string | undefined;
      for (let attempt = 0; attempt < 40; attempt++) {
        if (child.exitCode !== null) throw new Error(`nginx exited before listening: ${output}`);
        try {
          body = await new Promise<string>((resolve, reject) => {
            const request = https.get({ hostname: '127.0.0.1', port, servername: linked.domain,
              headers: { host: linked.domain }, ca: fs.readFileSync(gatewayStatus.caPath) }, response => {
              let text = '';
              response.on('data', chunk => { text += chunk; });
              response.on('end', () => resolve(text));
            });
            request.on('error', reject);
          });
          break;
        } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
      }
      assert.equal(body, 'nginx:alpha.test:https', output);
      const mismatched = await new Promise<number>((resolve, reject) => {
        const request = https.get({ hostname: '127.0.0.1', port, servername: linked.domain,
          headers: { host: 'other.test' }, ca: fs.readFileSync(gatewayStatus.caPath) }, response => {
          response.resume();
          response.on('end', () => resolve(response.statusCode || 0));
        });
        request.on('error', reject);
      });
      assert.equal(mismatched, 421);
    } finally {
      if (probe.listening) await new Promise<void>(resolve => probe.close(() => resolve()));
      if (child && child.exitCode === null) {
        const running = child;
        running.kill('SIGTERM');
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { running.kill('SIGKILL'); resolve(); }, 2000);
          running.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      }
      await gateway.stop();
      await previews.stopAll();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
