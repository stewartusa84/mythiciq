import { ColumnStore } from '../columns/columnStore.js';
import type { DungeonEnemies } from './enemyFacts.js';

export type SegmentKind = 'encounter' | 'trash';

/** One enemy npc-type engaged in a trash pull. `name`/`count` are filled by MDT enrichment. */
export interface PullEnemy {
  npcId: number;
  /** Distinct enemy GUIDs of this npc the players damaged. */
  engaged: number;
  /** ...that subsequently died (the kill-weighted enemy-forces basis). */
  killed: number;
  name?: string;
  /** MDT enemy-forces value per mob (0 for adds/bosses). */
  count?: number;
}

/** MDT enrichment summary for a trash pull (filled by `enrichSegment`).
 *  Note: MDT pack identity (which specific group `g` was pulled) is intentionally NOT surfaced — an
 *  npcId maps to ALL packs it appears in map-wide, so it can't be disambiguated without matching the
 *  log's spawn positions to MDT clone coordinates (a deferred per-map calibration). */
export interface PullMdt {
  /** Kill-weighted enemy-forces this pull contributed (Σ killed × count). */
  forces: number;
  /** Dungeon enemy-forces total (the % denominator). */
  forcesTotal: number;
  /** True when the pull engaged boss-encounter npcs (e.g. construct adds) — not a real trash pack. */
  bossArea: boolean;
  /** Human label: the top engaged mob names. */
  title: string;
}

export interface Segment {
  index: number;
  kind: SegmentKind;
  /** half-open event range [startIdx, endIdx) into the columns */
  startIdx: number;
  endIdx: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  // encounter-only metadata
  encounterId?: number;
  name?: string;
  success?: boolean;
  /** Encounter difficultyId (ENCOUNTER_START field 3) — raid 14/15/16/17, M+ 8. */
  difficultyId?: number;
  // trash-pull engagement (filled by the segmenter)
  /** Distinct enemy npc types engaged, busiest first. */
  enemies?: PullEnemy[];
  /** Total distinct enemy GUIDs engaged in the pull. */
  mobCount?: number;
  // MDT enrichment (filled by enrichSegment when dungeon facts are available)
  mdt?: PullMdt;
}

export interface SegmentOptions {
  /** A gap larger than this (ms) with NO player↔enemy damage splits a trash pull. */
  damageGapMs?: number;
  /** Drop trash pulls shorter than this (ms) as idle noise. */
  minTrashMs?: number;
}

/** Damage event types that mark a player↔enemy exchange (the pull-activity signal). */
const DAMAGE_EVENTS = [
  'SPELL_DAMAGE',
  'SPELL_PERIODIC_DAMAGE',
  'RANGE_DAMAGE',
  'SWING_DAMAGE_LANDED',
  'SWING_DAMAGE',
  'SPELL_BUILDING_DAMAGE',
  'DAMAGE_SPLIT',
];

/**
 * Segment a log into M+ pulls:
 *   * `ENCOUNTER_START` .. `ENCOUNTER_END` become `encounter` segments (boss pulls).
 *   * Trash is detected from **player↔enemy damage activity**: a pull spans contiguous damage,
 *     splitting only when no player-vs-enemy damage lands for `damageGapMs`. (This is far more
 *     accurate than gapping on ALL events, which never lulls — HoTs/pets/buffs tick constantly —
 *     so adjacent packs used to merge into one long "pull".) Each trash pull records which enemy
 *     npcs were engaged (and how many died) so MDT enrichment can name it + score enemy-forces.
 *
 * Enemy = the HOSTILE unit on a damage event (reaction flag 0x40), so friendly player guardians
 * (Creature- pets) are excluded. npcId is parsed from the GUID (`Creature-…-<npcId>-<spawn>`).
 */
