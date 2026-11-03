# Runtime matrix (planning, not implemented)

Target: macOS 14+ Apple Silicon and Windows 10+ x64. `Native` describes the intended integration, **not a tested guarantee**. Version manifests, redistributable terms, release archives, and hashes need to be pinned and verified for each supported release before downloads are enabled. Install only what the user selects.

**0.1.2 implemented subset:** Node.js 24.22.2 is pinned from the official Node.js distribution for macOS ARM and Windows x64. PHP 8.5.12 NTS x64 is pinned from the official PHP Windows archive; the official PHP downloads page does not supply a comparable precompiled macOS release, so managed PHP on macOS is not offered yet. Runtime archives are verified against pinned SHA-256 values and installed independently in the per-user data directory. These are user-triggered installs; system DNS, certificate stores and PATH are not modified by the installer.

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
