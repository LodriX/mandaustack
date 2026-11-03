#!/usr/bin/env node
import fs from 'node:fs';
import { planHosts, systemHostsPath } from './core/hosts';
import { dataDirectory } from './core/paths';
import { detectRuntimes } from './core/runtimes';
import { SiteStore } from './core/sites';

const store = new SiteStore(dataDirectory());

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  switch (command) {
    case 'sites:list':
      for (const site of store.list()) console.log(`${site.domain}\t${site.path}`);
      return;
    case 'sites:link':
      if (!argument) throw new Error('Usage: mandaustack sites:link <directory>');
      console.log(`Linked ${store.add(argument).domain} (start a preview for HTTPS gateway routing)`);
      return;
    case 'sites:unlink': {
      if (!argument) throw new Error('Usage: mandaustack sites:unlink <domain>');
      const site = store.list().find(item => item.domain === argument);
      if (!site) throw new Error('Project not found.');
      store.remove(site.id);
      console.log(`Unlinked ${site.domain}; project files were preserved.`);
      return;
    }
    case 'runtimes:list':
      for (const runtime of await detectRuntimes()) console.log(`${runtime.name}\t${runtime.version || 'Not detected'}`);
      return;
    case 'hosts:plan': {
      const file = systemHostsPath();
      const plan = planHosts(fs.readFileSync(file, 'utf8'), store.list().map(site => site.domain));
      console.log(`Hosts file: ${file}\nCurrent SHA-256: ${plan.originalSha256}`);
      for (const domain of plan.added) console.log(`+ 127.0.0.1 ${domain}`);
      for (const domain of plan.removed) console.log(`- 127.0.0.1 ${domain}`);
      console.log(plan.changed ? 'Plan only; system hosts were not modified.' : 'Already up to date; system hosts were not modified.');
      return;
    }
    default:
      console.log('MandauStack 0.1.6\n\nCommands:\n  sites:list\n  sites:link <directory>\n  sites:unlink <domain>\n  runtimes:list\n  hosts:plan');
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
