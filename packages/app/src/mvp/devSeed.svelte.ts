// DEV-ONLY placeholder data for the Groups/LFG views. Lets us eyeball the Run Board + Looking Pool full
// of cards without standing up real runs. It is PURELY CLIENT-SIDE — these fakes are NEVER sent to the
// backend, so the real shared pool stays clean and there is nothing to delete in the cloud (clearing the
// store is the whole cleanup). Persisted to localStorage so a seed survives reloads.
//
// GroupsView merges `devSeed.cards` (board) and `devSeed.pool` (queue counts) into its view ONLY behind
// `import.meta.env.DEV`, so this never affects a production build. The DevPanel drives seed()/clear().
import {
  RUN_TYPES, LFG_DUNGEONS,
  type RunCard, type LookingCard, type RunType, type LfgRole, type RoleCounts,
  type RosterEntry, type CharacterRef, type Region,
} from './lfg.js';

const KEY = 'wow.devSeed.v1';

const HANDLES = [
  'MythicMike', 'Lunara', 'Gallywix', 'Rokhan', 'Velthra', 'BrewmasterBo', "Thal'garr", 'Silkweaver',
  'Pawsitive', 'Critlord', 'Hexxen', 'Moofasa', 'Zugzug', 'Healznoob', 'Tankenstein', 'Voidwhisper',
  'Pyreheart', 'Frostbyte', 'Shadowmeld', 'Bubblehearth',
];
const REALMS = ['Area-52', 'Tichondrius', 'Stormrage', 'Illidan', 'Sargeras', "Mal'Ganis", 'Frostmourne'];
// Class/spec by role so roster + pool chips render with real class colors / spec icons.
const SPECS: { class: string; spec: string; role: LfgRole }[] = [
  { class: 'Warrior', spec: 'Protection', role: 'tank' },
  { class: 'Death Knight', spec: 'Blood', role: 'tank' },
  { class: 'Demon Hunter', spec: 'Vengeance', role: 'tank' },
  { class: 'Druid', spec: 'Guardian', role: 'tank' },
  { class: 'Paladin', spec: 'Holy', role: 'healer' },
  { class: 'Priest', spec: 'Discipline', role: 'healer' },
  { class: 'Shaman', spec: 'Restoration', role: 'healer' },
  { class: 'Monk', spec: 'Mistweaver', role: 'healer' },
  { class: 'Mage', spec: 'Frost', role: 'dps' },
  { class: 'Warlock', spec: 'Destruction', role: 'dps' },
  { class: 'Hunter', spec: 'Marksmanship', role: 'dps' },
  { class: 'Rogue', spec: 'Assassination', role: 'dps' },
  { class: 'Evoker', spec: 'Devastation', role: 'dps' },
  { class: 'Paladin', spec: 'Retribution', role: 'dps' },
];

function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)]!;
}
function rint(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function fakeChar(role: LfgRole): CharacterRef {
  const opts = SPECS.filter((s) => s.role === role);
  const s = opts.length ? pick(opts) : pick(SPECS);
  const realm = pick(REALMS);
  return {
    id: `dev-${rid()}`,
    region: 'us' as Region,
    realm,
    realmSlug: realm.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: pick(HANDLES),
    class: s.class,
    spec: s.spec,
    ilvl: rint(600, 639),
    lastSyncedAt: Date.now() - rint(0, 720) * 60000,
    verified: Math.random() < 0.5,
  };
}

function fakeRunCard(): RunCard {
  const runType = pick(RUN_TYPES);
  const coach = Math.random() < 0.2;
  const neededRoles: RoleCounts = { tank: 1, healer: 1, dps: 3, ...(coach ? { coach: 1 } : {}) };
  const now = Date.now();
  // Partially fill the roster so the role-need chips show a mix of staffed/open.
  const roster: RosterEntry[] = [];
  const fill = (role: LfgRole, max: number) => {
    for (let i = 0, n = rint(0, max); i < n; i++) {
      const ch = fakeChar(role);
      roster.push({ sub: `dev-${rid()}`, handle: ch.name, role, character: ch });
    }
  };
  fill('tank', 1);
  fill('healer', 1);
  fill('dps', 3);
  if (coach) fill('coach', 1);
  return {
    id: `dev-${rid()}`,
    ownerSub: `dev-${rid()}`, // NOT you — so the card renders as someone else's (with an Apply button)
    ownerHandle: pick(HANDLES),
    runType,
    dungeon: pick(LFG_DUNGEONS),
    keyLevel: rint(2, 18),
    neededRoles,
    reviewOffered: Math.random() < 0.4,
    lowerGearedWelcome: runType === 'growth-vault' || Math.random() < 0.3,
    status: Math.random() < 0.15 ? 'locked' : 'open',
    ...(Math.random() < 0.5 ? { broadcastAt: now } : {}),
    roster,
    createdAt: now,
    updatedAt: now,
  };
}

function fakeLookingCard(runType: RunType, role: LfgRole): LookingCard {
  const ch = fakeChar(role);
  const now = Date.now();
  const keyMin = rint(2, 8);
  return {
    id: `dev-${rid()}`,
    sub: `dev-${rid()}`,
    handle: ch.name,
    characterId: ch.id,
    character: ch,
    runType,
    roles: [role],
    keyMin,
    keyMax: keyMin + rint(2, 12),
    openToReview: Math.random() < 0.5,
    openToLowerGeared: Math.random() < 0.5,
    createdAt: now,
    expiresAt: now + 30 * 60000,
  };
}

class DevSeed {
  cards = $state<RunCard[]>([]);
  pool = $state<LookingCard[]>([]);

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const j = JSON.parse(raw) as { cards?: RunCard[]; pool?: LookingCard[] };
        this.cards = j.cards ?? [];
        this.pool = j.pool ?? [];
      }
    } catch {
      /* ignore */
    }
  }

  /** Replace the placeholder set with a fresh batch (repeated presses don't pile up). */
  seed(runs = 11): void {
    const cards = Array.from({ length: runs }, fakeRunCard);
    const pool: LookingCard[] = [];
    for (const t of RUN_TYPES) {
      pool.push(fakeLookingCard(t, 'tank'), fakeLookingCard(t, 'tank'));
      pool.push(fakeLookingCard(t, 'healer'), fakeLookingCard(t, 'healer'));
      for (let i = 0, n = rint(3, 6); i < n; i++) pool.push(fakeLookingCard(t, 'dps'));
      if (Math.random() < 0.5) pool.push(fakeLookingCard(t, 'coach'));
    }
    this.cards = cards;
    this.pool = pool;
    this.persist();
  }

  clear(): void {
    this.cards = [];
    this.pool = [];
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ cards: this.cards, pool: this.pool }));
    } catch {
      /* ignore */
    }
  }
}

export const devSeed = new DevSeed();
