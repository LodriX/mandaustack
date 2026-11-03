# Local HTTPS integration

Version 0.1.5 includes an unprivileged HTTPS gateway on a random loopback port. The gateway checks the TLS server name against the HTTP Host header, looks up the exact linked `.test` domain, and forwards traffic only to a running preview at `127.0.0.1`. Unlinked sites cannot reach another project's preview. A persistent, private CA signs individual site certificates because `*.test` wildcard certificates are rejected by hostname validation. Only the public CA certificate path is shown in the application; private keys stay in its per-user data directory.

Run a project's preview in the desktop app and use the command in the README to verify routing and TLS without modifying the system. The gateway port changes on restart, and stopping the preview removes its upstream. This is not yet a browser-ready site service.

The app's **Review .test hosts plan** button (or `npm run cli -- hosts:plan`) reads the system hosts file and proposes a dedicated, sorted MandauStack block for linked projects. The planner refuses malformed blocks, duplicate domains, mixed line endings, or a requested domain already assigned outside the managed block. It preserves unrelated entries and supports a stale-plan checksum. The internal writer makes a private backup before an atomic replacement and can restore that backup only if the file still matches the applied version. This writer is **not invoked by the UI or CLI**; applying system changes awaits an authorized helper and Windows ACL-preserving replacement tests. The read-only plan does not change DNS resolution.

To reach the target `https://project.test/` on both operating systems, the following must still be implemented and tested:

1. Acquire and validate redistributable nginx binaries for macOS ARM and Windows x64. Generate site configurations from the linked-project registry; bind nginx to loopback; test startup, configuration rollback and crash recovery. The current gateway is a temporary front end for previews, not nginx.
2. Connect the tested hosts planner to an explicitly authorized macOS/Windows installer. Installation/removal must preserve unrelated entries and the file's OS ownership/ACLs, verify the result, and roll back failures. Test this on both OSes before enabling the UI action. A wildcard DNS responder can be considered later.
3. Serve on HTTPS port 443 with port-collision checks and a reversible privileged binding mechanism on both OSes. Only after the listener is healthy should the app expose a browser-opening `.test` action.
4. Install the public local CA into the appropriate user/system trust store through an explicit authorized OS step. Never export or install the CA private key. Check the trust result and support removal without deleting other certificates or project data.
5. Exercise actual Laravel pages, assets, redirects, uploads, updates, restarts, and deliberately failed configuration on clean macOS and Windows machines. Test both trusted and untrusted scenarios.
