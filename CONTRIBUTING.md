# Contributing

Thanks for helping improve MythicIQ.

## Local setup

```bash
pnpm install
pnpm build:wasm
pnpm --filter @wow/engine test
pnpm --filter @wow/app typecheck
pnpm --filter @wow/app build
```

Use anonymized or synthetic logs for tests and examples. Do not commit real combat logs, local `.env` files, credentials, screenshots with personal data, raw DB2 dumps, or generated build output.

## Curation data

Hand-edited mechanics data lives under `packages/data/curation/`. After changing curation, rebuild the mechanics bundle with the matching importer and finish with:

```bash
pnpm --filter @wow/data run build:mechanics
```

## Public/private workflow

This public repository is the open-source distribution surface. Production deployment infrastructure and private agent/tooling state are intentionally not part of this repo.