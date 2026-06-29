[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $RepoRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'git was not found on PATH.'
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $gitDir = (& git rev-parse --git-dir 2>$null)
    $gitExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($gitExitCode -ne 0 -or -not $gitDir) {
    throw 'This folder is not a Git repo yet. Run git init first, then re-run this script.'
}

if (-not [System.IO.Path]::IsPathRooted($gitDir)) {
    $gitDir = Join-Path $RepoRoot $gitDir
}

$hooksDir = Join-Path $gitDir 'hooks'
New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null

$hookPath = Join-Path $hooksDir 'pre-push'
$hook = @'
#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

if command -v pwsh >/dev/null 2>&1; then
  pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/verify-public-release.ps1
elif command -v powershell >/dev/null 2>&1; then
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-public-release.ps1
else
  echo "PowerShell is required to run scripts/verify-public-release.ps1" >&2
  exit 1
fi
'@

$hook = $hook -replace "`r`n", "`n"
$encoding = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($hookPath, $hook, $encoding)
Write-Host "Installed pre-push hook: $hookPath"

if (Get-Command git-secrets -ErrorAction SilentlyContinue) {
    Write-Host 'Registering git-secrets AWS patterns for this public repo...'
    $gitSecretsScript = Join-Path $env:USERPROFILE '.git-secrets\git-secrets'
    $gitSecretsProvider = $null
    if (Test-Path -LiteralPath $gitSecretsScript) {
        $drive = $gitSecretsScript.Substring(0, 1).ToLowerInvariant()
        $rest = ($gitSecretsScript.Substring(2) -replace '\\', '/')
        $gitSecretsProvider = "/$drive$rest --aws-provider"
    }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & git-secrets --register-aws
        $gitSecretsExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($gitSecretsExitCode -ne 0) {
        Write-Warning 'git-secrets was found, but AWS pattern registration failed.'
    } else {
        $providers = @(& git config --get-all secrets.providers 2>$null)
        if ($providers.Count -gt 0) {
            & git config --unset-all secrets.providers 2>$null
            $normalizedProviders = New-Object System.Collections.Generic.List[string]
            foreach ($provider in $providers) {
                if ($gitSecretsProvider -and ($provider -eq 'git secrets --aws-provider' -or $provider -eq 'git-secrets --aws-provider')) {
                    $provider = $gitSecretsProvider
                }
                if (-not $normalizedProviders.Contains($provider)) {
                    $normalizedProviders.Add($provider)
                }
            }

            foreach ($provider in $normalizedProviders) {
                & git config --add secrets.providers $provider
            }
        }
    }
} else {
    Write-Host 'git-secrets not found; skipping optional AWS pattern registration.'
}
