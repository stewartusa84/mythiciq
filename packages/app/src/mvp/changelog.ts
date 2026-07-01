// Curated, user-facing changelog. We deliberately do NOT log every change (most are cosmetic / minor
// fixes) — this is the central place for notable, user-relevant notes, especially "we fixed a bug in
// X analysis, which means your numbers may have changed". Mark an entry `critical: true` when users
// should actively know about it: that surfaces an accent on the Notifications bell until they open it.
//
// The full changelog now lives in Settings → "What's new"; recent entries ALSO surface as cards in the
// Notifications bell dropdown (see notifications.ts), where each can be clicked to jump to the relevant
// part of the app (via the optional `link`) or dismissed.
//
// Newest entries FIRST. `id` must be stable + unique (it's the "seen"/"dismissed" marker), so never reuse one.

/** In-app navigation target for a notification card. Omit for a purely informational entry (dismiss only). */
export type NotificationLink =
  | { kind: 'settings' }
  | { kind: 'tab'; tab: 'overview' | 'pulls' | 'role' | 'mechanics' | 'deaths' | 'insights' };

export interface ChangeEntry {
  /** Stable unique id (also the seen/dismissed marker) — e.g. `YYYY-MM-DD-slug`. Never reuse. */
  id: string;
  /** Human display date. */
  date: string;
  title: string;
  detail?: string;
  /** Surfaces the accent on the Notifications bell until the user opens it. Use for changes users must know. */
  critical?: boolean;
  /** Where clicking the notification card takes the user. A `tab` link needs a loaded run to be useful
   *  (rendered informational-only when no run is loaded); a `settings` link always works. */
  link?: NotificationLink;
}

