// Mechanic-edit submission seam. Posts a PROPOSED edit to a mechanic card (`POST /api/mechanic-edits`).
// The edit is never applied automatically — it lands in a backend review queue for a human to curate.
// No-op-with-error when no backend is configured, mirroring the bug-report / discovery-sync seams.
// Only the changed card fields (a minimal diff the editor builds) leave the browser.

import type { MechanicCard } from '@wow/engine';
import { APP_VERSION } from '../version.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;

/** The editable subset of a card a proposal may carry (the editor emits only changed fields). The
 *  classification fields accept `null` to mean "clear it" in a minimal diff. */
export type ProposedCard = Partial<
  Pick<MechanicCard, 'name' | 'caster' | 'boss' | 'summary' | 'advice' | 'videos' | 'tags' | 'confidence' | 'notes' | 'avoidable' | 'removableBy' | 'source' | 'sourceUrl'>
> & {
  interruptPriority?: 'dangerous' | 'regular' | null;
  dispelPriority?: 'dangerous' | 'regular' | null;
  danger?: 'dangerous' | 'regular' | null;
};

export interface MechanicEditResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** True when a backend is configured to receive proposed edits. */
export const mechanicEditsEnabled = (): boolean => !!BACKEND_URL;

export async function submitMechanicEdit(
  spellId: number,
  proposed: ProposedCard,
  opts: { dungeon?: string; note?: string } = {},
): Promise<MechanicEditResult> {
  if (!BACKEND_URL) return { ok: false, error: 'No backend configured (set VITE_BACKEND_URL).' };
  if (!proposed || Object.keys(proposed).length === 0) {
    return { ok: false, error: 'No changes to submit.' };
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/mechanic-edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spellId,
        proposed,
        dungeon: opts.dungeon,
        note: opts.note?.trim() || undefined,
        context: { appVersion: APP_VERSION, appUrl: location.href },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}${detail ? ` — ${detail}` : ''}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
