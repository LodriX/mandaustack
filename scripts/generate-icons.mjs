import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const assets = path.join(root, 'assets');
const svg = await readFile(path.join(assets, 'mandaustack-icon.svg'), 'utf8');

function render(size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

await writeFile(path.join(assets, 'icon.png'), render(1024));
await writeFile(path.join(assets, 'icon.ico'), await pngToIco([16, 32, 48, 64, 128, 256].map(render)));

if (process.platform === 'darwin') {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'mandaustack-icon-'));
  const iconset = path.join(temp, 'MandauStack.iconset');
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      await writeFile(path.join(iconset, `icon_${size}x${size}.png`), render(size));
      await writeFile(path.join(iconset, `icon_${size}x${size}@2x.png`), render(size * 2));
    }
    await exec('iconutil', ['-c', 'icns', '-o', path.join(assets, 'icon.icns'), iconset]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

console.log('MandauStack icons generated from the SVG brand asset.');
