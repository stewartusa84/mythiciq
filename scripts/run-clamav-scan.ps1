[CmdletBinding()]
param(
    [string]$OutputPath = 'security-reports/clamav-scan.log',
    [switch]$FailOnMissingClamAv
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $RepoRoot

$clamscan = Get-Command clamscan -ErrorAction SilentlyContinue
if (-not $clamscan) {
    $message = 'ClamAV clamscan was not found on PATH.'
    if ($FailOnMissingClamAv) {
        Write-Error $message
        exit 2
    }

    Write-Warning "$message Skipping local malware scan."
    exit 0
}

$resolvedOutputPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
} else {
    Join-Path $RepoRoot $OutputPath
}

$outputDir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$scanArgs = @(
    '--recursive',
    '--infected',
    '--suppress-ok-results',
    '--exclude-dir=(^|[\\/])\.git([\\/]|$)',
    '--exclude-dir=(^|[\\/])node_modules([\\/]|$)',
    '--exclude-dir=(^|[\\/])\.pnpm-store([\\/]|$)',
    '--exclude-dir=(^|[\\/])dist([\\/]|$)',
    '--exclude-dir=(^|[\\/])build([\\/]|$)',
    '--exclude-dir=(^|[\\/])target([\\/]|$)',
    '--exclude-dir=(^|[\\/])security-reports([\\/]|$)',
    $RepoRoot
)

Write-Host 'Running ClamAV malware scan...'
Write-Host "Scanner: $($clamscan.Source)"
Write-Host "Report: $resolvedOutputPath"

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    & $clamscan.Source @scanArgs 2>&1 | Tee-Object -FilePath $resolvedOutputPath
    $scanExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($scanExitCode -eq 0) {
    Write-Host 'ClamAV malware scan passed.'
    exit 0
}

if ($scanExitCode -eq 1) {
    Write-Error 'ClamAV found one or more infected files.'
    exit 1
}

Write-Error "ClamAV scan failed with exit code $scanExitCode."
exit $scanExitCode

