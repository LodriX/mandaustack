import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppInfo, DesktopApi, HostsPlanSummary, NginxPlan, PreviewStatus, RuntimeOption, RuntimeStatus, Site } from '../shared/types';
import brandIcon from '../../assets/mandaustack-icon.svg';
import './style.css';

declare global {
  interface Window { mandaustack: DesktopApi }
}

function App(): React.JSX.Element {
  const [sites, setSites] = useState<Site[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([]);
  const [managedRuntimes, setManagedRuntimes] = useState<RuntimeOption[]>([]);
  const [previews, setPreviews] = useState<PreviewStatus[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [hostsPlan, setHostsPlan] = useState<HostsPlanSummary | null>(null);
  const [nginxPlan, setNginxPlan] = useState<NginxPlan | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busySite, setBusySite] = useState<string | null>(null);
  const [busyRuntime, setBusyRuntime] = useState<string | null>(null);
  const [busyHosts, setBusyHosts] = useState(false);
  const [busyCa, setBusyCa] = useState(false);
  const [busyNginx, setBusyNginx] = useState(false);

  useEffect(() => {
    void Promise.all([window.mandaustack.listSites(), window.mandaustack.detectRuntimes(), window.mandaustack.getInfo(), window.mandaustack.listPreviews(), window.mandaustack.listManagedRuntimes()])
      .then(([loadedSites, loadedRuntimes, loadedInfo, activePreviews, availableRuntimes]) => {
        setSites(loadedSites);
        setRuntimes(loadedRuntimes);
        setInfo(loadedInfo);
        setPreviews(activePreviews);
        setManagedRuntimes(availableRuntimes);
      }).catch(showError);
    const interval = window.setInterval(() => {
      void window.mandaustack.listPreviews().then(setPreviews).catch(showError);
    }, 3000);
    return () => window.clearInterval(interval);
  }, []);

  function showError(reason: unknown): void {
    setError(reason instanceof Error ? reason.message : String(reason));
  }

  async function linkSite(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      const location = await window.mandaustack.chooseDirectory();
      if (location) {
        await window.mandaustack.addSite(location);
        setSites(await window.mandaustack.listSites());
        setHostsPlan(null);
        setNginxPlan(null);
      }
    } catch (reason) { showError(reason); }
    finally { setBusy(false); }
  }

  async function unlinkSite(site: Site): Promise<void> {
    if (!window.confirm(`Unlink ${site.name}? Your project files will be preserved.`)) return;
    try {
      setError('');
      await window.mandaustack.removeSite(site.id);
      setSites(await window.mandaustack.listSites());
      setPreviews(await window.mandaustack.listPreviews());
      setHostsPlan(null);
      setNginxPlan(null);
    } catch (reason) { showError(reason); }
  }

  async function togglePreview(site: Site, running: boolean): Promise<void> {
    setError('');
    setBusySite(site.id);
    try {
      if (running) await window.mandaustack.stopPreview(site.id);
      else await window.mandaustack.startPreview(site.id);
      setPreviews(await window.mandaustack.listPreviews());
    } catch (reason) { showError(reason); }
    finally { setBusySite(null); }
  }

  async function installRuntime(runtime: RuntimeOption): Promise<void> {
    setError('');
    setBusyRuntime(runtime.id);
    try {
      setManagedRuntimes(await window.mandaustack.installRuntime(runtime.id));
    } catch (reason) { showError(reason); }
    finally { setBusyRuntime(null); }
  }

  async function changeHosts(restore: boolean): Promise<void> {
    setBusyHosts(true);
    setError('');
    try {
      setHostsPlan(restore ? await window.mandaustack.restoreHosts() : await window.mandaustack.applyHosts(hostsPlan!.originalSha256));
    } catch (reason) { showError(reason); }
    finally { setBusyHosts(false); }
  }

  async function changeCaTrust(remove: boolean): Promise<void> {
    setBusyCa(true);
    setError('');
    try {
      if (remove) await window.mandaustack.removeCaTrust();
      else await window.mandaustack.installCaTrust();
    } catch (reason) { showError(reason); }
    finally {
      try { setInfo(await window.mandaustack.getInfo()); }
      catch (reason) { showError(reason); }
      setBusyCa(false);
    }
  }

  async function changeNginx(restore: boolean): Promise<void> {
    if (!nginxPlan) return;
    setBusyNginx(true);
    setError('');
    try {
      setNginxPlan(restore ? await window.mandaustack.restoreNginx(nginxPlan.originalSha256)
        : await window.mandaustack.prepareNginx(nginxPlan.originalSha256, nginxPlan.configurationSha256));
    } catch (reason) {
      setNginxPlan(null);
      showError(reason);
    } finally { setBusyNginx(false); }
  }

  const filtered = sites.filter(site => `${site.name} ${site.path} ${site.domain}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="layout">
    <aside className="sidebar">
      <div className="brand"><img className="brand-mark" src={brandIcon} alt="" /><div className="brand-type"><strong>mandaustack</strong><span>LOCAL DEVELOPMENT ENVIRONMENT</span></div></div>
      <div className="nav-heading">WORKSPACE</div>
      <div className="nav-item active">▦ <span>Projects</span><small>{sites.length}</small></div>
      <div className="nav-heading second">ENVIRONMENT</div>
      <div className="nav-item">⌘ <span>Local runtimes</span></div>
      <div className="nav-item muted">◈ <span>Services · coming later</span></div>
      <div className="sidebar-bottom"><div><span className="status-dot"/> Local workspace <small>v{info?.version || '0.1.8'}</small></div><p>© {new Date().getFullYear()} MandauStack Contributors<br/>MIT License</p></div>
    </aside>
    <main>
      <header><div><span className="eyebrow">YOUR DEVELOPMENT SPACE</span><h1>Projects</h1><p>One place for your local development projects.</p></div><button className="primary" onClick={() => void linkSite()} disabled={busy}>+ Link existing project</button></header>
      {error && <div className="alert" role="alert">{error}<button aria-label="Dismiss" onClick={() => setError('')}>×</button></div>}
      <div className="notice"><span>◉</span><div><strong>Local PHP preview and HTTPS gateway</strong><p>Start a linked PHP/Laravel project to preview it. {info?.gateway ? `HTTPS routing is running on 127.0.0.1:${info.gateway.port}; port 443 is not configured yet. CA certificate: ${info.gateway.caPath}` : `HTTPS gateway unavailable${info?.gatewayError ? `: ${info.gatewayError}` : '.'}`} Browser previews still open on HTTP until trusted .test setup is ready.</p>
         {info?.platform === 'darwin' && info.gateway && <>
           <p role="status">Local CA: {info.caTrustError || (info.caTrust?.trusted ? 'trusted for this user' : 'not trusted for this user')}. {info.caTrust?.installedByMandauStack ? 'MandauStack has a removal record.' : 'No MandauStack removal record.'}</p>
           {!info.caTrustError && !info.caTrust?.trusted && !info.caTrust?.installedByMandauStack && <button className="secondary" disabled={busyCa} onClick={() => void changeCaTrust(false)}>{busyCa ? 'Updating Keychain…' : 'Trust local CA in user Keychain'}</button>}
           {info.caTrust?.installedByMandauStack && <button className="secondary" disabled={busyCa} onClick={() => void changeCaTrust(true)}>{busyCa ? 'Updating Keychain…' : 'Remove MandauStack CA trust'}</button>}
         </>}
         <button className="secondary" disabled={busyHosts} onClick={() => void window.mandaustack.previewHosts().then(setHostsPlan).catch(showError)}>Review .test hosts plan</button>{hostsPlan && <p role="status">{hostsPlan.changed ? `Proposed in ${hostsPlan.file}: ${hostsPlan.added.map(domain => `+ ${domain}`).join(', ') || 'no additions'}; ${hostsPlan.removed.map(domain => `- ${domain}`).join(', ') || 'no removals'}.` : `${hostsPlan.file}: no changes needed.`} {info?.platform === 'darwin' ? 'Apply requires macOS administrator authorization.' : 'Preview only; Windows installation is not yet supported.'}</p>}{hostsPlan?.changed && info?.platform === 'darwin' && <button className="secondary" disabled={busyHosts} onClick={() => void changeHosts(false)}>{busyHosts ? 'Updating…' : 'Install reviewed .test entries'}</button>}{hostsPlan?.restoreAvailable && info?.platform === 'darwin' && <button className="secondary" disabled={busyHosts} onClick={() => void changeHosts(true)}>Restore previous hosts file</button>}</div></div>
      {info?.gateway && <section className="runtime-section"><div className="section-heading"><div><h2>nginx configuration preview</h2><p>Review a local TLS reverse-proxy configuration. Preparation validates it with an existing nginx installation; it does not start nginx or bind a port.</p></div></div>
        <button className="secondary" disabled={busyNginx} onClick={() => void window.mandaustack.previewNginx().then(setNginxPlan).catch(showError)}>Review nginx configuration</button>
        {nginxPlan && <div className="nginx-plan"><p role="status">{nginxPlan.changed ? 'Changes proposed' : 'Configuration already prepared'} for {nginxPlan.file} on 127.0.0.1:{nginxPlan.listenPort}. No listener has been started.</p>
          <details><summary>Show proposed configuration</summary><pre>{nginxPlan.configuration}</pre></details>
          {info.platform === 'darwin' && nginxPlan.changed && <button className="secondary" disabled={busyNginx} onClick={() => void changeNginx(false)}>{busyNginx ? 'Validating…' : 'Validate and prepare reviewed configuration'}</button>}
          {info.platform === 'darwin' && nginxPlan.restoreAvailable && <button className="secondary" disabled={busyNginx} onClick={() => void changeNginx(true)}>Restore previous nginx configuration</button>}
        </div>}
      </section>}
      <section className="section-heading"><div><h2>Your projects</h2><p>{sites.length} linked {sites.length === 1 ? 'project' : 'projects'}</p></div><input aria-label="Search projects" placeholder="Search projects…" value={search} onChange={event => setSearch(event.target.value)}/></section>
      {filtered.length ? <div className="site-list">{filtered.map(site => {
        const preview = previews.find(item => item.siteId === site.id);
        return <article className="site" key={site.id}><div className="site-icon">{site.name[0].toUpperCase()}</div><div className="site-details"><strong>{site.name}</strong><span>{site.path}</span><span>{preview ? `Preview: ${preview.url}` : `Planned: ${site.domain}`}</span>{preview && info?.gateway && <span>{`HTTPS test: https://${site.domain}:${info.gateway.port}/ (use --resolve and --cacert)`}</span>}</div><div className="site-actions"><button className={preview ? 'secondary' : 'primary'} onClick={() => void togglePreview(site, Boolean(preview))} disabled={busySite === site.id}>{preview ? 'Stop' : 'Start preview'}</button>{preview && <button className="secondary" onClick={() => void window.mandaustack.openPreview(site.id).catch(showError)}>Open in browser</button>}<button className="secondary" onClick={() => void window.mandaustack.openDirectory(site.path).catch(showError)}>Open folder</button><button className="icon-button" title="Unlink project" aria-label={`Unlink ${site.name}`} disabled={busySite === site.id} onClick={() => void unlinkSite(site)}>×</button></div></article>;
      })}</div> : <div className="empty"><div className="empty-icon">⌁</div><h3>{search ? 'No matching projects' : 'Your workspace starts here'}</h3><p>{search ? 'Try a different search term.' : 'Link an existing project folder to get started.'}</p>{!search && <button className="secondary" onClick={() => void linkSite()} disabled={busy}>Link a project</button>}</div>}
      <section className="runtime-section"><div className="section-heading"><div><h2>Detected on this computer</h2><p>Read-only detection of tools already installed on your system</p></div></div><div className="runtime-grid">{runtimes.map(runtime => <div className="runtime" key={runtime.name}><div className="runtime-title">{runtime.name}</div><strong>{runtime.version || 'Not detected'}</strong><span>{runtime.source || 'Not installed by MandauStack'}</span></div>)}</div></section>
      <section className="runtime-section"><div className="section-heading"><div><h2>Managed runtimes</h2><p>Pinned downloads · SHA-256 verified · installed separately from your system</p></div></div><div className="runtime-grid">{managedRuntimes.map(runtime => <div className="runtime" key={runtime.id}><div className="runtime-title">{runtime.name} {runtime.version}</div><strong>{runtime.installed ? 'Installed' : 'Available to install'}</strong><span>{runtime.sourceUrl}</span><span>License: {runtime.license}</span>{!runtime.installed && <button className="primary runtime-install" onClick={() => void installRuntime(runtime)} disabled={Boolean(busyRuntime)}>{busyRuntime === runtime.id ? 'Downloading & verifying…' : `Install ${runtime.name}`}</button>}</div>)}</div>{!managedRuntimes.some(runtime => runtime.name === 'PHP') && <p className="runtime-note">Managed PHP is not available for this architecture; previews use an existing PHP installation.</p>}</section>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
