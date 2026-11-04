import path from 'node:path';

export const laravelPhpExtensions = [
  'bcmath', 'ctype', 'curl', 'dom', 'fileinfo', 'filter', 'hash', 'intl',
  'mbstring', 'openssl', 'PDO', 'pdo_mysql', 'pdo_sqlite', 'session',
  'tokenizer', 'xml', 'zip'
] as const;

const dynamicExtensions = ['curl', 'fileinfo', 'intl', 'mbstring', 'openssl', 'pdo_mysql', 'pdo_sqlite', 'zip'] as const;

export function managedWindowsPhpArguments(binary: string): string[] {
  if (!path.win32.isAbsolute(binary) || path.win32.basename(binary).toLowerCase() !== 'php.exe') {
    throw new Error('An absolute managed Windows PHP executable is required.');
  }
  const extensionDirectory = path.win32.join(path.win32.dirname(binary), 'ext').replaceAll('\\', '/');
  return ['-n', '-d', `extension_dir=${extensionDirectory}`,
    ...dynamicExtensions.flatMap(extension => ['-d', `extension=${extension}`])];
}
