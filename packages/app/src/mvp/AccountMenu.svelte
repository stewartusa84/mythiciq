<!-- Topbar "Account" dropdown — the typical-site account/settings menu in the top-right. Bundles:
       • Sign in / account (email + Sign out) — when Cognito accounts are configured (FLAGS.accounts).
       • Settings (opens the Account & Settings modal).
       • Anonymize (the streaming role-alias toggle, moved off the main topbar) — only with a loaded run.
     Notifications + Report a Bug stay as their own topbar buttons for quick access. -->
<script lang="ts">
  import { auth } from './auth.svelte.js';
  import { settings } from './settings.svelte.js';
  import { anon } from './anon.svelte.js';
  import { FLAGS } from './flags.js';
  import { isDesktop, quitApp } from './desktop.js';

  let { hasReport = false, onOpenSettings }: { hasReport?: boolean; onOpenSettings: () => void } = $props();

  let menuOpen = $state(false);
  let accountAvailable = $derived(FLAGS.accounts && auth.configured);
  let signedIn = $derived(accountAvailable && auth.status === 'signed-in');
  const desktop = isDesktop();

  function close() { menuOpen = false; }
  function openSettings() { close(); onOpenSettings(); }
  function quit() { close(); void quitApp(); }
</script>

<svelte:window onclick={close} />

<div class="acct" onclick={(e) => e.stopPropagation()} role="presentation">
  <button
    class="acctbtn"
    class:on={!FLAGS.demo && settings.shareStats}
    data-tour="settings"
    title="Account & Settings"
    aria-label="Account & Settings"
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    onclick={() => (menuOpen = !menuOpen)}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    {#if signedIn}<span class="dot" aria-hidden="true"></span>{/if}
  </button>

  {#if menuOpen}
    <div class="acctmenu" role="menu">
      {#if accountAvailable}
        {#if signedIn}
          {#if auth.user?.email}<div class="acctemail" title={auth.user.email}>{auth.user.email}</div>{/if}
          <button class="acctitem" role="menuitem" onclick={() => { close(); auth.logout(); }}>Sign out</button>
        {:else}
          <button class="acctitem" role="menuitem" onclick={() => { close(); auth.login(); }}>Sign in</button>
        {/if}
        <div class="acctsep" role="separator"></div>
      {/if}

      <button class="acctitem" role="menuitem" onclick={openSettings}>Settings</button>

      {#if hasReport}
        <button
          class="acctitem toggle"
          class:on={anon.enabled}
          role="menuitemcheckbox"
          aria-checked={anon.enabled}
          title="Replace player names with role aliases (for streaming)"
          onclick={() => anon.toggle()}
        >
          <span>Anonymize names</span>
          <span class="state">{anon.enabled ? 'On' : 'Off'}</span>
        </button>
      {/if}

      {#if desktop}
        <!-- The window X only minimizes to the tray; this fully exits the app. -->
        <div class="acctsep" role="separator"></div>
        <button class="acctitem quit" role="menuitem" onclick={quit}>Quit MythicIQ</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .acct { position: relative; display: inline-flex; }
  .acctbtn {
    display: inline-flex; align-items: center; justify-content: center; position: relative;
    background: transparent; color: var(--muted); border: 1px solid var(--border);
    border-radius: 6px; width: 30px; height: 26px; cursor: pointer; padding: 0;
  }
  .acctbtn:hover { color: var(--text); border-color: var(--muted); }
  .acctbtn.on { background: rgba(78, 161, 255, 0.16); color: var(--accent); border-color: rgba(78, 161, 255, 0.4); }
  .acctbtn svg { width: 16px; height: 16px; }
  .dot {
    position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%;
    background: #5fd08a; border: 1.5px solid var(--bg, #0e1116);
  }
  .acctmenu {
    position: absolute; right: 0; top: calc(100% + 6px); min-width: 200px;
    background: var(--card-bg, #161a22); border: 1px solid var(--border, #2a2f3a);
    border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); padding: 6px; z-index: 80;
  }
  .acctemail {
    font-size: 12px; color: var(--muted); padding: 6px 8px; margin-bottom: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .acctsep { height: 1px; background: var(--border, #2a2f3a); margin: 4px 0; }
  .acctitem {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    width: 100%; text-align: left; background: transparent; color: var(--text); border: 0;
    border-radius: 6px; padding: 8px; font-size: 13px; cursor: pointer;
  }
  .acctitem:hover { background: var(--surface-2, rgba(255, 255, 255, 0.06)); }
  .acctitem .state { font-size: 11px; color: var(--muted); font-weight: 600; }
  .acctitem.toggle.on .state { color: var(--accent); }
  .acctitem.quit { color: var(--bad, #f87171); }
  .acctitem.quit:hover { background: color-mix(in srgb, var(--bad, #f87171) 14%, transparent); }
</style>
