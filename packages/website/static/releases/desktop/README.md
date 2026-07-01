# MythicIQ Desktop Releases

Release folders contain the Windows installer, its SHA-256 checksum, a JSON manifest, and per-release verification notes.

Latest manifest:

```text
/releases/desktop/latest.json
```

Verify a downloaded installer on Windows:

```powershell
Get-FileHash .\MythicIQ-0.1.0-windows-x64-setup.exe -Algorithm SHA256
Get-Content .\MythicIQ-0.1.0-windows-x64-setup.exe.sha256
```

The hash printed by `Get-FileHash` must match the first value in the `.sha256` file. The release manifest records the source commit used to build the published installer.
