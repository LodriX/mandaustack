#!/usr/bin/env node
import path from 'node:path';
import { applyHostsFile, restoreHostsFile, systemHostsPath } from './core/hosts';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const BACKUPS = '/var/db/mandaustack/hosts-backups';

function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }

export function executeHostsOperation(args: string[], hostsPath = systemHostsPath(), backupDirectory = BACKUPS): { backupPath?: string; appliedSha256: string } {
  const [action, expected, ...rest] = args;
  if (process.platform !== 'darwin' || process.getuid?.() !== 0) throw new Error('Mac hosts changes require administrator authorization.');
  if (!/^[a-f0-9]{64}$/.test(expected || '')) throw new Error('Invalid reviewed hosts checksum.');
  if (action === 'apply') {
    const result = applyHostsFile(hostsPath, backupDirectory, rest, expected);
    return { backupPath: result.backupPath || undefined, appliedSha256: sha256(fs.readFileSync(hostsPath)) };
  }
  if (action === 'restore' && rest.length === 1) {
    const backup = rest[0];
    if (path.dirname(backup) !== backupDirectory || !/^hosts-[0-9a-f-]{36}\.backup$/.test(path.basename(backup))) {
      throw new Error('Invalid MandauStack hosts backup path.');
    }
    restoreHostsFile(hostsPath, backup, expected);
    return { appliedSha256: sha256(fs.readFileSync(hostsPath)) };
  }
  throw new Error('Invalid hosts operation.');
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(executeHostsOperation(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; }
}
