# MandauStack

MandauStack is a free, open-source local development environment for PHP and Laravel on macOS and Windows. It is developed with an AI-driven workflow; code, dependencies, and releases require review and testing. No account, license key, paid tier, advertisements, or upgrade prompts are required.

Branding follows the supplied MandauStack reference: a red mandau/server emblem, lowercase wordmark, and the tagline “LOCAL DEVELOPMENT ENVIRONMENT.” The vector artwork in `assets/mandaustack-icon.svg` is a redraw based on that reference; replace it with the original vector master if one becomes available. The UI, generated app icons, and installer metadata use the same identity. Copyright: © 2026 MandauStack Contributors; application source is MIT licensed.

**Status: 0.1.7 early preview.** This release links existing project folders, persists a project registry, detects PHP/Node.js/Composer/nginx already on the system, and provides a desktop interface and basic CLI. The desktop app can start and stop local PHP previews for linked projects. Managed downloads are available for Node.js and PHP on macOS Apple Silicon and Windows x64. A local HTTPS gateway can route linked `*.test` sites to running previews on a random loopback port, with a private per-user CA and valid per-site certificates. A reviewed hosts plan can be installed through an explicit macOS administrator authorization; the macOS user Keychain can trust the local CA through a separate explicit action. Windows hosts and certificate trust integration are pending. **Browser-ready `https://project.test/` URLs are not available yet:** port 443 and nginx are not installed. Version switching, databases, and other services are planned; do not use this version as a complete local stack.

## Develop

Requirements: Node.js and npm. On macOS, the eventual release target is macOS 14+ Apple Silicon; on Windows, Windows 10+ x64. The desktop foundation has not yet been verified on a Windows machine.

```sh
npm install
npm run dev
```

Build and test:

```sh
npm run build
npm test
```

Basic CLI from the source checkout:

```sh
npm run cli -- sites:list
npm run cli -- sites:link /path/to/project
npm run cli -- sites:unlink project.test
npm run cli -- runtimes:list
npm run cli -- hosts:plan
```

`sites:unlink` removes only the registration; project files are never deleted. The desktop and CLI share the same per-user registry: `~/Library/Application Support/MandauStack` on macOS or `%APPDATA%\MandauStack` on Windows. Packages can be built with `npm run package:mac` on macOS and `npm run package:win` on Windows; packages are not yet signed or released.

### Local preview

Link a project containing `public/index.php` (Laravel), `index.php`, or `index.html`, then select **Start preview**. Install managed PHP in the app first, or use PHP already on the system. The app starts a PHP development server on `127.0.0.1` at a free port; managed macOS PHP uses FrankenPHP's included server. Select **Open in browser** to visit its actual URL; **Stop** or quitting the app ends the process. Laravel's `public/` directory is served instead of the project root, so files outside `public/` are not exposed. The preview address changes after a restart, and projects are not started automatically. The CLI currently manages registrations only, not running previews.

This preview and gateway are intermediate development features, not the promised nginx-backed, trusted `https://project.test` service. To keep a project running without this desktop window, a persistent managed service will be needed in a future version.

### Local HTTPS gateway (developer test)

The desktop app starts an HTTPS gateway bound only to `127.0.0.1` on an available high port. Its port and public CA certificate path appear in the desktop app. The CA private key and per-site keys are stored with restricted permissions under the user data directory's `certificates/` folder; the same CA is reused after restart, and site certificates are renewed before expiry. Requests are routed only when the TLS server name and HTTP Host match a linked project that has a running preview. System DNS is changed only by an explicit authorized macOS action; the user Keychain is changed only when you select **Trust local CA in user Keychain** or **Remove MandauStack CA trust**. The CA private key is never imported into Keychain.

To test a running project from a terminal, replace the domain, port, and certificate path shown in the app:

```sh
curl --noproxy '*' --resolve project.test:PORT:127.0.0.1 --cacert "/path/to/MandauStack/certificates/ca.pem" "https://project.test:PORT/"
```

This checks the certificate and site routing without bypassing TLS validation. Do not use `--insecure` for the check. See [docs/local-https.md](docs/local-https.md) for the remaining OS integration steps.

On macOS, **Trust local CA in user Keychain** checks whether this exact CA already exists, imports only its public certificate with SSL trust into the default user Keychain, checks a locally issued certificate using the OS trust verifier, and saves its SHA-256 fingerprint and Keychain location for recovery. It does not take ownership of a CA that was already installed or trusted elsewhere. **Remove MandauStack CA trust** acts only on the recorded fingerprint and Keychain, without removing projects or private keys. A locked Keychain may prompt you to unlock it. These actions have been tested with a simulated Keychain, not authorized on a real machine yet; if an operation fails, the app retains its recovery record where possible.

