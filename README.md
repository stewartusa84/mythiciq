# WoW Mythic+ Combat Log Analyzer

Browser-based analyzer for large (200MB+, 2–3M line) World of Warcraft combat logs,
focused on Mythic+ dungeon runs.

## Architecture

A pnpm + Vite + TypeScript monorepo:

| Package                  | Lang   | Responsibility |
| ------------------------ | ------ | -------------- |
| `@wow/parser-core`       | Rust→WASM | Parses raw log bytes into a **columnar (structure-of-arrays) event store** in WASM linear memory: parallel typed-array columns + a string interning table. Exposes pointers/lengths so TS builds **zero-copy** typed-array views. |
| `@wow/engine`            | TS     | Web Worker that runs the WASM parse off the main thread (chunked/streamed, progress events); zero-copy column views; pluggable analytics registry; segmenter; O(window) time-window queries via binary search on the sorted timestamp column. |
| `@wow/app`               | TS/Svelte | Svelte 5 (runes) UI on Vite — polished MVP analyzer at `/` + dev inspector at `/diag`. Engine stays framework-agnostic. |
| `@wow/data`              | data   | Curated spell/mechanics knowledge (MDT seed + overlay + removal model + DB2 facts) and the importers that build the served **mechanics bundle**. See [Curation data](#curation-data-mechanics-bundle). |
| `@wow/backend`           | TS (Fastify) | Serves the mechanics bundle (ETag), ingests removal discoveries (auto-promoting them into curation), and accepts bug reports + screenshots. |

## Performance contract (bake in from day one)

- **Never** serialize per-event JSON or copy event objects across the JS↔WASM boundary.
  No `serde_json::Value` per event, no array-of-objects event lists.
- Columns live in WASM linear memory; TS reads them as zero-copy typed-array views.
- Tokenize by slicing `&str` (`char_indices`), never `chars().collect()`.
- Strings (player names, GUIDs, spell names) are interned to `u32` ids.
- **Target: a 200MB log parsed and summary-ready in under ~2s in the Worker.**
- The summary report is computed/rendered first; the full event corpus stays resident
  for scrubbing and finishes indexing in the background.

## Prerequisites

- Node ≥ 20, pnpm
- Rust stable with the `wasm32-unknown-unknown` target:
  ```
  rustup target add wasm32-unknown-unknown
  ```

## Quick start

```bash
pnpm install
pnpm build:wasm                 # compile the Rust crate to WASM
pnpm test                       # fixture test: parse a small known log, assert output
pnpm bench                      # per-phase benchmark harness (ms per phase)
pnpm --filter @wow/app dev      # main UI server
pnpm dev:website                # website on :5173, analyzer web app proxied at /app/
pnpm --filter @wow/backend dev  # backend server
```

## Layout

```
packages/
  parser-core/   Rust crate (columnar store, intern table, parse entry point)
  engine/        Worker, column views, analytics registry, segmenter, bench
  app/           Vite + Svelte 5 (MVP analyzer at /, dev inspector at /diag)
```

See `packages/engine/src/analytics/registry.ts` for how to add a new metric without
touching the parser.

## License

Source code is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE)
for details.

The MythicIQ name, logo, branding, website copy, icons, artwork, screenshots, and other
visual brand assets are reserved and may not be used to imply endorsement, sponsorship,
or affiliation with MythicIQ.

## Curation data (mechanics bundle)

Spell/mechanics knowledge (which casts are avoidable, interrupt/dispel priority, what
removes what, active-mitigation buffs, …) is **curated** in `packages/data` and compiled
into a single served artifact: `packages/data/generated/mechanics.json` (the *bundle*).

**The app reads the bundle, never the curation source files.** So after editing any
curation file you must **regenerate the bundle**, then restart the dev server (or
hard-reload) — when running offline the bundle is imported at build time.

What you changed → what to run (always end with `build:mechanics`):

| You edited | Command(s) |
| ---------- | ---------- |
| `curation/avoidable.json` and/or `curation/overlay.json` | `pnpm --filter @wow/data run import:avoidable && pnpm --filter @wow/data run build:mechanics` |
| `curation/removers.json` / `debuffs.json` / `removal-categories.json` | `pnpm --filter @wow/data run import:db2 && pnpm --filter @wow/data run build:mechanics` |
| dungeon Lua in `dungeons/*.lua` | `pnpm --filter @wow/data run import:mdt && pnpm --filter @wow/data run build:mechanics` |
| only `overlay.json` (e.g. flip one flag) | `pnpm --filter @wow/data run build:mechanics` |

> **Gotcha:** `import:avoidable` is **non-destructive** — it only ever *adds*
> `avoidable: true`. Removing an entry from `avoidable.json` will **not** un-flag a
> mechanic. To make something **not** avoidable, set `"avoidable": false` directly in
> `overlay.json` (overlay overrides win), then `build:mechanics`.

`build:mechanics` writes a new content-hash `version` into the bundle; with the backend
running (`VITE_BACKEND_URL` set) clients pick it up via the `/api/mechanics` ETag with no
rebuild. If a stale bundle persists in dev, clear `packages/app/node_modules/.vite`
(or run `vite --force`).

