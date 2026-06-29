// Run-stats sharing seam. When the user opts in (settings.shareStats), we POST a small, NAME-FREE
// summary of a finished run to the backend and get back COMPARISON FEEDBACK (how it stacks up vs the
// field for the same dungeon + key). No-op-with-error when no backend is configured — mirrors the
// bug-report / discovery seams. The whole log never leaves the browser; only these numbers do, and the
// owner's spec/personal numbers are omitted entirely when "anonymize" is on.
import type { RunReport, FullReport, DamageResult, HealingResult, DeathRecapResult, RosterEntry, AnalyticResult } from '@wow/engine';
import { classSpecOf } from '@wow/engine';
import { analytic, runResult } from './report.js';
import { runHash } from './runHash.js';
import { APP_VERSION } from '../version.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;

/** A player's output, keyed by spec (name-free). dps/hps are whole numbers. */
export interface PlayerStat {
  specId: number;
  className?: string;
  specName?: string;
  dps: number;
  hps?: number;
}

export interface EncounterSeq {
  name: string;
  startMs: number;
  endMs: number;
  players?: PlayerStat[];
}

export interface RunStatsPayload {
  runHash: string;
  dungeon: string;
  keyLevel: number;
  completed: boolean;
  timed: boolean;
  durationMs: number;
  deaths: number;
  raidDps: number;
  raidHps: number;
  ownerSpecId?: number;
  ownerDps?: number;
  ownerHps?: number;
  encounters?: EncounterSeq[];
  totalEvents?: number;
  players?: PlayerStat[];
  appVersion?: string;
}

export interface MetricCompare {
  you: number;
  median: number;
  sampleSize: number;
  betterThanPct: number;
}

export interface EncounterHeat {
  name: string;
  heat: number[];
  youStartMs: number;
  youEndMs: number;
  medianStartMs: number;
  medianDurationMs: number;
}

export interface EncounterComparison {
  sampleSize: number;
  buckets: number;
  bucketMs: number;
  axisMs: number;
  rows: EncounterHeat[];
}

export interface RunComparison {
  dungeon: string;
  keyLevel: number;
  sampleSize: number;
  duration: MetricCompare | null;
  deaths: { you: number; median: number; sampleSize: number } | null;
  raidDps: MetricCompare | null;
  raidHps: MetricCompare | null;
  spec: (MetricCompare & { specId: number }) | null;
  encounters: EncounterComparison | null;
}

export const runStatsEnabled = (): boolean => !!BACKEND_URL;

/** Read one analytic value out of a per-pull SegmentReport's results array. */
function fromResults<T>(results: AnalyticResult[], id: string): T | null {
  const r = results.find((a) => a.id === id);
  return r ? (r.value as T) : null;
}

/** Per-player output (name-free, spec-keyed) from a damage + healing result, mapping each meter row to
 *  its spec via the run roster's name→specId. Only real party members (those with a COMBATANT_INFO
 *  specId) are included; the name is used ONLY to join client-side and never leaves the browser. */
function playerStats(
  dmg: DamageResult | null,
  heal: HealingResult | null,
  specByName: Map<string, number>,
): PlayerStat[] {
  const hpsByName = new Map((heal?.bySource ?? []).map((r) => [r.name, r.hps]));
  const out: PlayerStat[] = [];
  const seen = new Set<string>();
  for (const r of dmg?.bySource ?? []) {
    const specId = specByName.get(r.name);
    if (specId === undefined) continue;
    seen.add(r.name);
    out.push({ specId, dps: Math.round(r.dps), hps: Math.round(hpsByName.get(r.name) ?? 0) });
  }
  // Players who only show in the healing meter (e.g. a healer with ~0 damage).
  for (const r of heal?.bySource ?? []) {
    if (seen.has(r.name)) continue;
    const specId = specByName.get(r.name);
    if (specId === undefined) continue;
    out.push({ specId, dps: 0, hps: Math.round(r.hps) });
  }
  return out;
}

/** Build the share payload from a run's analytics. `anonymize` strips the owner's spec/personal data.
 *  Returns null for runs not worth aggregating (synthetic / not actually completed). */
