import os from 'node:os';
import path from 'node:path';

export function dataDirectory(platform = process.platform, home = os.homedir(), appData = process.env.APPDATA): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'MandauStack');
  if (platform === 'win32') return path.join(appData || path.join(home, 'AppData', 'Roaming'), 'MandauStack');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'mandaustack');
}
