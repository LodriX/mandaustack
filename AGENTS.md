# AGENTS.md

**MandauStack agent guide / Panduan agent MandauStack**

This file is the stable contract for humans and AI agents working in this repository. Read it before changing code. Live status, decisions, findings, and next steps belong in [`docs/progress.md`](docs/progress.md); update that file before ending a session, finishing a milestone, or switching to another model or device.

Dokumen ini adalah kontrak stabil untuk manusia dan agent AI yang bekerja di repository ini. Baca sebelum mengubah kode. Status terkini, keputusan, temuan, dan langkah berikutnya ada di [`docs/progress.md`](docs/progress.md); perbarui file itu sebelum mengakhiri sesi, menyelesaikan milestone, atau pindah model/perangkat.

## 1. Read first / Baca dulu

1. This file / file ini.
2. [`README.md`](README.md) for user-facing behavior and current scope.
3. [`docs/local-https.md`](docs/local-https.md) for gateway, hosts, CA trust, and nginx integration.
4. [`docs/runtime-matrix.md`](docs/runtime-matrix.md) for the service roadmap.
5. [`docs/progress.md`](docs/progress.md) for the live handoff.

Then inspect the repository state:

```sh
git status
git log --oneline -10
```

Jangan menganggap rencana di dokumen mana pun sudah disetujui atau sudah diimplementasikan. Cek status dan commit terakhir.

## 2. Project / Proyek

- MandauStack is a free, open-source local development environment for PHP and Laravel on macOS and Windows.
- Desktop app: Electron, React, TypeScript, Vite. Core logic is plain TypeScript with `node --test` tests.
- Supported targets: macOS 14+ Apple Silicon and Windows 10+ x64. Windows execution has not been fully verified.
- Current release: **0.1.10 early preview**. Next planned release: **0.2.0** with a privileged nginx helper for browser-ready `https://project.test/` on port 443.
- Databases, cache, search, storage, broadcasting, mail capture, version switching, managed Composer, profiling, Tinker, and Xdebug are **not implemented** unless the current docs explicitly say otherwise. Do not imply support.
- The product target and safety requirements are documented in `README.md` and `docs/runtime-matrix.md`.

Ringkasnya: 0.1.10 adalah preview awal. Database dan layanan lain masih roadmap; jangan mengklaim fitur yang belum ada.

## 3. Setup and commands / Setup dan perintah

