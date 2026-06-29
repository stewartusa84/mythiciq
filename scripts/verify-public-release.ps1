[CmdletBinding()]
param(
    [switch]$SkipExternalScanners,
    [switch]$WarnOnly
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $RepoRoot

$Failures = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]

$LargeFileLimitBytes = 25MB
$TextScanLimitBytes = 8MB

function Add-Failure {
    param([string]$Message)

    if ($WarnOnly) {
        $Warnings.Add("FAIL AS WARNING: $Message")
    } else {
        $Failures.Add($Message)
    }
}

function Add-Warning {
    param([string]$Message)
    $Warnings.Add($Message)
}

function ConvertTo-RepoRelativePath {
    param([string]$Path)

    $fullPath = (Resolve-Path -LiteralPath $Path).Path
    if ($fullPath.StartsWith($RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $fullPath.Substring($RepoRoot.Length).TrimStart('\', '/')
    }

    return $fullPath
}

function Test-IsGitRepo {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        return $false
    }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $result = & git rev-parse --is-inside-work-tree 2>$null
        return $LASTEXITCODE -eq 0 -and ($result | Select-Object -First 1) -eq 'true'
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

function Get-PublicCandidateFiles {
    $isGitRepo = Test-IsGitRepo

    if ($isGitRepo) {
        $gitFiles = & git ls-files -co --exclude-standard
        if ($LASTEXITCODE -eq 0) {
            return @($gitFiles | Where-Object { $_ } | ForEach-Object {
                Join-Path $RepoRoot $_
            })
        }

        Add-Warning 'git ls-files failed; falling back to filesystem scan.'
    }

    $skipDirs = @(
        '.git',
        'node_modules',
        '.pnpm-store',
        'dist',
        'build',
        'target',
        '.svelte-kit',
        '.vite',
        'coverage',
        'test-results',
        'playwright-report',
        '.playwright'
    )

    return @(Get-ChildItem -LiteralPath $RepoRoot -Recurse -File -Force | Where-Object {
        $relative = ConvertTo-RepoRelativePath $_.FullName
        $parts = $relative -split '[\\/]'
        -not ($parts | Where-Object { $skipDirs -contains $_ })
    } | ForEach-Object { $_.FullName })
}

function Test-BinaryFile {
    param([string]$Path)

    $info = Get-Item -LiteralPath $Path
    if ($info.Length -eq 0) {
        return $false
    }

    $sampleLength = [Math]::Min(4096, [int]$info.Length)
    $buffer = New-Object byte[] $sampleLength
    $stream = [System.IO.File]::OpenRead($info.FullName)
    try {
        [void]$stream.Read($buffer, 0, $sampleLength)
    } finally {
        $stream.Dispose()
    }

    return [Array]::IndexOf($buffer, [byte]0) -ge 0
}

function Read-TextForScan {
    param([string]$Path)

    $info = Get-Item -LiteralPath $Path
    if ($info.Length -gt $TextScanLimitBytes) {
        Add-Warning "Skipping full text scan for large file '$((ConvertTo-RepoRelativePath $Path))' ($($info.Length) bytes)."
        return $null
    }

    if (Test-BinaryFile $Path) {
        return $null
    }

    return [System.IO.File]::ReadAllText($info.FullName)
}

function Test-AllowedPlaceholderLine {
    param([string]$Line)

    return $Line -match '(?i)(example|placeholder|changeme|change-me|replace-me|replace_me|your-|your_|<[^>]+>)'
}

function Invoke-OptionalExternalScanners {
    if ($SkipExternalScanners) {
        Add-Warning 'External scanners skipped by parameter.'
        return
    }

    if (Get-Command gitleaks -ErrorAction SilentlyContinue) {
        & gitleaks detect --no-git --source $RepoRoot --redact --verbose
        if ($LASTEXITCODE -ne 0) {
            Add-Failure 'gitleaks reported possible secrets.'
        }
    } else {
        Add-Warning 'gitleaks not found; using built-in scanner only.'
    }

    if ((Test-IsGitRepo) -and (Get-Command git-secrets -ErrorAction SilentlyContinue)) {
        & git secrets --scan
        if ($LASTEXITCODE -ne 0) {
            Add-Failure 'git-secrets reported possible secrets.'
        }
    } elseif (Test-IsGitRepo) {
        Add-Warning 'git-secrets not found; using built-in scanner only.'
    }
}

function Test-TrackedIgnoredFiles {
    if (-not (Test-IsGitRepo)) {
        return
    }

    $trackedIgnored = @(& git ls-files -ci --exclude-standard)
    if ($LASTEXITCODE -ne 0) {
        Add-Warning 'Could not check for tracked ignored files.'
        return
    }

    foreach ($path in $trackedIgnored) {
        if ($path) {
            Add-Failure "Ignored file is already tracked: $path"
        }
    }
}

$ForbiddenPathPatterns = @(
    @{ Name = 'private agent instructions'; Regex = '^(AGENTS|CLAUDE)\.md$' },
    @{ Name = 'local Codex state'; Regex = '^\.codex([\\/]|$)' },
    @{ Name = 'local Claude state'; Regex = '^\.claude([\\/]|$)' },
    @{ Name = 'backend package'; Regex = '^packages[\\/]backend([\\/]|$)' },
    @{ Name = 'infrastructure directory'; Regex = '^infra([\\/]|$)' },
    @{ Name = 'deployment directory'; Regex = '^deploy([\\/]|$)' },
    @{ Name = 'AWS local directory'; Regex = '^\.aws([\\/]|$)' },
    @{ Name = 'Terraform state'; Regex = '(^|[\\/])[^\\/]*\.tfstate(\.backup)?$' },
    @{ Name = 'Terraform work directory'; Regex = '^\.terraform([\\/]|$)' },
    @{ Name = 'CDK output'; Regex = '^cdk\.out([\\/]|$)' },
    @{ Name = 'SAM build output'; Regex = '^\.aws-sam([\\/]|$)' },
    @{ Name = 'Serverless output'; Regex = '^\.serverless([\\/]|$)' },
    @{ Name = 'real env file'; Regex = '(^|[\\/])\.env($|\.)(?!.*\.example$)' },
    @{ Name = 'desktop live env file'; Regex = '^packages[\\/]app[\\/]\.env\.desktop$' },
    @{ Name = 'real combat log'; Regex = '(^|[\\/])WoWCombatLog-[0-9]{6}_[0-9]{6}\.txt(\.gz)?$' },
    @{ Name = 'raw DB2 dumps'; Regex = '^packages[\\/]data[\\/]curation[\\/]db2([\\/]|$)' }
)

$SecretPatterns = @(
    @{ Name = 'AWS access key'; Regex = '(?<![A-Z0-9])(AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])'; Severity = 'fail' },
    @{ Name = 'private key block'; Regex = '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----'; Severity = 'fail' },
    @{ Name = 'GitHub token'; Regex = '(gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{20,})'; Severity = 'fail' },
    @{ Name = 'Slack webhook'; Regex = 'https://hooks\.slack\.com/services/[A-Za-z0-9/+]+'; Severity = 'fail' },
    @{ Name = 'OpenAI API key'; Regex = 'sk-[A-Za-z0-9_-]{32,}'; Severity = 'fail' },
    @{ Name = 'Stripe live secret key'; Regex = '(sk|rk)_live_[A-Za-z0-9]{16,}'; Severity = 'fail' },
    @{ Name = 'JWT'; Regex = 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'; Severity = 'fail' },
    @{ Name = 'generic secret assignment'; Regex = '(?i)\b(api[_-]?key|secret|token|password|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["''][^"''<>{}\s]{12,}["'']'; Severity = 'warn' }
)

$InfraContentPatterns = @(
    @{ Name = 'AWS ARN'; Regex = 'arn:aws[a-zA-Z-]*:' },
    @{ Name = 'AWS service URL'; Regex = 'https?://[^"''\s]+\.amazonaws\.com[^"''\s]*' },
    @{ Name = 'API Gateway host'; Regex = '[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com' },
    @{ Name = 'CloudFront host'; Regex = '[a-z0-9-]+\.cloudfront\.net' },
    @{ Name = 'Cognito host'; Regex = '[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com' },
    @{ Name = 'local Windows user path'; Regex = 'C:\\Users\\[^\\]+' },
    @{ Name = 'private repo path'; Regex = 'C:\\Repos\\wow\\parser-rust' }
)

Write-Host 'Running public release verification...'
Invoke-OptionalExternalScanners
Test-TrackedIgnoredFiles

$candidateFiles = @(Get-PublicCandidateFiles)

foreach ($file in $candidateFiles) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        continue
    }

    $relative = ConvertTo-RepoRelativePath $file
    $normalized = $relative -replace '\\', '/'
    $info = Get-Item -LiteralPath $file

    if ($info.Length -gt $LargeFileLimitBytes) {
        Add-Failure "Large file should not be in the public repo without review: $relative ($($info.Length) bytes)"
    }

    foreach ($pattern in $ForbiddenPathPatterns) {
        if ($normalized -match $pattern.Regex) {
            Add-Failure "Forbidden public path ($($pattern.Name)): $relative"
        }
    }

    $text = Read-TextForScan $file
    if ($null -eq $text) {
        continue
    }

    $lines = $text -split "`r?`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]

        foreach ($pattern in $SecretPatterns) {
            if ($line -match $pattern.Regex) {
                $location = "${relative}:$($i + 1)"
                if ($pattern.Severity -eq 'warn' -and (Test-AllowedPlaceholderLine $line)) {
                    continue
                }
                if ($pattern.Severity -eq 'warn') {
                    Add-Warning "Possible secret-like assignment ($($pattern.Name)) at $location"
                } else {
                    Add-Failure "Possible secret ($($pattern.Name)) at $location"
                }
            }
        }

        foreach ($pattern in $InfraContentPatterns) {
            if ($line -match $pattern.Regex) {
                if (Test-AllowedPlaceholderLine $line) {
                    continue
                }
                Add-Failure "Private/live infra marker ($($pattern.Name)) at ${relative}:$($i + 1)"
            }
        }
    }
}

if ($Warnings.Count -gt 0) {
    Write-Host ''
    Write-Host 'Warnings:'
    foreach ($warning in $Warnings) {
        Write-Host "  - $warning"
    }
}

if ($Failures.Count -gt 0) {
    Write-Host ''
    Write-Host 'Public release verification FAILED:'
    foreach ($failure in $Failures) {
        Write-Host "  - $failure"
    }
    exit 1
}

Write-Host ''
Write-Host "Public release verification passed. Files scanned: $($candidateFiles.Count)"
