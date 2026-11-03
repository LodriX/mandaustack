import { execFile } from 'node:child_process';
import { X509Certificate, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CaTrustStatus } from '../shared/types';

const execute = promisify(execFile);
type Command = (file: string, args: string[]) => Promise<{ stdout: string }>;

interface TrustRecord { fingerprint: string; keychain: string }

export class MacCaTrust {
  private readonly recordPath: string;

  constructor(private readonly caPath: string, dataDirectory: string, private readonly run: Command = async (file, args) =>
    execute(file, args, { timeout: 30_000, maxBuffer: 256 * 1024, windowsHide: true })) {
    this.recordPath = path.join(dataDirectory, 'ca-trust.json');
  }

  private certificate(): { fingerprint: string } {
    const cert = new X509Certificate(fs.readFileSync(this.caPath));
    if (!cert.ca || !cert.verify(cert.publicKey)) {
      throw new Error('Local CA certificate is invalid.');
    }
    return { fingerprint: cert.fingerprint256.replaceAll(':', '').toUpperCase() };
  }

  private readRecord(): TrustRecord | null {
    if (!fs.existsSync(this.recordPath)) return null;
    const value: unknown = JSON.parse(fs.readFileSync(this.recordPath, 'utf8'));
    if (!value || typeof value !== 'object' || !('fingerprint' in value) || !('keychain' in value) ||
      typeof value.fingerprint !== 'string' || !/^[A-F0-9]{64}$/.test(value.fingerprint) ||
      typeof value.keychain !== 'string' || !path.isAbsolute(value.keychain)) {
      throw new Error('Saved CA trust record is damaged; it was preserved.');
    }
    return { fingerprint: value.fingerprint, keychain: value.keychain };
  }

  private saveRecord(value: TrustRecord): void {
    const temporary = `${this.recordPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, this.recordPath);
    } finally { fs.rmSync(temporary, { force: true }); }
  }

  private async verified(): Promise<boolean> {
    try {
      await this.run('/usr/bin/security', ['verify-cert', '-c', path.join(path.dirname(this.caPath), 'localhost.pem'), '-p', 'ssl', '-n', 'localhost', '-L', '-q']);
      return true;
    } catch { return false; }
  }

  private async defaultKeychain(): Promise<string> {
    const { stdout } = await this.run('/usr/bin/security', ['default-keychain', '-d', 'user']);
    const raw = stdout.trim();
    const keychain: unknown = raw.startsWith('"') ? JSON.parse(raw) : raw;
    if (typeof keychain !== 'string' || !path.isAbsolute(keychain)) throw new Error('User login keychain is unavailable.');
    return keychain;
  }

  private async contains(keychain: string, fingerprint: string): Promise<boolean> {
    try {
      const { stdout } = await this.run('/usr/bin/security', ['find-certificate', '-a', '-Z', '-c', 'MandauStack Local CA', keychain]);
      return [...stdout.matchAll(/SHA-256 hash:\s*([A-Fa-f0-9:]+)/g)].some(match => match[1].replaceAll(':', '').toUpperCase() === fingerprint);
    } catch (error) {
      if (String((error as NodeJS.ErrnoException).code) === '44') return false;
      throw error;
    }
  }

  async status(): Promise<CaTrustStatus> {
    const { fingerprint } = this.certificate();
    const record = this.readRecord();
    if (record && record.fingerprint !== fingerprint) throw new Error('Local CA changed after it was trusted; existing trust was preserved.');
    return { trusted: await this.verified(), installedByMandauStack: Boolean(record) };
  }

  async install(): Promise<CaTrustStatus> {
    if (process.platform !== 'darwin') throw new Error('CA trust installation is available on macOS only.');
    const { fingerprint } = this.certificate();
    if (Date.parse(new X509Certificate(fs.readFileSync(this.caPath)).validTo) <= Date.now()) {
      throw new Error('Local CA certificate has expired.');
    }
    const record = this.readRecord();
    if (record) {
      if (record.fingerprint !== fingerprint) throw new Error('Local CA changed after it was trusted; existing trust was preserved.');
      if (await this.verified()) return { trusted: true, installedByMandauStack: true };
      throw new Error('The previously installed CA is no longer trusted; its recovery record was preserved.');
    }
    const keychain = await this.defaultKeychain();
    if (await this.contains(keychain, fingerprint) || await this.verified()) {
      throw new Error('This CA is already present or trusted outside MandauStack; it will not be replaced.');
    }
    try {
      await this.run('/usr/bin/security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', keychain, this.caPath]);
    } catch (error) {
      if (await this.contains(keychain, fingerprint)) this.saveRecord({ fingerprint, keychain });
      throw error;
    }
    try {
      if (!(await this.verified()) || !(await this.contains(keychain, fingerprint))) throw new Error('CA trust could not be verified.');
      this.saveRecord({ fingerprint, keychain });
    } catch (error) {
      try {
        await this.run('/usr/bin/security', ['remove-trusted-cert', this.caPath]);
        await this.run('/usr/bin/security', ['delete-certificate', '-t', '-Z', fingerprint, keychain]);
      } catch {
        this.saveRecord({ fingerprint, keychain });
        throw new Error(`CA installation needs recovery; its trust record was saved. ${(error as Error).message}`);
      }
      throw error;
    }
    return { trusted: true, installedByMandauStack: true };
  }

  async remove(): Promise<CaTrustStatus> {
    if (process.platform !== 'darwin') throw new Error('CA trust removal is available on macOS only.');
    const { fingerprint } = this.certificate();
    const record = this.readRecord();
    if (!record) throw new Error('MandauStack did not install this CA in the user keychain.');
    if (record.fingerprint !== fingerprint) throw new Error('Local CA changed after it was trusted; existing trust was preserved.');
    if (await this.contains(record.keychain, fingerprint)) {
      if (await this.verified()) await this.run('/usr/bin/security', ['remove-trusted-cert', this.caPath]);
      await this.run('/usr/bin/security', ['delete-certificate', '-t', '-Z', fingerprint, record.keychain]);
    }
    if (await this.contains(record.keychain, fingerprint)) throw new Error('CA still exists in the login keychain; recovery record was preserved.');
    fs.rmSync(this.recordPath);
    return { trusted: await this.verified(), installedByMandauStack: false };
  }
}
