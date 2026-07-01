# Desktop Release Verification

Desktop release files are served from `packages/website/static/releases/desktop/<version>/`, which publishes at `/releases/desktop/<version>/` on the public site.

Each published Windows build must include:

- `MythicIQ-<version>-windows-x64-setup.exe`
- `MythicIQ-<version>-windows-x64-setup.exe.sha256`
- `manifest.json`
- `VERIFY.md`

Maintainers build and publish the site artifact from a clean working tree with:

```powershell
pnpm release:desktop
```

That script runs `pnpm build:wasm`, runs `pnpm --filter @wow/app desktop:build`, copies the newest Tauri NSIS installer into the website release folder, writes the SHA-256 checksum, and stamps a manifest with the source commit.

For a local test artifact only, pass `-AllowDirty` directly to `scripts/publish-desktop-release.ps1`. Do not publish a dirty release artifact; `manifest.json` should show `"sourceDirty": false`.

Users can verify a downloaded installer on Windows:

```powershell
Get-FileHash .\MythicIQ-0.1.0-windows-x64-setup.exe -Algorithm SHA256
Get-Content .\MythicIQ-0.1.0-windows-x64-setup.exe.sha256
```

The hash printed by `Get-FileHash` must match the first value in the `.sha256` file. On macOS or Linux, use:

```bash
sha256sum MythicIQ-0.1.0-windows-x64-setup.exe
cat MythicIQ-0.1.0-windows-x64-setup.exe.sha256
```

To inspect the source used for a release, read `manifest.json`, confirm `"sourceDirty": false`, check out its `sourceCommit`, and build:

```powershell
pnpm install --frozen-lockfile
pnpm build:wasm
pnpm --filter @wow/app desktop:build
```

The published checksum verifies the exact bytes hosted on `mythiciq.app`. Until the project adds code signing and a reproducible build pipeline, local Tauri/NSIS builds can differ by toolchain metadata even when built from the same source commit.
