import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import * as tar from 'tar';
import yazl from 'yazl';
import type { RuntimeArtifact } from '../shared/types';
import { PreviewManager } from './previews';
import { NginxConfigManager } from './nginx-config';
import { NginxService } from './nginx-service';
import { HttpsGateway } from './https-gateway';
import { availableArtifacts, RuntimeInstaller } from './runtime-installer';
import { laravelPhpExtensions, managedWindowsPhpArguments } from './windows-php';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandaustack-installer-'));
  roots.push(root);
  return root;
}

function artifact(file: string, archive: 'tar.gz' | 'zip', root: string): RuntimeArtifact {
  return {
    id: 'node-fixture', name: 'Node.js', version: '0.0.0',
    sourceUrl: 'https://nodejs.org/fixtures/node',
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    archive, root, executable: 'bin/node', license: 'MIT'
  };
}

function installer(root: string, source: string, onDownload?: () => void): RuntimeInstaller {
  return new RuntimeInstaller(path.join(root, 'runtimes'), async (_url, target) => {
    onDownload?.();
    fs.copyFileSync(source, target);
  }, async binary => {
    assert.ok(fs.statSync(binary).isFile());
  });
}

test('official catalog is pinned by OS and architecture', () => {
  assert.deepEqual(availableArtifacts('darwin', 'arm64').map(item => item.name), ['Node.js', 'PHP', 'nginx']);
  assert.equal(availableArtifacts('darwin', 'arm64')[1].archive, 'binary');
  assert.deepEqual(availableArtifacts('win32', 'x64').map(item => item.name), ['Node.js', 'PHP', 'nginx']);
  assert.equal(availableArtifacts('darwin', 'arm64')[2].buildSources?.length, 2);
  assert.deepEqual(availableArtifacts('darwin', 'x64'), []);
});

test('installs a standalone executable after checksum and version verification', async () => {
  const root = fixture();
  const source = path.join(root, 'runtime.bin');
  fs.writeFileSync(source, 'binary fixture');
  const spec: RuntimeArtifact = {
    id: 'binary-fixture', name: 'PHP', version: '0.0.0',
    sourceUrl: 'https://github.com/php/frankenphp/releases/download/v0/fixture',
    sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
    archive: 'binary', root: '', executable: 'frankenphp', license: 'MIT'
  };
  const manager = installer(root, source);
  const installed = await manager.install(spec);
  assert.equal(fs.readFileSync(installed.binary, 'utf8'), 'binary fixture');
  assert.deepEqual(fs.readdirSync(path.dirname(installed.binary)).sort(), ['frankenphp', 'manifest.json']);
});

test('verifies archive and installs in an isolated directory only once', async () => {
  const root = fixture();
  const extracted = path.join(root, 'node-fixture', 'bin');
  fs.mkdirSync(extracted, { recursive: true });
  fs.writeFileSync(path.join(extracted, 'node'), 'executable fixture');
  const source = path.join(root, 'artifact.tar.gz');
  await tar.c({ cwd: root, file: source, gzip: true }, ['node-fixture']);
  const spec = artifact(source, 'tar.gz', 'node-fixture');
  let downloads = 0;
  const manager = installer(root, source, () => { downloads++; });
  const installed = await manager.install(spec);
  assert.equal(fs.readFileSync(installed.binary, 'utf8'), 'executable fixture');
  assert.equal(installed.license, 'MIT');
  assert.deepEqual(await manager.install(spec), installed);
  assert.equal(downloads, 1);
  assert.deepEqual(fs.readdirSync(path.join(root, 'runtimes')), ['node-fixture']);
});

test('ZIP artifacts install without writing outside their version directory', async () => {
  const root = fixture();
  const source = path.join(root, 'artifact.zip');
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from('node fixture'), 'node-fixture/bin/node');
  const completed = new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(source);
    stream.on('finish', resolve);
    stream.on('error', reject);
    zip.outputStream.on('error', reject).pipe(stream);
  });
  zip.end();
  await completed;
  const installed = await installer(root, source).install(artifact(source, 'zip', 'node-fixture'));
  assert.equal(fs.readFileSync(installed.binary, 'utf8'), 'node fixture');
});

test('checksum failure leaves no installed version or partial staging directory', async () => {
  const root = fixture();
  const source = path.join(root, 'bad.zip');
  fs.writeFileSync(source, 'not an archive');
  const spec = { ...artifact(source, 'zip', 'node-fixture'), sha256: '0'.repeat(64) };
  const manager = installer(root, source);
  await assert.rejects(manager.install(spec), /checksum mismatch/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'runtimes')), []);
  assert.equal(await manager.installed(spec), null);
});

