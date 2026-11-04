# Progress and handoff / Progres dan serah-terima

**Last updated / Terakhir diperbarui:** 2026-11-04
**Milestone baseline commit:** `06e20cc` on `main` (`0.1.10`); this handoff covers the 0.1.11 Windows candidate, signing preparation, and test results.
**Purpose:** live status, decisions, and next actions. Stable rules and commands live in [`AGENTS.md`](../AGENTS.md).

## Snapshot / Ringkasan

- **Version / Versi:** 0.1.10 early preview baseline; `package.json` is 0.1.11 for an unsigned **internal Windows candidate**, not a public release. Next planned milestone: 0.2.0.
- **Current state / Status:** unpacked Windows 0.1.11 passed an isolated packaged-app/managed-PHP/HTTPS smoke test including quit, restart and unlink. Unsigned NSIS installation/uninstallation is untested; the signing command is ready but no signing identity or signed artifact exists. Windows nginx service integration is pending. The privileged macOS port-443 helper plan awaits approval; no 0.2.0 implementation has started.
- **Next action / Aksi berikutnya:** test `release/MandauStack Setup 0.1.11.exe` install/uninstall on a disposable Windows profile/VM, then start with `src/core/nginx-service.ts` for isolated Windows nginx lifecycle work. Public signing awaits publisher identity and certificate; macOS 0.2.0 work awaits plan approval.

## Completed / Selesai

- Managed runtime installation: Node.js 24.22.2, PHP 8.5.12 (FrankenPHP 1.13.4 on macOS ARM), and nginx 1.30.6 with pinned downloads and SHA-256 checks.
- Local PHP previews, HTTPS gateway with per-site certificates, hosts planning, macOS Keychain CA trust, and managed nginx on loopback port 8443.
- Desktop UI and basic CLI for sites and runtimes.
- Documentation, tests, version 0.1.10, commit `0027f7d` pushed to `main`, and DMG built at `release/MandauStack-0.1.10-arm64.dmg`.
- **2026-11-04 Windows x64:** unsigned NSIS installer built at `release/MandauStack Setup 0.1.10.exe` (ignored by git; local to this device). It has not been run, installed, or distributed.
- **2026-11-04 Windows signing preparation:** `npm run package:win:signed` now targets `release/signed/`, requires electron-builder code signing, and verifies the packaged executable and installer have locally valid, timestamped Authenticode signatures. No signed release has been produced.
- **2026-11-04 Windows 0.1.11 candidate:** managed Windows PHP loads Laravel extensions through isolated startup arguments and verifies them before installation; existing system PHP is unchanged. Pinned Node.js 24.22.2, PHP 8.5.12, and nginx 1.30.6 executables ran in isolated directories; no Windows nginx service was started. `npm run package:win` produced `release/MandauStack Setup 0.1.11.exe` unsigned. The unpacked app passed a managed-PHP/HTTPS smoke test with disposable app data and a temporary project.
- The 0.1.10 baseline and 0.1.11 internal candidate are separate; rerun relevant checks before any 0.2.0 claim.

## Active / Aktif

- **0.2.0 plan:** browser-ready `https://<project>.test/` without a port, using a permanent privileged LaunchDaemon helper.
- **Windows setup (2026-11-04):** dependencies installed; core and unpacked GUI tested with temporary data and managed PHP without modifying hosts, CA trust, or Laragon. Installer installation/uninstallation, an actual Laravel project and Windows nginx service on port 8443 remain unverified or unimplemented.
- Planned flow: app (unprivileged) -> Unix socket `0600` -> root helper -> root-owned nginx with `nobody` workers -> `127.0.0.1:443` and `[::1]:443` -> HTTPS gateway -> PHP preview.
- Planned new files: `src/nginx-helper.ts`, `src/helper-installer.ts`, `src/core/privileged-nginx.ts`, and `src/core/privileged-nginx-config.ts`.
- Planned changes: `src/core/nginx-config.ts`, `src/electron/main.ts`, `src/electron/preload.ts`, `src/shared/types.ts`, `src/renderer/main.tsx`, `tsconfig.main.json`, and docs.
- The helper must accept structured JSON only, validate with `nginx -t`, keep a known-good configuration, run a health check, reload with SIGHUP, and stop when the app exits or crashes.
- Status: proposed, awaiting approval. Do not treat it as implemented.

## Blocked / Terhambat

- User approval for the 0.2.0 helper plan.
- Full unsigned NSIS installation/uninstallation requires a disposable Windows profile or VM; do not test it on the main profile.
- Windows release signing requires an authorized code-signing identity and a decision on certificate file, hardware token, or cloud integration. No qualifying identity was found in the current user's certificate store, and no electron-builder signing environment variables were configured on this Windows device; a signed build cannot be completed yet.
- Windows x64 nginx executable version was checked, but a managed Windows nginx lifecycle is not implemented or tested.
- The source-built macOS nginx binary has not been validated on a clean macOS 14 machine.
- The app is ad-hoc signed; signing/notarization is needed before wide distribution of a root helper. SMAppService/SMJobBless is not feasible without a Developer ID.
- Port 80 and HTTP-to-HTTPS redirect are deferred while Herd/Valet may own port 80.

