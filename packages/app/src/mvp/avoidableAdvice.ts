// "How to avoid" guidance for dangerous mechanics — shown in depth on the Mechanics tab and summarized
// on the Overview's "Rough patches" section. Layers, most-specific first:
//   1. MECHANIC_ADVICE — curated advice from the consolidated mechanic CARDS (one per mechanic under
//      packages/data/curation/mechanics/<dungeon>.json), shipped in the active mechanics bundle. The app
//      starts with @wow/data/mechanics and swaps in GET /api/mechanics through mechanicsRuntime when a
//      backend is configured. Each card's advice has a `generic` tip (shown to EVERYONE) plus optional
//      tank/healer/dps lines shown ADDITIVELY when that lens (or "All") is selected.
//   2. SPELL_ADVICE — a small per-spell archetype/tip override in code (authoritative when present).
//   3. an ARCHETYPE guessed from the ability NAME (best-effort fallback), else a generic tip.
// Heuristic by design: name-based archetypes are general guidance, not ground truth — the UI flags
// inferred tips as "by mechanic type". Curate the mechanic card to make a mechanic's advice authoritative.
// `cardFor(spellId)` exposes the FULL card (summary / videos / tags) for the upcoming learning-card UI.

import type { MechanicCard } from '@wow/engine';
import { mechanicsRuntime } from './mechanicsRuntime.svelte.js';

/** Whose-perspective the Mechanics tab is reading mechanics through. "all" shows every role's advice. */
export type Lens = 'tank' | 'healer' | 'dps' | 'all';
/** A single role's advice line, surfaced for the selected lens. */
export interface RoleAdvice {
  role: 'tank' | 'healer' | 'dps';
  text: string;
}

export interface MechanicAdvice {
  generic?: string;
  tank?: string;
  healer?: string;
  dps?: string;
}

export type AdviceArchetype =
  | 'frontal'
  | 'swirl'
  | 'ground'
  | 'beam'
  | 'nova'
  | 'charge'
  | 'projectile'
  | 'soak'
  | 'generic';

export interface AvoidableAdvice {
  archetype: AdviceArchetype;
  /** Short archetype name, e.g. "Frontal". */
  label: string;
  /** GENERIC advice, shown for everyone (curated `generic`, else the name-archetype/generic fallback). */
  tip: string;
  /** True when the advice is curated (advice JSON or SPELL_ADVICE); false when inferred from the name. */
  curated: boolean;
  /** Role-specific advice to show ADDITIVELY for the requested lens (empty when no lens / none curated). */
  roles: RoleAdvice[];
}

const ARCHETYPE: Record<AdviceArchetype, { label: string; tip: string }> = {
  frontal: {
    label: 'Frontal',
    tip: 'Fires in a cone along the caster’s facing — move to its side or behind it before the cast lands. Tanks: point it away from the group.',
  },
  swirl: {
    label: 'Swirl',
    tip: 'A telegraphed swirl on the ground — step off the marker before it detonates.',
  },
  ground: {
    label: 'Ground pool',
    tip: 'Don’t stand in the pool/zone, and don’t drop it on the group — reposition to clean ground.',
  },
  beam: {
    label: 'Beam / line',
    tip: 'Fires in a straight line (or sweeps) — sidestep out of its path.',
  },
  nova: {
    label: 'Nova',
    tip: 'Hits everyone near the caster — run out of range before it goes off.',
  },
  charge: {
    label: 'Charge',
    tip: 'Travels in a line toward a target — sidestep the path and don’t stand between the caster and its target.',
  },
  projectile: {
    label: 'Targeted',
    tip: 'Lands on targeted players — spread out and move off the marked area before impact.',
  },
  soak: {
    label: 'Soak',
    tip: 'Meant to be SHARED — group up (or send the assigned soakers) so the hit is split, with a defensive if it’s heavy.',
  },
  generic: {
    label: 'Avoidable',
    tip: 'Telegraphed, avoidable damage — sidestep it, or pre-plan a personal defensive if you can’t move. Repeated hits here are a common run-ender.',
  },
};

// Name → archetype (best-effort, conservative). First match wins; ordered most-distinctive first.
// Kept deliberately tight so we don't hand out confidently-wrong specifics — anything unmatched falls
// back to the honest generic tip.
const NAME_HINTS: { re: RegExp; a: AdviceArchetype }[] = [
  { re: /frontal|\bcone\b|breath|exhale|\bgaze\b/i, a: 'frontal' },
  { re: /\bbeam\b|\bray\b|lance|laser|lens flare|\bline\b|sweep/i, a: 'beam' },
  { re: /\bnova\b|shock ?wave|detonation|\bpulse\b/i, a: 'nova' },
  { re: /charge|trample|barrel|\brush\b|\bleap\b/i, a: 'charge' },
  { re: /\brain\b|barrage|volley|meteor|bombard|chakram|\bhail\b|shrapnel/i, a: 'projectile' },
  { re: /\bpool\b|puddle|patch|sludge|\btar\b|caustic|quills|residue/i, a: 'ground' },
  { re: /\bsoak\b|\bshare\b/i, a: 'soak' },
];

// Per-spell curated overrides (spellId → archetype + bespoke tip). Authoritative when present.
// Empty to start — add entries as we confirm specific Midnight dungeon mechanics.
const SPELL_ADVICE: Record<number, { a: AdviceArchetype; tip: string }> = {};

/** The full consolidated card for a mechanic (summary / advice / videos / tags), or undefined. */
export function cardFor(spellId: number): MechanicCard | undefined {
  return mechanicsRuntime.cardFor(spellId);
}

/** Every curated mechanic card (for the library browser). */
export function allCards(): MechanicCard[] {
  return mechanicsRuntime.allCards();
}

export function mechanicAdvice(): Record<string, MechanicAdvice> {
  return mechanicsRuntime.adviceForCards();
}

/** The archetype label for a spell (curated SPELL_ADVICE override → name hint → generic) — used as the
 *  category chip even when the TIP text comes from the curated tips file. */
function archetypeOf(spellId: number, name?: string): AdviceArchetype {
  const c = SPELL_ADVICE[spellId];
  if (c) return c.a;
  if (name) {
    for (const h of NAME_HINTS) if (h.re.test(name)) return h.a;
  }
  return 'generic';
}

const ROLE_ORDER: ('tank' | 'healer' | 'dps')[] = ['tank', 'healer', 'dps'];

export function adviceFor(spellId: number, name?: string, lens?: Lens): AvoidableAdvice {
  const archetype = archetypeOf(spellId, name);
  const label = ARCHETYPE[archetype].label;
  const entry = mechanicAdvice()[String(spellId)];
  const code = SPELL_ADVICE[spellId];

  // Generic advice (shown to everyone): curated generic → in-code override → name-archetype/generic.
  const tip = entry?.generic ?? code?.tip ?? ARCHETYPE[archetype].tip;
  const curated = Boolean(entry?.generic || code);

  // Role-specific advice for the selected lens (additive). No lens ⇒ generic only (e.g. Overview).
  const roles: RoleAdvice[] = [];
  if (entry && lens) {
    const wanted = lens === 'all' ? ROLE_ORDER : [lens];
    for (const r of wanted) {
      const text = entry[r];
      if (text) roles.push({ role: r, text });
    }
  }

  return { archetype, label, tip, curated, roles };
}