export function segment(store: ColumnStore, opts: SegmentOptions = {}): Segment[] {
  const damageGapMs = opts.damageGapMs ?? 3500;
  const minTrashMs = opts.minTrashMs ?? 3_000;
  const { ts, eventType, count } = store;
  const encounterStart = store.eventTypeId('ENCOUNTER_START');
  const encounterEnd = store.eventTypeId('ENCOUNTER_END');
  const diedId = store.eventTypeId('UNIT_DIED');
  const damageIds = new Set(
    DAMAGE_EVENTS.map((n) => store.eventTypeId(n)).filter((x): x is number => x !== undefined),
  );

  // Memoized npcId per enemy GUID id (string parse once per distinct guid).
  const npcCache = new Map<number, number | null>();
  const npcOf = (guidId: number): number | undefined => {
    let v = npcCache.get(guidId);
    if (v === undefined) {
      const s = store.str(guidId);
      let n: number | null = null;
      if (s.startsWith('Creature-') || s.startsWith('Vehicle-')) {
        const p = s.split('-');
        if (p.length >= 6) {
          const x = Number(p[5]);
          if (Number.isFinite(x)) n = x;
        }
      }
      npcCache.set(guidId, n);
      v = n;
    }
    return v ?? undefined;
  };
  const isHostile = (flags: number | null): boolean => flags != null && (flags & 0xf0) === 0x40;

  interface TrashAccum {
    startIdx: number;
    lastIdx: number;
    startMs: number;
    lastDmgMs: number;
    guids: Set<number>; // distinct enemy guid ids engaged
    guidNpc: Map<number, number>; // guid id -> npcId
    killed: Set<number>; // guid ids that died
  }

  const segments: Segment[] = []; // pushed in occurrence order; index reassigned at the end
  const lastPullByGuid = new Map<number, TrashAccum>(); // for attributing deaths to the engaging pull
  let pull: TrashAccum | null = null;

  const flushPull = () => {
    if (!pull) return;
    const duration = pull.lastDmgMs - pull.startMs;
    if (pull.guids.size > 0 && duration >= minTrashMs) {
      // Aggregate per-npc engaged/killed counts.
      const byNpc = new Map<number, { engaged: number; killed: number }>();
      for (const g of pull.guids) {
        const npc = pull.guidNpc.get(g)!;
        const e = byNpc.get(npc) ?? { engaged: 0, killed: 0 };
        e.engaged++;
        if (pull.killed.has(g)) e.killed++;
        byNpc.set(npc, e);
      }
      const enemies: PullEnemy[] = [...byNpc.entries()]
        .map(([npcId, e]) => ({ npcId, engaged: e.engaged, killed: e.killed }))
        .sort((a, b) => b.engaged - a.engaged || a.npcId - b.npcId);
      segments.push({
        index: 0,
        kind: 'trash',
        startIdx: pull.startIdx,
        endIdx: pull.lastIdx + 1,
        startMs: pull.startMs,
        endMs: pull.lastDmgMs,
        durationMs: duration,
        enemies,
        mobCount: pull.guids.size,
      });
    }
    pull = null;
  };

  for (let i = 0; i < count; i++) {
    const et = eventType[i]!;
    const t = ts[i]!;

    if (encounterStart !== undefined && et === encounterStart) {
      flushPull();
      const encounterId = numOr(store.detail(i, 'encounterId'));
      const name = strOr(store.detail(i, 'encounterName'));
      const difficultyId = numOr(store.detail(i, 'difficultyId'));
      const startIdx = i;
      const startMs = t;
      let j = i + 1;
      let success: boolean | undefined;
      let endMs = t;
      while (j < count) {
        endMs = ts[j]!;
        if (encounterEnd !== undefined && eventType[j]! === encounterEnd) {
          const s = store.detail(j, 'success');
          success = typeof s === 'boolean' ? s : s === 1;
          j++;
          break;
        }
        j++;
      }
      segments.push({
        index: 0,
        kind: 'encounter',
        startIdx,
        endIdx: j,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        ...(encounterId !== undefined ? { encounterId } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(success !== undefined ? { success } : {}),
        ...(difficultyId !== undefined ? { difficultyId } : {}),
      });
      i = j - 1;
      continue;
    }

    if (diedId !== undefined && et === diedId) {
      const tgt = store.targetGuid[i]!;
      const p = lastPullByGuid.get(tgt);
      if (p) p.killed.add(tgt);
      continue;
    }

    if (!damageIds.has(et)) continue;

    // Identify the hostile enemy (the side with the hostile reaction flag).
    const sGuid = store.sourceGuid[i]!;
    const tGuid = store.targetGuid[i]!;
    const sHostile = isHostile(store.sourceFlagsNum(i));
    const tHostile = isHostile(store.targetFlagsNum(i));
    let enemyGuid = 0;
    if (tHostile && !sHostile) enemyGuid = tGuid;
    else if (sHostile && !tHostile) enemyGuid = sGuid;
    else continue;
    const npc = npcOf(enemyGuid);
    if (npc === undefined) continue;

    if (!pull || t - pull.lastDmgMs > damageGapMs) {
      flushPull();
      pull = { startIdx: i, lastIdx: i, startMs: t, lastDmgMs: t, guids: new Set(), guidNpc: new Map(), killed: new Set() };
    }
    pull.lastIdx = i;
    pull.lastDmgMs = t;
    if (!pull.guids.has(enemyGuid)) {
      pull.guids.add(enemyGuid);
      pull.guidNpc.set(enemyGuid, npc);
    }
    lastPullByGuid.set(enemyGuid, pull);
  }

  flushPull();

  segments.sort((a, b) => a.startIdx - b.startIdx);
  segments.forEach((s, idx) => (s.index = idx));
  return segments;
}

/**
 * Enrich a trash pull in place with MDT facts: name each engaged npc, weight enemy-forces by KILLED
 * mobs (Σ killed × count), union pack groups, and flag combined-pack / boss-area pulls. No-op for
 * encounters or when no dungeon facts are available. Returns the same segment for chaining.
 */
export function enrichSegment(seg: Segment, dungeon: DungeonEnemies | undefined): Segment {
  if (seg.kind !== 'trash' || !seg.enemies) return seg;
  let forces = 0;
  let bossArea = false;
  for (const e of seg.enemies) {
    const fact = dungeon?.enemies[String(e.npcId)];
    if (fact) {
      e.name = fact.name;
      e.count = fact.count;
      forces += e.killed * fact.count;
      if (fact.encounterID !== undefined) bossArea = true;
    }
  }
  // Label: the top engaged mobs by name (fall back to npc id), e.g. "Soaring Chakram Master ×3".
  const named = seg.enemies.filter((e) => e.name);
  const labelSrc = named.length ? named : seg.enemies;
  const title = labelSrc
    .slice(0, 3)
    .map((e) => `${e.name ?? `npc ${e.npcId}`}${e.engaged > 1 ? ` ×${e.engaged}` : ''}`)
    .join(', ') + (labelSrc.length > 3 ? ', …' : '');
  seg.mdt = {
    forces,
    forcesTotal: dungeon?.totalCount ?? 0,
    bossArea,
    title,
  };
  return seg;
}

function numOr(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function strOr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
