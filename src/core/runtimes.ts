import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RuntimeStatus } from '../shared/types';

const run = promisify(execFile);
const candidates = [
  { name: 'PHP', binary: 'php', args: ['-v'] },
  { name: 'Node.js', binary: 'node', args: ['--version'] },
  { name: 'Composer', binary: 'composer', args: ['--version'] },
  { name: 'nginx', binary: 'nginx', args: ['-v'] }
] as const;

export async function findPhpBinary(): Promise<string> {
  const binaries = process.platform === 'darwin'
    ? ['php', '/opt/homebrew/bin/php', '/usr/local/bin/php']
    : ['php'];
  for (const binary of binaries) {
    try {
      await run(binary, ['-v'], { timeout: 3000, windowsHide: true });
      return binary;
    } catch { /* Try the next known installation path. */ }
  }
  throw new Error('PHP is not available. Install PHP before starting a preview.');
}

export async function detectRuntimes(): Promise<RuntimeStatus[]> {
  return Promise.all(candidates.map(async ({ name, binary, args }) => {
    try {
      const resolved = name === 'PHP' ? await findPhpBinary() : binary;
      const { stdout, stderr } = await run(resolved, [...args], { timeout: 3000, windowsHide: true });
      return { name, version: (stdout || stderr).trim().split('\n')[0] || null, source: resolved === binary ? 'System PATH' : resolved };
    } catch {
      return { name, version: null, source: null };
    }
  }));
}
