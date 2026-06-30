# MythicIQ

MythicIQ turns World of Warcraft combat logs into clear run analysis, replayable
moments, and better group coordination. It combines a Rust/WASM parser, a
reusable TypeScript analytics engine, a Svelte web app, and curated mechanics
knowledge for Mythic+ review.

## What MythicIQ Does

MythicIQ helps players and groups understand what happened in a Mythic+ run:

- analyze real combat logs in the browser
- surface mechanics such as interrupts, dispels, avoidable damage, deaths, and defensives
- review a run with summaries, breakdowns, and replay-style navigation
- support run cards, group coordination, and companion tooling

The analyzer is designed around real player logs and real dungeon knowledge. Code
contributions are welcome, and mechanics curation is especially valuable.

## Repository layout

This repository is a pnpm monorepo with focused packages:

- `packages/parser-core`: Rust/WASM parser for raw combat-log data
- `packages/engine`: analysis engine, worker orchestration, and analytics logic
- `packages/app`: Svelte/Vite web app for viewing and exploring runs
- `packages/backend`: APIs and supporting services
- `packages/data`: curated spell and mechanics knowledge used by the analyzer
- `AddOns/MythicIQ`: WoW addon integration for the Group Finder flow

## Prerequisites

- Node.js 20+
- pnpm
- Rust stable with the wasm target installed:

```bash
rustup target add wasm32-unknown-unknown
```

## Quick start

```bash
pnpm install
pnpm build:wasm
pnpm test
pnpm --filter @wow/app dev
pnpm --filter @wow/backend dev
pnpm dev:website
```

Useful commands while developing:

- `pnpm test` runs the repo test suite
- `pnpm typecheck` checks the workspace types
- `pnpm bench` runs the engine benchmark harness
- `.\scripts\verify-public-release.ps1` checks the public checkout before publishing

## How the pieces fit together

The parser core turns raw combat-log bytes into a structured event store. The engine consumes
that data to produce analytics and run reports. The app presents those findings in a user-facing
review experience, while the backend and data package provide supporting services and curated
knowledge.

This split keeps the core analysis path reusable while allowing the app layer to stay focused on
experience and presentation.

## Help With Mechanics Curation

A large part of MythicIQ's value comes from curated mechanics knowledge: which
abilities are avoidable, which casts are dangerous to interrupt, which debuffs
are removable, which abilities provide useful defenses, and what advice should
be shown to players after a run.

This is a large ongoing effort, and help here would make a meaningful
difference. Good curation contributions include:

- reviewing logs to confirm spell IDs and event behavior
- classifying avoidable damage, priority interrupts, dangerous debuffs, and removers
- improving role-specific mechanic advice
- adding evidence notes when a mechanic is confirmed from real logs

Hand-edited data lives under [packages/data/curation](packages/data/curation)
and is compiled into a generated mechanics bundle. After changing curation data,
regenerate the bundle before testing the app:

```bash
pnpm --filter @wow/data run build:mechanics
```

If you are editing spell data or mechanics knowledge, start with the detailed
contributor notes in
[packages/data/curation/README.md](packages/data/curation/README.md).

## More documentation

The repository also includes deeper notes for specific parts of the project:

- [docs/desktop-app.md](docs/desktop-app.md)
- [docs/raid-support.md](docs/raid-support.md)
- [docs/run-metrics.md](docs/run-metrics.md)
- [AddOns/MythicIQ/README.md](AddOns/MythicIQ/README.md)

## Contributing

If you want to help, start with the package that matches your focus:

- app work: [packages/app](packages/app)
- engine and analysis: [packages/engine](packages/engine)
- parser work: [packages/parser-core](packages/parser-core)
- curation and mechanics data: [packages/data](packages/data)

Please review [CONTRIBUTING.md](CONTRIBUTING.md) and
[PUBLIC_RELEASE_CHECKS.md](PUBLIC_RELEASE_CHECKS.md) before opening a pull
request.

## License

Source code is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for
details.

The MythicIQ name, logo, branding, website copy, icons, artwork, screenshots, and other
visual brand assets are reserved and may not be used to imply endorsement, sponsorship,
or affiliation with MythicIQ.