## Findings / Temuan

- The HTTPS gateway uses a random loopback port; a request with the public CA returned HTTP 200, so routing and TLS generation work.
- Browser access failed because the local CA was not trusted, the MandauStack hosts block was not installed, and `/etc/resolver/test` returned both `::1` and `127.0.0.1` while the gateway listens only on IPv4.
- nginx on port 8443 had not been prepared in the observed run.
- Port 443 was free. Binding `127.0.0.1:443` requires root. An unprivileged wildcard bind on `0.0.0.0:443` worked on the test machine (macOS 27), but it was rejected as an experimental/security-sensitive approach.
- A foreign root nginx on `127.0.0.1:80`, dnsmasq, `/etc/resolver/test`, and `/etc/sudoers.d/herd` were present, consistent with Herd/Valet leftovers. They must not be killed, reconfigured, or adopted.
- In the earlier macOS test the app was ad-hoc signed; that machine was macOS 27.0.1, arm64. The current Windows device and results are recorded below.
- **2026-11-04 Windows x64 (initial setup):** Node.js 24.19.0, npm 11.17.0, Laragon PHP 8.3.33, and system Composer available; no listener on ports 80, 443, or 8443 at the time checked. No managed runtimes were installed in the main profile; later tests installed them only in disposable directories.
- On this Windows machine, Schannel `curl.exe --cacert` initially rejected the private CA because revocation status was unknown. Adding `--ssl-revoke-best-effort` allowed verified TLS without importing CA trust or bypassing hostname checks; the smoke test also confirmed an inaccessible private project file, HTTP 503 after preview stop, and unlink preserving project files. All generated certificates and project data were confined to a temporary fixture and removed after the test.
- **2026-11-04 Windows 0.1.11:** official PHP initially lacked eight dynamic Laravel extensions (`curl`, `fileinfo`, `intl`, `mbstring`, `openssl`, `pdo_mysql`, `pdo_sqlite`, `zip`); process-only `-n`/`-d` flags loaded them. In the packaged app, requesting `/private.txt` returned **HTTP 200 with the same body as `public/index.php`**, not the `must-not-be-served` marker in the private file. This is the PHP development server's index fallback, not evidence of file exposure. After graceful restart the CA certificate, linked-site registry and managed PHP persisted; the preview did not restart automatically, and unlink preserved the project. No app-owned test processes or fixtures remained after the smoke test.

## Decisions / Keputusan

- **2026-11-03:** Target the Herd-like no-port URL `https://<project>.test/`; the permanent privileged helper was selected instead of an unprivileged wildcard bind. Status: mechanism selected; final plan awaiting approval.
- **2026-11-03:** Defer port 80 and HTTP-to-HTTPS redirect because Herd/Valet may occupy port 80. Windows keeps the port-8443 fallback for now. Status: proposed.
- **2026-11-03:** Database management is not implemented in 0.1.10 and remains a 1.0.0 roadmap item. Projects may use an externally managed database through their own configuration. Status: current behavior.
- **2026-11-03:** The helper owns root-owned copies of Node.js, nginx, scripts, configuration, state, hosts backups, and certificates. It must not touch `/etc/resolver/test` or dnsmasq. Status: proposed.
- **Baseline:** Runtime versions and hashes are pinned; macOS nginx is built from official sources, and Windows uses the official nginx ZIP.
- **2026-11-04:** Continue Windows internal verification using an unsigned 0.1.11 candidate; defer signed public distribution until an eligible publisher identity, code-signing certificate and clean-machine validation exist. No hosts, trust-store or Laragon changes are authorized for this test.

## Next move / Langkah berikutnya

1. Windows integration: on a disposable Windows user profile/VM, run `release/MandauStack Setup 0.1.11.exe` and verify installation, startup, quit, uninstall and preservation of unrelated/project files; SmartScreen may warn because it is unsigned. Do not install the candidate into the main profile. Then open `src/core/nginx-service.ts` to plan and test Windows nginx lifecycle in isolated directories without adopting Laragon services. Do not enable Windows hosts or CA trust without ACL-safe, reversible implementations.
2. Windows signing: choose the legal publisher and signing provider; after provisioning credentials outside the repo, start with `package.json` and `scripts/verify-windows-signatures.mjs`, run `npm run package:win:signed`, and test the signed installer on a clean Windows profile/VM. The local signature check cannot prove public trust or SmartScreen reputation.
3. macOS when available: get approval for the 0.2.0 helper plan, then spike a root LaunchDaemon helper with nginx on `127.0.0.1:443` and `[::1]:443`.
4. Implement the URL/preflight/dual-stack foundation, helper, installer, IPC, and setup UI only after approval; add tests and docs, bump the version to 0.2.0, and build the DMG.
5. Update this file after each milestone.