**Review .test hosts plan** in the app or run `npm run cli -- hosts:plan` to inspect the mappings for all linked projects. The planner rejects existing mappings owned by other software and does not change the system hosts file. On macOS, **Install reviewed .test entries** asks for administrator authorization, rechecks the plan against the current file, makes a protected backup, and replaces only the managed block. **Restore previous hosts file** reverts the last operation if the file has not since changed. This UI path has not yet been exercised with real administrator authorization; its file operations were tested using isolated copies. The Windows button is not enabled until ACL-preserving replacement is tested.

### Managed runtime downloads

In **Managed runtimes**, select **Install** for a pinned artifact. MandauStack downloads it on demand over HTTPS, validates a pinned SHA-256 hash, checks the executable version, and installs into an isolated `runtimes/` directory inside its user data directory. An interrupted or mismatched download does not replace an existing runtime. Source URL and license are visible in the application. The current Node.js artifact is 24.22.2 on macOS ARM and Windows x64. PHP 8.5.12 comes from the official Windows PHP archive on Windows x64 and from the official FrankenPHP 1.13.4 standalone release on macOS ARM; the latter contains PHP and a web server, and its required Laravel extensions are checked during installation. These exact versions must be updated deliberately when upstream patches are released.

Managed PHP is used for previews after installation on both platforms. On macOS it is provided by FrankenPHP (`frankenphp php-cli` for scripts, `frankenphp php-server` for the preview); the app does not yet provide a terminal `php` alias or managed Composer. On Windows, the official PHP binary may need the Microsoft Visual C++ Redistributable 2015–2022 x64; if unavailable, MandauStack reports a startup error. Managed Node.js is available by its installed binary path but is **not yet added to the terminal PATH or selected per project**. Windows installation still needs validation on a Windows machine.

The macOS ARM PHP artifact was tested by downloading it from the pinned GitHub release, verifying its hash and extensions, serving a PHP site, and running Artisan and the welcome page of a newly created Laravel 13 application. The Laravel app was created with an existing system Composer/PHP installation; managed Composer and a clean-machine installation flow still need testing. Set `MANDAUSTACK_TEST_REMOTE_RUNTIME=1` when running `npm test` to repeat the official runtime download and preview checks. To additionally test a local Laravel 13 project, set `MANDAUSTACK_TEST_FRANKENPHP_BINARY` to the downloaded standalone binary and `MANDAUSTACK_TEST_LARAVEL_SITE` to that project directory.

## Product decisions

- Target 1.0.0: local site management, PHP and Node.js versions, nginx, local domains and HTTPS, Composer/Laravel installer, database/cache/search/storage/broadcasting services, per-site configuration, mail capture, logs, dumps, profiling, Tinker, Xdebug, workspace Git, and CLI. Every promised feature must pass real Laravel integration tests on both OSes before 1.0.0.
- Windows WSL2 is optional and only required when installing a service with no officially supported native Windows runtime (for example Valkey or Typesense).
- RustFS is the default S3-compatible local storage option. MinIO Community support depends on a viable source/community distribution method; never silently substitute proprietary editions.
- Installed service data and project files persist across application updates and uninstall. Back up before data migrations; deleting user data always requires a separate explicit action.
- Initial 0.x releases use manual installers; auto-update is a prerequisite for 1.0.0. Runtime installation must be on demand, with download integrity checks and a visible provenance/license record.
- MandauStack's own code is MIT licensed. Downloadable services have their own licenses; free-to-use does not always mean OSI-approved open source. MongoDB Community, for instance, uses SSPL and must be labeled accordingly.

## Safe version changes (design requirement)

The UI will offer a project-level version selector with installed versions and compatibility information. Runtime switching is **not implemented in 0.1.7**. Before it is exposed, the engine must:

1. Download into a versioned, isolated directory, verify checksum/signature and executable, then leave the currently active version untouched.
2. Validate project configuration, required PHP extensions or service compatibility and port availability before switching. PHP CLI and web server must resolve to the same selected version.
3. Keep a known-good configuration, switch atomically, restart only affected processes, run a health check, and automatically restore the previous version/configuration if it fails. Report the exact reason and recovery action.
4. For MySQL/MariaDB/PostgreSQL and similar stateful services, **never point a different major version at the existing data directory without a supported migration**. Provide separate instances and data directories; require a verified backup and migration path for upgrades. Changing a project's database connection must not implicitly upgrade its server or destroy data.
5. Test both successful transitions and deliberate failure (bad archive, unavailable port, incompatible data, failed health check) on macOS and Windows before the selector ships.

See [docs/runtime-matrix.md](docs/runtime-matrix.md) for the initial service plan.
