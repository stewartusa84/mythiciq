// LFG (Groups) pilot client — the browser side of /api/lfg/*. Looking Cards → pool counts → Run Cards →
// broadcast → apply → lock → invite list. Mirrors comments.ts / groups.ts (auth headers, no-op-with-error
// when no backend is configured). The run-type config is mirrored from the backend (runTypes.ts) so the
// UI renders pickers + contract text without a round-trip; the backend's agreementVersion stays
// authoritative (the apply 409 carries the live agreement). Pool COUNTS are computed client-side from the
// pool list (instant feedback as a leader configures a run) via the shared match helper below.

import { auth } from './auth.svelte.js';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '');

export const RUN_TYPES = ['growth-vault', 'timed-completion', 'progression-push', 'route-lab'] as const;
export type RunType = (typeof RUN_TYPES)[number];

export const LFG_ROLES = ['tank', 'healer', 'dps', 'coach'] as const;
export type LfgRole = (typeof LFG_ROLES)[number];

/** Current-season M+ dungeon pool — a Run Card picks a CONCRETE dungeon from here (mirrors backend
 *  runTypes.ts `LFG_DUNGEONS`; edit when the season rotates). */
export const LFG_DUNGEONS = [
  'Skyreach',
  "Algeth'ar Academy",
  'Pit of Saron',
  'Windrunner Spire',
  "Magisters' Terrace",
  'Nexus-Point Xenas',
  'Maisara Caverns',
  'Seat of the Triumvirate',
] as const;

export const MIN_KEY_LEVEL = 2;
export const MAX_KEY_LEVEL = 99;

export interface RunTypeConfig {
  id: RunType;
  label: string;
  blurb: string;
  agreementVersion: number;
  agreement: string[];
}

/** Mirror of the backend runTypes.ts config (label/blurb/contract). Keep in sync; the backend version is
 *  authoritative for the social-contract gate. */
export const RUN_TYPE_CONFIG: Record<RunType, RunTypeConfig> = {
  'growth-vault': {
    id: 'growth-vault',
    label: 'Growth Vault',
    blurb: 'Completion/growth-oriented. Lower-geared players welcome; mechanics practice & review encouraged.',
    agreementVersion: 1,
    agreement: [
      'This is a growth run: completion and learning come before the timer.',
      'Lower-geared and less-experienced players are welcome here.',
      'Mistakes are expected and used for practice — keep feedback kind and constructive.',
      'Be patient, explain mechanics when asked, and assume good intent.',
    ],
  },
  'timed-completion': {
    id: 'timed-completion',
    label: 'Timed Completion',
    blurb: 'Complete within the timer for crests/vault. 2/3-star not required; clean, focused effort expected.',
    agreementVersion: 1,
    agreement: [
      'Goal: beat the timer for crests/vault — a clean +1 is a success.',
      'Come prepared (consumables, routes you know) and play with focus.',
      'Know your interrupts and major mechanics; avoid avoidable damage.',
      'Stay positive if it gets tight — no rage, no bailing mid-key.',
    ],
  },
  'progression-push': {
    id: 'progression-push',
    label: 'Progression Push',
    blurb: 'Score / key progression. The timer matters; higher execution expectations.',
    agreementVersion: 1,
    agreement: [
      'Goal: push score/keys — the timer and execution both matter.',
      'Bring near-optimal gear, talents, consumables, and route knowledge.',
      'Tight cooldown usage, kicks, and mechanic execution are expected.',
      'Communicate clearly and keep it constructive under pressure.',
    ],
  },
  'route-lab': {
    id: 'route-lab',
    label: 'Tech Lab',
    blurb: 'Route / pull / cooldown experimentation. Mistakes are data; the timer is secondary.',
    agreementVersion: 1,
    agreement: [
      'This is an experiment: we are testing routes, pulls, and cooldown timings.',
      'Wipes and mistakes are DATA, not failures — we learn from them.',
      'Expect to stop, discuss, and re-pull; the timer is secondary.',
      'Bring ideas and a willingness to try things that might not work.',
    ],
  },
};

export function runTypeLabel(t: RunType): string {
  return RUN_TYPE_CONFIG[t]?.label ?? t;
}

export type RunCardStatus = 'open' | 'locked' | 'cancelled';
export type ApplicationStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';
export type RoleCounts = Partial<Record<LfgRole, number>>;

// -- Characters (Groups is character-first) --
export const REGIONS = ['us', 'eu', 'kr', 'tw', 'cn'] as const;
export type Region = (typeof REGIONS)[number];

/** The public character snapshot embedded on cards/applications/roster (mirrors backend characters.ts). */
export interface CharacterRef {
  id: string;
  region: Region;
  realm: string;
  realmSlug: string;
  name: string;
  class: string;
  spec: string;
  ilvl?: number;
  avatar?: string;
  lastSyncedAt?: number;
  verified: boolean;
}

