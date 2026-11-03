import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { NginxPlan, Site } from '../shared/types';
import { localCertificates } from './local-certificates';

const execute = promisify(execFile);
const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.test$/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
type Run = (file: string, args: string[]) => Promise<void>;

function quotePath(value: string): string {
  if (!path.isAbsolute(value) || /[\x00-\x1f\x7f$]/.test(value)) throw new Error('Unsafe nginx configuration path.');
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function renderNginxConfig(dataDirectory: string, sites: Site[], gatewayPort: number, listenPort = 8443): string {
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535 ||
    !Number.isInteger(listenPort) || listenPort < 1024 || listenPort > 65535 || gatewayPort === listenPort) {
    throw new Error('Invalid or privileged nginx port.');
  }
  const domains = sites.map(site => site.domain);
  if (domains.some(domain => !domainPattern.test(domain)) || new Set(domains).size !== domains.length) {
    throw new Error('Invalid or duplicate .test domain in nginx plan.');
  }
  const certDir = path.join(dataDirectory, 'certificates');
  const ca = quotePath(path.join(certDir, 'ca.pem'));
  const binding = `127.0.0.1:${listenPort}`;
  return [
    'worker_processes 1;',
    `pid ${quotePath(path.join(dataDirectory, 'nginx', 'nginx.pid'))};`,
    'error_log stderr warn;',
    'events { worker_connections 128; }',
    'http {',
    '  access_log off;',
    '  server_tokens off;',
    `  server { listen ${binding} ssl default_server; server_name _;`,
    `    ssl_certificate ${quotePath(path.join(certDir, 'localhost.pem'))};`,
    `    ssl_certificate_key ${quotePath(path.join(certDir, 'localhost-key.pem'))};`,
    '    return 421;',
    '  }',
    ...[...domains].sort().flatMap(domain => [
      `  server { listen ${binding} ssl; server_name ${domain};`,
      `    ssl_certificate ${quotePath(path.join(certDir, `${domain}.pem`))};`,
      `    ssl_certificate_key ${quotePath(path.join(certDir, `${domain}-key.pem`))};`,
      '    if ($ssl_server_name != $host) { return 421; }',
      '    location / {',
      '      proxy_http_version 1.1;',
      '      proxy_set_header Host $host;',
      '      proxy_set_header X-Forwarded-Proto https;',
      '      proxy_set_header Connection "";',
      '      proxy_ssl_server_name on;',
      '      proxy_ssl_name $host;',
      `      proxy_ssl_trusted_certificate ${ca};`,
      '      proxy_ssl_verify on;',
      `      proxy_pass https://127.0.0.1:${gatewayPort};`,
      '    }',
      '  }'
    ]),
    '}',
    ''
  ].join('\n');
}

export class NginxConfigManager {
  private readonly directory: string;
  private readonly file: string;
  private readonly previous: string;

  constructor(private readonly dataDirectory: string, private readonly run: Run = async (binary, args) => {
    await execute(binary, args, { timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true });
  }, private readonly listenPort = 8443) {
    this.directory = path.join(dataDirectory, 'nginx');
    this.file = path.join(this.directory, 'nginx.conf');
    this.previous = path.join(this.directory, 'nginx.conf.previous');
  }

  plan(sites: Site[], gatewayPort: number): NginxPlan {
    const configuration = renderNginxConfig(this.dataDirectory, sites, gatewayPort, this.listenPort);
    const original = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8') : '';
    return { file: this.file, configuration, configurationSha256: sha256(configuration), changed: configuration !== original,
      originalSha256: sha256(original), restoreAvailable: fs.existsSync(this.previous), listenPort: this.listenPort };
  }

  private checkCurrent(expectedSha256: string): void {
    const current = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8') : '';
    if (sha256(current) !== expectedSha256) throw new Error('nginx configuration changed; review it again before applying.');
  }

  async prepare(sites: Site[], gatewayPort: number, expectedSha256: string, expectedConfigurationSha256: string, nginxBinary: string): Promise<NginxPlan> {
    this.checkCurrent(expectedSha256);
    const plan = this.plan(sites, gatewayPort);
    if (plan.configurationSha256 !== expectedConfigurationSha256) throw new Error('nginx site plan changed; review it again before applying.');
    if (!plan.changed) return plan;
    if (!path.isAbsolute(nginxBinary) || !fs.existsSync(nginxBinary) || !fs.statSync(nginxBinary).isFile()) {
      throw new Error('A local nginx executable is required to validate the configuration.');
    }
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const certDir = path.join(this.dataDirectory, 'certificates');
    localCertificates(certDir);
    for (const site of sites) localCertificates(certDir, site.domain);
    const staging = path.join(this.directory, `nginx.conf.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(staging, plan.configuration, { flag: 'wx', mode: 0o600 });
      await this.run(nginxBinary, ['-t', '-q', '-p', `${this.directory}${path.sep}`, '-c', staging]);
      this.checkCurrent(expectedSha256);
      if (fs.existsSync(this.file)) {
        const backup = `${this.previous}.${randomUUID()}.tmp`;
        try {
          fs.copyFileSync(this.file, backup, fs.constants.COPYFILE_EXCL);
          fs.renameSync(backup, this.previous);
        } finally { fs.rmSync(backup, { force: true }); }
      }
      fs.renameSync(staging, this.file);
      return this.plan(sites, gatewayPort);
    } finally { fs.rmSync(staging, { force: true }); }
  }

  restore(expectedSha256: string): void {
    this.checkCurrent(expectedSha256);
    if (!fs.existsSync(this.previous)) throw new Error('No previous validated nginx configuration is available.');
    fs.renameSync(this.previous, this.file);
  }
}
