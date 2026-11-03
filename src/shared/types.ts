export interface Site {
  id: string;
  name: string;
  path: string;
  domain: string;
  createdAt: string;
}

export interface RuntimeStatus {
  name: string;
  version: string | null;
  source: string | null;
}

export interface RuntimeArtifact {
  id: string;
  name: string;
  version: string;
  sourceUrl: string;
  sha256: string;
  archive: 'tar.gz' | 'zip' | 'binary';
  root: string;
  executable: string;
  license: string;
}

export interface InstalledRuntime {
  id: string;
  name: string;
  version: string;
  binary: string;
  sourceUrl: string;
  license: string;
}

export interface RuntimeOption {
  id: string;
  name: string;
  version: string;
  sourceUrl: string;
  license: string;
  installed: boolean;
}

export interface AppInfo {
  version: string;
  dataDirectory: string;
  gateway: { port: number; caPath: string } | null;
  gatewayError: string | null;
}

export interface PreviewStatus {
  siteId: string;
  url: string;
}

export interface DesktopApi {
  getInfo(): Promise<AppInfo>;
  listSites(): Promise<Site[]>;
  chooseDirectory(): Promise<string | null>;
  addSite(path: string): Promise<Site>;
  removeSite(id: string): Promise<void>;
  openDirectory(path: string): Promise<void>;
  detectRuntimes(): Promise<RuntimeStatus[]>;
  listManagedRuntimes(): Promise<RuntimeOption[]>;
  installRuntime(id: string): Promise<RuntimeOption[]>;
  listPreviews(): Promise<PreviewStatus[]>;
  startPreview(id: string): Promise<PreviewStatus>;
  stopPreview(id: string): Promise<void>;
  openPreview(id: string): Promise<void>;
}
