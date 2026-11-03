# Runtime matrix (planning, not implemented)

Target: macOS 14+ Apple Silicon and Windows 10+ x64. `Native` describes the intended integration, **not a tested guarantee**. Version manifests, redistributable terms, release archives, and hashes need to be pinned and verified for each supported release before downloads are enabled. Install only what the user selects.

**0.1.10 implemented subset:** Node.js 24.22.2 is pinned from the official Node.js distribution for macOS ARM and Windows x64. PHP 8.5.12 NTS x64 is pinned from the official PHP Windows archive. macOS ARM uses the official FrankenPHP 1.13.4 standalone binary containing PHP 8.5.12 and the server needed for local previews. The macOS installer checks the included PHP extensions used by Laravel before activation. Downloads are verified against pinned SHA-256 values and installed independently in the per-user data directory. A per-user HTTPS gateway issues site-specific certificates and routes active linked previews on an ephemeral loopback port; an opt-in macOS administrator action can apply reviewed `.test` entries, and a separate user action can trust or remove the public CA in the macOS user Keychain. Keychain installation has only been tested with a simulated runner. Managed macOS ARM nginx 1.30.6 is compiled on demand from pinned official nginx, OpenSSL 3.5.9 and PCRE2 10.49 sources and tested with a real PHP project over HTTPS on port 8443; it requires Apple Command Line Tools. The official Windows nginx 1.30.6 ZIP is verified/extracted but Windows execution is not tested. Port 443, Windows hosts installation and certificate trust are not configured. A macOS ARM Laravel 13 project created with system Composer was tested with the managed PHP CLI and preview. Clean-machine setup and Windows installation still require end-to-end testing.

| Runtime/service | macOS | Windows | Source / distribution note |
| --- | --- | --- | --- |
| PHP (CLI and FastCGI), nginx, Node.js, Composer | Native | Native | Official downloads/builds where possible; validate PHP extensions and Windows VC++ dependencies. |
| MySQL, MariaDB, PostgreSQL | Native | Native | Separate data directories per major version/instance; PostgreSQL binaries on Windows may be EDB-distributed. |
| MongoDB Community | Native | Native | Free Community server; SSPL (source-available, not OSI open-source). |
| Redis | Native | Verify available official Windows build per selected version; otherwise optional WSL2 | License varies by version: <=7.2 BSD, 7.4 source-available, 8+ has an AGPL option. |
| Valkey | Native | Optional WSL2 | No officially supported native Windows Valkey runtime. |
| Laravel Reverb | Managed PHP process | Managed PHP process | Tied to an installed project's compatible PHP/Composer environment. |
| Meilisearch | Native | Native subject to release verification | Confirm vendor archive, architecture, and license for each version. |
| Typesense | Native | Optional WSL2 | Official Windows installation guide uses WSL. |
| RustFS | Native subject to release verification | Native subject to release verification | Apache-2.0; preferred S3-compatible service. |
| MinIO Community | Source build/legacy, optional | Source build/legacy, optional | Community repository archived; no current community binary distribution. No proprietary edition substitution. |
| Mail capture, logs, dumps, profiler, Tinker, Xdebug | MandauStack integration | MandauStack integration | Implement/test with the relevant PHP/Laravel versions. |

Official references: [Herd macOS services](https://herd.laravel.com/docs/macos/herd-pro-services/services.md), [Herd Windows services](https://herd.laravel.com/docs/windows/herd-pro-services/services.md), [Valkey installation](https://valkey.io/topics/installation/), [Typesense installation](https://typesense.org/docs/guide/install-typesense.html), [Redis licenses](https://redis.io/legal/licenses/), [MongoDB SSPL](https://www.mongodb.com/legal/licensing/server-side-public-license), [MinIO Community](https://github.com/minio/minio), [RustFS](https://github.com/rustfs/rustfs).