Requirements: Node.js and npm. On macOS, managed nginx requires Apple Command Line Tools. On Windows, managed PHP may require the Microsoft Visual C++ Redistributable 2015-2022 x64.

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run package:mac
npm run package:win
```

- `npm test` builds the main process first, then runs the compiled tests in `dist-electron/core/*.test.js`.
- `npm run typecheck` checks both renderer and main TypeScript projects.
- `npm run cli -- <command>` runs the source CLI after building the main process.
- Remote runtime checks require `MANDAUSTACK_TEST_REMOTE_RUNTIME=1`. Optional local checks use `MANDAUSTACK_TEST_FRANKENPHP_BINARY` and `MANDAUSTACK_TEST_LARAVEL_SITE`.
- Do not edit `dist/`, `dist-electron/`, or `release/` directly. Regenerate them with the scripts above.
- Do not edit `package-lock.json` by hand; use npm.

## 4. Architecture map / Peta arsitektur

- `src/core/`: platform-independent logic and OS adapters, each with focused tests.
- `src/core/paths.ts`, `sites.ts`, `previews.ts`: user data paths, project registry, PHP preview processes.
- `src/core/runtimes.ts`, `runtime-installer.ts`: pinned Node.js, PHP, and nginx downloads/builds and version checks.
- `src/core/https-gateway.ts`, `local-certificates.ts`: loopback HTTPS gateway and per-site certificates.
- `src/core/nginx-config.ts`, `nginx-service.ts`: reviewed nginx configuration and the current unprivileged port-8443 process lifecycle.
- `src/core/hosts.ts`, `mac-hosts.ts`; `src/hosts-helper.ts`: hosts planning, protected backup, and macOS authorized apply/restore.
- `src/core/mac-ca-trust.ts`: explicit user-Keychain CA trust and removal.
- `src/electron/main.ts`: app lifecycle, process supervision, and IPC handlers.
- `src/electron/preload.ts`: the `window.mandaustack` bridge.
- `src/shared/types.ts`: shared contracts between main, preload, and renderer.
- `src/renderer/main.tsx`, `src/renderer/style.css`: desktop UI.
- `src/cli.ts`: basic CLI.
- `docs/`: integration notes and the live handoff.
- `package.json`, `tsconfig.main.json`, `tsconfig.renderer.json`, `vite.config.mjs`: build, test, and packaging configuration.

When adding a new OS integration, keep the pure planning/validation logic in `src/core/`, isolate command execution behind an injectable runner, and add tests that do not modify the real system.

Saat menambah integrasi OS, pisahkan logika murni di `src/core/`, isolasi eksekusi perintah, dan buat tes yang tidak mengubah sistem nyata.

## 5. Non-negotiable rules / Aturan wajib

- **Explicit system changes only / Perubahan sistem hanya eksplisit.** Never modify `/etc/hosts`, the Keychain or trust store, DNS resolvers, firewall rules, ports, or system services without a clear user action and a reviewed code path. Do not run these actions automatically on app startup.
- **Never adopt foreign services / Jangan adopsi layanan asing.** Herd, Valet, nginx, dnsmasq, or another tool may own port 80, `/etc/resolver/*`, or other system state. Detect conflicts, report them, and never kill, reconfigure, or take ownership of a process you did not start.
- **Privileged boundary / Batas privileged.** The desktop app stays unprivileged. Root operations must go through a dedicated helper that accepts only structured, validated JSON; owns its nginx, Node.js, scripts, configuration, state, and certificate copies; runs `nginx -t` before activation; rolls back to the last known-good configuration; performs a real health check; and stops its listener when the app exits or the session ends. Never accept arbitrary shell commands or raw configuration through the helper.
- **Secrets and keys / Rahasia dan kunci.** Never commit private keys, CA private keys, tokens, or secrets. Never export or import the CA private key into a Keychain. Public certificates may be readable; private keys must remain restricted to the owner. Do not log secret material.
- **Pinned runtimes / Runtime pinned.** Managed runtime versions and SHA-256 hashes stay pinned. Do not silently upgrade a runtime, substitute a different edition, or change a download source without updating checks, licenses, docs, and tests.
- **Stateful data / Data stateful.** Never point a different major database version at an existing data directory without a verified backup and a supported migration. Service data and project files must survive app updates and must never be deleted implicitly.
- **Hosts and trust / Hosts dan trust.** Touch only the MandauStack-managed hosts block, preserve unrelated entries, and keep a protected backup. CA trust is an explicit, separate user action. Never modify `/etc/resolver/test`, Herd/Valet resolver files, or their dnsmasq configuration.
- **Evidence over assumptions / Bukti, bukan asumsi.** Do not claim a flow is tested if it was only simulated. Clearly distinguish macOS vs Windows and tested vs untested. Privileged, Keychain, hosts, TLS, restart, crash, and uninstall flows need real manual verification before release.
- **No unauthorized commits / Tanpa commit tanpa izin.** Make code changes when asked, run verification, and do not commit, amend, push, or open a pull request unless the user explicitly asks.

## 6. Workflow / Alur kerja

1. Read the docs in section 1 and check `git status` and recent history.
2. Read the relevant source and tests before changing behavior. Follow existing patterns and libraries.
3. For multi-step work, write a short plan and keep the task list current.
4. Keep core logic testable and add or update `*.test.ts` coverage for behavior changes.
5. Run `npm run typecheck` and `npm test`; use `npm run build` before packaging.
6. Update user-facing documentation and the version for visible changes.
7. Update `docs/progress.md` with the result, verification, blockers, and next action.
8. Commit only when explicitly requested. Use concise bilingual commit messages, for example `feat: pasang nginx terkelola / install managed nginx`.

## 7. Definition of done / Definisi selesai

- Typecheck and tests pass; new core behavior has tests.
- Error paths, recovery, and no-op cases are handled, not just the happy path.
- No system state is changed without an explicit action; no foreign service is touched.
- Docs and version metadata are updated for user-visible changes.
- Manual OS/privileged verification is recorded or clearly listed as pending.
- `docs/progress.md` is current.

## 8. Moving to another device / Pindah perangkat

The repository is portable through git. Machine state is not.

- Runtime binaries, certificates, `/etc/hosts` changes, Keychain trust, DNS resolver state, and the privileged helper belong to one device. Do not copy CA private keys, Keychain databases, or helper state between devices.
- On a new device: clone the repository, run `npm install`, start the app, install managed runtimes through the app, link projects, and then perform hosts and CA-trust actions explicitly. Let the app generate device-local certificates.
- macOS requires Apple Command Line Tools for the managed nginx build. Windows may require the Visual C++ Redistributable.
- Before changing anything, inspect existing port 80/443 listeners, `/etc/hosts`, resolver configuration, and Keychain entries. Other local-development tools may already own them.
- After setup, run the verification commands and add a dated entry to `docs/progress.md` with the device/OS details and any differences.

## 9. Handoff protocol / Protokol serah-terima

`docs/progress.md` is the authoritative live handoff. Keep `AGENTS.md` stable; update it only when rules, commands, architecture, or durable constraints change.

At the end of every session or milestone, record:

- Date and baseline commit.
- Version and current branch.
- What is completed and verified.
- What is active, blocked, or awaiting approval.
- Exact next action, including the first file or command.
- Environment-specific findings and decisions with dates.
- Verification commands and results; do not record a pass that was not run.

Keep entries concise. Do not include secrets, private paths that are not needed, or ephemeral PIDs; use process and service names instead. If the repository state contradicts the handoff, correct the handoff before continuing.

## 10. Current focus / Fokus saat ini

- Finish the 0.2.0 plan for a permanent privileged helper that serves browser-ready `https://project.test/` on port 443, dual-stack on `127.0.0.1` and `[::1]`.
- The plan is proposed and awaiting approval; no 0.2.0 implementation has started as of commit `0027f7d`.
- Port 80 and HTTP-to-HTTPS redirects are deferred because Herd/Valet may occupy port 80. Windows keeps the port-8443 fallback for now.
- Database management is not implemented; projects may use an externally managed database through their own configuration.
- See [`docs/progress.md`](docs/progress.md) for the live snapshot and next move.
