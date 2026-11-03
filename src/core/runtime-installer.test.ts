import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import * as tar from 'tar';
import yazl from 'yazl';
import type { RuntimeArtifact } from '../shared/types';
import { availableArtifacts, RuntimeInstaller } from './runtime-installer';

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
  assert.equal(availableArtifacts('darwin', 'arm64')[0].sha256.length, 64);
  assert.deepEqual(availableArtifacts('win32', 'x64').map(item => item.name), ['Node.js', 'PHP']);
  assert.deepEqual(availableArtifacts('darwin', 'x64'), []);
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
