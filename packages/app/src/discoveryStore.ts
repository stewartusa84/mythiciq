import type { RemovalDiscovery } from '@wow/engine';
import { APP_VERSION } from './version.js';

// Local store for removal discoveries (removals the curated table can't explain). "Store locally
// for now" = localStorage, deduped/accumulated across runs by remover:removed. The `syncToBackend`
// seam is where these will later be POSTed so the curated table can grow from real logs.

const KEY = 'wow.removalDiscoveries.v1';

export interface StoredDiscovery extends RemovalDiscovery {
  /** How many separate parsed logs this interaction has appeared in. */
  seenInRuns: number;
  /** Epoch ms when first recorded locally. */
  recordedAt: number;
}

function load(): Record<string, StoredDiscovery> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredDiscovery>) : {};
  } catch {
    return {};
  }
}

function save(map: Record<string, StoredDiscovery>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota / unavailable — best-effort local cache */
  }
}

/** Merge a run's discoveries into the local store, accumulating occurrences. Returns the full set. */
export function recordDiscoveries(discoveries: RemovalDiscovery[]): StoredDiscovery[] {
  const map = load();
  const now = Date.now();
  for (const d of discoveries) {
    const key = `${d.removerSpellId}:${d.removedSpellId}`;
    const existing = map[key];
    if (existing) {
      existing.occurrences += d.occurrences;
      existing.seenInRuns += 1;
      existing.lastMs = d.lastMs;
      existing.reason = d.reason; // latest classification wins (table may have changed)
    } else {
      map[key] = { ...d, seenInRuns: 1, recordedAt: now };
    }
  }
  save(map);
  return getAllDiscoveries();
}

export function getAllDiscoveries(): StoredDiscovery[] {
  return Object.values(load()).sort((a, b) => b.occurrences - a.occurrences);
}

export function clearDiscoveries(): void {
  save({});
}

/** Backend base URL (e.g. http://localhost:8787). Unset ⇒ sync is a no-op (local-only). */
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;

export interface SyncResult {
  /** false when no backend is configured (VITE_BACKEND_URL unset) or the POST failed. */
  sent: boolean;
  promoted?: number;
  bundleVersion?: string;
  error?: string;
}

/**
 * POST one parse run's discoveries to the backend, tagged with a per-run id so the server counts
 * DISTINCT logs (it auto-promotes a discovery into the curated removers once it has appeared in >=2
 * runs). The local store stays the client-side source of truth; this is fire-and-forget enrichment.
 * No-op (sent:false) when no backend is configured, so the inspector works fully offline.
 */
export async function syncToBackend(runId: string, discoveries: RemovalDiscovery[]): Promise<SyncResult> {
  if (!BACKEND_URL || discoveries.length === 0) return { sent: false };
  try {
    const res = await fetch(`${BACKEND_URL}/api/removal-discoveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, discoveries, appVersion: APP_VERSION }),
    });
    if (!res.ok) return { sent: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { promoted?: unknown[]; bundleVersion?: string };
    return { sent: true, promoted: json.promoted?.length ?? 0, bundleVersion: json.bundleVersion };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}
