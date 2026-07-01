// @wow/engine — framework-agnostic combat-log analysis library.
//
// Browser usage drives the Worker via `ParserClient`. Node/test usage calls the
// pipeline functions directly. Analytics are pluggable via `AnalyticsRegistry`.

export { ColumnStore } from './columns/columnStore.js';
export * from './columns/schema.js';

export { instantiateParser, type ParserWasmExports } from './wasm/loader.js';

export {
  parseLog,
  parseWith,
  buildSummary,
  createRegistry,
  type ParsedLog,
  type ParseOptions,
  type LogSummary,
  type SegmentSummary,
} from './pipeline.js';

export {
  segment,
  enrichSegment,
  type Segment,
  type SegmentKind,
  type SegmentOptions,
  type PullEnemy,
  type PullMdt,
} from './segments/segmenter.js';
export {
  dungeonEnemiesFor,
  type EnemyFact,
  type DungeonEnemies,
  type EnemyFactsByDungeon,
} from './segments/enemyFacts.js';
export { segmentRuns, type Run, type ContentType } from './segments/runs.js';
export { bucketBosses, type BossBucket, type RaidAttempt } from './segments/raidBosses.js';
export {
  RAID_DIFFICULTY_IDS,
  MYTHIC_PLUS_DIFFICULTY,
  difficultyName,
  isRaidDifficulty,
} from './segments/difficulty.js';
export {
  CHALLENGE_TIMERS_SECONDS,
  timerSecondsFor,
  chestsFor,
} from './segments/challengeTimers.js';
export { classSpecOf, roleOf, SPEC_IDS, type ClassSpec, type PlayerRole } from './spells/specIds.js';
export { buildRoster, type RosterEntry } from './analytics/roster.js';
export {
  computeVerifiedCredit,
  splitNameRealm,
  type RunCreditResult,
  type PlayerCredit,
  type PlayerPraise,
} from './analytics/verifiedCredit.js';
export { anonymizeLog } from './anonymize.js';
export {
  buildCombatants,
  parseTalents,
  parseGear,
  parseAuras,
  type CombatantInfo,
  type CombatantStats,
  type TalentEntry,
  type GearItem,
  type CombatantAura,
} from './analytics/combatants.js';
export { lowerBound, upperBound, windowRange, type IndexRange } from './query/timeWindow.js';

export { AnalyticsRegistry } from './analytics/registry.js';
export type { Analytic, AnalyticContext, AnalyticResult, Role } from './analytics/types.js';
export { seedAnalytics } from './analytics/seed/index.js';
// Seed-analytic result shapes used by bespoke MVP panels (Role Review).
export type { DamageResult, DamageMeterRow, BreakdownResult } from './analytics/seed/damage.js';
export type { HealingResult } from './analytics/seed/healing.js';
export type { InterruptsResult } from './analytics/seed/interrupts.js';
export type { DamageTakenResult } from './analytics/seed/damageTaken.js';
export type {
  DamageTakenByEnemyResult,
  EnemyDamageRow,
  EnemyDamageSpell,
  EnemyDamageSplit,
} from './analytics/seed/damageTakenByEnemy.js';

// Derived primitives + episode/stat analytics
export {
  Primitives,
  HpTimeline,
  UnitEventIndex,
  ReplayModel,
  ReplayView,
  toReplayData,
  type HpSample,
  type UnitHpTimeline,
  type HpQuery,
  type UnitHeal,
  type HealType,
  type ReplayModelData,
  type ReplayUnit,
  type ReplayDeath,
  type ReplayBookmark,
  type BookmarkKind,
  type AuraInterval,
  type CastInterval,
  type ActiveAura,
  type AuraKind,
  type CastResult,
  type JournalEvent,
  type JournalEventKind,
  type RunTimeline,
  type MeterRow,
  type AvoidableHit,
  type EncounterSpan,
  type InterruptEvent,
  type DamageTick,
  type HealTick,
  type CombatAggregate,
  type CombatPop,
  type CooldownState,
  type CooldownStatus,
} from './analytics/primitives/index.js';
export {
  IMPORTANT_COOLDOWNS,
  interruptForSpec,
  cooldownsForSpec,
  talentCooldownsForSpec,
  type CooldownKind,
  type CooldownDef,
  type PlayerCooldown,
} from './spells/importantCooldowns.js';
export {
  aggregate,
  summarizeCensored,
  formatCensored,
  type AggregateStats,
  type CensoredStats,
} from './analytics/stats/aggregate.js';
export {
  computeHealResponse,
  healResponse,
  DEFAULT_HEAL_RESPONSE_PARAMS,
  type HealResponseResult,
  type HealResponseParams,
} from './analytics/seed/healResponse.js';
export {
  computeRecovery,
  recovery,
  DEFAULT_RECOVERY_PARAMS,
  type RecoveryResult,
  type RecoveryParams,
} from './analytics/seed/recovery.js';

