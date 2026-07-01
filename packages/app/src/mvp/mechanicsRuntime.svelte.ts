// Runtime mechanics bundle for the app UI. The generated @wow/data/mechanics JSON is the offline
// baseline, then a configured backend can replace it on startup via GET /api/mechanics. Card/advice
// consumers read through this singleton so the Mechanics Library and detail overlay can update without
// an app release.

import bundledMechanics from '@wow/data/mechanics';
import type { MechanicAdvice, MechanicCard, MechanicsBundle } from '@wow/engine';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '');
const MECHANICS_URL = BACKEND_URL ? `${BACKEND_URL}/api/mechanics` : undefined;
const CACHE_KEY = 'wow.mechanicsBundle.v1';

type SeedSpellLite = { spellId?: number; npcName?: string; isBoss?: boolean };

interface CacheRecord {
  version: string;
  savedAt: number;
  bundle: MechanicsBundle;
}

function validBundle(v: unknown): v is MechanicsBundle {
  const b = v as Partial<MechanicsBundle> | null;
  return !!b && typeof b === 'object' && typeof b.version === 'string' && !!b.seed && !!b.overlay;
}

function loadCachedBundle(): MechanicsBundle | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as Partial<CacheRecord>;
    return rec.bundle && validBundle(rec.bundle) ? rec.bundle : null;
  } catch {
    return null;
  }
}

function saveCachedBundle(bundle: MechanicsBundle): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version: bundle.version, savedAt: Date.now(), bundle }));
  } catch {
    /* quota/private-mode failure: keep the in-memory live bundle */
  }
}

class MechanicsRuntime {
  bundle = $state<MechanicsBundle>(bundledMechanics as MechanicsBundle);
  status = $state<'bundled' | 'cached' | 'loading' | 'live' | 'offline'>('bundled');
  error = $state<string | null>(null);
  updatedAt = $state<number | null>(null);

  readonly configured = !!MECHANICS_URL;
  #initPromise: Promise<void> | null = null;
  #cardsBundle: MechanicsBundle | null = null;
  #cards: Record<string, MechanicCard> = {};
  #adviceBundle: MechanicsBundle | null = null;
  #advice: Record<string, MechanicAdvice> = {};

  init(): Promise<void> {
    if (this.#initPromise) return this.#initPromise;
    if (MECHANICS_URL) this.#applyCache();
    this.#initPromise = this.refresh();
    return this.#initPromise;
  }

  async refresh(): Promise<void> {
    if (!MECHANICS_URL) return;
    const previousStatus = this.status;
    this.status = previousStatus === 'cached' ? 'cached' : 'loading';
    this.error = null;

    try {
      const headers: Record<string, string> = {};
      if (this.bundle.version) headers['If-None-Match'] = `"${this.bundle.version}"`;
      const res = await fetch(MECHANICS_URL, { headers, cache: 'no-cache' });
      if (res.status === 304) {
        this.status = 'live';
        this.updatedAt = Date.now();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bundle = (await res.json()) as unknown;
      if (!validBundle(bundle)) throw new Error('invalid mechanics bundle');
      this.bundle = bundle;
      this.status = 'live';
      this.updatedAt = Date.now();
      saveCachedBundle(bundle);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.status = previousStatus === 'cached' || this.status === 'cached' ? 'cached' : 'offline';
    }
  }

  cardFor(spellId: number): MechanicCard | undefined {
    return this.#cardsFor(this.bundle)[String(spellId)];
  }

  allCards(): MechanicCard[] {
    return Object.values(this.#cardsFor(this.bundle));
  }

  adviceForCards(): Record<string, MechanicAdvice> {
    if (this.#adviceBundle === this.bundle) return this.#advice;
    const out: Record<string, MechanicAdvice> = {};
    for (const [id, card] of Object.entries(this.#cardsFor(this.bundle))) {
      const advice = card.advice;
      if (!advice || typeof advice !== 'object') continue;
      const entry: MechanicAdvice = {};
      for (const role of ['generic', 'tank', 'healer', 'dps'] as const) {
        const value = typeof advice[role] === 'string' ? advice[role]!.trim() : '';
        if (value) entry[role] = value;
      }
      if (Object.keys(entry).length) out[id] = entry;
    }
    this.#adviceBundle = this.bundle;
    this.#advice = out;
    return out;
  }

  #applyCache(): void {
    const cached = loadCachedBundle();
    if (!cached || cached.version === this.bundle.version) return;
    this.bundle = cached;
    this.status = 'cached';
  }

  #cardsFor(bundle: MechanicsBundle): Record<string, MechanicCard> {
    if (this.#cardsBundle === bundle) return this.#cards;
    const seedBySpell = new Map<number, SeedSpellLite>();
    for (const spell of (bundle.seed?.spells ?? []) as SeedSpellLite[]) {
      if (typeof spell.spellId === 'number') seedBySpell.set(spell.spellId, spell);
    }
    const cards = Object.fromEntries(
      Object.entries(bundle.cards ?? {}).map(([id, card]) => [id, this.#withSeedIdentity(id, card, seedBySpell)]),
    );
    this.#cardsBundle = bundle;
    this.#cards = cards;
    return cards;
  }

  #withSeedIdentity(id: string, card: MechanicCard, seedBySpell: Map<number, SeedSpellLite>): MechanicCard {
    const spellId = card.spellId ?? Number(id);
    const seed = seedBySpell.get(spellId);
    const out: MechanicCard = { ...card, spellId };
    if (!seed) return out;
    if (out.caster == null && seed.npcName) out.caster = seed.npcName;
    if (out.boss == null && seed.isBoss !== undefined) out.boss = seed.isBoss;
    return out;
  }
}

export const mechanicsRuntime = new MechanicsRuntime();
