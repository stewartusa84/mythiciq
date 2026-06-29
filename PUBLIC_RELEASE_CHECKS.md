# Public Release Checks

This repository is the sanitized public release surface for MythicIQ. Run the
public release verification before every push:

```powershell
.\scripts\verify-public-release.ps1
```

To install the same check as a local Git `pre-push` hook:

```powershell
.\scripts\install-git-hooks.ps1
```

The verification script checks the files that would be visible from this public
repo checkout. It looks for high-confidence secrets, live AWS/infra identifiers,
private repo agent files, backend/infra artifacts, ignored files that are already
tracked, and accidentally large files.

Optional external scanners are used when installed:

- `betterleaks` — preferred primary scanner.
- `gitleaks` — fallback scanner when Betterleaks is not installed.
- `git-secrets` — extra AWS-focused scanner. Re-run
  `.\scripts\install-git-hooks.ps1` after installing it so the repo-local AWS
  patterns are registered.

The built-in scanner still runs even when those tools are not installed. Treat the
script as a release gate, not a replacement for reviewing `git status --short` and
the final diff before pushing.

The public GitHub repo remote belongs to this folder only:

```powershell
git remote add origin https://github.com/stewartusa84/mythiciq.git
```

Do not add the public remote to the private production checkout as a push target.
