import http, { type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import tls, { type TLSSocket } from 'node:tls';
import type { Site } from '../shared/types';
import { localCertificates } from './local-certificates';
import type { PreviewManager } from './previews';

export interface GatewayStatus { port: number; caPath: string }

const HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade'
]);

function forwardHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const forbidden = new Set(HOP_HEADERS);
  for (const token of (headers.connection || '').split(',')) forbidden.add(token.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !forbidden.has(name)));
}

export class HttpsGateway {
  private server: https.Server | null = null;
  private status: GatewayStatus | null = null;

  constructor(private readonly dataDirectory: string, private readonly sites: () => Site[], private readonly previews: PreviewManager) {}

  getStatus(): GatewayStatus | null { return this.status; }

  async start(): Promise<GatewayStatus> {
    if (this.status) return this.status;
    const directory = path.join(this.dataDirectory, 'certificates');
    const certificates = localCertificates(directory);
    const server = https.createServer({
      key: certificates.privateKey, cert: certificates.certificate, minVersion: 'TLSv1.2',
      SNICallback: (servername, callback) => {
        try {
          if (!this.sites().some(site => site.domain === servername)) throw new Error('Unknown local site.');
          const siteCert = localCertificates(directory, servername);
          callback(null, tls.createSecureContext({ key: siteCert.privateKey, cert: siteCert.certificate }));
        } catch (error) { callback(error as Error); }
      }
    }, (request, response) => {
      const host = request.headers.host?.toLowerCase() || '';
      const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.test)(?::([0-9]{1,5}))?$/.exec(host);
      const domain = match?.[1];
      const port = (server.address() as { port: number } | null)?.port;
      const servername = (request.socket as TLSSocket).servername;
      const sni = typeof servername === 'string' ? servername.toLowerCase() : null;
      if (!domain || !sni || sni !== domain || (match[2] && Number(match[2]) !== port)) {
        response.writeHead(421).end('Invalid local site host.');
        return;
      }
      let site: Site | undefined;
      try { site = this.sites().find(item => item.domain === domain); }
      catch { response.writeHead(500).end('Project registry is unavailable.'); return; }
      if (!site) { response.writeHead(404).end('Project is not linked.'); return; }
      const preview = this.previews.list().find(item => item.siteId === site.id);
      if (!preview) { response.writeHead(503).end('Start the project preview first.'); return; }
      const upstream = new URL(preview.url);
      if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' || !upstream.port) {
        response.writeHead(502).end('Invalid local preview address.');
        return;
      }
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) {
        response.writeHead(400).end('Invalid request path.');
        return;
      }
      const headers = forwardHeaders(request.headers);
      headers.host = domain;
      headers['x-forwarded-proto'] = 'https';
      headers['x-forwarded-host'] = domain;
      headers['x-forwarded-for'] = '127.0.0.1';
      const proxy = http.request({ hostname: '127.0.0.1', port: Number(upstream.port), method: request.method, path: request.url, headers, agent: false }, upstreamResponse => {
        if (response.destroyed) { upstreamResponse.destroy(); return; }
        response.writeHead(upstreamResponse.statusCode || 502, forwardHeaders(upstreamResponse.headers));
        upstreamResponse.pipe(response);
      });
      proxy.setTimeout(30_000, () => proxy.destroy(new Error('Preview timed out.')));
      proxy.on('error', () => { if (!response.headersSent) response.writeHead(502).end('Preview is unavailable.'); else response.destroy(); });
      request.on('aborted', () => proxy.destroy());
      request.pipe(proxy);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Cannot bind the local HTTPS gateway.');
      this.server = server;
      this.status = { port: address.port, caPath: certificates.caPath };
      return this.status;
    } catch (error) {
      server.close();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    this.status = null;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}
