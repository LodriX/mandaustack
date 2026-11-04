import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyHostsFile, planHosts, restoreHostsFile, systemHostsPath } from './hosts';

test('plans additions, removals and stable ordering without touching unrelated hosts entries', () => {
  const original = '127.0.0.1 localhost\n::1 localhost\n10.0.0.9 intranet.local\n';
  const first = planHosts(original, ['bravo.test', 'alpha.test']);
  assert.deepEqual(first.added, ['alpha.test', 'bravo.test']);
  assert.match(first.content, /10\.0\.0\.9 intranet\.local\n# BEGIN MandauStack managed sites\n127\.0\.0\.1 alpha\.test\n127\.0\.0\.1 bravo\.test\n# END MandauStack managed sites\n$/);
  assert.equal(planHosts(first.content, ['alpha.test', 'bravo.test']).changed, false);
  const second = planHosts(first.content, ['bravo.test']);
  assert.deepEqual(second.removed, ['alpha.test']);
  assert.equal(planHosts(second.content, []).content, original);
});

test('preserves Windows CRLF and BOM and refuses to replace unmanaged mappings', () => {
  const original = '\ufeff# Local settings\r\n127.0.0.1 localhost\r\n';
  const updated = planHosts(original, ['demo.test']);
  assert.ok(updated.content.startsWith(original));
  assert.equal(planHosts(updated.content, []).content, original);
  assert.equal(systemHostsPath('win32', 'C:\\Windows').toLowerCase(), 'c:\\windows\\system32\\drivers\\etc\\hosts');
  assert.throws(() => planHosts(original + '127.0.0.1 demo.test another.test\r\n', ['demo.test']), /outside the MandauStack block/);
});

test('refuses tampered blocks, duplicate domains and invalid line endings', () => {
  assert.throws(() => planHosts('# BEGIN MandauStack managed sites\n127.0.0.1 alpha.test\n', []), /incomplete/);
  assert.throws(() => planHosts('# BEGIN MandauStack managed sites\n8.8.8.8 alpha.test\n# END MandauStack managed sites\n', ['alpha.test']), /modified/);
  assert.throws(() => planHosts('', ['alpha.test', 'alpha.test']), /duplicate/);
  assert.throws(() => planHosts('', ['alpha.test\n127.0.0.1 attacker.test']), /Invalid/);
  assert.throws(() => planHosts('127.0.0.1 localhost\r\n::1 localhost\n', []), /line endings/);
});

test('backs up and atomically applies only a reviewed plan to a copy, rejecting stale plans', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandau-hosts-'));
  try {
    const file = path.join(root, 'hosts');
    const original = '127.0.0.1 localhost\n';
    fs.writeFileSync(file, original, { mode: 0o644 });
    const plan = planHosts(original, ['alpha.test']);
    const backupDir = path.join(root, 'backups');
    const result = applyHostsFile(file, backupDir, ['alpha.test'], plan.originalSha256);
    assert.equal(fs.readFileSync(file, 'utf8'), plan.content);
    const backup = result.backupPath;
    assert.ok(backup);
    assert.equal(fs.readFileSync(backup, 'utf8'), original);
    // POSIX mode bits do not validate Windows ACLs; system hosts writes remain disabled there.
    if (process.platform !== 'win32') assert.equal(fs.statSync(backup).mode & 0o077, 0);
    assert.throws(() => applyHostsFile(file, backupDir, [], plan.originalSha256), /changed since the plan/);
    assert.equal(fs.readFileSync(file, 'utf8'), plan.content);
    assert.equal(fs.readdirSync(backupDir).length, 1);
    const applied = planHosts(plan.content, []);
    restoreHostsFile(file, backup, applied.originalSha256);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.throws(() => restoreHostsFile(file, backup, applied.originalSha256), /changed during the update/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