test('does not overwrite a runtime whose manifest does not match', async () => {
  const root = fixture();
  const source = path.join(root, 'bad.zip');
  fs.writeFileSync(source, 'not an archive');
  const spec = artifact(source, 'zip', 'node-fixture');
  const destination = path.join(root, 'runtimes', spec.id);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'manifest.json'), '{"unrecognized":true}');
  const manager = installer(root, source);
  await assert.rejects(manager.install(spec), /needs repair/);
  assert.equal(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'), '{"unrecognized":true}');
});

test('installs the pinned official Node.js artifact end to end', {
  skip: !process.env.MANDAUSTACK_TEST_REMOTE_RUNTIME,
  timeout: 120_000
}, async () => {
  const spec = availableArtifacts().find(item => item.name === 'Node.js');
  if (!spec) return;
  const root = fixture();
  const installed = await new RuntimeInstaller(path.join(root, 'runtimes')).install(spec);
  assert.ok(fs.existsSync(installed.binary));
  assert.match(installed.binary, /node-24\.22\.2/);
});

test('extracts the pinned official Windows nginx ZIP into an isolated directory', {
  skip: !process.env.MANDAUSTACK_TEST_NGINX_WINDOWS_ARCHIVE, timeout: 15_000
}, async () => {
  const spec = availableArtifacts('win32', 'x64').find(item => item.name === 'nginx')!;
  const root = fixture();
  const manager = new RuntimeInstaller(path.join(root, 'runtimes'), async (_url, destination) => {
    fs.copyFileSync(process.env.MANDAUSTACK_TEST_NGINX_WINDOWS_ARCHIVE!, destination);
  }, async (binary, artifact) => {
    assert.equal(artifact.name, 'nginx');
    assert.deepEqual([...fs.readFileSync(binary).subarray(0, 2)], [0x4d, 0x5a]);
  });
  const installed = await manager.install(spec);
  assert.ok(fs.existsSync(path.join(path.dirname(installed.binary), 'docs', 'LICENSE')));
  assert.equal((await manager.installed(spec))?.binary, installed.binary);
});

test('builds pinned nginx, OpenSSL and PCRE2 source into a portable macOS runtime', {
  skip: process.platform !== 'darwin' || !process.env.MANDAUSTACK_TEST_NGINX_SOURCE,
  timeout: 900_000
}, async () => {
  const spec = availableArtifacts('darwin', 'arm64').find(item => item.name === 'nginx')!;
  const root = fixture();
  const archives = process.env.MANDAUSTACK_TEST_NGINX_SOURCE_ARCHIVES;
  const manager = archives ? new RuntimeInstaller(path.join(root, 'runtimes'), async (url, destination) => {
    fs.copyFileSync(path.join(archives, path.basename(new URL(url).pathname)), destination);
  }) : new RuntimeInstaller(path.join(root, 'runtimes'));
  const installed = await manager.install(spec);
  const version = spawnSync(installed.binary, ['-V'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(version.status, 0);
  assert.match(version.stderr, /nginx\/1\.30\.6/);
  assert.match(version.stderr, /OpenSSL 3\.5\.9/);
  assert.ok(fs.existsSync(path.join(path.dirname(installed.binary), '..', 'OpenSSL.LICENSE')));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'index.php'), '<?php echo "managed nginx:" . $_SERVER["HTTP_HOST"];');
  const site = { id: 'alpha', name: 'alpha', path: fs.realpathSync(project), domain: 'alpha.test', createdAt: new Date().toISOString() };
  const previews = new PreviewManager();
  const gateway = new HttpsGateway(root, () => [site], previews);
  const config = new NginxConfigManager(root);
  const service = new NginxService(config);
  try {
    const status = await gateway.start();
    await previews.start(site);
    const plan = config.plan([site], status.port);
    await config.prepare([site], status.port, plan.originalSha256, plan.configurationSha256, installed.binary);
    assert.equal((await service.start([site], status.port, status.caPath, installed.binary)).running, true);
    const body = await new Promise<string>((resolve, reject) => {
      const request = https.get({ hostname: '127.0.0.1', port: 8443, servername: site.domain,
        headers: { host: site.domain }, ca: fs.readFileSync(status.caPath) }, response => {
        let text = '';
        response.on('data', (chunk: Buffer) => { text += chunk.toString(); });
        response.on('end', () => resolve(text));
      });
      request.on('error', reject);
    });
    assert.equal(body, 'managed nginx:alpha.test');
  } finally { await service.stop(); await previews.stopAll(); await gateway.stop(); }
});

