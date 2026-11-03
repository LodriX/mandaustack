import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Site } from '../shared/types';

interface SiteState {
  schemaVersion: 1;
  sites: Site[];
}

export class SiteStore {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'sites.json');
  }

  list(): Site[] {
    if (!fs.existsSync(this.file)) return [];
    const state: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!isSiteState(state)) throw new Error('Invalid site registry. No changes were made.');
    return state.sites;
  }

  add(inputPath: string): Site {
    const actualPath = fs.realpathSync(inputPath);
    if (!fs.statSync(actualPath).isDirectory()) throw new Error('Choose an existing project directory.');
    const name = path.basename(actualPath);
    const slug = name.toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length > 63) {
      throw new Error('Project directory name must contain only letters, numbers, and hyphens, and cannot start or end with a hyphen.');
    }
    const sites = this.list();
    if (sites.some(site => site.path.toLowerCase() === actualPath.toLowerCase())) {
      throw new Error('This directory is already linked.');
    }
    const domain = `${slug}.test`;
    if (sites.some(site => site.domain === domain)) throw new Error(`Domain ${domain} is already registered.`);
    const site: Site = { id: randomUUID(), name, path: actualPath, domain, createdAt: new Date().toISOString() };
    this.save([...sites, site]);
    return site;
  }

  remove(id: string): void {
    const sites = this.list();
    const remaining = sites.filter(site => site.id !== id);
    if (remaining.length === sites.length) throw new Error('Project not found.');
    this.save(remaining);
  }

  private save(sites: Site[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, sites }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}

function isSiteState(value: unknown): value is SiteState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<SiteState>;
  return state.schemaVersion === 1 && Array.isArray(state.sites) && state.sites.every(site =>
    typeof site.id === 'string' && typeof site.name === 'string' && typeof site.path === 'string' &&
    typeof site.domain === 'string' && typeof site.createdAt === 'string'
  );
}
