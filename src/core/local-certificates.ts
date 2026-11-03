import { createPrivateKey, createPublicKey, randomBytes, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';

export interface LocalCertificates {
  caPath: string;
  certificate: string;
  privateKey: string;
}

function issueCertificate(ca?: { certificate: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey; domain: string }) {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = `0${randomBytes(16).toString('hex')}`;
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + (ca ? 397 : 3650) * 86_400_000);
  const name = [{ name: 'commonName', value: ca ? ca.domain : 'MandauStack Local CA' }];
  certificate.setSubject(name);
  certificate.setIssuer(ca ? ca.certificate.subject.attributes : name);
  certificate.setExtensions(ca ? [
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: ca.domain }] }
  ] : [
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' }
  ]);
  certificate.sign(ca?.key || keys.privateKey, forge.md.sha256.create());
  return { certificate: forge.pki.certificateToPem(certificate), privateKey: forge.pki.privateKeyToPem(keys.privateKey) };
}

function matchingKey(certificate: string, privateKey: string): boolean {
  const actual = createPublicKey(createPrivateKey(privateKey)).export({ format: 'der', type: 'spki' });
  const expected = createPublicKey(certificate).export({ format: 'der', type: 'spki' });
  return actual.equals(expected);
}

export function localCertificates(directory: string, domain = 'localhost'): LocalCertificates {
  if (domain !== 'localhost' && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.test$/.test(domain)) {
    throw new Error('Invalid local certificate domain.');
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const caPath = path.join(directory, 'ca.pem');
  const caKeyPath = path.join(directory, 'ca-key.pem');
  const leafPath = path.join(directory, `${domain}.pem`);
  const leafKeyPath = path.join(directory, `${domain}-key.pem`);
  let caPem: string;
  let caKeyPem: string;
  if (!fs.existsSync(caPath) && !fs.existsSync(caKeyPath)) {
    const created = issueCertificate();
    // Never silently replace a trusted CA, even if an interrupted write left only one file.
    fs.writeFileSync(caKeyPath, created.privateKey, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(caPath, created.certificate, { flag: 'wx', mode: 0o600 });
  }
  if (!fs.existsSync(caPath) || !fs.existsSync(caKeyPath)) throw new Error('Local CA is incomplete; existing files were preserved.');
  caPem = fs.readFileSync(caPath, 'utf8');
  caKeyPem = fs.readFileSync(caKeyPath, 'utf8');
  if (process.platform !== 'win32' && (fs.statSync(caKeyPath).mode & 0o077)) throw new Error('Local CA key permissions are too broad.');
  if (!matchingKey(caPem, caKeyPem)) throw new Error('Local CA key does not match its certificate.');
  const caCertificate = forge.pki.certificateFromPem(caPem);
  if (!caCertificate.verify(caCertificate) || caCertificate.validity.notAfter <= new Date()) {
    throw new Error('Local CA is invalid or expired; existing files were preserved.');
  }

  let renew = !fs.existsSync(leafPath) || !fs.existsSync(leafKeyPath);
  if (!renew) {
    try {
      const pem = fs.readFileSync(leafPath, 'utf8');
      const key = fs.readFileSync(leafKeyPath, 'utf8');
      const leaf = forge.pki.certificateFromPem(pem);
      renew = !matchingKey(pem, key) || !caCertificate.verify(leaf) || !new X509Certificate(pem).checkHost(domain) ||
        leaf.validity.notAfter.getTime() - Date.now() < 30 * 86_400_000;
    } catch { renew = true; }
  }
  if (renew) {
    const created = issueCertificate({ certificate: caCertificate, key: forge.pki.privateKeyFromPem(caKeyPem), domain });
    // A crash between the two renames is repaired on the next launch; the CA never changes.
    const suffix = randomBytes(8).toString('hex');
    const nextKey = `${leafKeyPath}.${suffix}.tmp`;
    const nextCert = `${leafPath}.${suffix}.tmp`;
    try {
      fs.writeFileSync(nextKey, created.privateKey, { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(nextCert, created.certificate, { flag: 'wx', mode: 0o600 });
      fs.renameSync(nextKey, leafKeyPath);
      fs.renameSync(nextCert, leafPath);
    } finally {
      fs.rmSync(nextKey, { force: true });
      fs.rmSync(nextCert, { force: true });
    }
  }
  if (process.platform !== 'win32' && (fs.statSync(leafKeyPath).mode & 0o077)) throw new Error('Local server key permissions are too broad.');
  return { caPath, certificate: fs.readFileSync(leafPath, 'utf8'), privateKey: fs.readFileSync(leafKeyPath, 'utf8') };
}
