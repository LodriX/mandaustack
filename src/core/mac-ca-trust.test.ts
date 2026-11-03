import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { localCertificates } from './local-certificates';
import { MacCaTrust } from './mac-ca-trust';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mandau-keychain-'));
  const caPath = localCertificates(path.join(root, 'certificates')).caPath;
  const fingerprint = new X509Certificate(fs.readFileSync(caPath)).fingerprint256.replaceAll(':', '');
  const keychain = path.join(root, 'login.keychain-db');
  const calls: string[][] = [];
  let present = false;
  let trusted = false;
  let verificationFails = false;
  let deletionFails = false;
  const run = async (file: string, args: string[]): Promise<{ stdout: string }> => {
    assert.equal(file, '/usr/bin/security');
    calls.push(args);
    switch (args[0]) {
      case 'default-keychain': return { stdout: `    "${keychain}"\n` };
      case 'find-certificate': return { stdout: present ? `SHA-256 hash: ${fingerprint}\n` : '' };
      case 'verify-cert':
        assert.deepEqual(args, ['verify-cert', '-c', path.join(root, 'certificates', 'localhost.pem'), '-p', 'ssl', '-n', 'localhost', '-L', '-q']);
        if (!trusted || verificationFails) throw new Error('untrusted');
        return { stdout: '' };
      case 'add-trusted-cert':
        assert.deepEqual(args, ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', keychain, caPath]);
        present = true; trusted = true;
        return { stdout: '' };
      case 'remove-trusted-cert':
        assert.deepEqual(args, ['remove-trusted-cert', caPath]);
        trusted = false;
        return { stdout: '' };
      case 'delete-certificate':
        assert.deepEqual(args, ['delete-certificate', '-t', '-Z', fingerprint, keychain]);
        if (deletionFails) throw new Error('keychain locked');
        present = false;
        return { stdout: '' };
      default: throw new Error(`Unexpected Keychain operation: ${args[0]}`);
    }
  };
  return { root, caPath, fingerprint, calls, trust: new MacCaTrust(caPath, root, run),
    setPresent: (value: boolean) => { present = value; },
    setVerificationFails: (value: boolean) => { verificationFails = value; },
    setDeletionFails: (value: boolean) => { deletionFails = value; } };
}

test('macOS does not accept a newly generated CA as trusted (read-only Keychain check)', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    await assert.rejects(promisify(execFile)('/usr/bin/security',
      ['verify-cert', '-c', path.join(f.root, 'certificates', 'localhost.pem'), '-p', 'ssl', '-n', 'localhost', '-L', '-q'], { timeout: 30_000 }));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('installs only a previously absent CA and removes only its fingerprint', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    assert.deepEqual(await f.trust.status(), { trusted: false, installedByMandauStack: false });
    assert.deepEqual(await f.trust.install(), { trusted: true, installedByMandauStack: true });
    assert.deepEqual(await f.trust.install(), { trusted: true, installedByMandauStack: true });
    assert.equal(f.calls.filter(args => args[0] === 'add-trusted-cert').length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'ca-trust.json'), 'utf8')).fingerprint, f.fingerprint);
    assert.deepEqual(await f.trust.remove(), { trusted: false, installedByMandauStack: false });
    assert.equal(fs.existsSync(path.join(f.root, 'ca-trust.json')), false);
    await assert.rejects(f.trust.remove(), /did not install/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('never adopts or removes a pre-existing certificate and preserves a mismatched recovery record', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    f.setPresent(true);
    await assert.rejects(f.trust.install(), /already present/);
    assert.equal(f.calls.some(args => args[0] === 'add-trusted-cert'), false);
    f.setPresent(false);
    await f.trust.install();
    const record = path.join(f.root, 'ca-trust.json');
    fs.writeFileSync(record, JSON.stringify({ fingerprint: 'A'.repeat(64), keychain: '/some/keychain' }));
    await assert.rejects(f.trust.remove(), /CA changed/);
    assert.equal(f.calls.some(args => args[0] === 'delete-certificate'), false);
    assert.equal(fs.existsSync(record), true);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('rolls back failed verification and retains recovery state when removal is interrupted', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    f.setVerificationFails(true);
    await assert.rejects(f.trust.install(), /could not be verified/);
    assert.equal(fs.existsSync(path.join(f.root, 'ca-trust.json')), false);
    f.setVerificationFails(false);
    await f.trust.install();
    f.setDeletionFails(true);
    await assert.rejects(f.trust.remove(), /keychain locked/);
    assert.deepEqual(await f.trust.status(), { trusted: false, installedByMandauStack: true });
    f.setDeletionFails(false);
    assert.deepEqual(await f.trust.remove(), { trusted: false, installedByMandauStack: false });
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
