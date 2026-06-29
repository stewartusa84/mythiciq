// Shared helpers for the MVP analyzer: typed lookup of an analytic result out of a RunReport, and
// run-label / time formatting. The engine returns analytics as an untyped `{ id, value }[]`; the MVP
// panels know which id they want and the result shape, so we cast at this single seam.
import type { RunReport, DamageResult, HealingResult } from '@wow/engine';

/** Find one analytic's value in a run's overall results, cast to the caller's expected shape. */
export function analytic<T>(report: RunReport, id: string): T | null {
  const r = report.overall.find((a) => a.id === id);
  return r ? (r.value as T) : null;
}

/** Names of players who actually participated in THIS run (dealt damage or healing). The roster spans
 *  the WHOLE log (every key in the file), so run-scoped praise/blame — "took zero avoidable damage" —
 *  must be limited to players who were in this run, not everyone who appeared all night. */
export function runParticipants(report: RunReport): Set<string> {
  const names = new Set<string>();
  for (const r of analytic<DamageResult>(report, 'dps.overall')?.bySource ?? []) if (r.dps > 0) names.add(r.name);
  for (const r of analytic<HealingResult>(report, 'hps.overall')?.bySource ?? []) if (r.hps > 0) names.add(r.name);
  return names;
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type RunResult = 'timed' | 'over-time' | 'completed' | 'abandoned' | 'in-progress';

/** Resolve a run's display status + star tier. `overrideAbandoned` lets the user force a stuck
 *  "in progress" run (a re-rolled key with no END) to "abandoned" — see runStatus.svelte.ts. */
export function runResult(run: RunReport['run'], overrideAbandoned = false): { result: RunResult; stars: number } {
  const stars = run.chests ?? 0;
  let result: RunResult;
  if (overrideAbandoned || run.abandoned || run.completed === false) result = 'abandoned';
  else if (run.completed) result = run.chests === undefined ? 'completed' : run.chests >= 1 ? 'timed' : 'over-time';
  else result = 'in-progress';
  return { result, stars };
}

/** Human label for a run's outcome (shared by the run-completion notification + anywhere else that needs
 *  words rather than the ✓/✗ glyphs). Note "timed" (within the dungeon timer) ≠ "completed" (boss killed
 *  but over time) — `success` alone can't tell them apart; this reads `runResult`'s richer verdict. */
export function resultLabel(result: RunResult, stars = 0): string {
  switch (result) {
    case 'timed':
      return stars > 0 ? `Timed ${'★'.repeat(stars)}` : 'Timed';
    case 'over-time':
      return 'Over time';
    case 'completed':
      return 'Completed';
    case 'abandoned':
      return 'Abandoned';
    case 'in-progress':
      return 'In progress';
  }
}

/** Session-level read of a raid run: instance/difficulty + bosses killed / pulled. Null for non-raid. */
export interface RaidSummary {
  instanceName: string;
  difficultyName?: string;
  killed: number;
  pulled: number;
}
export function raidSummary(report: RunReport): RaidSummary | null {
  if (report.run.contentType !== 'raid') return null;
  const bosses = report.bosses ?? [];
  return {
    instanceName: report.run.instanceName ?? 'Raid',
    ...(report.run.difficultyName ? { difficultyName: report.run.difficultyName } : {}),
    killed: bosses.filter((b) => b.killed).length,
    pulled: bosses.length,
  };
}

/** Compact label for the run selector, e.g. "Ara-Kara +12 · ✓ · 28:14" (M+) or
 *  "Liberation of Undermine (Heroic) · 5/8 · 1:42:10" (raid). */
export function runLabel(r: RunReport, i: number): string {
  const run = r.run;
  if (run.contentType === 'raid') {
    const rs = raidSummary(r)!;
    const diff = rs.difficultyName ? ` (${rs.difficultyName})` : '';
    return `${rs.instanceName}${diff} · ${rs.killed}/${rs.pulled} · ${mmss(run.durationMs)}`;
  }
  const name = run.dungeonName ?? (run.synthetic ? 'Whole log' : `Run ${i + 1}`);
  const key = run.keystoneLevel ? ` +${run.keystoneLevel}` : '';
  const outcome = run.completed === undefined ? '' : run.completed ? ' · ✓' : ' · ✗';
  const dur = mmss(run.completionTimeMs ?? run.durationMs);
  return `${name}${key}${run.synthetic ? '' : outcome} · ${dur}`;
}

/** Human-readable large numbers: 12300000 → "12.3M", 4500 → "4.5K". */
export function abbrev(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
