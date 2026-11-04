import assert from 'node:assert/strict';
import { test } from 'node:test';
import { laravelPhpExtensions, managedWindowsPhpArguments } from './windows-php';

test('configures only managed Windows PHP with an isolated extension directory', () => {
  const binary = 'C:\\Users\\Developer\\AppData\\Roaming\\Mandau Stack\\runtimes\\php-8.5.12\\php.exe';
  const args = managedWindowsPhpArguments(binary);
  assert.deepEqual(args.slice(0, 3), ['-n', '-d',
    'extension_dir=C:/Users/Developer/AppData/Roaming/Mandau Stack/runtimes/php-8.5.12/ext']);
  assert.deepEqual(args.slice(3), [
    '-d', 'extension=curl', '-d', 'extension=fileinfo', '-d', 'extension=intl',
    '-d', 'extension=mbstring', '-d', 'extension=openssl', '-d', 'extension=pdo_mysql',
    '-d', 'extension=pdo_sqlite', '-d', 'extension=zip'
  ]);
  assert.equal(laravelPhpExtensions.length, 17);
  assert.throws(() => managedWindowsPhpArguments('php.exe'), /absolute managed/);
  assert.throws(() => managedWindowsPhpArguments('C:\\Users\\Developer\\node.exe'), /absolute managed/);
});
