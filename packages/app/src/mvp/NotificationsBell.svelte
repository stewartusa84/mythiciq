<!-- Topbar Notifications bell + dropdown. Replaces the old "What's new" MODAL: recent changelog entries
     surface here as cards that can be CLICKED to jump to the relevant part of the app (via each entry's
     optional `link`) or DISMISSED if they're just informational. The full changelog now lives in
     Settings → "What's new"; this bell is the "new since you last looked" surface.
     Opening the dropdown marks everything read (clears the unread badge). Mirrors AccountMenu's
     self-contained button+dropdown + outside-click-close pattern. -->
<script lang="ts">
  import { settings } from './settings.svelte.js';
  import { buildNotifications, unreadCount, hasUnreadCritical, type NotificationLink } from './notifications.js';
  import { mmss, resultLabel } from './report.js';
  import type { RunNotification } from './watchStore.svelte.js';
  import type { LfgMatchNote, LfgEventNote } from './lfgLive.svelte.js';

  let {
    hasReport = false,
    onNavigate,
    runNotifications = [],
    onOpenRun,
    onDismissRun,
    onSeenRuns,
    lfgMatches = [],
    onOpenLfg,
    onDismissLfg,
    onSeenLfg,
    lfgEvents = [],
    onOpenLfgEvent,
    onDismissLfgEvent,
  }: {
    hasReport?: boolean;
    onNavigate: (link: NotificationLink) => void;
    /** Completed-run cards (desktop live watch) shown above the changelog cards. */
    runNotifications?: RunNotification[];
    onOpenRun?: (hash: string) => void;
    onDismissRun?: (hash: string) => void;
    onSeenRuns?: () => void;
    /** LFG broadcast matches (near-instant WebSocket push) shown at the top. */
    lfgMatches?: LfgMatchNote[];
    onOpenLfg?: (id: string) => void;
    onDismissLfg?: (id: string) => void;
    onSeenLfg?: () => void;
    /** LFG board events (applied / accepted / declined / locked / group full) shown with the matches. */
    lfgEvents?: LfgEventNote[];
    onOpenLfgEvent?: (id: string) => void;
    onDismissLfgEvent?: (id: string) => void;
  } = $props();

  function lfgTitle(m: LfgMatchNote): string {
    return `${m.label}${m.dungeon ? ` · ${m.dungeon}` : ''}${m.keyLevel ? ` +${m.keyLevel}` : ''}`;
  }

  function runTitle(r: RunNotification): string {
    return `${r.dungeon ?? 'New run'}${r.level ? ` +${r.level}` : ''}`;
  }
  function runDetail(r: RunNotification): string {
    return `${resultLabel(r.result, r.stars)}${r.durationMs ? ` · ${mmss(r.durationMs)}` : ''}`;
  }

  let menuOpen = $state(false);
  // Which cards were unread when the dropdown was opened — snapshotted so the "new" highlight persists
  // while the user reads (opening immediately marks everything seen, which would otherwise clear it).
  let unreadSnapshot = $state<Set<string>>(new Set());

  // Lucide "bell".
  const BELL =
    '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>';

  const items = $derived(buildNotifications(settings.seenChangelogId, settings.dismissedNotifications));
  const unseenRuns = $derived(runNotifications.reduce((n, r) => n + (r.seen ? 0 : 1), 0));
  const unseenLfg = $derived(lfgMatches.reduce((n, m) => n + (m.seen ? 0 : 1), 0));
  const unseenLfgEvents = $derived(lfgEvents.reduce((n, e) => n + (e.seen ? 0 : 1), 0));
  const count = $derived(unreadCount(settings.seenChangelogId, settings.dismissedNotifications) + unseenRuns + unseenLfg + unseenLfgEvents);
  const critical = $derived(hasUnreadCritical(settings.seenChangelogId, settings.dismissedNotifications));

  /** A card is actionable when it has a link we can honor now (settings always; a tab needs a loaded run). */
  function actionable(link: NotificationLink | undefined): boolean {
    if (!link) return false;
    return link.kind === 'settings' || (link.kind === 'tab' && hasReport);
  }

  function toggle() {
    menuOpen = !menuOpen;
    if (menuOpen) {
      // Snapshot what's unread (changelog + completed runs) BEFORE marking read, so the "new" highlight
      // persists while the user reads.
      unreadSnapshot = new Set([
        ...items.filter((i) => i.unread).map((i) => i.id),
        ...runNotifications.filter((r) => !r.seen).map((r) => r.hash),
        ...lfgMatches.filter((m) => !m.seen).map((m) => m.id),
        ...lfgEvents.filter((e) => !e.seen).map((e) => e.id),
      ]);
      settings.markChangelogSeen(); // opening = read → clears the badge
      onSeenRuns?.();
      onSeenLfg?.();
    }
  }
  function close() { menuOpen = false; }

  function go(link: NotificationLink | undefined) {
    if (!actionable(link)) return;
    onNavigate(link!);
    close();
  }
  function openRun(hash: string) {
    onOpenRun?.(hash);
    close();
  }
  function openLfg(id: string) {
    onOpenLfg?.(id);
    close();
  }
  function openLfgEvent(id: string) {
    onOpenLfgEvent?.(id);
    close();
  }

  /** Whether any cards are showing — gates the header "Clear all". */
  const hasCards = $derived(
    items.length > 0 || runNotifications.length > 0 || lfgMatches.length > 0 || lfgEvents.length > 0,
  );
  /** Dismiss every currently-shown card via each list's own dismiss seam. */
  function clearAll() {
    for (const m of lfgMatches) onDismissLfg?.(m.id);
    for (const e of lfgEvents) onDismissLfgEvent?.(e.id);
    for (const r of runNotifications) onDismissRun?.(r.hash);
    for (const n of items) settings.dismissNotification(n.id);
  }
