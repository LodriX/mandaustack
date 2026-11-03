#!/usr/bin/env node
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
      console.log(`Linked ${store.add(argument).domain} (routing is planned for a later release)`);
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
    default:
      console.log('MandauStack 0.1.0\n\nCommands:\n  sites:list\n  sites:link <directory>\n  sites:unlink <domain>\n  runtimes:list');
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
