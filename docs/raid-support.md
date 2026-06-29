# Design: Raid support

Status: **Tier 1 implemented (engine model + app framing).** Tier 2 (raid mechanic curation +
comparison backend) is still pending. See "Effort tiers" below.

## What shipped (Tier 1)
- **Content type.** `Run.contentType` ∈ `'mplus' | 'raid' | 'other'` (`engine/src/segments/runs.ts`).
  M+ = CHALLENGE_MODE bracket; raid = raid-difficulty `ENCOUNTER_START..END` sessions; else synthetic
  `'other'`. Difficulty vocab in `engine/src/segments/difficulty.ts` (`isRaidDifficulty` = 14/15/16/17).
- **Raid run model.** `segmentRuns` now emits, alongside M+ runs, one **raid session** run per
  contiguous block of raid encounters sharing an `instanceId` (range = first pull START → last pull
  END). Session metadata: `difficultyId`/`difficultyName`/`instanceId`/`instanceName` (the last from the
  nearest preceding `ZONE_CHANGE` `zoneName`). A log can hold both M+ and raid runs.
- **Boss buckets.** `engine/src/segments/raidBosses.ts` `bucketBosses(segments)` groups a raid run's
  `encounter` segments by `encounterId` (wipes + kill = `attempts`), surfaced as `RunReport.bosses`
  (worker only sets it for raid runs). Each attempt references `RunReport.segments` by `segmentIndex`.
- **App framing.** `runHash` (raid identity), `report.ts` `raidSummary`/`runLabel` (raid selector
  label), `RunSummary.svelte` (instance + difficulty badge + `killed/pulled`, no stars/timer/affixes),
  `tabs/Pulls.svelte` (boss buckets, expandable attempts, replay seek per attempt), `tabs/Overview.svelte`
  (a `'kill'` celebration via `CelebrationOverlay`), and run history (`historyStore`/`runExtract`/
  `RunHistory.svelte` show raid rows). Mechanics tab honestly reads "0 known" until raid curation lands.
- **Tests:** `engine/test/runs.test.ts` (raid sessions, mixed M+/raid, non-raid-difficulty ignore) +
  `engine/test/raidBosses.test.ts`.

## Deferred (Tier 2 + smaller follow-ups)
- **Trash bucketing for raids** (instanceId-scoped, excluding non-raid trash) — intentionally not built
  yet; the instance-scoping needs validation on a real raid log.
- Raid mechanic curation (the big recurring lift — see below), best-pull % (boss HP at wipe), raid
  comparison backend, manual content-type override toggle.

---

The remainder of this doc is the original scoping/execution plan, kept for context.

## Why
The analyzer is Mythic+ only right now. Raiding is a large, overlapping audience — once the tool is
out, raiders will want it too, and the marginal cost is low because the parser and most analytics are
content-agnostic. The goal: make a raid log a first-class thing the app understands, without forking
the engine.

## TL;DR
Most of the engine already works on a raid log today — the parser is identical, and a raid log falls
into a single synthetic whole-log "run" with each boss pull already detected as an `encounter` segment.
What's missing is (1) **raid framing** (the run model + header are Mythic+ shaped: keystone/timer/stars/
affixes) and (2) **raid curation** (the mechanics analytics are data-driven from an M+ addon, so raid
boss abilities aren't in the spell table). (1) is moderate plumbing; (2) is the real, ongoing lift.

## What already works (content-agnostic — no change needed)
- **Parsing.** Identical; no M+ assumptions in the columnar parser.
- **Run fallback.** [`segments/runs.ts`](../packages/engine/src/segments/runs.ts) `segmentRuns` returns a
  single `synthetic` whole-log run when there's no `CHALLENGE_MODE_START` (which a raid log won't have),
  so every downstream consumer still runs.
- **Encounter detection.** [`segments/segmenter.ts`](../packages/engine/src/segments/segmenter.ts) already
  brackets each `ENCOUNTER_START..ENCOUNTER_END` into an `encounter` segment with `encounterId` /
  `encounterName` / `success`. (`difficultyID` is parsed into the event side-table but not yet surfaced.)
- **Generic analytics.** DPS/HPS (`dps.overall`/`hps.overall`), deaths + death recap, role review,
  the replay viewer, custom metrics, clutch plays, interrupts/dispels — all read raw events/HP/casts and
  are content-neutral. They produce meaningful output on a raid log as-is.

So a raid log dropped in **today** gives useful damage/healing/deaths/replay/custom-metrics — it's just
mislabeled as a (synthetic) M+ run and the mechanics tab is empty for raid abilities.

## What is Mythic+-specific and needs a content-type branch
Introduce a `contentType: 'mplus' | 'raid'` (and a catch-all `'other'`) threaded through `FullReport` /
`RunReport`, set by auto-detection (below). Then branch:

1. **Run model** (`segments/runs.ts`). M+: one run = one dungeon (`CHALLENGE_MODE_*`). Raid: there's no
   container event. Two viable models:
   - **Boss-as-run** (recommended): each boss `ENCOUNTER` is its own "run" in the selector, grouping its
     wipes + kill as **pulls/attempts**. Matches how raiders think ("Council pull 4").
   - **Session-as-run**: the whole night is one run with per-boss `encounter` segments (closest to the
     current synthetic fallback; least new code, but a worse selector UX for a long night).
   Either way, bracket on `ENCOUNTER_START/END` + `difficultyID`; track pull count, wipe vs kill, and
   best pull % (boss HP remaining at wipe) / kill time.
