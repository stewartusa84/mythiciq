<!-- Groups main window — the LFG pilot. The whole loop on one page:
       1. LOOKING POOL — you publish "Looking Cards" (what you're open to running: run type, key range,
          roles, flags). Multiple at once; each expires in 30 min unless extended. The pool shows who's
          looking, bucketed by run type + role.
       2. CREATE RUN — a leader configures a Run Card (run type, dungeon/key, needed roles, flags) and
          watches the MATCHING POOL COUNTS update live (unique players by role + open-to-review /
          open-to-lower-geared).
       3. RUN BOARD — open/locked Run Cards. Broadcast notifies matching players (inbox + sound); players
          APPLY (gated, the first time per run type, by a short social contract); the leader accepts →
          roster, LOCKS, and copies the generated INVITE LIST.
     Backend: /api/lfg/* (see docs/group-coordination.md). All authed; a display handle is required first
     (the same 409 gate as comments). Enabled upstream by FLAGS.groups. No automatic
     matchmaking, no automated WoW invites — this is the coordination layer only. -->
<script lang="ts">
  import { auth } from './auth.svelte.js';
  import { playSound } from './sound.js';
  import { blizzardLink } from './blizzardLink.svelte.js';
  import CharacterPicker from './CharacterPicker.svelte';
  import { CLASS_COLOR } from './specVisuals.js';
  import {
    listLooking, createLooking, extendLooking, deleteLooking, listCharacters,
    listRunCards, createRunCard, updateRunCard, deleteRunCard,
    applyToRun, withdrawApplication, listApplications, acceptApplication, declineApplication, getInvite,
    agreeToRunType, lfgConfigured, getCleanRunCount,
    RUN_TYPES, LFG_ROLES, LFG_DUNGEONS, MIN_KEY_LEVEL, MAX_KEY_LEVEL,
    runTypeLabel, poolCounts, minutesLeft, syncFreshness, cardMatchesRun,
    type RunType, type LfgRole, type LookingCard, type RunCard, type RunApplication, type Character, type CharacterRef,
    type AgreementChallenge, type RoleCounts,
  } from './lfg.js';

  import { leaderManifest, applyManifest, groupNameFor } from './addonManifest.js';
  import { lfgStatus } from './lfgStatus.svelte.js';
  import { lfgConn } from './lfgConn.svelte.js';
  import { tip } from './tip.js';
  import { POOL_DISPLAY, poolName } from './poolDisplay.js';
  import { specIconUrl } from './specVisuals.js';
  import { SPEC_IDS, roleOf, type PlayerRole } from '@wow/engine';
  import { devSeed } from './devSeed.svelte.js'; // DEV-only placeholder runs/pool (inert in prod)

  function classColor(name: string): string {
    return CLASS_COLOR[name] ?? 'var(--muted)';
  }

  // Resolve a character's role + spec icon from its class/spec strings (we store names, not specIds).
  // Reverse the engine's specId→{class,spec} map once.
  const SPEC_ID_BY_NAME = new Map<string, number>();
  for (const [id, cs] of Object.entries(SPEC_IDS)) SPEC_ID_BY_NAME.set(`${cs.className}|${cs.specName}`, Number(id));
  function specIdOf(ch: { class: string; spec: string }): number | undefined {
    return SPEC_ID_BY_NAME.get(`${ch.class}|${ch.spec}`);
  }
  function roleForChar(ch: { class: string; spec: string }): PlayerRole | undefined {
    return roleOf(specIdOf(ch));
  }
  function iconForChar(ch: { class: string; spec: string }): string | undefined {
    return specIconUrl(specIdOf(ch));
  }
  function roleLabel(role: PlayerRole | undefined): string {
    return role ? (role === 'dps' ? 'DPS' : role.charAt(0).toUpperCase() + role.slice(1)) : '';
  }
  // Whether item level is surfaced on a run's roster tiles (the chip under the role icon) AND in
  // the tile tooltip. Centralized so we can later hide ilvl on non-serious queues — e.g.
  //   return c.runType !== 'growth-vault';
  function showIlvl(_c: RunCard): boolean {
    return true;
  }
  /** Distinct pools a character is currently in (its active Looking Cards), in run-type order. */
  function poolsForChar(id: string): RunType[] {
    const set = new Set<RunType>();
    for (const c of myCards) if (c.characterId === id) set.add(c.runType);
    return RUN_TYPES.filter((t) => set.has(t));
  }

  // Pool-card role icons (Lucide paths) + tooltips, keyed by role. Color comes from the role class.
  const ROLE_ICON: Record<LfgRole, string> = {
    tank: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    healer: '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="M12 8v8M8 12h8"/>',
    dps: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="9" y2="18"/><line x1="7" y1="17" x2="4" y2="20"/><line x1="3" y1="19" x2="5" y2="21"/>',
    coach: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  };
  const ROLE_TIP: Record<LfgRole, string> = {
    tank: 'Tanks looking', healer: 'Healers looking', dps: 'DPS looking', coach: 'Coaches looking',
  };
  // Run-board card glyphs (Lucide). DUNGEON_GLYPH is a generic placeholder in the left avatar disc
  // (real per-dungeon art is a later add); CROWN_GLYPH marks the run's host.
  const DUNGEON_GLYPH =
    '<path d="M22 20v-9H2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2Z"/><path d="M18 11V4H6v7"/><path d="M15 22v-4a3 3 0 0 0-3-3a3 3 0 0 0-3 3v4"/><path d="M22 11V9"/><path d="M2 11V9"/><path d="M6 4V2"/><path d="M10 4V2"/><path d="M14 4V2"/><path d="M18 4V2"/>';
  const CROWN_GLYPH =
    '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>';

  // Mirror my presence into the app-wide status singleton so the topbar dot + the WS lifecycle stay in
  // sync: active Looking Cards (load/post/remove/expiry all flow through myCards) AND whether I own an
  // open Run Card (a leader must stay connected to receive application pushes even when not looking).
  $effect(() => {
    lfgStatus.setActiveCards(myCards.length);
    // Soonest expiry drives the inactivity ("still looking?") prompt in App.
    lfgStatus.setSoonestCardExpiry(myCards.length ? Math.min(...myCards.map((c) => c.expiresAt)) : null);
  });
  $effect(() => {
    lfgStatus.setOwnsOpenRun(runCards.some((c) => c.ownerSub === mySub && c.status === 'open'));
  });

  let loading = $state(false);
  let err = $state<string | null>(null);

  // Surface errors as a viewport-fixed toast (so a "no such run" from a card deep in the board is
  // visible wherever you're scrolled, not stranded at the top of the page). Auto-dismiss after a few s.
  $effect(() => {
    if (!err) return;
    const t = setTimeout(() => { err = null; }, 5000);
    return () => clearTimeout(t);
  });

  let mySub = $state('');
  let characters = $state<Character[]>([]);
  let myCards = $state<LookingCard[]>([]);
  let pool = $state<LookingCard[]>([]);
  let runCards = $state<RunCard[]>([]);
  let myApplications = $state<Record<string, string>>({});
  let pendingByCard = $state<Record<string, number>>({});
  let inbox = $state<{ card: RunCard; reason: string }[]>([]);
  let seenInbox = new Set<string>();
  let firstInbox = true;

  // Your Characters view: a toon grid; selecting one opens its create/manage Looking-Card panel.
  let toonSearch = $state('');
  let showAddChar = $state(false);
  let selectedCharId = $state<string | null>(null);
  // The selected toon steps through a small wizard: choose an intent, then the matching form.
  let toonMode = $state<'choose' | 'find' | 'host'>('choose');

  // New-Looking-Card form (now driven by the selected toon).
  const KEY_MIN = 2;
  const KEY_MAX = 25; // slider cap for now
  let lcCharacterId = $state<string | null>(null);
  let lcType = $state<RunType>('timed-completion');
  let lcRoles = $state<Set<LfgRole>>(new Set(['dps'])); // derived from the toon's spec, not user-chosen
  let lcKeyMin = $state(KEY_MIN);
  let lcKeyMax = $state(KEY_MAX);
  // Dungeons the toon is open to running (a filter pane). Defaults to ALL = open to anything.
  let lcDungeons = $state<Set<string>>(new Set(LFG_DUNGEONS));

  // Auto-scroll the selected-toon panel into view (it renders below the grid; with many toons it would
  // otherwise be off-screen when you pick one near the top).
  let panelEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (selectedCharId && panelEl) panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // Create-Run form. The comp is ALWAYS standard (1 tank / 1 healer / 3 dps); the only role knob is an
  // optional coach seat. The character being brought is the selected toon (host mode), set when entering it.
  let rcType = $state<RunType>('timed-completion');
  let rcCharacterId = $state<string | null>(null);
  let rcDungeon = $state('');
  let rcKey = $state<number | ''>('');
  let rcCoach = $state(false);
  // Optional minimum item-level requirement: a checkbox toggles it on, the field holds the floor.
  let rcMinIlvlOn = $state(false);
  let rcMinIlvl = $state<number | ''>('');
  // Optional minimum clean-run requirement (account-level): checkbox + field.
  let rcMinCleanOn = $state(false);
  let rcMinClean = $state<number | ''>('');

  // The signed-in user's banked clean-run count — drives the account-level apply gate + display.
  let myCleanRuns = $state(0);

  // Per-card UI state (board).
  let applyPickFor = $state<string | null>(null); // run card id whose "choose a character" chooser is open
  let openAppsCard = $state<string | null>(null);
  let appsList = $state<RunApplication[]>([]);
  let invite = $state<{ id: string; text: string; invites: string[] } | null>(null);
  let copied = $state(false);

  // Addon export: the MIQ manifest string a user pastes into the MythicIQ WoW addon (leader or applicant).
  let addon = $state<{ id: string; text: string; name: string } | null>(null);
  let addonCopied = $state(false);

  // Social-contract gate: when an apply 409s, hold the challenge + the action to retry on agree.
  let agreement = $state<AgreementChallenge | null>(null);
  let pendingApply = $state<{ id: string; role: LfgRole; characterId: string | null } | null>(null);

  const configured = lfgConfigured();
  const signedIn = $derived(auth.status === 'signed-in');

  // The board's status is only trustworthy when the WS is LIVE. When you're not connected we don't know
  // the current state, so the Run Board is dimmed + cleared until you either go live (post a Looking Card)
  // or take a one-shot manual peek (the Refresh button). `snapshotShown` flips true after a manual refresh
  // so the peeked snapshot is shown.
  let snapshotShown = $state(false);
  const boardVisible = $derived(
    lfgConn.connected || snapshotShown || (import.meta.env.DEV && devSeed.cards.length > 0),
  );

  // Manual refresh is the ONLY way to refresh now (auto-refresh polling is gone). It's offered only when
  // NOT live (when connected the board stays current on its own, so a button would just invite spam) and
  // is rate-limited: disabled for REFRESH_COOLDOWN_S after each press.
  const REFRESH_COOLDOWN_S = 20;
  let cooldownLeft = $state(0);
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;
  function startRefreshCooldown() {
    cooldownLeft = REFRESH_COOLDOWN_S;
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      cooldownLeft -= 1;
      if (cooldownLeft <= 0) { cooldownLeft = 0; if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; } }
    }, 1000);
  }
  async function manualRefresh() {
    if (cooldownLeft > 0 || loading) return;
    snapshotShown = true; // reveal the (now-current) snapshot even while not live
    await liveRefresh();
    startRefreshCooldown();
  }
  $effect(() => () => { if (cooldownTimer) clearInterval(cooldownTimer); }); // tidy the ticker on destroy

  // Live pool counts for the Create-Run form (unique matching players, excluding me).
  // The pool used for the queue counts. In DEV we merge in `devSeed.pool` so the queues fill with mock
  // players; in prod this is just the real pool (the merge is dead-code-eliminated by the DEV check).
  const displayPool = $derived(import.meta.env.DEV ? [...pool, ...devSeed.pool] : pool);

  const liveCounts = $derived(
    poolCounts(displayPool, { runType: rcType, keyLevel: rcKey === '' ? undefined : Number(rcKey), dungeon: rcDungeon || undefined }, mySub),
  );

  // The board, filtered + sorted for display: when you're LOOKING (have active Looking Cards) the board
  // narrows to runs that match one of your cards (your own hosted runs always survive the filter); with
  // no Looking Cards it shows everything. Sort = your hosted runs first (they get a glow), then by run
  // type in pool order (Growth → Timed → Progression → Tech Lab), then by key level.
  const RUN_TYPE_ORDER = new Map<RunType, number>(RUN_TYPES.map((t, i) => [t, i]));
  const visibleRuns = $derived.by(() => {
    const looking = myCards.length > 0;
    const filtered = runCards.filter(
      (c) => c.ownerSub === mySub || !looking || myCards.some((lc) => cardMatchesRun(lc, c)),
    );
    // DEV placeholder runs always show (they bypass the look-filter); inert in prod.
    const all = import.meta.env.DEV ? [...filtered, ...devSeed.cards] : filtered;
    return all.slice().sort((a, b) => {
      const am = a.ownerSub === mySub ? 0 : 1;
      const bm = b.ownerSub === mySub ? 0 : 1;
      if (am !== bm) return am - bm;
      const at = RUN_TYPE_ORDER.get(a.runType) ?? 99;
      const bt = RUN_TYPE_ORDER.get(b.runType) ?? 99;
      if (at !== bt) return at - bt;
      return (a.keyLevel ?? 0) - (b.keyLevel ?? 0);
    });
  });

  // One group at a time: the single OPEN/LOCKED run I'm committed to (hosting OR rostered on), if any. The
  // backend enforces this (409 with `inGroup`); the UI mirrors it so I'm not offered host/apply actions
  // that would just bounce. Multiple Looking Cards stay fine — those are intent, not commitment.
  const myGroup = $derived(
    runCards.find(
      (c) => (c.status === 'open' || c.status === 'locked') && (c.ownerSub === mySub || c.roster.some((r) => r.sub === mySub)),
    ) ?? null,
  );

  async function refresh() {
    if (!signedIn) return;
    loading = true;
    err = null;
    try {
      const [chars, look, board, clean] = await Promise.all([listCharacters(), listLooking(), listRunCards(), getCleanRunCount()]);
      if (clean.ok) myCleanRuns = clean.value.count;
      if (chars.ok) {
        characters = chars.value.characters;
        // Default the form/apply selections to the first character if unset / stale.
        if (!lcCharacterId || !characters.some((c) => c.id === lcCharacterId)) lcCharacterId = characters[0]?.id ?? null;
      }
      if (look.ok) {
        myCards = look.value.mine;
        pool = look.value.pool;
        mySub = look.value.mySub;
      }
      if (board.ok) {
        runCards = board.value.runCards;
        mySub = board.value.mySub;
        myApplications = board.value.myApplications ?? {};
        pendingByCard = board.value.pendingByCard ?? {};
        inbox = board.value.inbox ?? [];
        // Ping (sound) when a NEW broadcast match arrives (not on first load).
        const fresh = inbox.some((m) => !seenInbox.has(m.card.id));
        if (fresh && !firstInbox) playSound('lfg-match');
        seenInbox = new Set(inbox.map((m) => m.card.id));
        firstInbox = false;
      } else err = board.error;
    } finally {
      loading = false;
    }
  }

  // Refresh the board AND, if a leader has the applications queue open, its applicant list — used by both
  // the WS-push reaction and the auto-refresh poll so the visible queue updates live, not just the card.
  async function liveRefresh() {
    await refresh();
    if (openAppsCard) {
      const c = runCards.find((r) => r.id === openAppsCard);
      if (c) await reloadApps(c);
    }
  }

  $effect(() => {
    if (signedIn) void refresh();
  });

  // Resume a Battle.net account link after the OAuth redirect (App flags it via the ?bnet= param). Runs
  // once Groups is mounted + signed in: loads the linked roster and imports (auto, or via the picker).
  $effect(() => {
    if (signedIn) void blizzardLink.consumeReturnIfAny(refresh);
  });

  // LIVE updates while connected — lfgSocket bumps lfgConn.boardRev on any run you're involved in
  // (application / accept / decline / lock). React (debounced) by refetching the whole board (which also
  // picks up wider changes). The initial rev (0) is skipped — the load effect above did the first fetch.
  // There is NO timed auto-refresh: when you're not live the board is dimmed and a manual one-shot Refresh
  // (rate-limited) is the only update path; when you ARE live, WS events keep it current.
  let boardRevSeen = 0;
  let liveTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const rev = lfgConn.boardRev;
    if (rev === boardRevSeen) return;
    boardRevSeen = rev;
    if (!signedIn) return;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => void liveRefresh(), 350);
  });

  async function createCard() {
    err = null;
    if (!lcCharacterId) { err = 'pick a character for this card'; return; }
    const allDuns = lcDungeons.size === LFG_DUNGEONS.length;
    const r = await createLooking({
      characterId: lcCharacterId,
      runType: lcType,
      roles: [...lcRoles], // the toon's spec role
      keyMin: lcKeyMin,
      keyMax: lcKeyMax,
      dungeons: allDuns ? undefined : [...lcDungeons], // undefined ⇒ open to any
    });
    if (r.ok) await refresh(); // keep the toon panel open so its new card shows
    else err = r.error;
  }
  async function extendCard(id: string) {
    if ((await extendLooking(id)).ok) await refresh();
  }
  async function removeCard(id: string) {
    if ((await deleteLooking(id)).ok) await refresh();
  }

  async function createRun() {
    err = null;
    if (!rcCharacterId) { err = "pick the character you're bringing"; return; }
    if (!rcDungeon || rcKey === '') { err = 'pick a dungeon and key level'; return; }
    // Standard comp, plus an optional coach seat.
    const neededRoles: RoleCounts = { tank: 1, healer: 1, dps: 3, ...(rcCoach ? { coach: 1 } : {}) };
    const ch = characters.find((c) => c.id === rcCharacterId);
    const ownerRole = ch ? roleForChar(ch) : undefined; // PlayerRole ⊂ LfgRole (tank/healer/dps)
    const minIlvl = rcMinIlvlOn && rcMinIlvl !== '' ? Number(rcMinIlvl) : undefined;
    const minCleanRuns = rcMinCleanOn && rcMinClean !== '' ? Number(rcMinClean) : undefined;
    const r = await createRunCard({
      runType: rcType,
      dungeon: rcDungeon,
      keyLevel: Number(rcKey),
      neededRoles,
      characterId: rcCharacterId,
      ...(minIlvl ? { minIlvl } : {}),
      ...(minCleanRuns ? { minCleanRuns } : {}),
      ...(ownerRole ? { ownerRole: ownerRole as LfgRole } : {}),
    });
    if (r.ok) { toonMode = 'choose'; rcDungeon = ''; rcKey = ''; rcCoach = false; rcMinIlvlOn = false; rcMinIlvl = ''; rcMinCleanOn = false; rcMinClean = ''; await refresh(); }
    else err = r.error;
  }

  async function setStatus(c: RunCard, status: RunCard['status']) {
    if ((await updateRunCard(c.id, { status })).ok) await refresh();
  }
  async function removeRun(id: string) {
    if ((await deleteRunCard(id)).ok) { if (openAppsCard === id) openAppsCard = null; if (invite?.id === id) invite = null; await refresh(); }
  }

  // Apply (with the social-contract gate). Character-first: you pick WHICH character to bring from a
  // dropdown (the role is that character's spec role — no manual role choice). The default for the inbox
  // quick-apply is the character on my matching Looking Card, else my first character.
  function defaultCharForRun(c: RunCard): string | null {
    const hit = myCards.find((lc) => cardMatchesRun(lc, c));
    const preferred = hit?.characterId ?? characters[0]?.id ?? null;
    const chosen = preferred && characters.some((ch) => ch.id === preferred) ? preferred : (characters[0]?.id ?? null);
    // If the preferred character doesn't meet the run's ilvl floor, fall back to the first that does.
    const chosenCh = characters.find((ch) => ch.id === chosen);
    if (chosen && meetsIlvl(c, chosenCh)) return chosen;
    return characters.find((ch) => meetsIlvl(c, ch))?.id ?? chosen;
  }
  // Item-level gate (mirrors the backend): a run with a minIlvl only accepts characters at/above it (and
  // with a readable ilvl). Used to disable ineligible characters in the chooser + block a doomed apply.
  function meetsIlvl(c: RunCard, ch: { ilvl?: number } | null | undefined): boolean {
    if (!c.minIlvl || c.minIlvl <= 0) return true;
    return (ch?.ilvl ?? 0) >= c.minIlvl;
  }
  // Do any of my characters qualify for this run's ilvl floor? (drives the board "below ilvl" notice).
  function haveEligibleChar(c: RunCard): boolean {
    return characters.some((ch) => meetsIlvl(c, ch));
  }
  // Clean-run gate (account-level, mirrors the backend): do I have enough banked clean runs for this run?
  function meetsCleanRuns(c: RunCard): boolean {
    return !c.minCleanRuns || c.minCleanRuns <= 0 || myCleanRuns >= c.minCleanRuns;
  }
  // The role a character applies as = its spec role if the run needs it, else the first non-coach seat.
  function applyRoleFor(c: RunCard, charId: string | null): LfgRole {
    const ch = characters.find((x) => x.id === charId);
    const r = ch ? roleForChar(ch) : undefined; // PlayerRole ⊂ LfgRole
    if (r && (c.neededRoles[r] ?? 0) > 0) return r;
    return neededRoles(c).find((x) => x !== 'coach') ?? neededRoles(c)[0] ?? 'dps';
  }
  // Apply button: one character → apply straight away; several → open the character chooser.
  function startApply(c: RunCard) {
    err = null;
    if (characters.length === 0) { err = 'add a character first'; return; }
    if (!meetsCleanRuns(c)) { err = `This run requires ${c.minCleanRuns} clean run${c.minCleanRuns === 1 ? '' : 's'} — you have ${myCleanRuns}.`; return; }
    if (!haveEligibleChar(c)) { err = `This run requires ${c.minIlvl}+ item level — none of your characters qualify.`; return; }
    if (characters.length === 1) { void doApply(c, characters[0]!.id); return; }
    applyPickFor = applyPickFor === c.id ? null : c.id;
  }
  async function doApply(c: RunCard, charId: string | null = defaultCharForRun(c)) {
    err = null;
    applyPickFor = null;
    if (characters.length === 0 || !charId) { err = 'add a character first'; return; }
    if (!meetsCleanRuns(c)) { err = `This run requires ${c.minCleanRuns} clean run${c.minCleanRuns === 1 ? '' : 's'} — you have ${myCleanRuns}.`; return; }
    const ch = characters.find((x) => x.id === charId);
    if (!meetsIlvl(c, ch)) { err = `${ch?.name ?? 'That character'} is below the ${c.minIlvl}+ item level this run requires.`; return; }
    const role = applyRoleFor(c, charId);
    const r = await applyToRun(c.id, role, charId);
    if (r.ok) await refresh();
    else if (r.agreement) { agreement = r.agreement; pendingApply = { id: c.id, role, characterId: charId }; }
    else err = r.error;
  }
  async function agreeAndApply() {
    if (!agreement || !pendingApply) return;
    const a = await agreeToRunType(agreement.runType);
    if (!a.ok) { err = a.error; return; }
    const { id, role, characterId } = pendingApply;
    agreement = null; pendingApply = null;
    const r = await applyToRun(id, role, characterId ?? undefined);
    if (r.ok) await refresh();
    else err = r.error;
  }
  function cancelAgreement() { agreement = null; pendingApply = null; }
  async function doWithdraw(c: RunCard) {
    if ((await withdrawApplication(c.id)).ok) await refresh();
  }

  // Owner: application queue.
  async function toggleApps(c: RunCard) {
    if (openAppsCard === c.id) { openAppsCard = null; appsList = []; return; }
    const r = await listApplications(c.id);
    if (r.ok) { appsList = r.value.applications; openAppsCard = c.id; }
    else err = r.error;
  }
  async function reloadApps(c: RunCard) {
    if (openAppsCard !== c.id) return;
    const r = await listApplications(c.id);
    if (r.ok) appsList = r.value.applications;
  }
  async function doAccept(c: RunCard, sub: string) {
    err = null;
    const r = await acceptApplication(c.id, sub);
    if (r.ok) { await refresh(); await reloadApps(c); }
    else err = r.error;
  }
  async function doDecline(c: RunCard, sub: string) {
    if ((await declineApplication(c.id, sub)).ok) { await refresh(); await reloadApps(c); }
  }

  // Invite list (generate + copy).
  async function showInvite(c: RunCard) {
    if (invite?.id === c.id) { invite = null; return; }
    const r = await getInvite(c.id);
    if (r.ok) invite = { id: c.id, text: r.value.text, invites: r.value.invites };
    else err = r.error;
  }
  async function copyInvite() {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite.text); copied = true; setTimeout(() => (copied = false), 1500); } catch { /* clipboard blocked — the text is visible to select */ }
  }

  // Addon export — build + reveal the MIQ manifest, and try to copy it. The <pre> stays visible so a user
  // can hand-select it if the clipboard is blocked. Leaders export the roster (Awaiting→Applied→Joined
  // tracking); a rostered member exports an APPLY manifest carrying the search code + their role.
  function showAddon(c: RunCard, kind: 'leader' | 'apply') {
    if (addon?.id === c.id) { addon = null; return; }
    let text: string;
    if (kind === 'leader') {
      text = leaderManifest(c, mySub);
    } else {
      const myRole = c.roster.find((r) => r.sub === mySub)?.role ?? 'dps';
      text = applyManifest(c, myRole);
    }
    addon = { id: c.id, text, name: groupNameFor(c) };
    addonCopied = false;
  }
  async function copyAddon() {
    if (!addon) return;
    try { await navigator.clipboard.writeText(addon.text); addonCopied = true; setTimeout(() => (addonCopied = false), 1500); } catch { /* clipboard blocked — the text is visible to select */ }
  }
  // Whether I'm on this run's roster (an accepted member who needs to join the in-game group).
  function onRoster(c: RunCard): boolean {
    return c.roster.some((r) => r.sub === mySub);
  }

  // Derived helpers.
  function neededRoles(c: RunCard): LfgRole[] {
    return LFG_ROLES.filter((r) => (c.neededRoles[r] ?? 0) > 0);
  }
  function rosterCount(c: RunCard, role: LfgRole): number {
    return c.roster.filter((r) => r.role === role).length;
  }
  function isOwner(c: RunCard): boolean {
    return c.ownerSub === mySub;
  }
  // How many of MY characters are in the pool for a run type (distinct characterIds across my Looking
  // Cards of that type) — the per-card "yours" number.
  function myCharsInPool(t: RunType): number {
    const ids = new Set<string>();
    for (const c of myCards) if (c.runType === t) ids.add(c.characterId);
    return ids.size;
  }
  // My active Looking Cards for one character (its pool memberships, manageable in the toon panel).
  function cardsForChar(id: string): LookingCard[] {
    return myCards.filter((c) => c.characterId === id);
  }

  // Your Characters grid: search filter + selection.
  const filteredChars = $derived(
    characters.filter((c) => {
      const q = toonSearch.trim().toLowerCase();
      return !q || `${c.name} ${c.realm} ${c.class} ${c.spec}`.toLowerCase().includes(q);
    }),
  );
  const selectedToon = $derived(characters.find((c) => c.id === selectedCharId) ?? null);
  // A single "last refreshed" hint for the pane = the freshness of the most-recently-synced character
  // (this is when we last pulled Armory data — distinct from any one card/run). null if none synced yet.
  const lastRefreshed = $derived.by(() => {
    const synced = characters.filter((c) => c.lastSyncedAt);
    if (!synced.length) return null;
    const newest = synced.reduce((a, b) => ((b.lastSyncedAt ?? 0) > (a.lastSyncedAt ?? 0) ? b : a));
    return syncFreshness(newest);
  });
  function selectToon(id: string) {
    if (selectedCharId === id) { closeToon(); return; }
    selectedCharId = id;
    lcCharacterId = id;
    showAddChar = false;
    toonMode = 'choose'; // always start on the intent step
    // Default the new-card role to the toon's spec role; blank the rest (the user can adjust).
    const ch = characters.find((c) => c.id === id);
    const role = ch ? roleForChar(ch) : undefined;
    lcRoles = new Set<LfgRole>(role ? [role] : ['dps']);
    lcKeyMin = KEY_MIN; lcKeyMax = KEY_MAX;
    lcDungeons = new Set(LFG_DUNGEONS); // open to all by default
  }
  function closeToon() { selectedCharId = null; toonMode = 'choose'; }
  // Pick what to do with the selected toon. Host mode binds the run card to this character.
  function chooseToonMode(mode: 'find' | 'host') {
    err = null;
    toonMode = mode;
    if (mode === 'host' && selectedCharId) {
      rcCharacterId = selectedCharId;
      rcDungeon = ''; rcKey = ''; rcCoach = false; rcMinIlvlOn = false; rcMinIlvl = ''; rcMinCleanOn = false; rcMinClean = '';
    }
  }
  function backToChoose() { toonMode = 'choose'; }
  // Dual-knob key-range slider helpers (two overlaid range inputs; keep min ≤ max).
  function keyPct(v: number): number { return ((v - KEY_MIN) / (KEY_MAX - KEY_MIN)) * 100; }
  function onKeyMinInput() { if (lcKeyMin > lcKeyMax) lcKeyMin = lcKeyMax; }
  function onKeyMaxInput() { if (lcKeyMax < lcKeyMin) lcKeyMax = lcKeyMin; }
  // Dungeon picker (a filter pane). Reassign the Set so runes re-render.
  function toggleDungeon(d: string) {
    const next = new Set(lcDungeons);
    if (next.has(d)) next.delete(d); else next.add(d);
    lcDungeons = next;
  }
  function allDungeons() { lcDungeons = new Set(LFG_DUNGEONS); }
  function noneDungeons() { lcDungeons = new Set(); }
  /** Short label for a card's dungeon preference (manage list). */
  function dunsLabel(c: LookingCard): string {
    const ds = c.dungeons;
    if (!ds || ds.length === 0 || ds.length >= LFG_DUNGEONS.length) return 'all dungeons';
    return ds.length === 1 ? ds[0]! : `${ds.length} dungeons`;
  }