test('installs official macOS PHP and serves a PHP project via its built-in server', {
  skip: process.platform !== 'darwin' || !process.env.MANDAUSTACK_TEST_REMOTE_RUNTIME,
  timeout: 240_000
}, async () => {
  const spec = availableArtifacts().find(item => item.name === 'PHP');
  assert.ok(spec);
  const root = fixture();
  const localBinary = process.env.MANDAUSTACK_TEST_FRANKENPHP_BINARY;
  const manager = localBinary
    ? new RuntimeInstaller(path.join(root, 'runtimes'), async (_url, target) => { fs.copyFileSync(localBinary, target); })
    : new RuntimeInstaller(path.join(root, 'runtimes'));
  const installed = await manager.install(spec);
  const publicDir = path.join(root, 'site', 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.php'), '<?php echo "php=" . PHP_VERSION . ";intl=" . (int)extension_loaded("intl");');
  fs.writeFileSync(path.join(root, 'site', 'secret.txt'), 'private-project-file');
  const sitePath = fs.realpathSync(path.join(root, 'site'));
  const otherPath = path.join(root, 'other-site');
  fs.mkdirSync(otherPath);
  fs.writeFileSync(path.join(otherPath, 'index.php'), '<?php echo "second-site";');
  const preview = new PreviewManager(undefined, async () => ({ binary: installed.binary, mode: 'frankenphp' }));
  try {
    const running = await preview.start({ id: 'site', name: 'site', path: sitePath, domain: 'site.test', createdAt: new Date().toISOString() });
    assert.equal(await (await fetch(new URL('laravel-route', running.url))).text(), 'php=8.5.12;intl=1');
    assert.notEqual(await (await fetch(new URL('secret.txt', running.url))).text(), 'private-project-file');
    const second = await preview.start({ id: 'other', name: 'other', path: fs.realpathSync(otherPath), domain: 'other.test', createdAt: new Date().toISOString() });
    assert.equal(await (await fetch(second.url)).text(), 'second-site');
    assert.equal(await (await fetch(running.url)).text(), 'php=8.5.12;intl=1');
  } finally { await preview.stopAll(); }
});

test('installs official Windows PHP with Laravel extensions and serves an isolated preview', {
  skip: process.platform !== 'win32' || !process.env.MANDAUSTACK_TEST_REMOTE_RUNTIME,
  timeout: 240_000
}, async () => {
  const root = fixture();
  const spec = availableArtifacts().find(item => item.name === 'PHP');
  assert.ok(spec);
  const installed = await new RuntimeInstaller(path.join(root, 'runtimes')).install(spec);
  const flags = managedWindowsPhpArguments(installed.binary);
  const check = `foreach (${JSON.stringify(laravelPhpExtensions)} as $extension) { if (!extension_loaded($extension)) { exit(1); } } echo 'ok';`;
  assert.equal(execFileSync(installed.binary, [...flags, '-r', check], { encoding: 'utf8' }), 'ok');
  const publicDir = path.join(root, 'site', 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.php'), '<?php echo PHP_VERSION . ":" . (int)extension_loaded("intl");');
  fs.writeFileSync(path.join(root, 'site', 'secret.txt'), 'private-project-file');
  const preview = new PreviewManager(undefined, async () => ({ binary: installed.binary, mode: 'php', startupArgs: flags }));
  try {
    const running = await preview.start({ id: 'site', name: 'site', path: fs.realpathSync(path.join(root, 'site')),
      domain: 'site.test', createdAt: new Date().toISOString() });
    assert.equal(await (await fetch(running.url)).text(), '8.5.12:1');
    assert.notEqual(await (await fetch(new URL('secret.txt', running.url))).text(), 'private-project-file');
  } finally { await preview.stopAll(); }
});

test('runs an actual Laravel app with managed macOS PHP', {
  skip: process.platform !== 'darwin' || !process.env.MANDAUSTACK_TEST_FRANKENPHP_BINARY || !process.env.MANDAUSTACK_TEST_LARAVEL_SITE,
  timeout: 30_000
}, async () => {
  const binary = process.env.MANDAUSTACK_TEST_FRANKENPHP_BINARY!;
  const sitePath = fs.realpathSync(process.env.MANDAUSTACK_TEST_LARAVEL_SITE!);
  assert.match(execFileSync(binary, ['php-cli', 'artisan', '--version'], { cwd: sitePath, encoding: 'utf8' }), /Laravel Framework 13\./);
  const preview = new PreviewManager(undefined, async () => ({ binary, mode: 'frankenphp' }));
  try {
    const running = await preview.start({ id: 'laravel', name: 'laravel', path: sitePath, domain: 'laravel.test', createdAt: new Date().toISOString() });
    const response = await fetch(running.url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Laravel/);
  } finally { await preview.stopAll(); }
});
