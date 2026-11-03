import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const BEGIN = '# BEGIN MandauStack managed sites';
const END = '# END MandauStack managed sites';
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.test$/;

export interface HostsPlan {
  content: string;
  added: string[];
  removed: string[];
  changed: boolean;
  originalSha256: string;
}

export function systemHostsPath(platform = process.platform, root = process.env.SystemRoot): string {
  if (platform === 'win32') {
    if (!root || !path.win32.isAbsolute(root)) throw new Error('Windows system root is unavailable.');
    return path.win32.join(root, 'System32', 'drivers', 'etc', 'hosts');
  }
  if (platform === 'darwin') return '/etc/hosts';
  throw new Error('Hosts integration is not available on this platform.');
}

function fileHash(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function planHosts(original: string, domains: readonly string[]): HostsPlan {
  if (original.includes('\0') || /\r(?!\n)/.test(original) || (/\r\n/.test(original) && /(?<!\r)\n/.test(original))) {
    throw new Error('Hosts file has an unsupported encoding or mixed line endings.');
  }
  const requested = [...domains];
  if (requested.some(domain => !DOMAIN.test(domain)) || new Set(requested).size !== requested.length) {
    throw new Error('Invalid or duplicate .test domain.');
  }
  requested.sort();
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const bom = original.startsWith('\ufeff') ? '\ufeff' : '';
  const lines = original.slice(bom.length).split(eol);
  const starts = lines.flatMap((line, index) => line === BEGIN ? [index] : []);
  const ends = lines.flatMap((line, index) => line === END ? [index] : []);
  if (starts.length !== ends.length || starts.length > 1 || (starts.length === 1 && starts[0] >= ends[0])) {
    throw new Error('Hosts file has an incomplete or duplicate MandauStack block; no changes were made.');
  }
  const begin = starts[0] ?? -1;
  const end = ends[0] ?? -1;
  const previous = new Set<string>();
  if (begin >= 0) {
    for (const line of lines.slice(begin + 1, end)) {
      const match = /^127\.0\.0\.1 ([a-z0-9-]+\.test)$/.exec(line);
      if (!match || !DOMAIN.test(match[1]) || previous.has(match[1])) {
        throw new Error('MandauStack hosts block was modified; no changes were made.');
      }
      previous.add(match[1]);
    }
  }
  const outside = lines.filter((_line, index) => begin < 0 || index < begin || index > end);
  for (const line of outside) {
    const tokens = line.split('#', 1)[0].trim().split(/\s+/);
    if (tokens.length > 1 && tokens.slice(1).some(token => requested.includes(token.toLowerCase()))) {
      throw new Error(`Domain ${tokens.slice(1).find(token => requested.includes(token.toLowerCase()))} already exists outside the MandauStack block.`);
    }
  }
  const block = requested.length ? [BEGIN, ...requested.map(domain => `127.0.0.1 ${domain}`), END] : [];
  let content: string;
  if (begin >= 0) {
    const replacement = [...lines];
    replacement.splice(begin, end - begin + 1, ...block);
    content = bom + replacement.join(eol);
  } else if (!block.length) content = original;
  else content = original + (original.length && !original.endsWith(eol) ? eol : '') + block.join(eol) + eol;
  return {
    content,
    added: requested.filter(domain => !previous.has(domain)),
    removed: [...previous].filter(domain => !requested.includes(domain)),
    changed: content !== original,
    originalSha256: fileHash(original)
  };
}

/** Requires an explicitly authorized caller. Never invoked on application startup. */
function replaceHostsFile(hostsPath: string, nextContent: Buffer | string, expectedSha256: string): void {
  // Windows needs an ACL-preserving file replacement mechanism before this can touch the real system file.
  if (process.platform === 'win32' && path.win32.normalize(hostsPath).toLowerCase() === systemHostsPath().toLowerCase()) {
    throw new Error('Applying Windows system hosts entries is not supported yet.');
  }
  const metadata = fs.lstatSync(hostsPath, { bigint: true });
  if (!metadata.isFile()) throw new Error('Hosts file must be a regular file.');
  if (process.platform !== 'win32' && process.getuid?.() !== Number(metadata.uid)) {
    throw new Error('Administrator authorization is required to update the hosts file.');
  }
  const temporary = path.join(path.dirname(hostsPath), `.mandaustack-hosts-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, nextContent, { flag: 'wx', mode: Number(metadata.mode & 0o777n) });
    if (process.platform !== 'win32') fs.chownSync(temporary, Number(metadata.uid), Number(metadata.gid));
    const now = fs.lstatSync(hostsPath, { bigint: true });
    if (now.ino !== metadata.ino || now.mtimeNs !== metadata.mtimeNs || now.size !== metadata.size || fileHash(fs.readFileSync(hostsPath)) !== expectedSha256) {
      throw new Error('Hosts file changed during the update. The original file was preserved.');
    }
    fs.renameSync(temporary, hostsPath);
    if (fileHash(fs.readFileSync(hostsPath)) !== fileHash(nextContent)) throw new Error('Hosts file verification failed; restore it from the saved backup.');
  } finally { fs.rmSync(temporary, { force: true }); }
}

/** Requires an explicitly authorized caller. Never invoked on application startup. */
export function applyHostsFile(hostsPath: string, backupDirectory: string, domains: readonly string[], expectedSha256: string): { backupPath: string | null; plan: HostsPlan } {
  const before = fs.readFileSync(hostsPath);
  if (!Buffer.from(before.toString('utf8'), 'utf8').equals(before)) throw new Error('Hosts file is not UTF-8; no changes were made.');
  const plan = planHosts(before.toString('utf8'), domains);
  if (plan.originalSha256 !== expectedSha256) throw new Error('Hosts file changed since the plan was reviewed.');
  if (!plan.changed) return { backupPath: null, plan };
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupDirectory, `hosts-${randomUUID()}.backup`);
  fs.writeFileSync(backupPath, before, { flag: 'wx', mode: 0o600 });
  try { replaceHostsFile(hostsPath, plan.content, expectedSha256); }
  catch (error) { throw new Error(`${(error as Error).message} Backup: ${backupPath}`); }
  return { backupPath, plan };
}

/** Restore only if the on-disk file still matches the exact content applied by this operation. */
export function restoreHostsFile(hostsPath: string, backupPath: string, expectedAppliedSha256: string): void {
  const previous = fs.readFileSync(backupPath);
  if (!Buffer.from(previous.toString('utf8'), 'utf8').equals(previous)) throw new Error('Hosts backup is not UTF-8.');
  replaceHostsFile(hostsPath, previous, expectedAppliedSha256);
}