/** A stored character (the roster the picker manages). */
export interface Character extends CharacterRef {
  sub: string;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterInput {
  region: Region;
  realm: string;
  name: string;
  class: string;
  spec: string;
  ilvl?: number;
}

export interface LookingCard {
  id: string;
  sub: string;
  handle: string;
  characterId: string;
  character: CharacterRef;
  runType: RunType;
  roles: LfgRole[];
  keyMin?: number;
  keyMax?: number;
  /** Dungeons the player is open to running. Absent/empty ⇒ open to ANY dungeon. */
  dungeons?: string[];
  openToReview: boolean;
  openToLowerGeared: boolean;
  note?: string;
  createdAt: number;
  expiresAt: number;
}

export interface RosterEntry {
  sub: string;
  handle: string;
  role: LfgRole;
  character: CharacterRef;
}

export interface RunCard {
  id: string;
  ownerSub: string;
  ownerHandle?: string;
  runType: RunType;
  dungeon?: string;
  keyLevel?: number;
  neededRoles: RoleCounts;
  /** Optional minimum item level requirement (absent/0 ⇒ none). */
  minIlvl?: number;
  /** Optional minimum clean-run count, account-level (absent/0 ⇒ none). */
  minCleanRuns?: number;
  reviewOffered: boolean;
  lowerGearedWelcome: boolean;
  note?: string;
  status: RunCardStatus;
  broadcastAt?: number;
  roster: RosterEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface RunApplication {
  runCardId: string;
  sub: string;
  handle: string;
  role: LfgRole;
  characterId: string;
  character: CharacterRef;
  lookingCardId?: string;
  matchReason?: string;
  note?: string;
  status: ApplicationStatus;
  createdAt: number;
  updatedAt: number;
}

/** One group-chat message (mirrors backend chat.ts ChatMessage). */
export interface ChatMessage {
  id: string;
  runCardId: string;
  authorSub: string;
  authorHandle: string;
  body: string;
  createdAt: number;
}

/** The agreement (social contract) the backend returns on a gated apply (409). */
export interface AgreementChallenge {
  runType: RunType;
  label: string;
  agreementVersion: number;
  agreement: string[];
}

/** Result; `needsHandle` (set a display name first) / `agreement` (accept the contract first) drive the
 *  two pre-action prompts the UI surfaces from a 409. */
export type LfgResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; needsHandle?: boolean; agreement?: AgreementChallenge };

export function lfgConfigured(): boolean {
  return !!BACKEND_URL && auth.configured;
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error('signed out');
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<LfgResult<T>> {
  if (!BACKEND_URL) return { ok: false, error: 'no backend configured' };
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: await authHeaders(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 409) {
      const j = (await res.json().catch(() => ({}))) as { needsHandle?: boolean; needsAgreement?: boolean; error?: string } & Partial<AgreementChallenge>;
      const agreement = j.needsAgreement && j.runType ? { runType: j.runType, label: j.label ?? j.runType, agreementVersion: j.agreementVersion ?? 1, agreement: j.agreement ?? [] } : undefined;
      return { ok: false, error: j.error ?? 'conflict', needsHandle: j.needsHandle, agreement };
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: j.error ?? `${method} ${path} → ${res.status}` };
    }
    const value = (res.status === 204 ? undefined : await res.json()) as T;
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// -- Characters (the identity a Looking Card / application is made with) --
export function listCharacters(): Promise<LfgResult<{ characters: Character[] }>> {
  return call('GET', '/api/characters');
}
export function createCharacter(input: CharacterInput): Promise<LfgResult<Character>> {
  return call('POST', '/api/characters', input);
}
export function updateCharacter(id: string, input: CharacterInput): Promise<LfgResult<Character>> {
  return call('PUT', `/api/characters/${id}`, input);
}
export function deleteCharacter(id: string): Promise<LfgResult<{ deleted: string }>> {
  return call('DELETE', `/api/characters/${id}`);
}

// -- Armory (Battle.net) lookup: auto-fill a manual character from the WoW Armory --
export interface ArmoryRealm { name: string; slug: string; }
/** A character resolved from the Armory (preview before adding). */
export interface ArmoryCharacter {
  region: Region;
  realm: string;
  realmSlug: string;
  name: string;
  class: string;
  spec: string;
  ilvl?: number;
  avatar?: string;
}
/** Realm list for a region (for autocomplete). `configured:false` ⇒ no Armory creds → manual entry only. */
export function armoryRealms(region: Region): Promise<LfgResult<{ configured: boolean; realms: ArmoryRealm[] }>> {
  return call('GET', `/api/armory/realms?region=${region}`);
}
/** Preview a character from the Armory (no create). */
export function armoryLookup(region: Region, realm: string, name: string): Promise<LfgResult<{ character: ArmoryCharacter }>> {
  return call('GET', `/api/armory/character?region=${region}&realm=${encodeURIComponent(realm)}&name=${encodeURIComponent(name)}`);
}
/** Look up + add a character in one step (data resolved server-side, stamped lastSyncedAt). */
export function addCharacterFromArmory(region: Region, realm: string, name: string): Promise<LfgResult<Character>> {
  return call('POST', '/api/characters/lookup', { region, realm, name });
}

// -- Looking Cards (pool) --
export function listLooking(): Promise<LfgResult<{ mine: LookingCard[]; pool: LookingCard[]; mySub: string }>> {
  return call('GET', '/api/lfg/looking');
}
export function createLooking(input: {
  characterId: string;
  runType: RunType;
  roles: LfgRole[];
  keyMin?: number;
  keyMax?: number;
  dungeons?: string[];
  openToReview?: boolean;
  openToLowerGeared?: boolean;
  note?: string;
}): Promise<LfgResult<LookingCard>> {
  return call('POST', '/api/lfg/looking', input);
}
export function extendLooking(id: string): Promise<LfgResult<LookingCard>> {
  return call('POST', `/api/lfg/looking/${id}/extend`);
}
export function deleteLooking(id: string): Promise<LfgResult<{ deleted: string }>> {
  return call('DELETE', `/api/lfg/looking/${id}`);
}
// Extend ALL of my active Looking Cards a fresh TTL — the "yes, I'm still looking" action behind the
// inactivity prompt. Lists first (cards may have expired/changed since the caller last saw them), then
// extends each. Returns true only if every extend succeeded.
export async function extendMyLookingCards(): Promise<boolean> {
  const r = await listLooking();
  if (!r.ok) return false;
  if (r.value.mine.length === 0) return true;
  const results = await Promise.all(r.value.mine.map((c) => extendLooking(c.id)));
  return results.every((x) => x.ok);
}
// Drop ALL of my active Looking Cards now — the "no, leave the pool" action. Best-effort.
export async function dropMyLookingCards(): Promise<boolean> {
  const r = await listLooking();
  if (!r.ok) return false;
  const results = await Promise.all(r.value.mine.map((c) => deleteLooking(c.id)));
  return results.every((x) => x.ok);
}

// -- Run Cards (board) --
export function listRunCards(): Promise<LfgResult<{
  runCards: RunCard[];
  mySub: string;
  myApplications: Record<string, ApplicationStatus>;
  pendingByCard: Record<string, number>;
  inbox: { card: RunCard; reason: string }[];
}>> {
  return call('GET', '/api/lfg/run-cards');
}
export function createRunCard(input: {
  runType: RunType;
  dungeon?: string;
  keyLevel?: number;
  neededRoles: RoleCounts;
  /** Optional minimum item level requirement (0/undefined ⇒ none). */
  minIlvl?: number;
  /** Optional minimum clean-run count (0/undefined ⇒ none). */
  minCleanRuns?: number;
  /** The character the leader is bringing; `ownerRole` (its spec role) seeds them onto the roster. */
  characterId?: string;
  ownerRole?: LfgRole;
  reviewOffered?: boolean;
  lowerGearedWelcome?: boolean;
  note?: string;
}): Promise<LfgResult<RunCard>> {
  return call('POST', '/api/lfg/run-cards', input);
}
export function updateRunCard(
  id: string,
  patch: { dungeon?: string; keyLevel?: number; note?: string; status?: RunCardStatus; reviewOffered?: boolean; lowerGearedWelcome?: boolean; minIlvl?: number; minCleanRuns?: number },
): Promise<LfgResult<RunCard>> {
  return call('PUT', `/api/lfg/run-cards/${id}`, patch);
}
export function deleteRunCard(id: string): Promise<LfgResult<{ deleted: string }>> {
  return call('DELETE', `/api/lfg/run-cards/${id}`);
}
export function broadcastRunCard(id: string): Promise<LfgResult<{ card: RunCard; notified: number }>> {
  return call('POST', `/api/lfg/run-cards/${id}/broadcast`);
}

// -- Applications --
export function applyToRun(id: string, role: LfgRole, characterId?: string, note?: string): Promise<LfgResult<RunApplication>> {
  return call('POST', `/api/lfg/run-cards/${id}/apply`, { role, ...(characterId ? { characterId } : {}), ...(note ? { note } : {}) });
}
export function withdrawApplication(id: string): Promise<LfgResult<{ withdrawn: boolean }>> {
  return call('DELETE', `/api/lfg/run-cards/${id}/apply`);
}
export function listApplications(id: string): Promise<LfgResult<{ applications: RunApplication[] }>> {
  return call('GET', `/api/lfg/run-cards/${id}/applications`);
}
export function acceptApplication(id: string, sub: string): Promise<LfgResult<RunCard>> {
  return call('POST', `/api/lfg/run-cards/${id}/applications/${sub}/accept`);
}
export function declineApplication(id: string, sub: string): Promise<LfgResult<RunApplication>> {
  return call('POST', `/api/lfg/run-cards/${id}/applications/${sub}/decline`);
}
export function getInvite(id: string): Promise<LfgResult<{ invites: string[]; text: string; header: string }>> {
  return call('GET', `/api/lfg/run-cards/${id}/invite`);
}

// -- Social contract --
export function agreeToRunType(runType: RunType): Promise<LfgResult<{ runType: RunType; agreementVersion: number }>> {
  return call('POST', `/api/lfg/agreements/${runType}`);
}

// -- Clean runs (the LFG eligibility metric: timed runs with ≤1 owner mechanic failure) --
export interface CleanRunSubmission {
  runHash: string;
  timed: boolean;
  mechanicFailures: number;
  dungeon?: string;
  keyLevel?: number;
  characterName?: string;
}
/** The signed-in user's banked clean-run count (for the client-side apply gate + display). */
export function getCleanRunCount(): Promise<LfgResult<{ count: number }>> {
  return call('GET', '/api/lfg/clean-runs');
}
/** Self-report a run's clean result; the backend banks it only if it's clean (timed + within the cap). */
export function recordCleanRun(input: CleanRunSubmission): Promise<LfgResult<{ recorded: boolean; clean: boolean; count: number }>> {
  return call('POST', '/api/lfg/clean-runs', input);
}

// -- Shared matching + pool counts (client-side, mirrors backend cardMatchesRun) --
/** Does a Looking Card match a run's intent? Same run type, and the run's key (if set) within the card's
 *  open range. */
export function cardMatchesRun(card: LookingCard, run: { runType: RunType; keyLevel?: number; dungeon?: string }): boolean {
  if (card.runType !== run.runType) return false;
  if (run.keyLevel != null) {
    if (card.keyMin != null && run.keyLevel < card.keyMin) return false;
    if (card.keyMax != null && run.keyLevel > card.keyMax) return false;
  }
  if (run.dungeon && card.dungeons && card.dungeons.length > 0 && !card.dungeons.includes(run.dungeon)) return false;
  return true;
}

export interface PoolCounts {
  /** Role buckets dedupe by CHARACTER (a main tank + an alt dps from one user = two options; two cards
   *  for the same character don't double-count). */
  tank: number;
  healer: number;
  dps: number;
  coach: number;
  /** Unique matching CHARACTERS available. */
  characters: number;
  /** Unique matching PLAYERS (humans, deduped across their characters/cards). */
  players: number;
  /** Unique matching characters open to review. */
  openToReview: number;
  /** Unique matching characters ok with lower-geared groups. */
  openToLowerGeared: number;
}

/** Pool counts for a run configuration. Role buckets are deduped by CHARACTER id (so different characters
 *  from the same user appear as different options, but a player's multiple cards for one character don't
 *  inflate a role), with a separate unique-PLAYER count. A leader watches these update live as they
 *  configure a Run Card. `excludeSub` drops the leader's own cards. */
export function poolCounts(
  pool: LookingCard[],
  run: { runType: RunType; keyLevel?: number; dungeon?: string },
  excludeSub?: string,
): PoolCounts {
  const matching = pool.filter((c) => c.sub !== excludeSub && cardMatchesRun(c, run));
  const byRole: Record<LfgRole, Set<string>> = { tank: new Set(), healer: new Set(), dps: new Set(), coach: new Set() };
  const chars = new Set<string>();
  const players = new Set<string>();
  const review = new Set<string>();
  const lower = new Set<string>();
  for (const c of matching) {
    chars.add(c.characterId);
    players.add(c.sub);
    for (const r of c.roles) byRole[r]?.add(c.characterId);
    if (c.openToReview) review.add(c.characterId);
    if (c.openToLowerGeared) lower.add(c.characterId);
  }
  return {
    tank: byRole.tank.size,
    healer: byRole.healer.size,
    dps: byRole.dps.size,
    coach: byRole.coach.size,
    characters: chars.size,
    players: players.size,
    openToReview: review.size,
    openToLowerGeared: lower.size,
  };
}

/** Time-since (or "never") for a character's last armory sync — sync-freshness shown on applicants. */
export function syncFreshness(c: CharacterRef, now = Date.now()): string {
  if (!c.lastSyncedAt) return c.verified ? 'synced' : 'manual';
  const mins = Math.round((now - c.lastSyncedAt) / 60000);
  if (mins < 1) return 'just synced';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function minutesLeft(card: LookingCard, now = Date.now()): number {
  return Math.max(0, Math.round((card.expiresAt - now) / 60000));
}
