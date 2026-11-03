import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { administratorScript } from './mac-hosts';

test('quotes privileged helper paths and rejects control characters', () => {
  const script = administratorScript('/Applications/Mandau Stack.app/bin', "/Users/O'Brien/app.asar/helper.js", ['apply', 'a'.repeat(64), 'my-site.test']);
  assert.match(script, /^do shell script "ELECTRON_RUN_AS_NODE=1 /);
  assert.match(script, /O'\\\\''Brien/);
  assert.match(script, /with administrator privileges$/);
  assert.throws(() => administratorScript('/path\n/bin', '/helper', []), /Invalid path/);
  assert.throws(() => administratorScript('/bin', '/helper', ['site.test\ncat /etc/hosts']), /Invalid path/);
});

test('runs the packaged-style read-only command via AppleScript without elevation', { skip: process.platform !== 'darwin' }, () => {
  const cli = path.join(__dirname, '../cli.js');
  const script = administratorScript(process.execPath, cli, ['hosts:plan']).replace(/ with administrator privileges$/, '');
  const result = execFileSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8', timeout: 10_000 });
  assert.match(result, /system hosts were not modified/);
});
