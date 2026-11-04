import { execFile } from 'node:child_process';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const project = path.resolve(import.meta.dirname, '..');
const signatureCommand = `
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $env:MANDAUSTACK_SIGNATURE_FILE
@{
  Status = [string]$signature.Status
  HasSigner = [bool]$signature.SignerCertificate
  HasTimestamp = [bool]$signature.TimeStamperCertificate
} | ConvertTo-Json -Compress
`;

export function windowsReleaseFiles(output, version) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version.');
  return [
    path.join(output, 'win-unpacked', 'MandauStack.exe'),
    path.join(output, `MandauStack Setup ${version}.exe`)
  ];
}

async function inspectSignature(file) {
  if (process.platform !== 'win32') throw new Error('Windows Authenticode verification requires Windows.');
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', signatureCommand], {
    env: { ...process.env, MANDAUSTACK_SIGNATURE_FILE: file },
    timeout: 15_000, maxBuffer: 16 * 1024, windowsHide: true
  });
  const result = JSON.parse(stdout);
  return { status: result.Status, hasSigner: result.HasSigner, hasTimestamp: result.HasTimestamp };
}

export async function verifyWindowsRelease(output, version, inspect = inspectSignature) {
  const files = windowsReleaseFiles(output, version);
  for (const file of files) {
    const metadata = await stat(file).catch(error => {
      if (error.code === 'ENOENT') throw new Error(`Windows release artifact is missing: ${file}`);
      throw error;
    });
    if (!metadata.isFile()) throw new Error(`Windows release artifact is not a file: ${file}`);
    const signature = await inspect(file);
    if (signature.status !== 'Valid' || signature.hasSigner !== true || signature.hasTimestamp !== true) {
      throw new Error(`Windows release artifact is not signed with a valid, timestamped certificate: ${file} (status: ${signature.status || 'unknown'}).`);
    }
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
    const output = path.resolve(process.argv[2] || path.join(project, 'release', 'signed'));
    const files = await verifyWindowsRelease(output, manifest.version);
    console.log(`Verified timestamped Authenticode signatures for ${files.length} Windows release artifacts.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
