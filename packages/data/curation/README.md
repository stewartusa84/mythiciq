# MythicIQ Curation

This folder is the contributor-facing source of truth for hand-curated MythicIQ data. If a change is judgment, guidance, or human-maintained game knowledge, put it here instead of hard-coding it in the app or engine.

Curated data files are plain JSON so they are easy to review in pull requests and easy for tooling to round-trip without losing fields.

## Mechanic cards (`mechanics/`) — the main thing you'll edit

Each enemy mechanic is one **mechanic card** in `mechanics/<dungeon-slug>.json` (Mythic+) or
`mechanics/<raid-slug>/<encounter-slug>.json` (raids — one file per encounter, the analog of
per-dungeon). A file is `{ "_meta": { kind, name, slug, instance?, encounterId? }, "cards": { "<spellId>": card } }`.

A card is the **single source** for everything about that mechanic — identity, how the analyzer
classifies it, and the learning content shown on the in-app card:

```jsonc
"374352": {
  "name": "Energy Bomb", "caster": "Overgrown Ancient", "boss": false,
  // classification (drives the analytics)
  "avoidable": true,                  // stand-in-fire damage you can personally dodge
  "interruptPriority": "dangerous",   // "dangerous" | "regular" | null
  "dispelPriority": "dangerous",
  "danger": "dangerous",              // present ⇒ this is a dangerous DEBUFF (registers it)
  "removableBy": ["snare"],           // optional override; DB2 supplies most removable categories
  // learning content (the card)
  "summary": "Targets a player; the explosion cleaves nearby allies.",
  "advice": { "generic": "...", "tank": "...", "healer": "...", "dps": "..." },
  "videos": [ { "title": "Handling it", "url": "https://youtu.be/...", "atSeconds": 42, "source": "youtube" } ],
  "tags": ["spread", "targeted"], "confidence": "high", "source": "MythicIQ", "notes": "..."
}
```

A mechanic can be any/all of avoidable, interruptible, and a dangerous debuff at once. Removable
categories (magic/curse/snare/bleed/…) come from DB2 facts automatically — only add `removableBy` to
override a wrong/missing one.

`source` is the visible contributor credit shown on the in-app learning card ("Contributed by …").
Use a player name, guild/team name, community handle, or `MythicIQ` for first-party/generated curation.
Legacy internal values such as `guide_or_curated` display as `MythicIQ`; do not add those to new cards.
`confidence` remains useful as an internal review hint, but the app does not show it to players.

### Community editing workflow

1. Find the right file in `packages/data/curation/mechanics/`.
2. Add or update one spell ID under `cards`.
3. Keep the file as real JSON: quoted keys/strings, no comments, no trailing commas.
4. Run `pnpm --filter @wow/data run check:mechanics`.
5. If the change should update the app bundle in this checkout, run
   `pnpm --filter @wow/data run build:mechanics`.

The check command validates every mechanic card and reports the exact file/path for common mistakes:
unknown fields, duplicate spell IDs, invalid priority values, bad video/advice shapes, and unknown
`removableBy` categories.

Smallest useful card:

```json
"123456": {
  "name": "Bad Swirl",
  "avoidable": true,
  "summary": "A ground effect players should move out of.",
  "advice": {
    "generic": "Move out before the impact lands."
  },
  "tags": ["dodge"],
  "confidence": "medium",
  "source": "MythicIQ"
}
```

For a new raid encounter file, use:

```json
{
  "_meta": {
    "kind": "encounter",
    "name": "Boss Name",
    "slug": "boss-name",
    "instance": "Raid Name"
  },
  "cards": {}
}
```

Do not add generated/display-only fields such as `spellId`, `dungeon`, `kind`, `instance`, or
`removableCategories` inside a card. The build script fills those from the spell ID and `_meta`.

## Other files

- `overlay.json`: **player-kit only** — player defensive cooldowns + tank active-mitigation buffs.
  (Enemy-mechanic flags moved to the mechanic cards above.)
- `debuffs.json`: backend-managed removal registry (the auto-promotion engine's write target); add a
  dangerous debuff via a card's `danger`, not here.
- `removers.json`: player spells or buffs that remove debuff categories.
- `removal-categories.json`: the shared category vocabulary used by debuffs and removers.
- `clutch-abilities.json`: external/utility abilities credited as clutch plays when used on allies in real danger.
- `affixes.json`: Mythic+ affix names and explanatory metadata.
- `positive-messages.json`: topbar affirmations and approved Scripture snippets.
- `custom-metrics-examples.json`: curated metric preset library source.
- `custom-metrics-template.json`: reference shape for custom metric examples.

## Regenerating Outputs

After editing curation that feeds generated/runtime artifacts, run the matching command:

- `pnpm --filter @wow/data run build:mechanics`  — after editing any mechanic card, `overlay.json`,
  `debuffs.json`, `removers.json`, or `removal-categories.json` (rebuilds the served bundle).
- `pnpm --filter @wow/data run check:mechanics` — validate mechanic cards without rewriting
  `generated/mechanics.json`.
- `pnpm --filter @wow/data run import:metric-presets`

Files under `packages/data/generated/` are build output. Do not hand-edit them.
