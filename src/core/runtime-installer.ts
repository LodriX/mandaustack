import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import * as tar from 'tar';
import yauzl from 'yauzl';
import type { InstalledRuntime, RuntimeArtifact } from '../shared/types';

const execute = promisify(execFile);
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 600 * 1024 * 1024;
const FRANKENPHP_EXTENSIONS = [
  'bcmath', 'ctype', 'curl', 'dom', 'fileinfo', 'filter', 'hash', 'intl',
  'mbstring', 'openssl', 'PDO', 'pdo_mysql', 'pdo_sqlite', 'session',
  'tokenizer', 'xml', 'zip'
];

// Pinned official artifacts. Never accept arbitrary URLs from renderer IPC.
export function availableArtifacts(platform = process.platform, arch = process.arch): RuntimeArtifact[] {
  const nodeVersion = '24.22.2';
  const nodeRoot = `node-v${nodeVersion}-${platform === 'darwin' ? 'darwin-arm64' : 'win-x64'}`;
  if (platform === 'darwin' && arch === 'arm64') {
    return [{
      id: 'node-24.22.2', name: 'Node.js', version: nodeVersion,
      sourceUrl: `https://nodejs.org/dist/v${nodeVersion}/${nodeRoot}.tar.gz`,
      sha256: 'aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a',
      archive: 'tar.gz', root: nodeRoot, executable: 'bin/node', license: 'MIT'
    }, {
      id: 'frankenphp-1.13.4-php-8.5.12', name: 'PHP', version: '8.5.12',
      sourceUrl: 'https://github.com/php/frankenphp/releases/download/v1.13.4/frankenphp-mac-arm64',
      sha256: '11ff0e0c3c2ae51a50ff4815d258a6775bb63e51718a34621e2fa8a3112c512d',
      archive: 'binary', root: '', executable: 'frankenphp', license: 'FrankenPHP: MIT; PHP: PHP-3.01'
    }];
  }
  if (platform === 'win32' && arch === 'x64') {
    return [{
      id: 'node-24.22.2', name: 'Node.js', version: nodeVersion,
      sourceUrl: `https://nodejs.org/dist/v${nodeVersion}/${nodeRoot}.zip`,
      sha256: 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2',
      archive: 'zip', root: nodeRoot, executable: 'node.exe', license: 'MIT'
    }, {
      id: 'php-8.5.12', name: 'PHP', version: '8.5.12',
      sourceUrl: 'https://downloads.php.net/~windows/releases/archives/php-8.5.12-1-nts-Win32-vs17-x64.zip',
      sha256: '2a36a2edcb7a5b9252f638fd5e4cf84d7f6e066092654220dc0b63e5cf4e9723',
      archive: 'zip', root: '', executable: 'php.exe', license: 'PHP-3.01'
    }];
  }
  return [];
}

function safeEntry(name: string): string[] {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.length > 1024) {
    throw new Error('Archive contains an unsafe path.');
  }
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('Archive contains an unsafe path.');
  }
  return parts;
}

function relativeEntry(name: string, artifact: RuntimeArtifact): string | null {
  const parts = safeEntry(name);
  if (!artifact.root) return parts.join('/');
  if (parts[0] !== artifact.root) throw new Error('Archive does not match its expected root directory.');
  return parts.length === 1 ? null : parts.slice(1).join('/');
}

