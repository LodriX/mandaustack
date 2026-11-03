import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

function shellQuote(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('Invalid path or argument for administrator command.');
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function administratorScript(binary: string, helper: string, args: string[]): string {
  const command = ['ELECTRON_RUN_AS_NODE=1', shellQuote(binary), shellQuote(helper), ...args.map(shellQuote)].join(' ');
  // osascript receives one literal AppleScript string; shell-quote every argument independently.
  return `do shell script "${command.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" with administrator privileges`;
}

export interface MacHostsResult { backupPath?: string; appliedSha256: string }

export async function authorizedHostsOperation(binary: string, helper: string, args: string[], run: typeof execute = execute): Promise<MacHostsResult> {
  if (process.platform !== 'darwin') throw new Error('Administrator hosts integration is available on macOS only.');
  const { stdout } = await run('/usr/bin/osascript', ['-e', administratorScript(binary, helper, args)], {
    timeout: 180_000, maxBuffer: 16 * 1024, windowsHide: true
  });
  const value: unknown = JSON.parse(stdout);
  if (typeof value !== 'object' || value === null || !('appliedSha256' in value) ||
      typeof value.appliedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.appliedSha256)) {
    throw new Error('Administrator helper returned an invalid hosts result.');
  }
  return value as MacHostsResult;
}