## Verification log / Log verifikasi

- **2026-11-03:** Added `AGENTS.md`, `docs/progress.md`, and the README handoff link. `npm run typecheck` passed; `npm test` passed 33 tests, 6 skipped, 0 failed. Skipped tests require external runtimes or Windows/manual environments.
- **0.1.10 baseline:** commit `0027f7d`; DMG built. The 0.2.0 work must rerun `npm run typecheck`, `npm test`, `npm run build`, and `npm run package:mac` before release.
- **Planned 0.2.0 checks:** Safari and Chrome; `curl` with the public CA; `curl -6`; app restart, quit, and crash; confirm Herd/Valet on port 80 is untouched; uninstall/reinstall; full test/build/package.
- **2026-11-04, Windows x64, baseline `06e20cc`:** `npm ci` passed (336 packages; 15 moderate npm audit findings in development dependencies); `npm run typecheck` passed; initial `npm test` failed on two POSIX-only test assumptions, then passed after making the tests portable: 39 tests, 24 passed, 15 skipped, 0 failed; `npm run build` passed; `npm audit --omit=dev` found 0 vulnerabilities. Isolated core smoke test with `SiteStore`, `PreviewManager`, `HttpsGateway`, system PHP, and Schannel `curl.exe --resolve --cacert --ssl-revoke-best-effort` passed. No desktop GUI, managed Windows PHP/nginx execution, hosts modification, or CA trust operation was tested.
- **2026-11-04, Windows x64, baseline `06e20cc`:** `npm run package:win` passed (including typecheck, build, and icon generation); NSIS installer `release/MandauStack Setup 0.1.10.exe` exists (122,878,321 bytes; SHA-256 `55f538d72c141a1d2476dbc45019ffb076a59159ca85284c7545e289f3a5eb11`), and unpacked executable reports version 0.1.10. Authenticode status: `NotSigned`. Installer launch/install/uninstall and desktop GUI were not tested.
- **2026-11-04, Windows x64, baseline `06e20cc`:** signing preparation passed `npm run typecheck`, `npm test` (42 total: 27 passed, 15 skipped, 0 failed), and `npm run build`. The real-signature verifier rejected the existing unsigned executable as `NotSigned` (expected); electron-builder 26.18.0 with `forceCodeSigning=true` refused a no-certificate build in an isolated temporary output (expected; exit 1), leaving `release/` unchanged. Unit tests simulate valid, unsigned, unstamped, and missing artifacts; no real signed artifact or clean-machine trust test exists.
- **2026-11-04, Windows x64, baseline `06e20cc`, 0.1.11 candidate:** `npm run typecheck` passed; `npm test` passed (45 total: 29 passed, 16 skipped, 0 failed), and opt-in `MANDAUSTACK_TEST_REMOTE_RUNTIME=1 npm test` passed (45 total: 31 passed, 14 skipped, 0 failed); both were repeated after the documentation update. `npm run package:win` passed, including `npm run build`, and produced the NSIS candidate and unpacked app; `Get-AuthenticodeSignature` reports `NotSigned` for both. The opt-in test installed and ran official Windows PHP with all required extensions; isolated tests also executed official pinned Node.js and nginx version commands. `git diff --check` passed (Git only warned about future LF-to-CRLF conversion).
- **2026-11-04, Windows x64, baseline `06e20cc`, unpacked 0.1.11:** launched `release/win-unpacked/MandauStack.exe` with isolated `APPDATA`, installed managed PHP through packaged IPC, linked a temporary `public/index.php` project, started preview via the UI, and verified `8.5.12:1:1` over Schannel `curl.exe --resolve --cacert --ssl-revoke-best-effort`. `/private.txt` returned HTTP 200 with the index body, not the private file. Graceful quit/restart preserved CA, site registry and managed PHP, returned HTTP 503 until preview restart, and unlink preserved project files. All temporary app data were removed; no NSIS installation, real Laravel project, system hosts or trust operation was tested.
- Do not record a pass unless it was actually run. Include date, commit, command, and result.

## Handoff checklist / Checklist serah-terima

- [ ] Read `AGENTS.md`, `README.md`, `docs/local-https.md`, `docs/runtime-matrix.md`, and this file.
- [ ] Run `git status` and `git log -5`; confirm the branch and working-tree state.
- [ ] Run `npm install` if dependencies are missing.
- [ ] Run `npm run typecheck` and `npm test`; record the result here.
- [ ] Check managed runtimes on this device; do not copy certificates, private keys, or Keychain data from another device.
- [ ] Confirm the current task and approval status; do not assume proposed work is approved.
- [ ] At the end, update the snapshot, next move, verification, and blockers.
