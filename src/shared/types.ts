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
  platform: string;
  gateway: { port: number; caPath: string } | null;
  gatewayError: string | null;
  caTrust: CaTrustStatus | null;
  caTrustError: string | null;
}

export interface CaTrustStatus { trusted: boolean; installedByMandauStack: boolean }

export interface PreviewStatus {
  siteId: string;
  url: string;
}

export interface HostsPlanSummary {
  file: string;
  added: string[];
  removed: string[];
  changed: boolean;
  originalSha256: string;
  restoreAvailable: boolean;
}

export interface NginxPlan {
  file: string;
  configuration: string;
  configurationSha256: string;
  changed: boolean;
  originalSha256: string;
  restoreAvailable: boolean;
  listenPort: number;
}

export interface DesktopApi {
  getInfo(): Promise<AppInfo>;
  listSites(): Promise<Site[]>;
  chooseDirectory(): Promise<string | null>;
  addSite(path: string): Promise<Site>;
  removeSite(id: string): Promise<void>;
  openDirectory(path: string): Promise<void>;
  previewHosts(): Promise<HostsPlanSummary>;
  applyHosts(expectedSha256: string): Promise<HostsPlanSummary>;
  restoreHosts(): Promise<HostsPlanSummary>;
  installCaTrust(): Promise<CaTrustStatus>;
  removeCaTrust(): Promise<CaTrustStatus>;
  previewNginx(): Promise<NginxPlan>;
  prepareNginx(expectedSha256: string, expectedConfigurationSha256: string): Promise<NginxPlan>;
  restoreNginx(expectedSha256: string): Promise<NginxPlan>;
  detectRuntimes(): Promise<RuntimeStatus[]>;
  listManagedRuntimes(): Promise<RuntimeOption[]>;
  installRuntime(id: string): Promise<RuntimeOption[]>;
  listPreviews(): Promise<PreviewStatus[]>;
  startPreview(id: string): Promise<PreviewStatus>;
  stopPreview(id: string): Promise<void>;
  openPreview(id: string): Promise<void>;
}
