import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { SiteStore } from './sites';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function fixture(): { root: string; store: SiteStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandaustack-test-'));
  directories.push(root);
  return { root, store: new SiteStore(path.join(root, 'state')) };
}

test('links a real project and persists it across store instances', () => {
  const { root, store } = fixture();
  const project = path.join(root, 'my-project');
  fs.mkdirSync(project);
  const site = store.add(project);
  assert.equal(site.domain, 'my-project.test');
  assert.deepEqual(new SiteStore(path.join(root, 'state')).list(), [site]);
});

test('rejects duplicate paths and domains without changing state', () => {
  const { root, store } = fixture();
  const first = path.join(root, 'one', 'project');
  const second = path.join(root, 'two', 'project');
  fs.mkdirSync(first, { recursive: true });
  fs.mkdirSync(second, { recursive: true });
  store.add(first);
  assert.throws(() => store.add(first), /already linked/);
  assert.throws(() => store.add(second), /already registered/);
  assert.equal(store.list().length, 1);
});

test('unlink preserves project files and registry stays valid', () => {
  const { root, store } = fixture();
  const project = path.join(root, 'blog');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'index.php'), '<?php');
  const site = store.add(project);
  store.remove(site.id);
  assert.deepEqual(store.list(), []);
  assert.ok(fs.existsSync(path.join(project, 'index.php')));
});

test('does not overwrite a damaged registry', () => {
  const { root, store } = fixture();
  const file = path.join(root, 'state', 'sites.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, '{broken');
  const project = path.join(root, 'blog');
  fs.mkdirSync(project);
  assert.throws(() => store.add(project));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
