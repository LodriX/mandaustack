import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Site } from '../shared/types';
import { HttpsGateway } from './https-gateway';
import { localCertificates } from './local-certificates';
import { PreviewManager } from './previews';

function request(port: number, ca: string, domain: string, options: { host?: string; method?: string; body?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = https.request({
      hostname: '127.0.0.1', port, servername: domain, ca,
      headers: { host: options.host || `${domain}:${port}`, 'content-type': 'text/plain' }, method: options.method || 'GET'
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

test('persists a private CA and a valid site certificate across restarts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandau-ca-'));
  try {
    const first = localCertificates(path.join(root, 'certificates'), 'alpha.test');
    const second = localCertificates(path.join(root, 'certificates'), 'alpha.test');
    assert.equal(first.certificate, second.certificate);
    assert.equal(first.privateKey, second.privateKey);
    assert.match(fs.readFileSync(first.caPath, 'utf8'), /BEGIN CERTIFICATE/);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(root, 'certificates', 'ca-key.pem')).mode & 0o077, 0);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const phpAvailable = spawnSync('php', ['-v'], { timeout: 3000, windowsHide: true }).status === 0;

test('routes only linked, running sites over verified local TLS', { skip: !phpAvailable, timeout: 30_000 }, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mandau-gateway-')));
  const sites: Site[] = ['alpha', 'bravo'].map(name => {
    const sitePath = path.join(root, name);
    fs.mkdirSync(path.join(sitePath, 'public'), { recursive: true });
    fs.writeFileSync(path.join(sitePath, 'public', 'index.php'), `<?php echo "${name}:" . $_SERVER['HTTP_HOST'] . ":" . $_SERVER['HTTP_X_FORWARDED_PROTO'] . ":" . file_get_contents('php://input');`);
    return { id: name, name, path: fs.realpathSync(sitePath), domain: `${name}.test`, createdAt: new Date().toISOString() };
  });
  const previews = new PreviewManager();
  const gateway = new HttpsGateway(root, () => sites, previews);
  try {
    const status = await gateway.start();
    assert.deepEqual(await gateway.start(), status);
    const ca = fs.readFileSync(status.caPath, 'utf8');
    assert.deepEqual(await request(status.port, ca, 'alpha.test'), { status: 503, body: 'Start the project preview first.' });
    await previews.start(sites[0]);
    await previews.start(sites[1]);
    assert.deepEqual(await request(status.port, ca, 'alpha.test', { method: 'POST', body: 'hello' }), { status: 200, body: 'alpha:alpha.test:https:hello' });
    assert.deepEqual(await request(status.port, ca, 'bravo.test'), { status: 200, body: 'bravo:bravo.test:https:' });
    await assert.rejects(request(status.port, ca, 'missing.test'));
    assert.equal(fs.existsSync(path.join(root, 'certificates', 'missing.test.pem')), false);
    assert.equal((await request(status.port, ca, 'alpha.test', { host: 'bravo.test' })).status, 421);
    assert.equal((await request(status.port, ca, 'alpha.test', { host: 'alpha.test:9999' })).status, 421);
    assert.equal((await request(status.port, ca, 'alpha.test', { host: 'alpha.test.evil' })).status, 421);
    await previews.stop(sites[0].id);
    assert.equal((await request(status.port, ca, 'alpha.test')).status, 503);
    sites.splice(0, 1);
    assert.equal((await request(status.port, ca, 'alpha.test')).status, 404);
  } finally {
    await gateway.stop();
    await previews.stopAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('serves a real Laravel project with managed PHP over verified local HTTPS', {
  skip: process.platform !== 'darwin' || !process.env.MANDAUSTACK_TEST_FRANKENPHP_BINARY || !process.env.MANDAUSTACK_TEST_LARAVEL_SITE,
  timeout: 30_000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandau-laravel-gateway-'));
  const site: Site = {
    id: 'laravel', name: 'laravel', domain: 'laravel.test',
    path: fs.realpathSync(process.env.MANDAUSTACK_TEST_LARAVEL_SITE!), createdAt: new Date().toISOString()
  };
  const previews = new PreviewManager(undefined, async () => ({ binary: process.env.MANDAUSTACK_TEST_FRANKENPHP_BINARY!, mode: 'frankenphp' }));
  const gateway = new HttpsGateway(root, () => [site], previews);
  try {
    const status = await gateway.start();
    await previews.start(site);
    const response = await request(status.port, fs.readFileSync(status.caPath, 'utf8'), site.domain);
    assert.equal(response.status, 200);
    assert.match(response.body, /Laravel/);
  } finally {
    await gateway.stop();
    await previews.stopAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
