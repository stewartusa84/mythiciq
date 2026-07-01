[CmdletBinding()]
param(
  [string] $Version,
  [string] $ArtifactName,
  [switch] $AllowDirty,
  [switch] $SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function FullPath([string] $Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Write-Utf8NoBom([string] $Target, [string] $Text) {
  $parent = Split-Path -Parent $Target
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $encoding = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Target, $Text, $encoding)
}

function Invoke-Checked([string] $Command, [string[]] $Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $($LASTEXITCODE): $Command $($Arguments -join ' ')"
  }
}

function Get-Sha256Hex([string] $Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = $sha256.ComputeHash($stream)
      return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

$root = FullPath (Join-Path $PSScriptRoot '..')
$appPackagePath = Join-Path $root 'packages\app\package.json'
$tauriConfigPath = Join-Path $root 'packages\app\src-tauri\tauri.conf.json'
$websiteReleaseRoot = Join-Path $root 'packages\website\static\releases\desktop'

$appPackage = Get-Content -LiteralPath $appPackagePath -Raw | ConvertFrom-Json
$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json

$sourceCommit = ''
$sourceDirty = $false
try {
  $sourceCommit = (& git -C $root rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    $sourceCommit = ''
  }
  $gitStatus = (& git -C $root status --short) -join "`n"
  if ($LASTEXITCODE -eq 0) {
    $sourceDirty = -not [string]::IsNullOrWhiteSpace($gitStatus)
  }
} catch {
  $sourceCommit = ''
  $sourceDirty = $false
}

if ($sourceDirty -and -not $AllowDirty) {
  throw 'Working tree has uncommitted changes. Commit or stash before publishing a verifiable desktop release, or rerun with -AllowDirty for a local test artifact.'
}

if (-not $Version) {
  $Version = if ($tauriConfig.version) { [string] $tauriConfig.version } else { [string] $appPackage.version }
}

if (-not $Version) {
  throw 'Unable to determine the desktop release version.'
}

if (-not $ArtifactName) {
  $ArtifactName = "MythicIQ-$Version-windows-x64-setup.exe"
}

if (-not $SkipBuild) {
  Push-Location $root
  try {
    Invoke-Checked 'pnpm' @('build:wasm')
    Invoke-Checked 'pnpm' @('--filter', '@wow/app', 'desktop:build')
  } finally {
    Pop-Location
  }
}

$nsisBundleDir = Join-Path $root 'packages\app\src-tauri\target\release\bundle\nsis'
if (-not (Test-Path -LiteralPath $nsisBundleDir -PathType Container)) {
  throw "Tauri NSIS bundle directory was not found: $nsisBundleDir"
}

$installer = Get-ChildItem -LiteralPath $nsisBundleDir -Filter '*.exe' -File |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "No NSIS installer was found in: $nsisBundleDir"
}

$releaseDir = Join-Path $websiteReleaseRoot $Version
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

$targetInstaller = Join-Path $releaseDir $ArtifactName
Copy-Item -LiteralPath $installer.FullName -Destination $targetInstaller -Force

$hash = Get-Sha256Hex $targetInstaller
$checksumFile = "$targetInstaller.sha256"
Write-Utf8NoBom $checksumFile "$hash  $ArtifactName`n"

$manifest = [ordered] @{
  product = 'MythicIQ Desktop'
  version = $Version
  platform = 'windows-x64'
  artifact = $ArtifactName
  artifactPath = "/releases/desktop/$Version/$ArtifactName"
  checksumPath = "/releases/desktop/$Version/$ArtifactName.sha256"
  sha256 = $hash
  sourceCommit = $sourceCommit
  sourceDirty = $sourceDirty
  builtAt = (Get-Date).ToUniversalTime().ToString('o')
  buildCommands = @(
    'pnpm install --frozen-lockfile',
    'pnpm build:wasm',
    'pnpm --filter @wow/app desktop:build'
  )
}

$manifestJson = ($manifest | ConvertTo-Json -Depth 8)
Write-Utf8NoBom (Join-Path $releaseDir 'manifest.json') "$manifestJson`n"
Write-Utf8NoBom (Join-Path $websiteReleaseRoot 'latest.json') "$manifestJson`n"

$verifyText = @'
# MythicIQ Desktop {Version}

Published files:

- Installer: `{ArtifactName}`
- SHA-256: `{ArtifactName}.sha256`
- Manifest: `manifest.json`

Verify the downloaded installer on Windows:

```powershell
Get-FileHash .\{ArtifactName} -Algorithm SHA256
Get-Content .\{ArtifactName}.sha256
```

The hash printed by `Get-FileHash` must match the first value in the `.sha256` file.

To inspect the source used for this release, confirm `manifest.json` has `"sourceDirty": false`, check out the manifest's `sourceCommit`, install dependencies, and build:

```powershell
pnpm install --frozen-lockfile
pnpm build:wasm
pnpm --filter @wow/app desktop:build
```

The public checksum verifies the exact bytes hosted on mythiciq.app. Until MythicIQ ships a reproducible build pipeline and code signing, local Tauri/NSIS builds can differ by toolchain metadata even when the source matches.
'@
$verifyText = $verifyText.Replace('{Version}', $Version).Replace('{ArtifactName}', $ArtifactName)

Write-Utf8NoBom (Join-Path $releaseDir 'VERIFY.md') $verifyText

Write-Host "Published desktop release:"
Write-Host "  $targetInstaller"
Write-Host "  SHA-256 $hash"
