# MythicIQ Desktop 0.1.0

Published files:

- Installer: `MythicIQ-0.1.0-windows-x64-setup.exe`
- SHA-256: `MythicIQ-0.1.0-windows-x64-setup.exe.sha256`
- Manifest: `manifest.json`

Verify the downloaded installer on Windows:

```powershell
Get-FileHash .\MythicIQ-0.1.0-windows-x64-setup.exe -Algorithm SHA256
Get-Content .\MythicIQ-0.1.0-windows-x64-setup.exe.sha256
```

The hash printed by `Get-FileHash` must match the first value in the `.sha256` file.

To inspect the source used for this release, confirm `manifest.json` has `"sourceDirty": false`, check out the manifest's `sourceCommit`, install dependencies, and build:

```powershell
pnpm install --frozen-lockfile
pnpm build:wasm
pnpm --filter @wow/app desktop:build
```

The public checksum verifies the exact bytes hosted on mythiciq.app. Until MythicIQ ships a reproducible build pipeline and code signing, local Tauri/NSIS builds can differ by toolchain metadata even when the source matches.