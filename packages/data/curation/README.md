# MythicIQ Curation

This folder is the contributor-facing source of truth for hand-curated MythicIQ data. If a change is judgment, guidance, or human-maintained game knowledge, put it here instead of hard-coding it in the app or engine.

Curated data files are plain JSON so they are easy to review in pull requests and easy for tooling to round-trip without losing fields.

## Files

- `avoidable.json`: avoidable enemy mechanics grouped by dungeon.
- `overlay.json`: spell-table overrides such as priority, defensive tags, and known mechanic flags.
- `debuffs.json`: dangerous player debuffs grouped by dungeon.
- `removers.json`: player spells or buffs that remove debuff categories.
- `removal-categories.json`: the shared category vocabulary used by debuffs and removers.
- `mechanic-advice.json`: role-lensed tips shown in the analyzer for dangerous mechanics.
- `clutch-abilities.json`: external/utility abilities credited as clutch plays when used on allies in real danger.
- `affixes.json`: Mythic+ affix names and explanatory metadata.
- `positive-messages.json`: topbar affirmations and approved Scripture snippets.
- `custom-metrics-examples.json`: curated metric preset library source.
- `custom-metrics-template.json`: reference shape for custom metric examples.

## Regenerating Outputs

After editing curation that feeds generated/runtime artifacts, run the matching command:

- `pnpm --filter @wow/data run import:avoidable`
- `pnpm --filter @wow/data run import:metric-presets`
- `pnpm --filter @wow/data run build:mechanics`

Files under `packages/data/generated/` are build output. Do not hand-edit them.
