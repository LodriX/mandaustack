import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyWindowsRelease, windowsReleaseFiles } from './verify-windows-signatures.mjs';

const version = '0.1.10';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandau-signing-'));
  const files = windowsReleaseFiles(root, version);
  fs.mkdirSync(path.dirname(files[0]), { recursive: true });
  for (const file of files) fs.writeFileSync(file, 'test-only executable fixture');
  return { root, files };
}

test('signed release requires both executable and installer with valid timestamps', async () => {
  const { root, files } = fixture();
  try {
    const inspected = [];
    assert.deepEqual(await verifyWindowsRelease(root, version, async file => {
      inspected.push(file);
      return { status: 'Valid', hasSigner: true, hasTimestamp: true };
    }), files);
    assert.deepEqual(inspected, files);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('signed release rejects missing artifacts, unsigned files, and missing timestamps', async () => {
  const { root, files } = fixture();
  try {
    await assert.rejects(verifyWindowsRelease(root, version, async () => ({
      status: 'NotSigned', hasSigner: false, hasTimestamp: false
    })), /not signed/);
    await assert.rejects(verifyWindowsRelease(root, version, async () => ({
      status: 'Valid', hasSigner: false, hasTimestamp: true
    })), /not signed/);
    await assert.rejects(verifyWindowsRelease(root, version, async file => ({
      status: 'Valid', hasSigner: true, hasTimestamp: file === files[0]
    })), /not signed/);
    fs.unlinkSync(files[1]);
    await assert.rejects(verifyWindowsRelease(root, version, async () => ({
      status: 'Valid', hasSigner: true, hasTimestamp: true
    })), /missing/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('signed release rejects unrecognized versions', () => {
  assert.throws(() => windowsReleaseFiles('release', '../0.1.10'), /Invalid release version/);
});