export const CHANGELOG: ChangeEntry[] = [
  {
    id: '2026-06-30-mechanic-suggest-edit',
    date: 'June 30, 2026',
    title: 'Suggest edits to mechanic cards',
    detail:
      'Open any card in the Mechanics Library (or from a mechanic’s details) and click “✎ Suggest edit” to ' +
      'propose changes — the summary, role advice, whether it’s avoidable/interruptible/a dangerous debuff, ' +
      'tags, and videos. Your suggestion goes into a review queue; a curator checks it before it goes live, ' +
      'so nothing changes instantly. Thanks for helping improve the mechanics data!',
  },
  {
    id: '2026-06-29-desktop-low-resource',
    date: 'June 29, 2026',
    title: 'Desktop: low resource mode',
    detail:
      'A new opt-in setting (Settings → Performance) for the desktop app. When it’s on, MythicIQ unloads ' +
      'its window a few seconds after you minimize it to the tray, freeing the memory the UI was using. ' +
      'It keeps watching and carving your runs the whole time — only the display is unloaded — and ' +
      'reopening from the tray rebuilds it. The short delay lets you pop back instantly if you minimized ' +
      'by accident.',
    link: { kind: 'settings' },
  },
  {
    id: '2026-06-28-desktop-raid-pulls',
    date: 'June 28, 2026',
    title: 'Desktop: review each raid pull the moment it ends',
    detail:
      'On the desktop app, while it’s watching your log, every raid boss pull (wipe or kill) is now carved ' +
      'out the instant the pull ends and added to the raid review switcher, grouped by boss — so ' +
      'raid leaders can review mechanics between pulls without loading the whole night. Click a pull to open ' +
      'it in the replay. There’s an opt-in setting (Settings → Raid review) to auto-open the replay on a wipe.',
  },
  {
    id: '2026-06-23-group-chat',
    date: 'June 23, 2026',
    title: 'Group chat in the Group Finder',
    detail:
      'Once you’re in a group (you accepted into a run, or someone joined yours), a floating 💬 chat ' +
      'bubble appears at the bottom-right so the group can coordinate in real time. It works app-wide, ' +
      'shows an unread badge, and a new message dings (and pops a desktop notification when the app is in ' +
      'the background). Chat is live for the session — it isn’t saved, so it starts fresh after a reload.',
  },
  {
    id: '2026-06-17-replay-load-reliability',
    date: 'June 17, 2026',
    title: 'Fixed: replay occasionally showed a stray “Load replay” button',
    detail:
      'When a run finished parsing, the replay could briefly race the parser and fall back to an old ' +
      'diagnostic “Load replay” prompt instead of just playing. The replay now waits for the parse and ' +
      'loads on its own; if it ever can’t, you get a clear “Replay unavailable · Retry” instead.',
  },
  {
    id: '2026-06-17-journal-incoming-damage',
    date: 'June 17, 2026',
    title: 'Combat journal now shows incoming damage + clearer values',
    detail:
      'Each player’s combat journal in the replay now lists the damage they took (red “− amount ← source”, ' +
      'with melee swings and environmental damage labelled properly), alongside what they cast. Cast rows ' +
      'show the spell’s value (e.g. 43K, 1.2M); abilities whose damage logs under a different name — and ' +
      'ground/channeled AoE like Spinning Crane Kick, Death and Decay, Consecration — now read a sensible ' +
      'total instead of nothing.',
  },
  {
    id: '2026-06-17-replay-ui-polish',
    date: 'June 17, 2026',
    title: 'Replay pane: cleaner layout + Compact mode',
    detail:
      'A round of tidying on the replay: aura/cooldown chips are now crisp icons (full name + ready state ' +
      'on hover), buff/debuff stacks show as a small badge, and dangerous-debuff / “kick now” highlights ' +
      'are easier to read at a glance. A new Compact toggle shrinks the player cards for smaller screens, ' +
      'and your Compact / misc-buff / journal-filter choices now stick between runs and sessions.',
  },
  {
    id: '2026-06-17-insights-ui',
    date: 'June 17, 2026',
    title: 'Insight metrics: smoother library & editing',
    detail:
      'More polish on the Insights metric library — browsing, adding, and editing custom metrics is ' +
      'cleaner and easier to follow.',
  },
  {
    id: '2026-06-15-replay-load-fix',
    date: 'June 15, 2026',
    title: 'Fixed: some runs got stuck on “building replay”',
    detail:
      'A run that happened to log two deaths or two interrupts at the exact same instant would crash the ' +
      'replay and leave it spinning on “building replay” forever (the rest of the analysis still loaded). ' +
      'Those runs now open normally.',
  },
  {
    id: '2026-06-15-journal-filter-invert',
    date: 'June 15, 2026',
    title: 'Combat-journal filter: show by default, uncheck to hide',
    detail:
      'The replay’s combat-journal spell filter is now the right way round — every spell shows by default ' +
      'and you uncheck the ones you want to hide (it used to be the reverse). Hidden spells move to the top ' +
      'of the list so they’re easy to restore, and “clear” is now “show all”.',
  },
  {
    id: '2026-06-14-instant-history',
    date: 'June 14, 2026',
    title: 'Saved runs open instantly + a clearer load screen',
    detail:
      'Opening a saved run now shows all the analysis panels immediately while the replay rebuilds in ' +
      'the background — no more waiting on a full re-parse to see your run, and it no longer flips back ' +
      'to the drop screen. Loading a fresh log shows a step-by-step progress screen (read → parse → ' +
      'detect pulls → analytics) instead of a single spinner.',
  },
  {
    id: '2026-06-14-avoidable-advice',
    date: 'June 14, 2026',
    title: 'Overview “rough patches” + how-to-avoid tips for mechanics',
    detail:
      'The Overview now flags the run’s rough patches — the mechanics the group ate avoidable damage ' +
      'from — with a quick “how to avoid” tip each and a jump into the Mechanics tab. The Mechanics ' +
      'avoidable-damage panel now shows that guidance under every mechanic so you can see how to stop ' +
      'it wrecking the run.',
    link: { kind: 'tab', tab: 'mechanics' },
  },
  {
    id: '2026-06-14-insights-library-redesign',
    date: 'June 14, 2026',
    title: 'Insights: a metric library + watchlist',
    detail:
      'The Insights page is now a single always-on metric library with a Watchlist on top. Click ' +
      '“watch” on any metric to track it (it’s evaluated and drawn on the replay timeline); click it ' +
      'again to stop. “Create metric” opens a guided modal that explains each metric in plain English ' +
      'and previews what it finds; click any library metric to edit it the same way (clicking outside ' +
      'the modal saves it). Metrics that apply to several specs are now one shared entry instead of a ' +
      'duplicate per spec.',
  },
  {
    id: '2026-06-14-targets-hit-insight',
    date: 'June 14, 2026',
    title: 'Custom insight: casts that hit too few targets',
    detail:
      'Insights has a new metric — “cast hit too few targets”. Pick a spell and a minimum, and it flags ' +
      'every cast that landed on fewer than N enemies (e.g. Spinning Crane Kick or Chain Lightning on <3), ' +
      'shown as bands on the replay timeline so you can spot suboptimal AoE at a glance.',
  },
  {
    id: '2026-06-14-healer-capacity',
    date: 'June 14, 2026',
    title: 'Healer capacity (pressure) on the replay',
    detail:
      'The replay now estimates each healer’s capacity — the share of their cast time spent healing — ' +
      'shown as a stoplight % on the healer card and a green/amber/red band on the run timeline. GCD is ' +
      'derived from haste (shortened during Bloodlust/Heroism); Disc/Mistweaver count their damage as ' +
      'healing. It ignores movement/LoS/mana, so it’s an at-a-glance pressure read, not exact truth.',
  },
  {
    id: '2026-06-14-removal-cooldown-detail',
    date: 'June 14, 2026',
    title: 'Cleanse / Removal: which remover, cooldown-blocked vs missed, and trimmable uptime',
    detail:
      'The Mechanics → Cleanse / Removal section now names the specific remover that went unused on a ' +
      'missed debuff, totals how long dangerous debuffs were active, shows how much of that uptime ' +
      'could’ve been trimmed if removers had been used when available, and splits misses into "could’ve ' +
      'been removed" (a remover was off cooldown) vs. "couldn’t be removed" (every remover was on ' +
      'cooldown — a forced heal-through, e.g. a 2nd debuff landing while your 8s dispel was spent).',
  },
  {
    id: '2026-06-14-dangerous-debuff-highlight',
    date: 'June 14, 2026',
    title: 'Dangerous debuffs highlighted in the replay',
    detail:
      'Curated dangerous debuffs now glow red on each player card in the replay, with a green dot when ' +
      'a remover can clear it (vs. a heal-through you just have to heal off). Paired with the existing ' +
      'dispel-cooldown glow, you can see at a glance when a dispel is available for a dangerous debuff ' +
      'and when it’s on cooldown and someone has to heal through it.',
    link: { kind: 'tab', tab: 'mechanics' },
  },
  {
    id: '2026-06-14-combatant-info',
    date: 'June 14, 2026',
    title: 'Player gear, talents & corrected secondary stats',
    detail:
      'We now read each player’s spec, talents, equipped gear, and secondary stats straight from the ' +
      'log (no addon needed) — see the new Composition card on the Overview tab. While wiring this up we ' +
      'fixed a long-standing bug: the crit/haste/mastery/versatility ratings were read from the wrong ' +
      'fields (crit always showed 0, haste showed the leech value). Those numbers are now correct.',
    critical: true,
    link: { kind: 'tab', tab: 'overview' },
  },
  {
    id: '2026-06-13-shared-stats',
    date: 'June 13, 2026',
    title: 'Anonymized run-stat sharing + comparisons',
    detail:
      'Opt in (Settings) to share an anonymized, name-free statistical summary of your runs and see how ' +
      'they compare to the field — by spec and by boss.',
    link: { kind: 'settings' },
  },
  {
    id: '2026-06-11-pet-attribution',
    date: 'June 11, 2026',
    title: 'Pet damage & healing now credited to the owner',
    detail:
      'Pet output (Demonology Warlock, Beast Mastery Hunter, Unholy DK, and other pet specs) was being ' +
      'undercounted. Pets are now attributed to their owner, so those players’ DPS/HPS went UP and now ' +
      'reflect their real output — if your numbers changed for one of these specs, this is why.',
    critical: true,
    link: { kind: 'tab', tab: 'role' },
  },
];

export const latestChangeId = (): string | undefined => CHANGELOG[0]?.id;

// Notification surfacing (unread / dismissed / critical accounting) now lives in notifications.ts, which
// reads this CHANGELOG. The bell shows recent entries as dismissible cards; Settings → "What's new" is
// the full archive.
