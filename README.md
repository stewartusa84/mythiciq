# MythicIQ

MythicIQ is a project for turning World of Warcraft combat logs into something useful:
clear run analysis, replayable moments, and better group coordination. It combines a high-throughput parser, a reusable analytics engine, a fully capable web app running rust in wasm, and supporting services for curated mechanics knowledge and learning.

## What the project does

MythicIQ helps players and groups understand what happened in a Mythic+ run:

- analyze large combat logs quickly and reliably
- surface mechanics such as interrupts, dispels, avoidable damage, deaths, and defensive usage
- review a run with summaries, breakdowns, and replay-style navigation
- support run cards, group coordination, and related companion tooling

The project is built to work on real-world logs, including large files that need a fast and
memory-conscious pipeline.

## Repository layout

This repository is a pnpm monorepo with a few focused packages:

- packages/parser-core: Rust/WASM parser for raw combat-log data
- packages/engine: analysis engine, worker orchestration, and analytics logic
- packages/app: Svelte/Vite web app for viewing and exploring runs
- packages/backend: APIs and supporting services
- packages/data: curated spell and mechanics knowledge used by the analyzer
- AddOns/MythicIQ: the WoW addon that integrates MythicIQ with the Group Finder flow

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

## How the pieces fit together

The parser core turns raw combat-log bytes into a structured event store. The engine consumes
that data to produce analytics and run reports. The app presents those findings in a user-facing
review experience, while the backend and data package provide supporting services and curated
knowledge.

This split keeps the core analysis path reusable while allowing the app layer to stay focused on
experience and presentation.

## Working on mechanics and curation

A large part of the product’s value comes from curated mechanics knowledge: which abilities are
avoidable, which casts are dangerous to interrupt, which debuffs are removable, and which
abilities provide useful defenses.

This is a large and ongoing effort, and help with curation would be greatly appreciated. If you
have time to review logs, classify mechanics, or improve the curated data, that contribution would
make a meaningful difference to the project.

That data lives under [packages/data](packages/data) and is compiled into a generated mechanics
bundle. After changing curation data, regenerate the bundle before testing the app:

```bash
pnpm --filter @wow/data run build:mechanics
```

If you are editing spell data or mechanics knowledge, the detailed contributor notes live in
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

Please also review [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Source code is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for
details.

The MythicIQ name, logo, branding, website copy, icons, artwork, screenshots, and other
visual brand assets are reserved and may not be used to imply endorsement, sponsorship,
or affiliation with MythicIQ.