## Maintenance

Day-to-day upkeep: classifying spells, adding new ones, and the regen + verify loop. This
is the section to skim before touching curation.

### Inspect a spell (do this first)

Don't dig through the DB2 CSVs by hand — ask the table how a spell is classified. It reads
the **built bundle** (`generated/mechanics.json`), so it answers exactly what the app sees:

```bash
pnpm --filter @wow/engine spell 1269286            # one id
pnpm --filter @wow/engine spell 1269286 1044 642   # several
```

It prints, for each id: **avoidable**, **interruptible** (+priority), **dispellable**
(+school/priority), **removable categories** and the full list of **removers that clear it**,
whether it's a **dangerous debuff** (caster/dungeon/notes), whether it's itself a **remover**
(what it provides), plus defensive / active-mitigation / duration / npc facts — or
"NOT in the table" for an unknown id.

> Rebuild the bundle (`build:mechanics`) before running it if you've just edited curation —
> it reads the *built* bundle, not the source files.

### Adding / changing a spell — pick the recipe by intent

All curation lives in `packages/data/curation/`. After **any** edit, run the matching regen
from the [Curation data](#curation-data-mechanics-bundle) table above (always ending in
`build:mechanics`) and re-run `spell <id>` to confirm.

| You want a spell to be… | Where | How |
| ----------------------- | ----- | --- |
| **Avoidable** (stand-in-fire, individual fault; feeds the Avoidable Damage panel) | `curation/avoidable.json` under its dungeon | Add `"<spellId>": { "ability": "<name>" }` under the dungeon key. Run `import:avoidable` → `build:mechanics`. |
| **Not avoidable** (un-flag it) | `curation/overlay.json` | `import:avoidable` is **add-only** — removing the entry won't un-flag. Delete the `overlay.json` entry (or set `"avoidable": false`) **and** remove the `avoidable.json` entry, then `import:avoidable` → `build:mechanics`. |
| **Interruptible-dangerous** (a kick should stop it; drives interrupt priority + the "should've been kicked" death tag) | `curation/overlay.json` | `"<id>": { "interruptPriority": "dangerous" }`. Then `build:mechanics`. |
| **Dispellable / removable debuff** (cleanse, Freedom, snare/root break, etc.) | `curation/debuffs.json` under its dungeon | See **removable debuffs** below. |
| **A remover** (a player ability that clears debuffs) | `curation/removers.json` | See **removers** below. |
| **A player defensive** (for the death-recap kit) | `curation/overlay.json` | `"<id>": { "defensive": { "name", "class", "spec", "type": "personal\|external\|raid\|tank\|aura", "cooldownSeconds", "durationSeconds" } }`. Then `build:mechanics`. |

### Removable debuffs (the cleanse / Freedom / dispel path)

Removal is a **category intersection**, never a debuff↔remover edge list: a debuff declares
`removableBy: [categories]`, a remover declares `provides: [categories]`; they match iff the
sets overlap. So you just tag the debuff with `snare` / `root` / `magic` / `curse` / `disease`
/ `poison` / `bleed` / `healing-absorb`, and every existing remover of that category covers it
automatically (no wiring).

1. **Get the applied-aura id** — the spell id on the `SPELL_AURA_APPLIED` line on the *player*
   (not the enemy's cast id). Verify against a real log line.
2. Add it to `curation/debuffs.json` under the dungeon group (judgment only):
   ```json
   "<auraId>": { "name": "...", "caster": "<mob>", "priority": "dangerous", "notes": "..." }
   ```
3. `import:db2` → `build:mechanics`. DB2 fills `removableBy` / `name` / `duration` for the id.
4. Run `spell <auraId>` to check `removable categories`. **If it's empty**, DB2 didn't encode
   the mechanic (common when the snare/root sits on the *parent cast* id, not the aura) — add
   an explicit **override** that unions the tag on, then just `build:mechanics`:
   ```json
   "<auraId>": { "name": "...", "priority": "dangerous", "removableBy": ["snare"], "notes": "DB2 has the mechanic on the parent cast id; overridden here." }
   ```

> **Don't mark a removable debuff `avoidable`.** Avoidable = the player could have personally
> dodged it (and it pollutes the Avoidable Damage panel). A debuff you cleanse/Freedom belongs
> only in `debuffs.json`.

### Removers (abilities that clear debuffs)

Only needed if a clearing ability isn't already in `curation/removers.json`. Keyed by the
remover's spell id:

```json
"<id>": { "name": "...", "class": "...", "spec": "...", "scope": "self|external|party|raid|offensive", "provides": ["snare", "root"] }
```

`provides`/`name` are **optional** — DB2 supplies them for most dispels/immunities; list
`provides` only for the gaps DB2 can't see (shapeshift/leap/speed-buff breaks, bleed cleanses).
Then `import:db2` → `build:mechanics`.

### Deploy discipline

A push to `main` **auto-deploys to production**. Build, test, and QA locally first
(`pnpm --filter @wow/app typecheck`, `pnpm --filter @wow/engine test`, eyeball in `pnpm dev`),
and treat `git push` as a deploy — get explicit go-ahead before pushing.