export function buildRunStatsPayload(
  runReport: RunReport,
  full: FullReport,
  anonymize: boolean,
): RunStatsPayload | null {
  const run = runReport.run;
  if (run.synthetic) return null;
  const { result } = runResult(run);
  if (result !== 'timed' && result !== 'over-time' && result !== 'completed') return null; // only finished keys

  const dmg = analytic<DamageResult>(runReport, 'dps.overall');
  const heal = analytic<HealingResult>(runReport, 'hps.overall');
  const recap = analytic<DeathRecapResult>(runReport, 'deaths.recap');

  // name → specId for this run's party (COMBATANT_INFO). Used ONLY client-side to spec-key the meters;
  // names never leave the browser.
  const specByName = new Map<string, number>();
  for (const r of runReport.roster as RosterEntry[]) if (r.name && r.specId !== undefined) specByName.set(r.name, r.specId);

  // Every player's run-total output, spec-keyed (+ class/spec names so the backend can aggregate by
  // spec without a spec table). Name-free, so shared regardless of the anonymize toggle.
  const players: PlayerStat[] = playerStats(dmg, heal, specByName).map((p) => {
    const cs = classSpecOf(p.specId);
    return cs ? { ...p, className: cs.className, specName: cs.specName } : p;
  });

  // Ordered boss engagements, timed RELATIVE to run start (run-level + name-free — shared even when
  // anonymized; the backend uses the order as the route signature for the timing heat map). Each also
  // carries per-player (spec-keyed) output during that encounter, for per-encounter DPS aggregates.
  const encounters: EncounterSeq[] = (runReport.segments ?? [])
    .filter((s) => s.segment.kind === 'encounter')
    .sort((a, b) => a.segment.startMs - b.segment.startMs)
    .map((s) => {
      const ePlayers = playerStats(
        fromResults<DamageResult>(s.results, 'dps.overall'),
        fromResults<HealingResult>(s.results, 'hps.overall'),
        specByName,
      );
      return {
        name: s.segment.name ?? 'Boss',
        startMs: s.segment.startMs - runReport.firstMs,
        endMs: s.segment.endMs - runReport.firstMs,
        ...(ePlayers.length ? { players: ePlayers } : {}),
      };
    });

  const payload: RunStatsPayload = {
    runHash: runHash(runReport),
    dungeon: run.dungeonName ?? 'Unknown',
    keyLevel: run.keystoneLevel ?? 0,
    completed: run.completed === true,
    timed: (run.chests ?? 0) >= 1,
    durationMs: run.completed && run.completionTimeMs ? run.completionTimeMs : run.durationMs,
    deaths: recap?.deaths.length ?? 0,
    raidDps: Math.round(dmg?.raidDps ?? 0),
    raidHps: Math.round(heal?.raidHps ?? 0),
    totalEvents: runReport.totalEvents,
    appVersion: APP_VERSION,
    ...(players.length ? { players } : {}),
    ...(encounters.length ? { encounters } : {}),
  };

  if (!anonymize && full.owner) {
    const owner = full.owner;
    const specId = (full.roster as RosterEntry[]).find((r) => r.guid === owner.guid)?.specId;
    const ownerDps = dmg?.bySource.find((r) => r.id === owner.unitId)?.dps;
    const ownerHps = heal?.bySource.find((r) => r.id === owner.unitId)?.hps;
    if (specId !== undefined) payload.ownerSpecId = specId;
    if (ownerDps && ownerDps > 0) payload.ownerDps = Math.round(ownerDps);
    if (ownerHps && ownerHps > 0) payload.ownerHps = Math.round(ownerHps);
  }

  return payload;
}

export async function submitRunStats(payload: RunStatsPayload): Promise<{ ok: boolean; comparison?: RunComparison; error?: string }> {
  if (!BACKEND_URL) return { ok: false, error: 'No backend configured (set VITE_BACKEND_URL).' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/run-stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { comparison?: RunComparison };
    return { ok: true, comparison: json.comparison };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
