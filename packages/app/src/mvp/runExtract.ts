// Carve a single M+ run out of a whole-night combat log into a self-contained sub-log, and build the
// metadata row for the history list. The parse output gives each run's half-open line range
// (RunReport.run.startIdx/endIdx — event index === kept-line index), so we slice the original file
// across that range (via LineIndex) and drop everything else (world content, other keys). Field
// layout is decided per-line by field count, so a CHALLENGE_MODE_START..END slice parses on its own;
// we still prepend the log's COMBAT_LOG_VERSION header line for well-formedness.
import type { RunReport } from '@wow/engine';
import type { LineIndex } from '../lineIndex.js';
import { analytic } from './report.js';
import type { HistoryMeta } from './historyStore.js';

const enc = new TextEncoder();

/** Find the log's leading COMBAT_LOG_VERSION line (usually line 0) to prepend to each extracted run. */
async function headerBytes(lineIndex: LineIndex): Promise<Uint8Array> {
  const scan = Math.min(8, lineIndex.count);
  for (let i = 0; i < scan; i++) {
    const line = await lineIndex.line(i);
    if (line.includes('COMBAT_LOG_VERSION')) return enc.encode(line + '\n');
  }
  return new Uint8Array(0);
}

/**
 * Raw (uncompressed) bytes of one run as a standalone log: the COMBAT_LOG_VERSION header followed by
 * the run's contiguous line range. Caller gzips + stores the result.
 */
export async function extractRunLog(lineIndex: LineIndex, run: RunReport['run']): Promise<Uint8Array> {
  const header = await headerBytes(lineIndex);
  const body = await lineIndex.bytesForLines(run.startIdx, run.endIdx - 1);
  if (header.length === 0) return body;
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

/** Build the metadata row shown in the history list (no log blob needed to render it). */
export function buildHistoryMeta(report: RunReport, fileName: string): HistoryMeta {
  const run = report.run;
  const deaths = analytic<{ count: number }>(report, 'deaths')?.count ?? 0;
  const bosses = report.bosses;
  return {
    contentType: run.contentType,
    ...(run.dungeonName !== undefined ? { dungeonName: run.dungeonName } : {}),
    ...(run.keystoneLevel !== undefined ? { keystoneLevel: run.keystoneLevel } : {}),
    ...(run.completed !== undefined ? { completed: run.completed } : {}),
    ...(run.abandoned !== undefined ? { abandoned: run.abandoned } : {}),
    ...(run.chests !== undefined ? { chests: run.chests } : {}),
    ...(run.completionTimeMs !== undefined ? { completionTimeMs: run.completionTimeMs } : {}),
    // Raid session display fields.
    ...(run.instanceName !== undefined ? { instanceName: run.instanceName } : {}),
    ...(run.difficultyName !== undefined ? { difficultyName: run.difficultyName } : {}),
    ...(bosses !== undefined ? { bossesKilled: bosses.filter((b) => b.killed).length } : {}),
    ...(bosses !== undefined ? { bossesPulled: bosses.length } : {}),
    durationMs: run.durationMs,
    deaths,
    affixes: run.affixes ?? [],
    fileName,
  };
}
