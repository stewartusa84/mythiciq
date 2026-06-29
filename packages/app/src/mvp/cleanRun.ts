// Clean-run computation (client-side) — turns a parsed run into the self-reported clean-run signal the
// Groups eligibility gate uses. A clean run = TIMED (beat the dungeon timer) AND the OWNING player had at
// most a small number of "mechanic failures". The whole log stays in the browser; only the resulting
// `{ timed, mechanicFailures }` (+ a name-free run hash) is sent to the backend, which applies the cap (so
// the threshold is authoritative server-side — see backend cleanRuns.ts).
//
// The mechanic-failure definition is DELIBERATELY EXTENSIBLE (the set "still needs to be defined"). v1
// counts the owner's DEATHS — the least ambiguous failure. Add more signals (standing in avoidable damage
// past a threshold, letting a dangerous cast you could kick go off, …) inside `countMechanicFailures`; the
// rest of the pipeline (submission, gate, display) doesn't change.
import type { RunReport, FullReport, DeathRecapResult } from '@wow/engine';
import { analytic, runResult } from './report.js';
import { runHash } from './runHash.js';
import type { CleanRunSubmission } from './lfg.js';

/** Count the owning player's mechanic failures in a run. EXTENSION POINT — add failure signals here. */
export function countMechanicFailures(runReport: RunReport, ownerUnitId: number): number {
  let failures = 0;
  // (1) Deaths — an owner death is an unambiguous mechanic failure.
  const recap = analytic<DeathRecapResult>(runReport, 'deaths.recap');
  if (recap) failures += recap.deaths.filter((d) => d.actorId === ownerUnitId).length;
  // (2+) TODO: avoidable-damage instances over a per-mechanic threshold, missed dangerous kicks, etc.
  return failures;
}

/** Build the clean-run submission for a single run, or null when it doesn't apply (synthetic / unfinished
 *  / no detectable owner). Note: NON-timed runs are still returned (timed:false) so the backend can record
 *  the attempt as not-clean if it wants — but in practice only timed runs ever bank. */
export function buildCleanRunSubmission(runReport: RunReport, full: FullReport): CleanRunSubmission | null {
  const run = runReport.run;
  if (run.synthetic) return null;
  const { result } = runResult(run);
  // Only finished keys are meaningful; an in-progress / abandoned run can't be clean.
  if (result !== 'timed' && result !== 'over-time' && result !== 'completed') return null;
  if (!full.owner) return null;

  return {
    runHash: runHash(runReport),
    timed: result === 'timed',
    mechanicFailures: countMechanicFailures(runReport, full.owner.unitId),
    ...(run.dungeonName ? { dungeon: run.dungeonName } : {}),
    ...(run.keystoneLevel != null ? { keyLevel: run.keystoneLevel } : {}),
    ...(full.owner.name ? { characterName: full.owner.name } : {}),
  };
}