async function extractZip(archive: string, output: string, artifact: RuntimeArtifact): Promise<void> {
  let totalSize = 0;
  await new Promise<void>((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, autoClose: true, decodeStrings: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError || new Error('Cannot open ZIP archive.'));
      let done = false;
      const fail = (error: Error) => {
        if (done) return;
        done = true;
        zip.close();
        reject(error);
      };
      zip.on('error', fail);
      zip.on('end', () => { if (!done) { done = true; resolve(); } });
      zip.on('entry', entry => {
        void (async () => {
          const name = relativeEntry(entry.fileName, artifact);
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (mode === 0o120000) throw new Error('Archive contains a symlink.');
          if (name === null) { zip.readEntry(); return; }
          const destination = path.join(output, ...name.split('/'));
          if (entry.fileName.endsWith('/')) {
            await mkdir(destination, { recursive: true });
          } else {
            totalSize += entry.uncompressedSize;
            if (totalSize > MAX_EXTRACTED_BYTES) throw new Error('Archive is too large after extraction.');
            await mkdir(path.dirname(destination), { recursive: true });
            const stream = await new Promise<NodeJS.ReadableStream>((next, error) => {
              zip.openReadStream(entry, (readError, file) => readError || !file ? error(readError || new Error('Cannot read ZIP entry.')) : next(file));
            });
            await pipeline(stream, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
}

async function extractTar(archive: string, output: string, artifact: RuntimeArtifact): Promise<void> {
  let totalSize = 0;
  await tar.x({
    file: archive, cwd: output, strip: 1, strict: true,
    filter(entryPath, entry) {
      if (!('type' in entry)) throw new Error('Invalid archive entry.');
      const name = relativeEntry(entryPath, artifact);
      if (name === null) return true;
      if (entry.type !== 'Directory' && entry.type !== 'File' && entry.type !== 'SymbolicLink') {
        throw new Error('Archive contains an unsupported entry.');
      }
      if (entry.type === 'SymbolicLink') {
        const link = entry.linkpath;
        if (!link || link.startsWith('/') || link.includes('\\')) throw new Error('Archive contains an unsafe symlink.');
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), link));
        if (resolved === '..' || resolved.startsWith('../')) throw new Error('Archive contains an unsafe symlink.');
      }
      totalSize += entry.size || 0;
      if (totalSize > MAX_EXTRACTED_BYTES) throw new Error('Archive is too large after extraction.');
      return true;
    }
  });
}

async function downloadOfficial(url: string, target: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !(
    ['nodejs.org', 'downloads.php.net'].includes(parsed.hostname) ||
    (parsed.hostname === 'github.com' && parsed.pathname.startsWith('/php/frankenphp/releases/download/'))
  )) {
    throw new Error('Runtime source must be an official HTTPS download.');
  }
  const signal = AbortSignal.timeout(180_000);
  let response = await fetch(url, { signal, redirect: parsed.hostname === 'github.com' ? 'manual' : 'error' });
  if (parsed.hostname === 'github.com') {
    const location = response.headers.get('location');
    const target = location ? new URL(location, url) : null;
    if (response.status !== 302 || target?.protocol !== 'https:' || target.hostname !== 'release-assets.githubusercontent.com') {
      throw new Error('Runtime release did not redirect to the expected GitHub asset host.');
    }
    await response.body?.cancel();
    response = await fetch(target, { signal, redirect: 'error' });
  }
  if (!response.ok || !response.body) throw new Error(`Runtime download failed (HTTP ${response.status}).`);
  let size = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    callback(size > MAX_DOWNLOAD_BYTES ? new Error('Runtime archive is too large.') : null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), limit, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export class RuntimeInstaller {
  private readonly pending = new Map<string, Promise<InstalledRuntime>>();

  constructor(
    private readonly directory: string,
    private readonly download: (url: string, target: string) => Promise<void> = downloadOfficial,
    private readonly verify: (binary: string, artifact: RuntimeArtifact) => Promise<void> = async (binary, artifact) => {
      try {
        const { stdout, stderr } = await execute(binary, artifact.archive === 'binary' ? ['version'] : ['--version'], { timeout: 5000, windowsHide: true });
        if (!(stdout + stderr).includes(artifact.version)) throw new Error('Downloaded runtime reports an unexpected version.');
        if (artifact.archive === 'binary') {
          // The macOS standalone server also provides the project's PHP CLI.
          // Reject an artifact lacking the extensions needed by typical Laravel projects.
          const script = `foreach (${JSON.stringify(FRANKENPHP_EXTENSIONS)} as $extension) { if (!extension_loaded($extension)) { fwrite(STDERR, "Missing extension: $extension\\n"); exit(1); } }`;
          await execute(binary, ['php-cli', '-r', script], { timeout: 10_000, windowsHide: true });
        }
      } catch (error) {
        if (artifact.name === 'PHP' && process.platform === 'win32') {
          throw new Error(`PHP could not start. The Microsoft Visual C++ Redistributable 2015–2022 x64 may be required. ${(error as Error).message}`);
        }
        throw error;
      }
    }
  ) {}

  async installed(artifact: RuntimeArtifact): Promise<InstalledRuntime | null> {
    const destination = path.join(this.directory, artifact.id);
    try {
      const saved: RuntimeArtifact = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'));
      if (JSON.stringify(saved) !== JSON.stringify(artifact)) throw new Error('Installed runtime manifest does not match.');
      const binary = path.join(destination, ...artifact.executable.split('/'));
      if (!(await stat(binary)).isFile()) throw new Error('Installed runtime executable is missing.');
      return { id: artifact.id, name: artifact.name, version: artifact.version, binary, sourceUrl: artifact.sourceUrl, license: artifact.license };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !fs.existsSync(destination)) return null;
      throw new Error(`Runtime ${artifact.id} needs repair; existing files were preserved. ${(error as Error).message}`);
    }
  }

  async install(artifact: RuntimeArtifact): Promise<InstalledRuntime> {
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(artifact.id) || !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      !['zip', 'tar.gz', 'binary'].includes(artifact.archive)) {
      throw new Error('Invalid runtime manifest.');
    }
    const pending = this.pending.get(artifact.id);
    if (pending) return pending;
    const operation = this.installOnce(artifact);
    this.pending.set(artifact.id, operation);
    try { return await operation; }
    finally { this.pending.delete(artifact.id); }
  }

  private async installOnce(artifact: RuntimeArtifact): Promise<InstalledRuntime> {
    const current = await this.installed(artifact);
    if (current) return current;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const staging = path.join(this.directory, `.install-${artifact.id}-${randomUUID()}`);
    const content = path.join(staging, 'content');
    await mkdir(content, { recursive: true });
    const archive = path.join(staging, `download.${artifact.archive === 'zip' ? 'zip' : artifact.archive === 'binary' ? 'bin' : 'tar.gz'}`);
    try {
      await this.download(artifact.sourceUrl, archive);
      if ((await stat(archive)).size > MAX_DOWNLOAD_BYTES || (await sha256(archive)) !== artifact.sha256) {
        throw new Error('Runtime checksum mismatch; no version was installed.');
      }
      if (artifact.archive === 'zip') await extractZip(archive, content, artifact);
      else if (artifact.archive === 'tar.gz') await extractTar(archive, content, artifact);
      else await rename(archive, path.join(content, artifact.executable));
      const binary = path.join(content, ...artifact.executable.split('/'));
      if (!(await stat(binary)).isFile()) throw new Error('Runtime archive is missing its executable.');
      if (process.platform !== 'win32') await chmod(binary, 0o755);
      await this.verify(binary, artifact);
      await writeFile(path.join(content, 'manifest.json'), JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      const destination = path.join(this.directory, artifact.id);
      await rename(content, destination);
      return (await this.installed(artifact))!;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