2. **Run header + result** ([`mvp/RunSummary.svelte`](../packages/app/src/mvp/RunSummary.svelte),
   [`mvp/report.ts`](../packages/app/src/mvp/report.ts) `runResult`/`runLabel`/`runHash`). Replace
   stars/keystone/timer/affixes with **difficulty + kill/wipe + attempts + best %**. All small branches
   on `contentType`. `runHash` must include the encounter id + difficulty + pull index so per-pull
   overrides/stats stay stable.
3. **Self-hiding / variant panels.** MDT enemy-forces %, pull-detection labeling
   ([`segments/enemyFacts.ts`](../packages/engine/src/segments/enemyFacts.ts)), the affix-gated death
   penalty ([`analytics/seed/deaths.ts`](../packages/engine/src/analytics/seed/deaths.ts)), and the
   "Timed!" celebration are M+-only. They should no-op for raids (or become a kill celebration). Most
   already self-hide when their data is absent.
4. **Detection + toggle.** Auto-detect from the log: `CHALLENGE_MODE_START` present → `mplus`; else an
   `ENCOUNTER_START` with a raid `difficultyID` (14 Normal / 15 Heroic / 16 Mythic / 17 LFR; M+ = 8) →
   `raid`. Add a manual override toggle in the topbar for edge cases. **No separate endpoint/route** —
   parsing is identical, only segmentation + framing differ.

## The real lift: raid mechanic curation (large, ongoing)
The mechanics-tab analytics — **avoidable damage, dangerous interrupts, dispels, dangerous debuffs,
active mitigation** — are entirely **data-driven by the curated spell table**, which today is seeded
from **MDT (a Mythic+ addon)**. Raids have no MDT equivalent in the pipeline, so raid boss abilities
aren't curated. The **engine does not change**; the spell table just needs raid entries:
- A new curation surface for raid encounter abilities (avoidable mechanics, dispellable/dangerous
  debuffs, dangerous interruptible casts), likely grouped by `encounterId` instead of dungeon.
- Source options: hand-curate per tier (like `curation/avoidable.json`), and/or import from a raid
  data source (DBC/journal/encounter-journal dumps) the way `import-db2.mjs` / `import-mdt.mjs` work.
- Until curated, raid runs degrade gracefully: DPS/deaths/replay/custom-metrics are full; the mechanics
  tab reads "0 known" (same honest coverage caveat the analytics already print).
- The removal auto-discovery loop (SPELL_DISPEL) **does** help grow raid dispels/cleanses automatically
  once raiders are submitting logs — but it does **not** cover avoidable mechanics (no log signature for
  "should have dodged"). Those stay hand-curated.

This curation is the bulk of the effort and it **recurs per raid tier**, not a one-time build.

## Backend comparison
`RunStatsSubmission` ([`backend/src/runStats.ts`](../packages/backend/src/runStats.ts) +
[`app/src/mvp/runStats.ts`](../packages/app/src/mvp/runStats.ts)) is M+-shaped (keyLevel / timed /
chests / dungeon). For raids: a variant keyed by **encounter + difficulty**, comparing kill time, best
pull %, and parse (per-spec DPS/HPS) against the field. The route can stay name-free + opt-in exactly as
today. Reasonable to ship raids with comparison OFF first and add the raid variant later.

## Effort tiers
- **Tier 1 — "raids aren't broken" (a few focused sessions, mostly plumbing):** content-type detect +
  raid run model (boss-as-run, pull grouping) + raid run header + hide M+-only panels. Reuses every
  generic analytic. Immediately useful: DPS/HPS/deaths/replay/custom-metrics on raid logs, with a thin
  mechanics tab.
- **Tier 2 — "raids as good as M+" (ongoing):** the raid mechanic curation library (per tier) + raid
  comparison backend. This is where the real time goes.

Recommendation: ship Tier 1 with auto-detect first (unlocks value from logs people already have), then
grow raid curation incrementally, discovery-assisted for removals.

## File-by-file change list (for whoever picks this up)
- `engine/src/worker/protocol.ts` — add `contentType` to `FullReport` (+ per-run if boss-as-run).
- `engine/src/segments/runs.ts` — raid run model + detection; pull/attempt grouping by `encounterId`.
- `engine/src/worker/parse.worker.ts` — set `contentType`; build raid runs.
- `engine/src/analytics/seed/deaths.ts` — skip the affix death-penalty for raids (already ~0 without affixes).
- `app/src/mvp/report.ts` — `runResult`/`runLabel`/`runHash` branches; raid status (kill/wipe/attempts).
- `app/src/mvp/RunSummary.svelte` — raid header (difficulty/kill/best %), hide stars/timer/affixes.
- `app/src/mvp/tabs/Overview.svelte` — kill celebration vs "Timed!"; raid highlights.
- `app/src/App.svelte` — content-type toggle in the topbar; run-selector labels.
- `app/src/mvp/runStats.ts` + `backend/src/runStats.ts` — raid comparison variant (later).
- `data/curation/` — raid mechanic curation (avoidable / debuffs / dangerous casts) by encounter (the big one).

## Open questions
- Boss-as-run vs session-as-run for the run selector (recommend boss-as-run).
- Where raid ability data comes from (hand-curation vs an encounter-journal/DBC importer).
- Whether to gate raid mode behind the toggle until curation is meaningful, or ship it auto-detected
  with the "0 known mechanics" caveat from day one.