// Curated spell table (#7) + table-backed analytics (#5/#6/#8)
export {
  SpellTable,
  type SpellInfo,
  type SpellSeed,
  type SpellOverlay,
  type OverlayEntry,
  type Priority,
  type DefensiveInfo,
  type DefensiveType,
  type RemovalCategory,
  type RemovalCategoryDef,
  type RemoverEntry,
  type DebuffEntry,
  type DebuffsByDungeon,
  type RemovalData,
  type SpellFact,
  type SpellFacts,
} from './spells/spellTable.js';
// Mechanics bundle (client-served artifact) + swappable fetch seam.
export {
  tableFromBundle,
  loadMechanics,
  type MechanicsBundle,
  type MechanicsSource,
  type MechanicCard,
  type MechanicCardSource,
  type MechanicAdvice,
  type MechanicVideo,
} from './spells/mechanics.js';
// Note: the node-only loader (`loadSpellTable`, uses node:fs) is intentionally NOT
// re-exported here so the browser bundle stays clean. Node consumers import it directly
// from './spells/nodeSpellTable.js'.
export {
  computeTankMelee,
  tankMelee,
  DEFAULT_TANK_MELEE_PARAMS,
  type TankMeleeResult,
  type TankMeleeUnit,
} from './analytics/seed/tankMitigation.js';
export {
  computeInterruptsPriority,
  computeDispelsPriority,
  interruptsPriority,
  dispelsPriority,
  type InterruptPriorityResult,
  type DispelPriorityResult,
} from './analytics/seed/priorityActions.js';
export {
  computeInterruptAccountability,
  interruptAccountability,
  DAMAGE_WINDOW_MS as INTERRUPT_DAMAGE_WINDOW_MS,
  type InterruptAccountabilityResult,
  type InterruptAccountabilityPlayer,
} from './analytics/seed/interruptAccountability.js';
export {
  computeClutchPlays,
  clutchPlays,
  type ClutchResult,
  type ClutchPlay,
  type ClutchCaster,
} from './analytics/seed/clutchPlays.js';
export {
  computeAvoidableDamage,
  avoidableDamage,
  type AvoidableDamageResult,
} from './analytics/seed/avoidableDamage.js';
export {
  computeDeathRecap,
  deathRecap,
  DEFAULT_DEATH_RECAP_PARAMS,
  type DeathRecapResult,
  type DeathRecapRow,
  type DefensiveStatus,
} from './analytics/seed/deathRecap.js';
export {
  AUTOPSY_WINDOW_MS,
  buildAutopsy,
  buildDangerDebuffIntervals,
  type DeathAutopsy,
  type AutopsyHpSample,
  type AutopsyEvent,
  type AutopsyInterval,
  type AutopsyDefensive,
  type AutopsyDebuff,
  type AutopsyMarker,
} from './analytics/seed/deathAutopsy.js';
export {
  computeRemoval,
  removal,
  type RemovalResult,
  type RemovalByDebuff,
  type RemovalByRemover,
  type HealThroughByDebuff,
} from './analytics/seed/removal.js';
export {
  discoverRemovals,
  type RemovalDiscovery,
  type DiscoveryReason,
} from './analytics/discovery.js';
// Custom metrics (#13) — user-defined window discovery (resources / auras / cooldowns / charges).
export {
  detectOwner,
  evaluateCustomMetrics,
  POWER_TYPES,
  type CustomMetricRule,
  type CustomMetricsReport,
  type MetricSubject,
  type MetricTarget,
  type MetricResult,
  type MetricWindow,
  type Comparator,
  type OwnerInfo,
} from './analytics/customMetrics.js';
// Custom-metric sharing + presets: template→rule conversion, paste-import, JSON export.
export {
  presetToRule,
  metricToSubject,
  describeSubject,
  normalizeTarget,
  normalizeSharedMetrics,
  exportSharedMetrics,
  SHARE_FORMAT,
  SHARE_VERSION,
  type PresetMetric,
  type MetricPreset,
  type MetricPresetLibrary,
  type ImportResult,
} from './analytics/customMetricsShare.js';

export { ParserClient, type ParseHandlers, type WindowEvents, type SearchResult } from './worker/client.js';
export type {
  WorkerRequest,
  WorkerResponse,
  ParsePhase,
  FullReport,
  RunReport,
  SegmentReport,
  EventMatch,
} from './worker/protocol.js';
export type { DecodedEvent, DecodedUnit, SideValue } from './columns/columnStore.js';

export { Bench, type PhaseTiming } from './bench/harness.js';
