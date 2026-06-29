// A stable identifier for a specific run instance — used as the localStorage key for the user's
// status override (mark-abandoned) AND as the dedup key when sharing run stats with the backend. It's
// derived purely from run METADATA + the run's time window, so it's identical across reloads of the
// same log but distinct per actual run (a different night, a different key). It carries NO player
// names — just a hash, so it's safe to send.
import type { RunReport } from '@wow/engine';

/** FNV-1a 32-bit → 8-char hex. Tiny, dependency-free, stable. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function runHash(report: RunReport): string {
  const r = report.run;
  return fnv1a(
    [
      r.contentType ?? '',
      r.dungeonName ?? '',
      r.mapId ?? '',
      r.challengeModeId ?? '',
      r.keystoneLevel ?? '',
      // Raid-session identity (distinct from a synthetic dungeon with the same time window).
      r.instanceId ?? '',
      r.instanceName ?? '',
      r.difficultyId ?? '',
      report.firstMs,
      report.lastMs,
    ].join('|'),
  );
}
