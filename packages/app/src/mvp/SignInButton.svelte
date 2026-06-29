<!-- Topbar sign-in / account control. Hidden entirely when Cognito isn't configured (offline build).
     Signed out → "Sign in" (opens the Hosted UI). Signed in → the user's email + a small menu with
     "Sign out". Account-backed product actions live in their own surfaces; this is just identity. -->
<script lang="ts">
  import { auth } from './auth.svelte.js';
  import { FLAGS } from './flags.js';

  let menuOpen = $state(false);
  // Short label for the account button: email local-part, else username, else "Account".
  let label = $derived(
    auth.user?.email?.split('@')[0] ?? auth.user?.username ?? 'Account',
  );

  function onWindowClick() {
    menuOpen = false;
  }
</script>

<svelte:window onclick={onWindowClick} />

{#if FLAGS.accounts && auth.configured}
  {#if auth.status === 'signed-in'}
    <div class="acct" onclick={(e) => e.stopPropagation()} role="presentation">
      <button class="acctbtn" title={auth.user?.email ?? ''} onclick={() => (menuOpen = !menuOpen)}>
        <span class="dot" aria-hidden="true"></span>{label}
      </button>
      {#if menuOpen}
        <div class="acctmenu" role="menu">
          {#if auth.user?.email}<div class="acctemail">{auth.user.email}</div>{/if}
          <button class="acctitem" role="menuitem" onclick={() => auth.logout()}>Sign out</button>
        </div>
      {/if}
    </div>
  {:else if auth.status === 'signed-out'}
    <button class="signin" title="Sign in to use account features" onclick={() => auth.login()}>Sign in</button>
  {/if}
{/if}

<style>
  .signin {
    background: rgba(78, 161, 255, 0.16);
    color: var(--accent);
    border: 1px solid rgba(78, 161, 255, 0.4);
    border-radius: 7px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .signin:hover { background: rgba(78, 161, 255, 0.26); }
  .acct { position: relative; }
  .acctbtn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border, #2a2f3a);
    border-radius: 7px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
    max-width: 180px;
  }
  .acctbtn:hover { border-color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #5fd08a; flex: none; }
  .acctmenu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    min-width: 180px;
    background: var(--card-bg, #161a22);
    border: 1px solid var(--border, #2a2f3a);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    padding: 6px;
    z-index: 50;
  }
  .acctemail { font-size: 12px; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--border, #2a2f3a); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; }
  .acctitem { display: block; width: 100%; text-align: left; background: transparent; color: var(--text); border: 0; border-radius: 6px; padding: 8px; font-size: 13px; cursor: pointer; }
  .acctitem:hover { background: var(--surface-2, rgba(255, 255, 255, 0.06)); }
</style>