</script>

<!-- A character chip: class-dot + name-realm + class/spec + ilvl. Reused by the roster
     and the application queue so a leader sees WHO (not just the account) they're staffing. -->
{#snippet charChip(ch: CharacterRef)}
  <span class="charline" title={`${ch.class} ${ch.spec}${ch.ilvl ? ` · ${ch.ilvl} ilvl` : ''}`}>
    <span class="cdot" style={`background:${classColor(ch.class)}`}></span>
    <span class="clname">{ch.name}-{ch.realm}</span>
    <span class="clspec">{ch.spec} {ch.class}</span>
    {#if ch.ilvl}<span class="cilvl">{ch.ilvl}</span>{/if}
  </span>
{/snippet}

<!-- One role stat on a pool card: a role-colored icon + the count, with a tooltip. -->
{#snippet poolStat(kind: LfgRole, n: number)}
  <span class="pc-role {kind}" use:tip={ROLE_TIP[kind]}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ROLE_ICON[kind]}</svg>
    <span class="pc-n">{n}</span>
  </span>
{/snippet}

<div class="gv">
  {#if err}
    <!-- Viewport-fixed so it's seen wherever you're scrolled (not stranded at the top of the board). -->
    <div class="gv-toast" role="alert">
      <span class="gv-toast-msg">{err}</span>
      <button class="gv-toast-x" onclick={() => (err = null)} aria-label="Dismiss">✕</button>
    </div>
  {/if}
  <div class="gv-inner">
  <header class="gv-head">
    <div class="gv-title">
      <h1>Group Finder <span class="beta">PILOT</span></h1>
      <p class="sub">Post what you're open to. We'll help build the roster.</p>
    </div>
    {#if signedIn}
      <div class="gv-live">
        {#if lfgConn.connected}
          <!-- Live: WS keeps the board current; no manual refresh (don't invite spam). -->
          <span class="liveflag on" title="Live — applications and status changes arrive instantly. The board stays current on its own; no need to refresh.">
            <span class="lvdot pulse"></span>Live
          </span>
        {:else}
          <!-- Not live: the board's status is unknown, so offer a one-shot, rate-limited peek. -->
          <div class="gv-notlive">
            <div class="gv-notlive-row">
              <span class="liveflag" title="Not connected — join a pool (post a Looking Card) to go live and see the board update automatically. Until then, the board may be out of date.">
                <span class="lvdot"></span>Not live
              </span>
              <button
                class="ghost icon"
                onclick={() => void manualRefresh()}
                disabled={loading || cooldownLeft > 0}
                title={cooldownLeft > 0 ? `Refresh available in ${cooldownLeft}s` : 'Load the current board (briefly disabled after each press)'}
                aria-label="Refresh the board"
              >{loading ? '…' : cooldownLeft > 0 ? `↻ ${cooldownLeft}s` : '↻ Refresh'}</button>
            </div>
            <p class="gv-notlive-sub">You'll be connected for live updates once you join a pool.</p>
          </div>
        {/if}
      </div>
    {/if}
  </header>

  {#if !configured}
    <div class="gate"><p class="muted">Group coordination isn't available in this build yet — it needs the accounts backend configured.</p></div>
  {:else if !signedIn}
    <div class="gate">
      <p class="muted">Sign in to post Looking Cards and coordinate runs.</p>
      <button class="primary" onclick={() => auth.login()}>Sign in</button>
    </div>
  {:else}
    <!-- The Looking Pool, up top: one card per run type (role icons + counts), straight across — no backing
         section. The top-right number is how many of YOUR characters are in that pool (gold ≥1, gray 0). -->
    <div class="poolcards">
      {#each RUN_TYPES as t (t)}
        {@const pc = poolCounts(displayPool, { runType: t })}
        {@const mine = myCharsInPool(t)}
        <div class="poolcard" style={`--pc:${POOL_DISPLAY[t].color}`}>
          <div class="pc-head">
            <span class="pc-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html POOL_DISPLAY[t].icon}</svg>
            </span>
            <span class="pc-title">{poolName(t)}</span>
            <span class="pc-mine" class:has={mine > 0} use:tip={`Your characters in the ${poolName(t)} pool`}>{mine}</span>
          </div>
          <div class="pc-roles">
            {@render poolStat('tank', pc.tank)}
            {@render poolStat('healer', pc.healer)}
            {@render poolStat('dps', pc.dps)}
            {@render poolStat('coach', pc.coach)}
          </div>
          <!-- Hover pane: the pool's purpose + expectations (overlays neighbors, no layout shift). -->
          <span class="pc-pop" role="tooltip">
            <span class="pc-pop-title">{poolName(t)}</span>
            <span class="pc-pop-tag">{POOL_DISPLAY[t].tagline}</span>
            <ul>{#each POOL_DISPLAY[t].expectations as e (e)}<li>{e}</li>{/each}</ul>
          </span>
        </div>
      {/each}
    </div>

    <!-- Inbox: broadcast runs matching one of your Looking Cards. -->
    {#if inbox.length}
      <section class="inbox card">
        <div class="card-head"><span class="lbl">📣 Matches for you</span><span class="count">{inbox.length}</span></div>
        <ul class="list">
          {#each inbox as m (m.card.id)}
            <li>
              <div class="ib-row">
                <span class="rt {m.card.runType}">{runTypeLabel(m.card.runType)}</span>
                <span class="ib-meta">{m.card.dungeon ?? 'Any dungeon'}{#if m.card.keyLevel} +{m.card.keyLevel}{/if} · by {m.card.ownerHandle ?? 'someone'}</span>
                {#if myApplications[m.card.id] === 'pending'}<span class="reqstatus pending">Applied</span>
                {:else if myApplications[m.card.id] === 'accepted'}<span class="reqstatus accepted">You're in ✓</span>
                {:else if myGroup}<span class="muted sm" use:tip={"You're already in a group — leave it before joining another."}>In a group</span>
                {:else}<button class="primary sm" onclick={() => doApply(m.card)}>Apply</button>{/if}
              </div>
              <span class="why">{m.reason}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- 1) Your Characters — the toon grid. Select one to create/manage its Looking Cards. A colored dot
         per card shows which pool(s) that toon is already in (matching the pool colors above). -->
    <section class="card">
      <div class="card-head">
        <span class="lbl">Your Characters</span>
        <span class="count">{characters.length}</span>
        {#if characters.length > 6}
          <input class="in slim toonsearch" bind:value={toonSearch} placeholder="Search characters…" />
        {/if}
        <button class="primary sm" onclick={() => (showAddChar = !showAddChar)}>{showAddChar ? 'Done' : '+ Add character'}</button>
      </div>

      {#if lastRefreshed}
        <p class="refreshed muted sm" use:tip={'When we last pulled Armory data for your characters'}>Last refreshed {lastRefreshed}</p>
      {/if}

      {#if showAddChar}
        <div class="form"><CharacterPicker {characters} bind:selectedId={lcCharacterId} onChanged={refresh} /></div>
      {/if}

      {#if characters.length === 0 && !showAddChar}
        <p class="muted sm pad">No characters yet. Add one to join a pool — we'll look it up on the Armory.</p>
      {/if}

      {#if characters.length}
        <div class="toons">
          {#each filteredChars as ch (ch.id)}
            {@const pools = poolsForChar(ch.id)}
            {@const role = roleForChar(ch)}
            {@const icon = iconForChar(ch)}
            <button class="toon" class:on={selectedCharId === ch.id} onclick={() => selectToon(ch.id)}>
              <span class="tav" style={`--cc:${classColor(ch.class)}`}>
                {#if ch.avatar}<img src={ch.avatar} alt="" />{:else if icon}<img src={icon} alt="" />{:else}<span class="tav-dot"></span>{/if}
              </span>
              <span class="tinfo">
                <span class="tname">{ch.name}</span>
                <span class="tspec" style={`color:${classColor(ch.class)}`}>{ch.spec} {ch.class}</span>
                {#if role}
                  <span class="trole {role}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ROLE_ICON[role]}</svg>
                    {role === 'dps' ? 'DPS' : role.charAt(0).toUpperCase() + role.slice(1)}
                  </span>
                {/if}
              </span>
              <span class="tstatus">
                {#if pools.length}
                  {#each pools as p (p)}<span class="pooldot" style={`background:${POOL_DISPLAY[p].color}`} use:tip={poolName(p)}></span>{/each}
                  <span class="stxt">{pools.length === 1 ? poolName(pools[0]!) : `${pools.length} pools`}</span>
                {:else}
                  <span class="pooldot off"></span><span class="stxt off">Not looking</span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Selected-toon panel: its current pools (manage) + create another Looking Card for it. -->
      {#if selectedToon}
        <div class="toonpanel" bind:this={panelEl}>
          <!-- "Selected toon" header, shown only on the intent step (choose). Once you pick find/host it
               collapses so the form gets the focus; ← Back returns to choose and brings it back. -->
          {#if toonMode === 'choose'}
          <div class="tp-head">
            <span class="tav sm" style={`--cc:${classColor(selectedToon.class)}`}>
              {#if selectedToon.avatar}<img src={selectedToon.avatar} alt="" />{:else if iconForChar(selectedToon)}<img src={iconForChar(selectedToon)} alt="" />{:else}<span class="tav-dot"></span>{/if}
            </span>
            <span class="tp-id">
              <span class="tp-name">{selectedToon.name}</span>
              <span class="tp-sub" style={`color:${classColor(selectedToon.class)}`}>
                {selectedToon.spec} {selectedToon.class}
                {#if roleForChar(selectedToon)}<span class="tp-role {roleForChar(selectedToon)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ROLE_ICON[roleForChar(selectedToon)!]}</svg>{roleLabel(roleForChar(selectedToon))}</span>{/if}
              </span>
            </span>
            <button class="tiny" onclick={closeToon}>Close</button>
          </div>
          {/if}

          {#if cardsForChar(selectedToon.id).length}
            <div class="tp-cards">
              {#each cardsForChar(selectedToon.id) as c (c.id)}
                <div class="tp-card">
                  <span class="pooldot" style={`background:${POOL_DISPLAY[c.runType].color}`}></span>
                  <span class="tp-pool">{poolName(c.runType)}</span>
                  <span class="krange">+{c.keyMin ?? '?'} – +{c.keyMax ?? '?'}</span>
                  <span class="duns" use:tip={c.dungeons && c.dungeons.length ? c.dungeons.join(', ') : 'Open to any dungeon'}>{dunsLabel(c)}</span>
                  <span class="ttl">{minutesLeft(c)}m left</span>
                  <span class="actions">
                    <button class="tiny" onclick={() => extendCard(c.id)}>Extend</button>
                    <button class="tiny danger" onclick={() => removeCard(c.id)}>Remove</button>
                  </span>
                </div>
              {/each}
            </div>
          {/if}

          {#if myGroup}
            <!-- Already committed to one group: hosting/looking is blocked until you leave it. -->
            <div class="tp-choice">
              <p class="tp-q">You're in a group — <strong>{myGroup.dungeon ?? runTypeLabel(myGroup.runType)}{#if myGroup.keyLevel} +{myGroup.keyLevel}{/if}</strong>.</p>
              <p class="muted sm">You can only be in one group at a time. Leave it (cancel your run, or withdraw) to host or look for another.</p>
            </div>
          {:else if toonMode === 'choose'}
            <!-- Step 1: choose what to do with this character. -->
            <div class="tp-choice">
              <p class="tp-q">What would you like to do with <strong>{selectedToon.name}</strong>?</p>
              <div class="choices">
                <button type="button" class="choice find" onclick={() => chooseToonMode('find')}>
                  <span class="ch-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
                  <span class="ch-text"><span class="ch-name">Find a group</span><span class="ch-desc">Join a pool so leaders can pick you up</span></span>
                </button>
                <button type="button" class="choice host" onclick={() => chooseToonMode('host')}>
                  <span class="ch-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html CROWN_GLYPH}</svg></span>
                  <span class="ch-text"><span class="ch-name">Host a run</span><span class="ch-desc">Post a run and build your roster</span></span>
                </button>
              </div>
            </div>
          {:else if toonMode === 'find'}
          <div class="form">
            <button type="button" class="backbtn" onclick={backToChoose}>← Back</button>
            <!-- Pool picker: a clickable card per pool. Hover a card to preview its expectations (overlay,
                 no layout shift). -->
            <div class="poolpick">
              {#each RUN_TYPES as t (t)}
                <button type="button" class="poolopt" class:on={lcType === t} style={`--pc:${POOL_DISPLAY[t].color}`} onclick={() => (lcType = t)}>
                  <span class="po-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html POOL_DISPLAY[t].icon}</svg></span>
                  <span class="po-text">
                    <span class="po-name">{poolName(t)}</span>
                    <span class="po-desc">{POOL_DISPLAY[t].tagline}</span>
                  </span>
                  <span class="po-pop" role="tooltip">
                    <span class="po-pop-title">What this pool expects</span>
                    <ul>{#each POOL_DISPLAY[t].expectations as e (e)}<li>{e}</li>{/each}</ul>
                  </span>
                </button>
              {/each}
            </div>

            <!-- Key range: a dual-knob slider (the toon's spec sets the role, so no role picker). -->
            <div class="fld">
              <div class="kr-head"><span class="flbl">Key range</span><span class="kr-val">+{lcKeyMin} – +{lcKeyMax}</span></div>
              <div class="dualrange" style={`--a:${keyPct(lcKeyMin)}%; --b:${keyPct(lcKeyMax)}%`}>
                <div class="dr-rail"></div>
                <div class="dr-fill"></div>
                <input type="range" min={KEY_MIN} max={KEY_MAX} bind:value={lcKeyMin} oninput={onKeyMinInput} aria-label="Minimum key level" />
                <input type="range" min={KEY_MIN} max={KEY_MAX} bind:value={lcKeyMax} oninput={onKeyMaxInput} aria-label="Maximum key level" />
              </div>
            </div>

            <!-- Dungeon picker: which dungeons this toon is open to. All on = open to anything. -->
            <div class="fld">
              <div class="kr-head">
                <span class="flbl">Dungeons</span>
                <span class="dun-actions">
                  <button type="button" class="tiny" onclick={allDungeons}>All</button>
                  <button type="button" class="tiny" onclick={noneDungeons}>None</button>
                  <span class="dun-count">{lcDungeons.size === LFG_DUNGEONS.length ? 'Any dungeon' : `${lcDungeons.size}/${LFG_DUNGEONS.length}`}</span>
                </span>
              </div>
              <div class="dungrid">
                {#each LFG_DUNGEONS as d (d)}
                  <button type="button" class="dunchip" class:on={lcDungeons.has(d)} onclick={() => toggleDungeon(d)}>{d}</button>
                {/each}
              </div>
            </div>

            <button class="primary startbtn" onclick={createCard} disabled={lcRoles.size === 0 || lcDungeons.size === 0}>Start Looking</button>
          </div>
          {:else}
          <!-- Host mode: a Run Card bound to this character (mirrors the looking form's pickers). -->
          <div class="form">
            <button type="button" class="backbtn" onclick={backToChoose}>← Back</button>
            <!-- Run type -->
            <div class="poolpick">
              {#each RUN_TYPES as t (t)}
                <button type="button" class="poolopt" class:on={rcType === t} style={`--pc:${POOL_DISPLAY[t].color}`} onclick={() => (rcType = t)}>
                  <span class="po-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html POOL_DISPLAY[t].icon}</svg></span>
                  <span class="po-text">
                    <span class="po-name">{poolName(t)}</span>
                    <span class="po-desc">{POOL_DISPLAY[t].tagline}</span>
                  </span>
                  <span class="po-pop" role="tooltip">
                    <span class="po-pop-title">What this pool expects</span>
                    <ul>{#each POOL_DISPLAY[t].expectations as e (e)}<li>{e}</li>{/each}</ul>
                  </span>
                </button>
              {/each}
            </div>

            <!-- Dungeon: single-select chip grid. -->
            <div class="fld">
              <span class="flbl">Dungeon</span>
              <div class="dungrid">
                {#each LFG_DUNGEONS as d (d)}
                  <button type="button" class="dunchip" class:on={rcDungeon === d} onclick={() => (rcDungeon = d)}>{d}</button>
                {/each}
              </div>
            </div>

            <!-- Key level: manual for now (later auto-filled from the character's keystone). -->
            <div class="fld">
              <span class="flbl">Key level <span class="hint">manual for now — later from the Armory</span></span>
              <input class="in slim num" type="number" bind:value={rcKey} placeholder="key" min={MIN_KEY_LEVEL} max={MAX_KEY_LEVEL} />
            </div>

            <!-- Comp is fixed (1 tank / 1 healer / 3 dps); the only knob is an optional coach seat. -->
            <label class="row sm"><input type="checkbox" bind:checked={rcCoach} /> Add a Coach seat (Discord streaming)</label>

            <!-- Optional minimum item-level requirement. When on, only characters at/above the floor can apply. -->
            <div class="ilvlreq">
              <label class="row sm"><input type="checkbox" bind:checked={rcMinIlvlOn} /> Require a minimum item level</label>
              {#if rcMinIlvlOn}
                <input class="in slim num" type="number" bind:value={rcMinIlvl} placeholder="min ilvl" min="1" max="9999" aria-label="Minimum item level" />
                <span class="hint">Only characters at or above this can apply.</span>
              {/if}
            </div>

            <!-- Optional minimum clean-run requirement (account-level). A clean run = a timed run where the
                 player had ≤1 mechanic failure. -->
            <div class="ilvlreq">
              <label class="row sm"><input type="checkbox" bind:checked={rcMinCleanOn} /> Require minimum clean runs</label>
              {#if rcMinCleanOn}
                <input class="in slim num" type="number" bind:value={rcMinClean} placeholder="clean runs" min="1" max="9999" aria-label="Minimum clean runs" />
                <span class="hint" use:tip={'A clean run = a timed run where you had at most 1 mechanic failure.'}>Only players with this many clean runs can apply. You have {myCleanRuns}.</span>
              {/if}
            </div>

            <!-- Live matching pool counts. -->
            <div class="counts">
              <span class="ctitle">Matching pool right now</span>
              <div class="crow">
                <span class="rc tank">{liveCounts.tank} tanks</span>
                <span class="rc healer">{liveCounts.healer} healers</span>
                <span class="rc dps">{liveCounts.dps} dps</span>
                {#if rcCoach}<span class="rc coach">{liveCounts.coach} coaches</span>{/if}
              </div>
              <div class="crow sub">
                <span class="rc">{liveCounts.characters} characters · {liveCounts.players} players</span>
              </div>
            </div>

            <button class="primary startbtn" onclick={createRun} disabled={!rcDungeon || rcKey === ''}>Create run</button>
            {#if !rcDungeon || rcKey === ''}<p class="muted sm">Pick a dungeon and key level to create the run.</p>{/if}
          </div>
          {/if}
        </div>
      {/if}
    </section>

    <!-- 4) Run Board. Dimmed + cleared when not live (we can't trust the status); a one-shot Refresh or
         going live reveals it. -->
    <section class="card" class:dim={!boardVisible}>
      <div class="card-head"><span class="lbl">Run Board</span>{#if boardVisible}<span class="count">{visibleRuns.length}</span>{/if}</div>
      {#if !boardVisible}
        <p class="board-off pad">You're not live, so the board may be out of date.<br />
          Press <strong>↻ Refresh</strong> (top-right) to load the current runs, or post a Looking Card to go live and watch it update automatically.</p>
      {:else if visibleRuns.length === 0}
        <p class="muted sm pad">{runCards.length === 0 ? 'No runs yet. Pick one of your characters above and choose “Host a run”.' : "No open runs match what you're looking for right now."}</p>
      {:else}
      <div class="runboard">
        {#each visibleRuns as c (c.id)}
          {@const owner = isOwner(c)}
          {@const pc = POOL_DISPLAY[c.runType]}
          <div class="runc {c.runType}" class:mine={owner} class:locked={c.status === 'locked'} class:cancelled={c.status === 'cancelled'} style={`--pc:${pc.color}`}>
            <!-- Title (dungeon +key) + run-type icon (was a colored dot in the mock). -->
            <div class="rc-top">
              <span class="rc-title">{c.dungeon ?? 'Any'}{#if c.keyLevel} <span class="rc-key">+{c.keyLevel}</span>{/if}</span>
              <span class="rc-type" use:tip={poolName(c.runType)} aria-label={poolName(c.runType)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html pc.icon}</svg>
              </span>
            </div>

            <!-- Avatar | needed roles, status, host. -->
            <div class="rc-body">
              <span class="rc-av" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{@html DUNGEON_GLYPH}</svg>
              </span>
              <div class="rc-info">
                <div class="rc-needs">
                  {#each neededRoles(c) as r (r)}
                    <span class="rc-need {r}" class:done={rosterCount(c, r) >= (c.neededRoles[r] ?? 0)} use:tip={`${rosterCount(c, r)}/${c.neededRoles[r]} ${r}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ROLE_ICON[r]}</svg>
                      <span class="rc-nn">{rosterCount(c, r)}</span>
                    </span>
                  {/each}
                </div>
                <div class="rc-line">
                  <span class="rc-status {c.status}"><span class="rc-dot"></span>{c.status === 'open' ? 'Open' : c.status === 'locked' ? 'Locked' : 'Cancelled'}</span>
                  {#if c.minIlvl}<span class="rc-ilvl" use:tip={`Requires ${c.minIlvl}+ item level to apply`}>{c.minIlvl}+ ilvl</span>{/if}
                  {#if c.minCleanRuns}<span class="rc-clean" use:tip={`Requires ${c.minCleanRuns} clean run${c.minCleanRuns === 1 ? '' : 's'} to apply (timed runs with ≤1 mechanic failure)`}>{c.minCleanRuns}+ clean</span>{/if}
                </div>
                <div class="rc-host">
                  <svg class="rc-crown" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html CROWN_GLYPH}</svg>
                  <span class="rc-by">{owner ? 'You' : c.ownerHandle ?? 'someone'}</span>
                </div>
              </div>
            </div>

            <!-- Footer: apply (others) or host controls. -->
            {#if owner}
              <div class="rc-foot owner">
                <div class="run-actions">
                  {#if c.status === 'open'}
                    <button class="tiny" onclick={() => setStatus(c, 'locked')}>Lock</button>
                  {:else if c.status === 'locked'}
                    <button class="tiny" onclick={() => setStatus(c, 'open')}>Reopen</button>
                  {/if}
                  <button class="tiny" onclick={() => showInvite(c)}>{invite?.id === c.id ? 'Hide invite' : 'Invite'}</button>
                  <button class="tiny" use:tip={'Copy a code to paste into the MythicIQ WoW addon — it builds your listing name and tracks who applies/joins.'} onclick={() => showAddon(c, 'leader')}>{addon?.id === c.id ? 'Hide addon' : 'Addon'}</button>
                  <button class="tiny danger" onclick={() => removeRun(c.id)}>Delete</button>
                </div>

                {#if c.roster.length}
                  <div class="roster">{#each c.roster as m (m.sub)}
                    <span class="rmember" title={`${m.character.class} ${m.character.spec}${showIlvl(c) && m.character.ilvl ? ` · ${m.character.ilvl} ilvl` : ''}`}>
                      <span class="rm-left">
                        <span class="rm-role {m.role}" use:tip={m.role === 'dps' ? 'DPS' : m.role.charAt(0).toUpperCase() + m.role.slice(1)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ROLE_ICON[m.role]}</svg>
                        </span>
                        {#if showIlvl(c) && m.character.ilvl}<span class="rm-ilvl">{m.character.ilvl}</span>{/if}
                      </span>
                      <span class="rm-body">
                        <span class="rm-spec" style={`color:${classColor(m.character.class)}`}>{m.character.spec} {m.character.class}</span>
                        <span class="rm-name">{m.character.name}-{m.character.realm}</span>
                      </span>
                    </span>
                  {/each}</div>
                {/if}

                {#if invite?.id === c.id}
                  <div class="invite">
                    {#if invite.invites.length === 0}
                      <p class="muted sm">No one on the roster yet — accept applicants first.</p>
                    {:else}
                      <pre class="invtext">{invite.text}</pre>
                      <button class="primary sm" onclick={copyInvite}>{copied ? 'Copied ✓' : 'Copy invite list'}</button>
                    {/if}
                  </div>
                {/if}

                {#if addon?.id === c.id}
                  <div class="addonx">
                    <p class="muted sm">Paste this into the MythicIQ WoW addon (<code>/miq</code>). It opens the Group Finder, shows the listing name <b>{addon.name}</b> to copy into your premade title, and tracks who applies/joins.</p>
                    <pre class="invtext">{addon.text}</pre>
                    <button class="primary sm" onclick={copyAddon}>{addonCopied ? 'Copied ✓' : 'Copy addon code'}</button>
                  </div>
                {/if}

                {#if pendingByCard[c.id] || openAppsCard === c.id}
                  <div class="reqs">
                    <button class="link" onclick={() => toggleApps(c)}>
                      {openAppsCard === c.id ? '▾' : '▸'} Applications{#if pendingByCard[c.id]} <span class="badge">{pendingByCard[c.id]}</span>{/if}
                    </button>
                    {#if openAppsCard === c.id}
                      {#if appsList.length === 0}
                        <p class="muted sm">No applications.</p>
                      {:else}
                        <ul class="reqlist">
                          {#each appsList as a (a.sub)}
                            <li>
                              <span class="role {a.role}">{a.role}</span>
                              {@render charChip(a.character)}
                              {#if a.matchReason}<span class="why sm">{a.matchReason}</span>{/if}
                              {#if a.note}<span class="note">{a.note}</span>{/if}
                              {#if a.status === 'pending'}
                                <span class="reqact">
                                  <button class="tiny accept" onclick={() => doAccept(c, a.sub)}>Accept</button>
                                  <button class="tiny" onclick={() => doDecline(c, a.sub)}>Decline</button>
                                </span>
                              {:else}<span class="reqstatus {a.status}">{a.status}</span>{/if}
                            </li>
                          {/each}
                        </ul>
                      {/if}
                    {/if}
                  </div>
                {/if}
              </div>
            {:else if onRoster(c)}
              <!-- I'm an accepted member: confirm I'm in + give me the addon code to find/join the in-game group. -->
              <div class="rc-foot">
                <div class="reqbar">
                  <span class="reqstatus accepted">You're in ✓</span>
                  <button class="tiny" use:tip={'Copy a code to paste into the MythicIQ WoW addon — it opens the Group Finder and fills the search box with this group.'} onclick={() => showAddon(c, 'apply')}>{addon?.id === c.id ? 'Hide addon' : 'Addon'}</button>
                </div>
                {#if addon?.id === c.id}
                  <div class="addonx">
                    <p class="muted sm">Paste this into the MythicIQ WoW addon (<code>/miq</code>). It opens the Group Finder and searches for <b>{addon.name}</b> — then apply in-game.</p>
                    <pre class="invtext">{addon.text}</pre>
                    <button class="primary sm" onclick={copyAddon}>{addonCopied ? 'Copied ✓' : 'Copy addon code'}</button>
                  </div>
                {/if}
              </div>
            {:else if c.status === 'open'}
              <div class="rc-foot">
                {#if myApplications[c.id] === 'pending'}
                  <div class="reqbar"><span class="reqstatus pending">Applied</span><button class="tiny" onclick={() => doWithdraw(c)}>Withdraw</button></div>
                {:else if characters.length === 0}
                  <span class="muted sm">Add a character to apply.</span>
                {:else if myGroup}
                  <span class="muted sm" use:tip={"You're already in a group — leave it before joining another."}>In a group</span>
                {:else if c.minCleanRuns && !meetsCleanRuns(c)}
                  <span class="muted sm" use:tip={`This run requires ${c.minCleanRuns} clean run${c.minCleanRuns === 1 ? '' : 's'} — you have ${myCleanRuns}.`}>Need {c.minCleanRuns} clean</span>
                {:else if c.minIlvl && !haveEligibleChar(c)}
                  <span class="muted sm" use:tip={`This run requires ${c.minIlvl}+ item level — none of your characters qualify.`}>Below {c.minIlvl}+ ilvl</span>
                {:else}
                  {#if myApplications[c.id] === 'declined'}<span class="reqstatus declined">Declined</span>{/if}
                  <button class="primary block" class:on={applyPickFor === c.id} onclick={() => startApply(c)}>Apply</button>
                  {#if applyPickFor === c.id}
                    <!-- Character chooser: pick which of your characters to apply with (role = its spec). -->
                    <div class="applypick">
                      <div class="ap-head">Choose a character{#if c.minIlvl} <span class="ap-req">{c.minIlvl}+ ilvl required</span>{/if}</div>
                      {#each characters as ch (ch.id)}
                        {@const icon = iconForChar(ch)}
                        {@const eligible = meetsIlvl(c, ch)}
                        <button type="button" class="ap-row" class:ineligible={!eligible} disabled={!eligible} onclick={() => doApply(c, ch.id)}>
                          <span class="ap-av">{#if ch.avatar}<img src={ch.avatar} alt="" />{:else if icon}<img src={icon} alt="" />{:else}<span class="ap-dot" style={`background:${classColor(ch.class)}`}></span>{/if}</span>
                          <span class="ap-info">
                            <span class="ap-name">{ch.name}</span>
                            <span class="ap-spec" style={`color:${classColor(ch.class)}`}>{ch.spec} {ch.class}</span>
                          </span>
                          {#if ch.ilvl}<span class="ap-ilvl" class:low={!eligible}>{ch.ilvl}</span>{/if}
                          <span class="ap-realm">{ch.realm}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      {/if}
    </section>
  {/if}
  </div>
</div>

<!-- Social-contract modal: shown the first time you apply to a run type (or when its version changes). -->
{#if agreement}
  <div class="modal-back" role="presentation" onclick={cancelAgreement} onkeydown={(e) => { if (e.key === 'Escape') cancelAgreement(); }}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Run agreement" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <h2>{agreement.label} — agreement</h2>
      <p class="muted sm">Before you join a {agreement.label} run, please agree to how this type of run works:</p>
      <ul class="agree">{#each agreement.agreement as line (line)}<li>{line}</li>{/each}</ul>
      <div class="modal-actions">
        <button class="ghost cancel" onclick={cancelAgreement}>Cancel</button>
        <button class="primary" onclick={agreeAndApply}>Agree &amp; apply</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .gv { height: 100%; overflow-y: auto; padding: 22px 26px 40px; color: var(--text); }
  /* Constrain + center the content so panes don't stretch absurdly wide on large monitors. */
  .gv-inner { max-width: 1120px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 16px; }
  .gv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .gv-title h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.01em; }
  .gv-title .sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; max-width: 680px; line-height: 1.5; }
  .beta { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border)); background: color-mix(in srgb, var(--accent) 14%, transparent); padding: 2px 6px; border-radius: 999px; vertical-align: middle; margin-left: 8px; }

  .gate { align-self: center; max-width: 460px; margin-top: 8vh; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .gate .muted { line-height: 1.55; }

  .card { background: var(--surface-2, rgba(255,255,255,0.03)); border: 1px solid var(--border); border-radius: 12px; }
  .card-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .lbl { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text); }
  .count { color: var(--muted); font-weight: 700; font-size: 12px; }
  .card-head .primary.sm { margin-left: auto; }

  .pad { padding: 14px; }
  .list { list-style: none; margin: 0; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
  .list li { display: flex; flex-direction: column; gap: 3px; padding: 8px; border-radius: 8px; }
  .note { color: var(--muted); font-size: 12px; font-style: italic; }
  .why { color: var(--accent); font-size: 12px; }
  .why.sm { font-size: 11px; }

  /* Run-type pill */
  .rt { font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--text); white-space: nowrap; }
  .rt.growth-vault { color: #8fd6a6; border-color: color-mix(in srgb, #8fd6a6 40%, var(--border)); background: color-mix(in srgb, #8fd6a6 12%, transparent); }
  .rt.timed-completion { color: #7dafff; border-color: color-mix(in srgb, #7dafff 40%, var(--border)); background: color-mix(in srgb, #7dafff 12%, transparent); }
  .rt.progression-push { color: #ff8f6b; border-color: color-mix(in srgb, #ff8f6b 40%, var(--border)); background: color-mix(in srgb, #ff8f6b 12%, transparent); }
  .rt.route-lab { color: #d6a6ff; border-color: color-mix(in srgb, #d6a6ff 40%, var(--border)); background: color-mix(in srgb, #d6a6ff 12%, transparent); }

  .role { text-transform: capitalize; font-weight: 700; font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); }
  .role.tank { color: #7dafff; border-color: color-mix(in srgb, #7dafff 40%, var(--border)); background: color-mix(in srgb, #7dafff 12%, transparent); }
  .role.healer { color: #5fd08a; border-color: color-mix(in srgb, #5fd08a 40%, var(--border)); background: color-mix(in srgb, #5fd08a 12%, transparent); }
  .role.dps { color: #ff8f6b; border-color: color-mix(in srgb, #ff8f6b 40%, var(--border)); background: color-mix(in srgb, #ff8f6b 12%, transparent); }
  .role.coach { color: #d6a6ff; border-color: color-mix(in srgb, #d6a6ff 40%, var(--border)); background: color-mix(in srgb, #d6a6ff 12%, transparent); }

  /* Character display */
  .cdot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; }
  .charline { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
  .clname { font-weight: 700; }
  .clspec { color: var(--muted); font-size: 11px; }
  .cilvl { font-size: 10.5px; font-weight: 700; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; }
  /* "Last refreshed" hint under the Add Character button (Armory sync freshness for the pane). */
  .refreshed { margin: -2px 14px 0; text-align: right; font-size: 10.5px; }

  /* Your Characters — toon grid */
  .toonsearch { margin-left: auto; width: 180px; }
  .card-head .toonsearch + .primary.sm { margin-left: 8px; }
  .toons { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; padding: 12px 14px; }
  .toon { display: flex; align-items: center; gap: 11px; text-align: left; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); cursor: pointer; color: var(--text); }
  .toon:hover { border-color: var(--muted); }
  .toon.on { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); background: color-mix(in srgb, var(--accent) 8%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent) inset; }
  .tav { width: 42px; height: 42px; border-radius: 50%; flex: none; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; border: 2px solid var(--cc, var(--border)); background: color-mix(in srgb, var(--cc, var(--muted)) 18%, transparent); }
  .tav img { width: 100%; height: 100%; object-fit: cover; }
  .tav-dot { width: 16px; height: 16px; border-radius: 50%; background: var(--cc, var(--muted)); }
  .tinfo { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .tname { font-weight: 800; font-size: 14px; }
  .tspec { font-size: 12px; font-weight: 600; }
  .trole { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--muted); margin-top: 1px; }
  .trole svg { width: 13px; height: 13px; }
  .trole.tank { color: #7dafff; } .trole.healer { color: #5fd08a; } .trole.dps { color: #ff8f6b; }
  .tstatus { display: inline-flex; align-items: center; gap: 5px; flex: none; align-self: flex-start; }
  .pooldot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .pooldot.off { background: var(--muted); opacity: 0.6; }
  .stxt { font-size: 11px; color: var(--muted); }
  .stxt.off { opacity: 0.85; }

  /* Selected-toon panel (manage pools + create a Looking Card) */
  .toonpanel { border-top: 1px solid var(--border); }
  /* Sticky header: pins the selected toon to the top of the scroll area while you fill the form, so you
     never forget who you picked even if the grid scrolled away. Solid bg so content scrolls cleanly under. */
  .tp-head {
    display: flex; align-items: center; gap: 11px; padding: 11px 14px; position: sticky; top: 0; z-index: 15;
    background: var(--card-bg, #161a22); border-bottom: 1px solid var(--border);
  }
  .tp-head .tav.sm { width: 34px; height: 34px; }
  .tp-id { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .tp-name { font-weight: 800; font-size: 14px; }
  .tp-sub { font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tp-role { display: inline-flex; align-items: center; gap: 3px; font-weight: 700; }
  .tp-role svg { width: 12px; height: 12px; }
  .tp-role.tank { color: #7dafff; } .tp-role.healer { color: #5fd08a; } .tp-role.dps { color: #ff8f6b; }
  .tp-head .tiny { margin-left: auto; align-self: flex-start; }
  .tp-cards { display: flex; flex-direction: column; gap: 4px; padding: 4px 14px; }
  .tp-card { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; }
  .tp-pool { font-weight: 700; }
  .tp-card .actions { margin-left: auto; display: flex; gap: 6px; }
  .krange { font-size: 12px; color: var(--muted); font-weight: 700; }
  .ttl { font-size: 11px; color: var(--muted); }

  /* Pool picker (clickable cards + hover-expand expectations) */
  .poolpick { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
  .poolopt { position: relative; display: flex; align-items: flex-start; gap: 9px; text-align: left; padding: 10px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); cursor: pointer; color: var(--text); }
  .poolopt:hover { border-color: color-mix(in srgb, var(--pc) 55%, var(--border)); }
  .poolopt.on { border-color: var(--pc); background: color-mix(in srgb, var(--pc) 12%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--pc) 45%, transparent) inset; }
  .po-ico { display: inline-flex; flex: none; color: var(--pc); margin-top: 1px; }
  .po-ico svg { width: 18px; height: 18px; }
  .po-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .po-name { font-weight: 700; font-size: 13px; }
  .po-desc { font-size: 11px; color: var(--muted); line-height: 1.35; }
  /* Hover popover: absolutely positioned, so it overlays neighbors without shifting layout. */
  .po-pop {
    position: absolute; top: calc(100% - 6px); left: 0; right: 0; z-index: 20;
    background: var(--card-bg, #161a22); border: 1px solid color-mix(in srgb, var(--pc) 45%, var(--border));
    border-radius: 9px; padding: 9px 11px; box-shadow: 0 12px 28px rgba(0,0,0,0.5);
    opacity: 0; transform: translateY(-4px); pointer-events: none; transition: opacity 0.12s ease, transform 0.12s ease;
  }
  .poolopt:hover .po-pop { opacity: 1; transform: translateY(0); }
  .po-pop-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--pc); }
  .po-pop ul { margin: 6px 0 0; padding-left: 16px; display: flex; flex-direction: column; gap: 4px; }
  .po-pop li { font-size: 11.5px; line-height: 1.4; color: var(--text); }

  /* Dual-knob key-range slider (two overlaid native range inputs). */
  .kr-head { display: flex; align-items: baseline; justify-content: space-between; }
  .kr-val { font-size: 12px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
  .dualrange { position: relative; height: 26px; }
  .dr-rail { position: absolute; top: 50%; left: 0; right: 0; height: 4px; transform: translateY(-50%); border-radius: 999px; background: var(--border); }
  .dr-fill { position: absolute; top: 50%; left: var(--a); right: calc(100% - var(--b)); height: 4px; transform: translateY(-50%); border-radius: 999px; background: var(--accent); }
  .dualrange input[type='range'] {
    position: absolute; top: 0; left: 0; width: 100%; height: 26px; margin: 0; background: none;
    -webkit-appearance: none; appearance: none; pointer-events: none;
  }
  .dualrange input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; pointer-events: auto; width: 16px; height: 16px; border-radius: 50%;
    background: var(--text); border: 2px solid var(--accent); cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.5);
  }
  .dualrange input[type='range']::-moz-range-thumb {
    pointer-events: auto; width: 16px; height: 16px; border-radius: 50%; background: var(--text);
    border: 2px solid var(--accent); cursor: pointer;
  }
  .dualrange input[type='range']::-moz-range-track { background: none; }

  .startbtn { align-self: flex-start; }

  /* Dungeon picker (a filter pane of toggle chips). */
  .dun-actions { display: inline-flex; align-items: center; gap: 6px; }
  .dun-count { font-size: 11px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
  .dungrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
  .dunchip {
    text-align: left; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg); color: var(--muted); cursor: pointer; font-size: 12.5px; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .dunchip:hover { border-color: var(--muted); color: var(--text); }
  .dunchip.on {
    color: var(--text); border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent) inset;
  }
  .duns { font-size: 11px; color: var(--muted); cursor: help; }

  .flbl .hint { text-transform: none; letter-spacing: 0; font-weight: 600; color: var(--muted); opacity: 0.8; margin-left: 6px; }

  /* Toon wizard: intent step (Find a group / Host a run) shown before the matching form. */
  .tp-choice { padding: 16px 14px; display: flex; flex-direction: column; gap: 12px; }
  .tp-q { margin: 0; font-size: 13.5px; color: var(--muted); }
  .tp-q strong { color: var(--text); }
  .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .choice { display: flex; align-items: center; gap: 12px; text-align: left; padding: 14px 16px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg); cursor: pointer; color: var(--text); transition: border-color 0.14s, background 0.14s, box-shadow 0.14s; }
  .choice:hover { border-color: color-mix(in srgb, var(--hover-accent, #8a5cff) 60%, var(--border)); background: color-mix(in srgb, var(--hover-accent, #8a5cff) 7%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--hover-accent, #8a5cff) 30%, transparent) inset; }
  .choice.host:hover { border-color: color-mix(in srgb, #e9c46a 60%, var(--border)); background: color-mix(in srgb, #e9c46a 9%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, #e9c46a 30%, transparent) inset; }
  .ch-ico { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); }
  .choice.host .ch-ico { color: #e9c46a; background: color-mix(in srgb, #e9c46a 14%, transparent); border-color: color-mix(in srgb, #e9c46a 35%, var(--border)); }
  .ch-ico svg { width: 20px; height: 20px; }
  .ch-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ch-name { font-weight: 800; font-size: 14px; }
  .ch-desc { font-size: 12px; color: var(--muted); line-height: 1.35; }
  /* Back link to the intent step. */
  .backbtn { align-self: flex-start; background: none; border: none; color: var(--accent); font-size: 12px; font-weight: 700; cursor: pointer; padding: 0; }
  .backbtn:hover { text-decoration: underline; }

  /* Looking pool — a card per run type, straight across the top (no backing section). */
  .poolcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  /* Each pool card is tinted by its own color (`--pc`): a colored border + a faint color wash, deepening on hover. */
  .poolcard { position: relative; border: 1px solid color-mix(in srgb, var(--pc) 40%, var(--border)); border-radius: 10px; background: color-mix(in srgb, var(--pc) 8%, var(--surface-2, rgba(255,255,255,0.03))); padding: 11px 13px; display: flex; flex-direction: column; gap: 11px; transition: border-color 0.12s ease, background 0.12s ease; }
  .poolcard:hover { border-color: color-mix(in srgb, var(--pc) 65%, var(--border)); background: color-mix(in srgb, var(--pc) 14%, var(--surface-2, rgba(255,255,255,0.03))); }
  .pc-head { display: flex; align-items: center; gap: 8px; }
  .pc-ico { display: inline-flex; flex: none; color: var(--pc); }
  .pc-ico svg { width: 18px; height: 18px; }
  .pc-title { font-weight: 700; font-size: 13.5px; color: var(--text); }
  /* The "your characters in this pool" number — gray at 0, gold when you have any. */
  .pc-mine { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--muted); cursor: help; font-variant-numeric: tabular-nums; }
  .pc-mine.has { color: #e9c46a; }
  .pc-roles { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pc-role { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--muted); cursor: help; font-variant-numeric: tabular-nums; }
  .pc-role svg { width: 15px; height: 15px; flex: none; }
  .pc-role.tank { color: #7dafff; } .pc-role.healer { color: #5fd08a; } .pc-role.dps { color: #ff8f6b; } .pc-role.coach { color: #d6a6ff; }
  /* Hover pane: the pool's purpose + expectations, overlaying neighbors (no layout shift). */
  .pc-pop {
    position: absolute; top: calc(100% - 4px); left: 0; right: 0; z-index: 20;
    background: var(--card-bg, #161a22); border: 1px solid color-mix(in srgb, var(--pc) 45%, var(--border));
    border-radius: 10px; padding: 10px 12px; box-shadow: 0 12px 28px rgba(0,0,0,0.5);
    opacity: 0; transform: translateY(-4px); pointer-events: none; transition: opacity 0.12s ease, transform 0.12s ease;
    display: flex; flex-direction: column; gap: 3px;
  }
  .poolcard:hover .pc-pop { opacity: 1; transform: translateY(0); }
  .pc-pop-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--pc); }
  .pc-pop-tag { font-size: 12px; color: var(--text); line-height: 1.35; }
  .pc-pop ul { margin: 6px 0 0; padding-left: 16px; display: flex; flex-direction: column; gap: 4px; }
  .pc-pop li { font-size: 11.5px; line-height: 1.4; color: var(--muted); }
  .pc-n { color: var(--text); }

  /* Inline role counts (Create Run "matching pool right now"). */
  .rc { font-size: 11.5px; font-weight: 700; color: var(--muted); }
  .rc.tank { color: #7dafff; } .rc.healer { color: #5fd08a; } .rc.dps { color: #ff8f6b; } .rc.coach { color: #d6a6ff; }

  /* Forms */
  .form { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .fld { display: flex; flex-direction: column; gap: 6px; }
  .flbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }

  .counts { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: var(--bg); display: flex; flex-direction: column; gap: 6px; }
  .ctitle { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .crow { display: flex; gap: 12px; flex-wrap: wrap; }
  .crow .rc { font-size: 13px; }
  .crow.sub .rc { font-size: 12px; color: var(--muted); }

  /* Run board */
  /* Not-live state: the whole panel reads as inactive, and a clear call-to-action replaces the cards. */
  .card.dim { opacity: 0.6; filter: grayscale(0.85); }
  .board-off { color: var(--text); font-size: 12.5px; line-height: 1.6; opacity: 0.9; }
  .board-off strong { color: var(--accent); }
  /* A responsive grid of run cards (browse + apply), matching the board mock. */
  .runboard { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; padding: 14px; }
  /* Tinted by the run's pool color (`--pc`) — matches the pool cards up top. Your own hosted run (.mine)
     overrides this with the accent glow below. */
  .runc {
    display: flex; flex-direction: column; gap: 12px;
    border: 1px solid color-mix(in srgb, var(--pc) 40%, var(--border)); border-radius: 12px;
    background: color-mix(in srgb, var(--pc) 8%, var(--surface-2, rgba(255,255,255,0.025))); padding: 14px 15px;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }
  .runc:not(.mine):hover {
    border-color: color-mix(in srgb, var(--pc) 65%, var(--border));
    background: color-mix(in srgb, var(--pc) 14%, var(--surface-2, rgba(255,255,255,0.025)));
  }
  .runc.locked { opacity: 0.85; }
  .runc.cancelled { opacity: 0.55; }
  /* Your hosted run: glowing tinted background + shadow (and the sort pins it first). */
  .runc.mine {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent) 9%, var(--surface-2, rgba(255,255,255,0.025)));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent),
      0 0 22px -4px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .rc-top { display: flex; align-items: flex-start; gap: 8px; }
  .rc-title { flex: 1; min-width: 0; font-size: 16px; font-weight: 800; color: var(--text); line-height: 1.2; }
  .rc-key { color: var(--muted); font-weight: 800; }
  .rc-type { flex: none; display: inline-flex; color: var(--pc, var(--muted)); }
  .rc-type svg { width: 19px; height: 19px; }
  .rc-body { display: flex; align-items: center; gap: 13px; }
  .rc-av {
    flex: none; width: 52px; height: 52px; border-radius: 999px; display: grid; place-items: center;
    color: var(--pc, var(--muted));
    background: radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--pc, var(--muted)) 26%, transparent), color-mix(in srgb, var(--pc, var(--muted)) 8%, transparent));
    border: 1px solid color-mix(in srgb, var(--pc, var(--muted)) 35%, var(--border));
  }
  .rc-av svg { width: 26px; height: 26px; opacity: 0.92; }
  .rc-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .rc-needs { display: flex; align-items: center; gap: 12px; }
  .rc-need { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .rc-need svg { width: 16px; height: 16px; }
  .rc-need.done { opacity: 0.42; }
  .rc-need.tank { color: #7dafff; } .rc-need.healer { color: #5fd08a; } .rc-need.dps { color: #ff8f6b; } .rc-need.coach { color: #d6a6ff; }
  .rc-nn { color: var(--text); }
  .rc-line { display: flex; align-items: center; gap: 8px; }
  .rc-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); }
  .rc-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--muted); flex: none; }
  .rc-status.open { color: #5fd08a; } .rc-status.open .rc-dot { background: #5fd08a; }
  .rc-status.locked { color: var(--accent); } .rc-status.locked .rc-dot { background: var(--accent); }
  .rc-status.cancelled { color: var(--warn, #e0a82e); } .rc-status.cancelled .rc-dot { background: var(--warn, #e0a82e); }
  /* Requirement badges on a run-board card (item level / clean runs). */
  .rc-ilvl { font-size: 10.5px; font-weight: 800; color: #e9c46a; border: 1px solid color-mix(in srgb, #e9c46a 40%, var(--border)); background: color-mix(in srgb, #e9c46a 12%, transparent); border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
  .rc-clean { font-size: 10.5px; font-weight: 800; color: #5fd08a; border: 1px solid color-mix(in srgb, #5fd08a 40%, var(--border)); background: color-mix(in srgb, #5fd08a 12%, transparent); border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
  .rc-host { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  .rc-crown { width: 13px; height: 13px; color: #e9c46a; flex: none; }
  .rc-by { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rc-foot { display: flex; flex-direction: column; gap: 8px; }
  .primary.block { padding: 9px 14px; } /* width:100% comes from the global .primary.block */
  /* Apply → "choose a character" chooser (in-flow panel so it never clips inside the grid/scroller). */
  .applypick { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 6px; }
  .ap-head { font-size: 11px; font-weight: 700; color: var(--muted); padding: 4px 6px 6px; }
  .ap-req { color: #e9c46a; font-weight: 800; margin-left: 4px; }
  .ap-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: transparent; border: 1px solid transparent; border-radius: 8px; padding: 6px; cursor: pointer; color: var(--text); transition: background 0.14s, border-color 0.14s; }
  .ap-row:hover { background: var(--surface-2); border-color: color-mix(in srgb, var(--hover-accent, #8a5cff) 55%, var(--border)); }
  .ap-row.ineligible { opacity: 0.5; cursor: not-allowed; }
  .ap-row.ineligible:hover { background: transparent; border-color: transparent; }
  .ap-ilvl { font-size: 11px; font-weight: 700; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; flex: none; }
  .ap-ilvl.low { color: var(--warn, #e0a82e); border-color: color-mix(in srgb, var(--warn, #e0a82e) 45%, var(--border)); }
  .ap-av { width: 34px; height: 34px; border-radius: 50%; overflow: hidden; flex: none; display: inline-flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--muted) 18%, transparent); border: 1px solid var(--border); }
  .ap-av img { width: 100%; height: 100%; object-fit: cover; }
  .ap-dot { width: 14px; height: 14px; border-radius: 50%; }
  .ap-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
  .ap-name { font-weight: 700; font-size: 13px; }
  .ap-spec { font-size: 11.5px; }
  .ap-realm { font-size: 11.5px; color: var(--muted); flex: none; }
  .roster { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
  /* Uniform fixed-size roster tile: role icon + (spec/class over name-realm). */
  .rmember { display: inline-flex; align-items: center; gap: 7px; width: 156px; height: 40px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 7px; padding: 4px 8px; background: var(--bg); overflow: hidden; }
  .rm-left { flex: none; display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .rm-role { display: inline-flex; align-items: center; }
  .rm-role svg { width: 16px; height: 16px; }
  .rm-role.tank { color: #7dafff; } .rm-role.healer { color: #5fd08a; } .rm-role.dps { color: #ff8f6b; } .rm-role.coach { color: #d6a6ff; }
  .rm-ilvl { font-size: 9px; font-weight: 700; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 0 3px; line-height: 1.3; }
  .rm-body { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
  .rm-spec { font-size: 11.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rm-name { font-size: 10px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .run-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
  .invite { margin-top: 10px; }
  .invtext { margin: 0 0 8px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); font-size: 12px; white-space: pre-wrap; color: var(--text); word-break: break-all; }
  .addonx { margin-top: 10px; }
  .addonx p { margin: 0 0 8px; }
  .addonx code { padding: 1px 4px; border-radius: 4px; background: var(--bg); border: 1px solid var(--border); font-size: 11px; }

  /* Apply / queue (shared with the old request UI styling) */
  .reqbar { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .reqs { margin-top: 10px; }
  .link { background: none; border: none; color: var(--accent); font-size: 12px; font-weight: 700; cursor: pointer; padding: 0; display: inline-flex; align-items: center; gap: 6px; }
  .badge { background: var(--accent); color: #0a0c10; font-size: 10px; font-weight: 800; border-radius: 999px; padding: 0 6px; min-width: 16px; text-align: center; }
  .reqlist { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .reqlist li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; flex-wrap: wrap; }
  .ib-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ib-meta { font-size: 12px; color: var(--muted); }
  .reqact { display: flex; gap: 6px; margin-left: auto; }
  .reqstatus { font-size: 11px; font-weight: 700; text-transform: capitalize; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
  .reqstatus.pending { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
  .reqstatus.accepted { color: var(--good, #5fd08a); border-color: color-mix(in srgb, var(--good, #5fd08a) 40%, var(--border)); }
  .reqstatus.declined { color: var(--warn, #e0a82e); border-color: color-mix(in srgb, var(--warn, #e0a82e) 40%, var(--border)); }
  .tiny.accept { color: var(--good, #5fd08a); border-color: color-mix(in srgb, var(--good, #5fd08a) 45%, var(--border)); }
  .tiny.accept:hover { background: color-mix(in srgb, var(--good, #5fd08a) 14%, transparent); }

  /* Min-ilvl requirement (host form): the checkbox row + revealed field. */
  .ilvlreq { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ilvlreq .hint { font-size: 11px; color: var(--muted); }

  /* Shared controls */
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .row.sm { font-size: 13px; gap: 6px; color: var(--muted); }
  .in { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-size: 13px; color-scheme: dark; }
  .in.slim { padding: 4px 7px; font-size: 12px; }
  .in.num { width: 80px; }
  .muted { color: var(--muted); }
  .sm { font-size: 12px; }
  .err { color: var(--warn, #e0a82e); font-size: 13px; margin: 0; }
  .actions { display: flex; gap: 6px; }

  /* Error toast — viewport-fixed, bottom-center, so it's visible regardless of scroll position. */
  .gv-toast {
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
    z-index: 60; display: inline-flex; align-items: center; gap: 12px;
    max-width: min(520px, 92vw); padding: 11px 14px; border-radius: 10px;
    background: var(--surface, #1b1d23);
    border: 1px solid color-mix(in srgb, var(--warn, #e0a82e) 55%, var(--border, #3a3d46));
    color: var(--warn, #e0a82e); font-size: 13px; font-weight: 600;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
    animation: gvtoastin 0.18s ease-out;
  }
  .gv-toast-msg { line-height: 1.35; }
  .gv-toast-x {
    background: none; border: none; color: inherit; opacity: 0.65; cursor: pointer;
    font-size: 13px; padding: 0 2px; line-height: 1; flex: none;
  }
  .gv-toast-x:hover { opacity: 1; }
  @keyframes gvtoastin {
    from { opacity: 0; transform: translate(-50%, 8px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  @media (prefers-reduced-motion: reduce) { .gv-toast { animation: none; } }

  /* .primary / .ghost / .tiny base styles now come from the global sleek button system in app.css. */
  .ghost.icon { padding: 6px 9px; font-size: 14px; line-height: 1; }
  /* Live/Auto board-status flag next to the (now-secondary) manual refresh. */
  .gv-live { display: inline-flex; align-items: center; gap: 8px; flex: none; }
  .gv-notlive { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .gv-notlive-row { display: inline-flex; align-items: center; gap: 8px; }
  .gv-notlive-sub { margin: 0; font-size: 11px; color: var(--muted); max-width: 240px; text-align: right; line-height: 1.3; }
  .liveflag { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); cursor: default; }
  .liveflag.on { color: var(--good, #4ade80); }
  .lvdot { width: 7px; height: 7px; border-radius: 999px; background: var(--muted); flex: none; }
  .liveflag.on .lvdot { background: var(--good, #4ade80); }
  .lvdot.pulse { animation: gvlivepulse 1.8s ease-in-out infinite; }
  @keyframes gvlivepulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--good, #4ade80) 60%, transparent); }
    50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--good, #4ade80) 0%, transparent); }
  }
  .tiny.danger:hover { color: #ffb4b4; border-color: #5a2a2a; }

  /* Agreement modal */
  .modal-back { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .modal { width: min(460px, 100%); background: var(--bg, #14161c); color: var(--text); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; box-shadow: 0 16px 48px rgba(0,0,0,0.5); }
  .modal h2 { margin: 0 0 6px; font-size: 16px; }
  .agree { margin: 10px 0 14px; padding-left: 20px; display: flex; flex-direction: column; gap: 7px; font-size: 13px; line-height: 1.5; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .modal-actions .cancel:hover { background: color-mix(in srgb, var(--bad, #f87171) 20%, transparent); border-color: var(--bad, #f87171); color: var(--bad, #f87171); }
</style>
