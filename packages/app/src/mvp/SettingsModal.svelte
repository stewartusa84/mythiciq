<!-- Account & Settings. The home for user preferences (shared-stats opt-in), the About/beta note, the
     full "What's new" changelog, the app version, and — when accounts are enabled (FLAGS.accounts) — sign-in
     and supporter status. (The Notifications bell shows recent updates as dismissible cards; this is the
     full archive.) Opening this records that the user made a choice (dismisses the first-time
     share-stats hint). -->
<script lang="ts">
  import { settings } from './settings.svelte.js';
  import { runStatsEnabled } from './runStats.js';
  import { verifiedCreditConfigured, listMyVerifiedCredit } from './verifiedCredit.js';
  import { APP_VERSION } from '../version.js';
  import { FLAGS } from './flags.js';
  import { auth } from './auth.svelte.js';
  import { isDesktop, historyDir } from './desktop.js';
  import { CHANGELOG } from './changelog.js';

  let { open = $bindable(false) }: { open?: boolean } = $props();
  const hasBackend = runStatsEnabled();

  // The on-disk run-history folder (desktop only) — shown so players can find/clear the saved sub-logs.
  let historyPath = $state<string | null>(null);
  let copied = $state(false);

  // Opening settings is "making a choice" → the first-time share-stats hint never shows again.
  $effect(() => {
    if (open) settings.markChoiceMade();
  });

  // The user's verified-credit tally (server-side), fetched when the section is visible + signed in.
  let verifiedRuns = $state<{ total: number; clean: number } | null>(null);
  $effect(() => {
    if (open && settings.verifiedCredit && auth.status === 'signed-in' && verifiedCreditConfigured()) {
      void listMyVerifiedCredit().then((r) => {
        if (r.ok) verifiedRuns = { total: r.value.length, clean: r.value.filter((c) => c.clean).length };
      });
    }
  });

  // Resolve the storage folder lazily the first time settings opens on desktop.
  $effect(() => {
    if (open && isDesktop() && historyPath === null) void historyDir().then((p) => (historyPath = p));
  });

  async function copyPath() {
    if (!historyPath) return;
    try {
      await navigator.clipboard.writeText(historyPath);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* clipboard blocked — the path is still selectable */
    }
  }

  function close() {
    open = false;
  }
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') close(); }} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Account & Settings" tabindex="-1">
      <div class="head">
        <h2>Account &amp; Settings</h2>
        <button class="x" onclick={close} aria-label="Close">✕</button>
      </div>

      {#if FLAGS.accounts && auth.configured}
        <h3 class="sec">Account</h3>
        {#if auth.status === 'signed-in'}
          <div class="acct-row">
            <span class="acct-dot" aria-hidden="true"></span>
            <span class="acct-email">{auth.user?.email ?? auth.user?.username ?? 'Signed in'}</span>
            <button class="ghost" onclick={() => auth.logout()}>Sign out</button>
          </div>
        {:else}
          <button class="primary" onclick={() => auth.login()}>Sign in</button>
        {/if}
      {/if}

      <h3 class="sec">About <span class="betatag">BETA</span></h3>
      <p class="desc muted">
        MythicIQ is in active development — it's updated regularly to refine accuracy, so a number may
        occasionally disagree with your in-game data or another tool. When they conflict, trust your
        in-game/Details numbers and please send a bug report (🐞) so it can be fixed. Every analytic is
        only as complete as the spell data we've curated, which each card notes.
      </p>

      {#if !FLAGS.demo}
        <h3 class="sec">Shared stats &amp; comparison</h3>

        <label class="toggle">
          <input type="checkbox" checked={settings.shareStats} onchange={(e) => settings.setShareStats(e.currentTarget.checked)} />
          <span class="tlabel">Share anonymized run stats to get comparison feedback</span>
        </label>
        <p class="desc muted">
          When on, an <b>anonymized, name-free</b> statistical summary of each finished run is shared — the
          dungeon, key level, time, deaths, and DPS/HPS broken out by <b>spec</b> and by boss — so the
          Overview can compare your run to the aggregate field. <b>Off by default.</b> Only this anonymized
          summary is sent for comparisons, and no player names are ever included.
        </p>
        <p class="desc muted" style="margin-top: -8px;">
          This shares <b>aggregate statistics only</b>, and they stay anonymized. (A remote
          <b>run-backup</b> feature is on the roadmap — that would store your full runs and would
          <b>not</b> be anonymized. It's separate from this, and nothing like it is sent today.)
        </p>

        <label class="toggle" class:disabled={!settings.shareStats}>
          <input type="checkbox" checked={settings.anonymizeShared} disabled={!settings.shareStats} onchange={(e) => settings.setAnonymize(e.currentTarget.checked)} />
          <span class="tlabel">Anonymize my contribution</span>
        </label>
        <p class="desc muted">
          The shared stats are always name-free. This only changes <b>your</b> line: with it <b>off</b>,
          your spec's numbers are tagged as yours so you get a personal you-vs-field spec comparison back;
          with it <b>on</b>, your numbers fold into the spec aggregates with nothing marking which were
          yours. Either way, no player names are ever sent.
        </p>

        {#if !hasBackend}
          <p class="note">No stats backend is configured for this build, so sharing is unavailable here — the toggle just records your preference.</p>
        {/if}

        {#if verifiedCreditConfigured()}
          <h3 class="sec">Verified credit</h3>
          <label class="toggle">
            <input type="checkbox" checked={settings.verifiedCredit} onchange={(e) => settings.setVerifiedCredit(e.currentTarget.checked)} />
            <span class="tlabel">Upload my finished runs for server-verified credit</span>
          </label>
          <p class="desc muted">
            <b>This is the one feature that sends your actual combat log off your device.</b> When on, the
            <b>compressed</b> log of each finished key is uploaded to our servers, where we re-parse it and
            award <b>verified credit</b> — a clean-run verdict plus praise (DPS/HPS rank, clutch plays,
            perfect interrupts) — to every party member who has linked that character to their account.
            <b>Off by default.</b> The uploaded log is <b>deleted right after it's parsed</b>. "Verified"
            means <b>we</b> compute the numbers from the real log rather than trusting a self-report; it is
            not tamper-proof (combat logs are editable text).
            {#if auth.status !== 'signed-in'}<br /><b>Sign in to use this.</b>{/if}
          </p>
          {#if verifiedRuns && verifiedRuns.total > 0}
            <p class="desc"><b>✓ {verifiedRuns.total}</b> server-verified {verifiedRuns.total === 1 ? 'run' : 'runs'} · <b>{verifiedRuns.clean}</b> clean</p>
          {/if}
        {/if}
      {/if}

      {#if isDesktop()}
        <h3 class="sec">Run history</h3>
        <label class="caprow">
          <span class="tlabel">Keep up to</span>
          <input
            type="number"
            min="5"
            max="2000"
            value={settings.historyCap}
            onchange={(e) => settings.setHistoryCap(+e.currentTarget.value)}
          />
          <span class="tlabel">runs on disk</span>
        </label>
        <p class="desc muted">
          Completed runs are saved as <b>compressed sub-logs</b> in a local folder, so you can clear out
          your raw WoW combat logs (they're huge) and still keep this run data for replay + analysis. The
          oldest runs beyond this limit are removed automatically.
        </p>
        {#if historyPath}
          <div class="pathrow">
            <code class="path" title={historyPath}>{historyPath}</code>
            <button class="ghost copy" onclick={copyPath}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <p class="desc muted" style="margin-top: 6px;">This is where the compressed sub-logs are stored.</p>
        {/if}

        <h3 class="sec">Raid review</h3>
        <label class="toggle">
          <input type="checkbox" checked={settings.autoOpenWipe} onchange={(e) => settings.setAutoOpenWipe(e.currentTarget.checked)} />
          <span class="tlabel">Auto-open replay when a pull wipes</span>
        </label>
        <p class="desc muted">
          While watching your log, each completed raid pull is added to the raid review switcher in the
          sidebar. With this on, a <b>wipe</b> also opens straight into the replay so you can review
          mechanics between pulls hands-free. Kills stay click-to-open.
        </p>

        <h3 class="sec">Performance</h3>
        <label class="toggle">
          <input type="checkbox" checked={settings.lowResourceMode} onchange={(e) => settings.setLowResourceMode(e.currentTarget.checked)} />
          <span class="tlabel">Low resource mode</span>
        </label>
        <p class="desc muted">
          A few seconds after you minimize MythicIQ to the tray, the window's UI is unloaded to free its
          memory. <b>Watching and carving your runs keeps running</b> in the background — only the display
          is unloaded. Reopening from the tray rebuilds it (takes a moment). The short delay lets you pop
          back instantly if you minimized by accident.
        </p>
      {/if}

      <h3 class="sec">Sound</h3>
      <label class="toggle">
        <input type="checkbox" checked={settings.celebrationSound} onchange={(e) => settings.setCelebrationSound(e.currentTarget.checked)} />
        <span class="tlabel">Play a chime when you time a key</span>
      </label>
      <p class="desc muted">A short celebration sound on the Overview when a run is timed.</p>

      <h3 class="sec">Help</h3>
      <button class="ghost replay" onclick={() => { settings.resetTour(); close(); }}>Replay walkthrough</button>
      <p class="desc muted">Show the guided tour of the app again on your current run.</p>

      <h3 class="sec">What's new</h3>
      <div class="changelog">
        {#each CHANGELOG as c (c.id)}
          <div class="cl-entry">
            <div class="cl-head">
              <span class="cl-title">{c.title}</span>
              {#if c.critical}<span class="cl-crit">important</span>{/if}
              <span class="cl-date muted">{c.date}</span>
            </div>
            {#if c.detail}<p class="cl-detail muted">{c.detail}</p>{/if}
          </div>
        {/each}
      </div>

      <div class="ver">
        <span class="muted">Version</span>
        <code>{APP_VERSION}</code>
      </div>
      <p class="desc muted credit">
        Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®),
        copyright © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission.
        All rights reserved.
      </p>

      <div class="actions"><button class="primary" onclick={close}>Done</button></div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .modal {
    width: min(500px, 100%); max-height: 90vh; overflow: auto;
    background: var(--bg, #14161c); color: var(--text, #e8e8ea);
    border: 1px solid var(--border, #2a2d36); border-radius: 12px;
    padding: 18px 20px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .head h2 { margin: 0; font-size: 16px; }
  .x { background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; padding: 4px; }
  .x:hover { color: var(--text); }
  .sec { margin: 14px 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .sec:first-of-type { margin-top: 6px; }
  .betatag {
    font-size: 9px; font-weight: 800; letter-spacing: 0.08em; color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    padding: 1px 5px; border-radius: 999px; vertical-align: middle; margin-left: 6px;
  }
  /* Account section. */
  .acct-row { display: flex; align-items: center; gap: 10px; }
  .acct-dot { width: 9px; height: 9px; border-radius: 50%; background: #5fd08a; flex: none; }
  .acct-email { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ghost {
    margin-left: auto; background: transparent; color: var(--muted); border: 1px solid var(--border);
    border-radius: 6px; padding: 5px 11px; cursor: pointer; font-size: 12px; font-weight: 600;
  }
  .ghost:hover { color: var(--text); border-color: var(--muted); }
  .ghost.replay { margin-left: 0; }

  .caprow { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 600; }
  .caprow input {
    width: 80px; background: var(--surface-2, rgba(255,255,255,0.04)); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 13px;
    color-scheme: dark;
  }
  .pathrow {
    display: flex; align-items: center; gap: 8px; margin: 0 0 0 25px;
    background: var(--surface-2, rgba(255,255,255,0.04)); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 8px;
  }
  .path {
    flex: 1; min-width: 0; font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: all;
  }
  .copy { margin-left: 0; flex: none; padding: 3px 9px; }
  .toggle { display: flex; align-items: flex-start; gap: 9px; cursor: pointer; font-size: 14px; font-weight: 600; }
  .toggle.disabled { opacity: 0.5; cursor: default; }
  .toggle input { margin-top: 2px; accent-color: var(--accent, #6ea8fe); width: 16px; height: 16px; }
  .tlabel { line-height: 1.35; }
  .desc { margin: 5px 0 14px 25px; font-size: 12.5px; line-height: 1.5; }
  .credit { font-size: 11px; opacity: 0.8; margin: 8px 0 0; }
  .desc b { color: var(--text); }
  .note {
    margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; padding: 9px 11px; border-radius: 8px;
    color: var(--warn, #e0a82e); background: color-mix(in srgb, var(--warn, #e0a82e) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--warn, #e0a82e) 30%, var(--border));
  }
  /* "What's new" changelog list (the full archive; the Notifications bell shows recent ones as cards). */
  .changelog { display: flex; flex-direction: column; gap: 12px; max-height: 280px; overflow-y: auto; padding: 2px 4px 2px 0; }
  .cl-entry { border-left: 2px solid var(--border); padding-left: 10px; }
  .cl-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .cl-title { font-size: 13px; font-weight: 700; color: var(--text); }
  .cl-date { font-size: 11px; }
  .cl-crit {
    font-size: 9px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--bad, #f87171); border: 1px solid color-mix(in srgb, var(--bad, #f87171) 55%, var(--border));
    background: color-mix(in srgb, var(--bad, #f87171) 14%, transparent); padding: 1px 5px; border-radius: 999px;
  }
  .cl-detail { margin: 4px 0 0; font-size: 12px; line-height: 1.5; }
  .ver {
    display: flex; align-items: center; gap: 8px; margin-top: 16px; padding-top: 12px;
    border-top: 1px solid var(--border); font-size: 12px;
  }
  .ver code { font-family: ui-monospace, monospace; color: var(--text); font-size: 12px; }
  .actions { display: flex; justify-content: flex-end; margin-top: 14px; }
  .primary {
    background: var(--accent, #6ea8fe); color: #0a0c10; border: none; border-radius: 8px;
    padding: 8px 16px; font-weight: 600; cursor: pointer; font-size: 13px;
  }
</style>
