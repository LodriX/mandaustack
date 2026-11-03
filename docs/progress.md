# Progress and handoff / Progres dan serah-terima

**Last updated / Terakhir diperbarui:** 2026-11-03
**Baseline commit:** `0027f7d` on `main` (`0.1.10`); this handoff file was added after that commit.
**Purpose:** live status, decisions, and next actions. Stable rules and commands live in [`AGENTS.md`](../AGENTS.md).

## Snapshot / Ringkasan

- **Version / Versi:** 0.1.10 early preview. Next target: 0.2.0.
- **Current state / Status:** the privileged port-443 helper plan is proposed and awaiting approval. No 0.2.0 implementation has started.
- **Next action / Aksi berikutnya:** approve the 0.2.0 plan, then spike a root LaunchDaemon helper with nginx on port 443.

## Completed / Selesai

- Managed runtime installation: Node.js 24.22.2, PHP 8.5.12 (FrankenPHP 1.13.4 on macOS ARM), and nginx 1.30.6 with pinned downloads and SHA-256 checks.
- Local PHP previews, HTTPS gateway with per-site certificates, hosts planning, macOS Keychain CA trust, and managed nginx on loopback port 8443.
- Desktop UI and basic CLI for sites and runtimes.
- Documentation, tests, version 0.1.10, commit `0027f7d` pushed to `main`, and DMG built at `release/MandauStack-0.1.10-arm64.dmg`.
- These are baseline results from the 0.1.10 work. Rerun the checks before claiming them for 0.2.0.

## Active / Aktif

- **0.2.0 plan:** browser-ready `https://<project>.test/` without a port, using a permanent privileged LaunchDaemon helper.
- Planned flow: app (unprivileged) -> Unix socket `0600` -> root helper -> root-owned nginx with `nobody` workers -> `127.0.0.1:443` and `[::1]:443` -> HTTPS gateway -> PHP preview.
- Planned new files: `src/nginx-helper.ts`, `src/helper-installer.ts`, `src/core/privileged-nginx.ts`, and `src/core/privileged-nginx-config.ts`.
- Planned changes: `src/core/nginx-config.ts`, `src/electron/main.ts`, `src/electron/preload.ts`, `src/shared/types.ts`, `src/renderer/main.tsx`, `tsconfig.main.json`, and docs.
- The helper must accept structured JSON only, validate with `nginx -t`, keep a known-good configuration, run a health check, reload with SIGHUP, and stop when the app exits or crashes.
- Status: proposed, awaiting approval. Do not treat it as implemented.

## Blocked / Terhambat

- User approval for the 0.2.0 helper plan.
- Windows x64 nginx lifecycle has not been tested on a Windows machine.
- The source-built macOS nginx binary has not been validated on a clean macOS 14 machine.
- The app is ad-hoc signed; signing/notarization is needed before wide distribution of a root helper. SMAppService/SMJobBless is not feasible without a Developer ID.
- Port 80 and HTTP-to-HTTPS redirect are deferred while Herd/Valet may own port 80.

## Findings / Temuan

- The HTTPS gateway uses a random loopback port; a request with the public CA returned HTTP 200, so routing and TLS generation work.
- Browser access failed because the local CA was not trusted, the MandauStack hosts block was not installed, and `/etc/resolver/test` returned both `::1` and `127.0.0.1` while the gateway listens only on IPv4.
- nginx on port 8443 had not been prepared in the observed run.
- Port 443 was free. Binding `127.0.0.1:443` requires root. An unprivileged wildcard bind on `0.0.0.0:443` worked on the test machine (macOS 27), but it was rejected as an experimental/security-sensitive approach.
- A foreign root nginx on `127.0.0.1:80`, dnsmasq, `/etc/resolver/test`, and `/etc/sudoers.d/herd` were present, consistent with Herd/Valet leftovers. They must not be killed, reconfigured, or adopted.
- The app is ad-hoc signed. Current development machine: macOS 27.0.1, arm64. Other devices may differ.

## Decisions / Keputusan

- **2026-11-03:** Target the Herd-like no-port URL `https://<project>.test/`; the permanent privileged helper was selected instead of an unprivileged wildcard bind. Status: mechanism selected; final plan awaiting approval.
- **2026-11-03:** Defer port 80 and HTTP-to-HTTPS redirect because Herd/Valet may occupy port 80. Windows keeps the port-8443 fallback for now. Status: proposed.
- **2026-11-03:** Database management is not implemented in 0.1.10 and remains a 1.0.0 roadmap item. Projects may use an externally managed database through their own configuration. Status: current behavior.
- **2026-11-03:** The helper owns root-owned copies of Node.js, nginx, scripts, configuration, state, hosts backups, and certificates. It must not touch `/etc/resolver/test` or dnsmasq. Status: proposed.
- **Baseline:** Runtime versions and hashes are pinned; macOS nginx is built from official sources, and Windows uses the official nginx ZIP.

## Next move / Langkah berikutnya

1. Get approval for the 0.2.0 helper plan.
2. Spike a root LaunchDaemon helper with nginx on `127.0.0.1:443` and `[::1]:443`.
3. Implement the URL/preflight/dual-stack foundation.
4. Implement the helper, installer, IPC, and setup UI.
5. Add tests and docs, bump the version to 0.2.0, and build the DMG.
6. Update this file after each milestone.

## Verification log / Log verifikasi

- **2026-11-03:** Added `AGENTS.md`, `docs/progress.md`, and the README handoff link. `npm run typecheck` passed; `npm test` passed 33 tests, 6 skipped, 0 failed. Skipped tests require external runtimes or Windows/manual environments.
- **0.1.10 baseline:** commit `0027f7d`; DMG built. The 0.2.0 work must rerun `npm run typecheck`, `npm test`, `npm run build`, and `npm run package:mac` before release.
- **Planned 0.2.0 checks:** Safari and Chrome; `curl` with the public CA; `curl -6`; app restart, quit, and crash; confirm Herd/Valet on port 80 is untouched; uninstall/reinstall; full test/build/package.
- Do not record a pass unless it was actually run. Include date, commit, command, and result.

## Handoff checklist / Checklist serah-terima

- [ ] Read `AGENTS.md`, `README.md`, `docs/local-https.md`, `docs/runtime-matrix.md`, and this file.
- [ ] Run `git status` and `git log -5`; confirm the branch and working-tree state.
- [ ] Run `npm install` if dependencies are missing.
- [ ] Run `npm run typecheck` and `npm test`; record the result here.
- [ ] Check managed runtimes on this device; do not copy certificates, private keys, or Keychain data from another device.
- [ ] Confirm the current task and approval status; do not assume proposed work is approved.
- [ ] At the end, update the snapshot, next move, verification, and blockers.