</script>

<svelte:window onclick={close} onkeydown={(e) => { if (menuOpen && e.key === 'Escape') close(); }} />

<div class="bell" onclick={(e) => e.stopPropagation()} role="presentation">
  <button
    class="bellbtn"
    class:has={count > 0}
    title={count > 0 ? `Notifications — ${count} new` : 'Notifications'}
    aria-label={count > 0 ? `Notifications (${count} new)` : 'Notifications'}
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    onclick={toggle}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html BELL}</svg>
    {#if count > 0}<span class="badge" class:crit={critical} aria-hidden="true">{count > 9 ? '9+' : count}</span>{/if}
  </button>

  {#if menuOpen}
    <div class="menu" role="menu" aria-label="Notifications">
      <div class="menuhead">
        <span class="mhtitle">Notifications</span>
        {#if hasCards}<button class="mhlink" onclick={clearAll}>Clear all</button>{/if}
      </div>

      {#if items.length === 0 && runNotifications.length === 0 && lfgMatches.length === 0 && lfgEvents.length === 0}
        <div class="empty">
          <div class="emptymark">🎉</div>
          <div class="emptytext">You're all caught up.</div>
          <button class="mhlink" onclick={() => go({ kind: 'settings' })}>See all updates in Settings</button>
        </div>
      {:else}
        <div class="list">
          {#each lfgMatches as m (m.id)}
            {@const isNew = unreadSnapshot.has(m.id)}
            <div class="ncard" class:unread={isNew}>
              <button type="button" class="ncard-main clickable" onclick={() => openLfg(m.id)}>
                <div class="nc-head">
                  {#if isNew}<span class="nc-dot" aria-hidden="true"></span>{/if}
                  <span class="nc-run-ico" aria-hidden="true">📣</span>
                  <span class="nc-title">Group match · {lfgTitle(m)}</span>
                </div>
                <div class="nc-foot">
                  <span class="nc-date">{m.reason}{#if m.ownerHandle} · by {m.ownerHandle}{/if}</span>
                  <span class="nc-go">View →</span>
                </div>
              </button>
              <button class="nc-x" title="Dismiss" aria-label="Dismiss match notification" onclick={() => onDismissLfg?.(m.id)}>✕</button>
            </div>
          {/each}
          {#each lfgEvents as e (e.id)}
            {@const isNew = unreadSnapshot.has(e.id)}
            <div class="ncard" class:unread={isNew}>
              <button type="button" class="ncard-main clickable" onclick={() => openLfgEvent(e.id)}>
                <div class="nc-head">
                  {#if isNew}<span class="nc-dot" aria-hidden="true"></span>{/if}
                  <span class="nc-run-ico" aria-hidden="true">{e.icon}</span>
                  <span class="nc-title">{e.title}</span>
                </div>
                <div class="nc-foot">
                  <span class="nc-date">{e.detail}</span>
                  <span class="nc-go">View →</span>
                </div>
              </button>
              <button class="nc-x" title="Dismiss" aria-label="Dismiss notification" onclick={() => onDismissLfgEvent?.(e.id)}>✕</button>
            </div>
          {/each}
          {#each runNotifications as r (r.hash)}
            {@const isNew = unreadSnapshot.has(r.hash)}
            <div class="ncard" class:unread={isNew}>
              <button type="button" class="ncard-main clickable" onclick={() => openRun(r.hash)}>
                <div class="nc-head">
                  {#if isNew}<span class="nc-dot" aria-hidden="true"></span>{/if}
                  <span class="nc-run-ico" aria-hidden="true">🎬</span>
                  <span class="nc-title">New run · {runTitle(r)}</span>
                </div>
                <div class="nc-foot">
                  <span class="nc-date">{runDetail(r)}</span>
                  <span class="nc-go">Open →</span>
                </div>
              </button>
              <button class="nc-x" title="Dismiss" aria-label="Dismiss run notification" onclick={() => onDismissRun?.(r.hash)}>✕</button>
            </div>
          {/each}
          {#each items as n (n.id)}
            {@const act = actionable(n.link)}
            {@const isNew = unreadSnapshot.has(n.id)}
            <div class="ncard" class:unread={isNew}>
              {#if act}
                <button type="button" class="ncard-main clickable" onclick={() => go(n.link)}>
                  {@render cardBody(n, true, isNew)}
                </button>
              {:else}
                <div class="ncard-main">{@render cardBody(n, false, isNew)}</div>
              {/if}
              <button class="nc-x" title="Dismiss" aria-label="Dismiss notification" onclick={() => settings.dismissNotification(n.id)}>✕</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#snippet cardBody(n: import('./notifications.js').NotificationItem, act: boolean, isNew: boolean)}
  <div class="nc-head">
    {#if isNew}<span class="nc-dot" aria-hidden="true"></span>{/if}
    <span class="nc-title">{n.title}</span>
    {#if n.critical}<span class="nc-crit">important</span>{/if}
  </div>
  {#if n.detail}<p class="nc-detail">{n.detail}</p>{/if}
  <div class="nc-foot">
    <span class="nc-date">{n.date}</span>
    {#if act}<span class="nc-go">View →</span>{/if}
  </div>
{/snippet}

<style>
  .bell { position: relative; display: inline-flex; }
  .bellbtn {
    display: inline-flex; align-items: center; justify-content: center; position: relative;
    background: transparent; color: var(--muted); border: 1px solid var(--border);
    border-radius: 6px; width: 30px; height: 26px; cursor: pointer; padding: 0;
  }
  .bellbtn:hover { color: var(--text); border-color: var(--muted); }
  .bellbtn.has { color: var(--text); }
  .bellbtn svg { width: 15px; height: 15px; }
  .badge {
    position: absolute; top: -6px; right: -6px; min-width: 15px; height: 15px; padding: 0 3px;
    display: inline-flex; align-items: center; justify-content: center; border-radius: 999px;
    font-size: 9px; font-weight: 800; line-height: 1; color: #0a0c10;
    background: var(--accent, #6ea8fe); border: 1.5px solid var(--bg, #0e1116);
  }
  .badge.crit { background: var(--bad, #f87171); color: #1a0c0c; box-shadow: 0 0 6px color-mix(in srgb, var(--bad, #f87171) 70%, transparent); }

  .menu {
    position: absolute; right: 0; top: calc(100% + 6px); width: 360px; max-width: 88vw;
    background: var(--card-bg, #161a22); border: 1px solid var(--border, #2a2f3a);
    border-radius: 10px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5); z-index: 80; overflow: hidden;
  }
  .menuhead {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 10px 12px; border-bottom: 1px solid var(--border);
  }
  .mhtitle { font-size: 13px; font-weight: 700; color: var(--text); }
  .mhlink {
    background: none; border: none; color: var(--accent, #6ea8fe); font-size: 12px; font-weight: 600;
    cursor: pointer; padding: 2px 4px;
  }
  .mhlink:hover { text-decoration: underline; }

  .empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 24px 16px; text-align: center; }
  .emptymark { font-size: 22px; }
  .emptytext { font-size: 13px; color: var(--text); font-weight: 600; }

  .list { max-height: min(60vh, 460px); overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
  .ncard {
    position: relative; display: flex; align-items: stretch; gap: 4px; border-radius: 8px;
    border: 1px solid transparent;
  }
  .ncard.unread { background: color-mix(in srgb, var(--accent, #6ea8fe) 8%, transparent); border-color: color-mix(in srgb, var(--accent, #6ea8fe) 22%, var(--border)); }
  .ncard-main {
    flex: 1; min-width: 0; padding: 9px 8px 8px 10px; border-radius: 8px;
    /* The clickable variant is a <button>; reset native chrome so both kinds look identical. */
    display: block; width: 100%; text-align: left; background: transparent; border: none;
    color: inherit; font: inherit;
  }
  .ncard-main.clickable { cursor: pointer; }
  .ncard-main.clickable:hover { background: var(--surface-2, rgba(255, 255, 255, 0.05)); }
  .nc-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .nc-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--accent, #6ea8fe); flex: none; }
  .nc-run-ico { font-size: 13px; line-height: 1; flex: none; }
  .nc-title { font-size: 12.5px; font-weight: 700; color: var(--text); line-height: 1.3; }
  .nc-crit {
    font-size: 8.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--bad, #f87171); border: 1px solid color-mix(in srgb, var(--bad, #f87171) 55%, var(--border));
    background: color-mix(in srgb, var(--bad, #f87171) 14%, transparent); padding: 1px 5px; border-radius: 999px;
  }
  .nc-detail {
    margin: 4px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--muted);
    display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .nc-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
  .nc-date { font-size: 10.5px; color: var(--muted); }
  .nc-go { font-size: 11px; font-weight: 700; color: var(--accent, #6ea8fe); }
  .nc-x {
    flex: none; align-self: flex-start; margin: 6px 6px 0 0; width: 20px; height: 20px; border: none;
    border-radius: 6px; background: none; color: var(--muted); font-size: 11px; cursor: pointer; line-height: 1;
  }
  .nc-x:hover { color: var(--text); background: var(--surface-2, rgba(255, 255, 255, 0.06)); }
</style>
