import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import type { Site } from '../shared/types';
import { documentRoot, PreviewManager } from './previews';

const roots: string[] = [];
const managers: PreviewManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.stopAll()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; site: Site } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mandaustack-preview-')));
  roots.push(root);
  return { root, site: { id: 'test-site', name: path.basename(root), path: root, domain: 'test.test', createdAt: new Date().toISOString() } };
}

test('chooses Laravel public directory rather than exposing project root', () => {
  const { root, site } = fixture();
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public', 'index.php'), '<?php');
  fs.writeFileSync(path.join(root, 'index.php'), '<?php');
  assert.equal(documentRoot(site), path.join(root, 'public'));
});

test('rejects a project without a web entry point', () => {
  const { site } = fixture();
  assert.throws(() => documentRoot(site), /No public\/index.php/);
});

const phpAvailable = spawnSync('php', ['-v'], { timeout: 3000, windowsHide: true }).status === 0;

test('starts PHP on loopback, serves a project, and stops without deleting files', { skip: !phpAvailable }, async () => {
  const { root, site } = fixture();
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public', 'index.php'), '<?php echo "mandau-preview-ok";');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'private-project-file');
  const manager = new PreviewManager();
  managers.push(manager);
  const preview = await manager.start(site);
  assert.match(preview.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.deepEqual(await manager.start(site), preview);
  assert.equal(await (await fetch(preview.url)).text(), 'mandau-preview-ok');
  assert.doesNotMatch(await (await fetch(new URL('secret.txt', preview.url))).text(), /private-project-file/);
  await manager.stop(site.id);
  assert.deepEqual(manager.list(), []);
  assert.ok(fs.existsSync(path.join(root, 'secret.txt')));
});

test('reports missing PHP clearly and does not claim a running preview', async () => {
  const { root, site } = fixture();
  fs.writeFileSync(path.join(root, 'index.php'), '<?php');
  const manager = new PreviewManager('mandaustack-php-not-installed');
  managers.push(manager);
  await assert.rejects(manager.start(site), /PHP is not available/);
  assert.deepEqual(manager.list(), []);
});

test('does not retain a failed process and allows a later retry', async () => {
  const { root, site } = fixture();
  fs.writeFileSync(path.join(root, 'index.php'), '<?php');
  // Node passes a version check, but rejects the PHP -S startup arguments.
  const manager = new PreviewManager(process.execPath);
  managers.push(manager);
  await assert.rejects(manager.start(site), /could not start/);
  assert.deepEqual(manager.list(), []);
  await assert.rejects(manager.start(site), /could not start/);
});
