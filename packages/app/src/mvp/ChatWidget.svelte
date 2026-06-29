<script lang="ts">
  // Floating group-chat window (bottom-right), like a site's chatbot bubble. Collapsed = a round 💬 bubble
  // with an unread badge; expanded = a panel that lists the groups you're in and lets you chat in each.
  // Messages flow over the WebSocket (lfgChat → lfgSocket); history loads lazily. Renders nothing when the
  // user isn't in any group. App owns reconciling the channel list (lfgChat.setGroups) from the board.
  import { tick } from 'svelte';
  import { lfgChat } from './lfgChat.svelte.js';
  import { lfgConn } from './lfgConn.svelte.js';
  import { auth } from './auth.svelte.js';

  const mySub = $derived(auth.user?.sub ?? null);
  const channels = $derived(lfgChat.channels);
  const active = $derived(lfgChat.activeChannel);
  // Show the channel LIST (vs a single conversation) when nothing's selected, or when there's more than
  // one group and the user explicitly backed out. A single-group user goes straight to the conversation.
  const showList = $derived(lfgChat.isOpen && (lfgChat.activeId === null || channels.length === 0));

  let draft = $state('');
  let sendError = $state(false);
  let scroller = $state<HTMLDivElement | null>(null);

  // Auto-scroll to the newest message when the active conversation changes or grows.
  $effect(() => {
    const el = scroller;
    const ch = active;
    if (!el || !ch) return;
    void ch.messages.length; // track length
    void tick().then(() => {
      el.scrollTop = el.scrollHeight;
    });
  });

  function openBubble() {
    // One group → straight into it; several → the list.
    const only = channels.length === 1 ? channels[0] : undefined;
    lfgChat.open(only?.runCardId);
  }

  function send() {
    if (!active) return;
    const text = draft.trim();
    if (!text) return;
    const ok = lfgChat.send(active.runCardId, text);
    if (ok) {
      draft = '';
      sendError = false;
    } else {
      sendError = true; // socket down — keep the draft so they can retry
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clockOf(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

{#if channels.length > 0}
  {#if !lfgChat.isOpen}
    <!-- Collapsed bubble -->
    <button class="chat-bubble" onclick={openBubble} aria-label="Open group chat" title="Group chat">
      <span class="bubble-ico" aria-hidden="true">💬</span>
      {#if lfgChat.totalUnread > 0}
        <span class="bubble-badge" aria-label={`${lfgChat.totalUnread} unread`}>{lfgChat.totalUnread > 99 ? '99+' : lfgChat.totalUnread}</span>
      {/if}
    </button>
  {:else}
    <!-- Expanded panel -->
    <section class="chat-panel" aria-label="Group chat">
      <header class="chat-head">
        <div class="head-left">
          {#if !showList && channels.length > 1}
            <button class="head-back" onclick={() => lfgChat.showList()} aria-label="Back to groups" title="All groups">‹</button>
          {/if}
          <div class="head-title">
            {#if showList}
              <span class="ht-main">Group chat</span>
            {:else if active}
              <span class="ht-main" title={active.title}>{active.title}</span>
              <span class="ht-sub">{active.members} {active.members === 1 ? 'member' : 'members'}{active.status === 'locked' ? ' · locked' : ''}</span>
            {/if}
          </div>
        </div>
        <div class="head-right">
          <span class="conn-dot" class:on={lfgConn.connected} title={lfgConn.connected ? 'Connected' : 'Reconnecting…'} aria-hidden="true"></span>
          <button class="head-x" onclick={() => lfgChat.close()} aria-label="Close chat">✕</button>
        </div>
      </header>

      {#if showList}
        <!-- Channel list -->
        <div class="chat-list">
          {#each channels as c (c.runCardId)}
            <button class="ch-row" onclick={() => lfgChat.select(c.runCardId)}>
              <span class="ch-title" title={c.title}>{c.title}</span>
              <span class="ch-meta">
                {#if c.unread > 0}<span class="ch-unread">{c.unread > 99 ? '99+' : c.unread}</span>{/if}
                <span class="ch-members">{c.members}</span>
              </span>
            </button>
          {/each}
        </div>
      {:else if active}
        <!-- Conversation -->
        <div class="chat-msgs" bind:this={scroller}>
          {#if active.messages.length === 0}
            <div class="chat-empty muted">No messages yet — say hi to your group 👋</div>
          {:else}
            {#each active.messages as m (m.id)}
              {@const mine = m.authorSub === mySub}
              <div class="msg" class:mine>
                {#if !mine}<div class="msg-author">{m.authorHandle}</div>{/if}
                <div class="msg-bubble">
                  <span class="msg-body">{m.body}</span>
                  <span class="msg-time">{clockOf(m.createdAt)}</span>
                </div>
              </div>
            {/each}
          {/if}
        </div>
        <div class="chat-compose">
          {#if sendError && !lfgConn.connected}
            <div class="compose-note">Reconnecting… your message wasn't sent. Try again in a moment.</div>
          {/if}
          <div class="compose-row">
            <textarea
              class="compose-input"
              rows="1"
              placeholder={active.status === 'cancelled' ? 'This run was cancelled.' : 'Message your group…'}
              bind:value={draft}
              onkeydown={onKeydown}
              maxlength={1000}
            ></textarea>
            <button class="compose-send primary" onclick={send} disabled={!draft.trim()} aria-label="Send">➤</button>
          </div>
        </div>
      {/if}
    </section>
  {/if}
{/if}

<style>
  /* Float above everything in the bottom-right; the ReplayDrawer handle sits at the bottom-center, so we
     don't collide. */
  .chat-bubble {
    position: fixed; right: 22px; bottom: 22px; z-index: 60;
    width: 54px; height: 54px; border-radius: 999px;
    display: grid; place-items: center; cursor: pointer;
    background: var(--accent); color: #fff;
    border: 1px solid color-mix(in srgb, var(--accent) 70%, #000);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }
  .chat-bubble:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45); }
  .bubble-ico { font-size: 22px; line-height: 1; }
  .bubble-badge {
    position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px;
    border-radius: 999px; background: var(--bad, #ef4444); color: #fff;
    font-size: 11px; font-weight: 800; display: grid; place-items: center;
    border: 2px solid var(--surface);
  }

  .chat-panel {
    position: fixed; right: 22px; bottom: 22px; z-index: 60;
    width: 340px; max-width: calc(100vw - 32px);
    height: 460px; max-height: calc(100vh - 120px);
    display: flex; flex-direction: column;
    background: var(--surface); color: var(--text, inherit);
    border: 1px solid var(--border); border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .chat-head {
    flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 12px; border-bottom: 1px solid var(--border);
    background: var(--surface-2, var(--surface));
  }
  .head-left { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .head-back {
    flex: none; width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
    background: transparent; border: 1px solid var(--border); color: inherit; font-size: 18px; line-height: 1;
  }
  .head-back:hover { border-color: var(--hover-accent, #8a5cff); }
  .head-title { display: flex; flex-direction: column; min-width: 0; }
  .ht-main { font-weight: 700; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ht-sub { font-size: 11px; color: var(--muted); }
  .head-right { display: flex; align-items: center; gap: 8px; flex: none; }
  .conn-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--muted); }
  .conn-dot.on { background: var(--good, #4ade80); }
  .head-x {
    width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
    background: transparent; border: 1px solid var(--border); color: inherit; font-size: 12px; line-height: 1;
  }
  .head-x:hover { border-color: var(--hover-accent, #8a5cff); }

  .chat-list { flex: 1; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
  .ch-row {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 12px; border-radius: 8px; cursor: pointer; text-align: left;
    background: var(--surface-2, transparent); border: 1px solid var(--border); color: inherit;
  }
  .ch-row:hover { border-color: var(--hover-accent, #8a5cff); }
  .ch-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ch-meta { display: flex; align-items: center; gap: 8px; flex: none; }
  .ch-unread {
    min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
    background: var(--bad, #ef4444); color: #fff; font-size: 11px; font-weight: 800; display: grid; place-items: center;
  }
  .ch-members { font-size: 11px; color: var(--muted); }

  .chat-msgs { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .chat-empty { text-align: center; margin: auto 0; font-size: 13px; }
  .msg { display: flex; flex-direction: column; max-width: 85%; align-self: flex-start; }
  .msg.mine { align-self: flex-end; align-items: flex-end; }
  .msg-author { font-size: 11px; color: var(--muted); margin: 0 0 2px 8px; }
  .msg-bubble {
    padding: 7px 10px; border-radius: 12px; font-size: 13px; line-height: 1.35;
    background: var(--surface-2, rgba(255, 255, 255, 0.06)); border: 1px solid var(--border);
    word-break: break-word; white-space: pre-wrap;
  }
  .msg.mine .msg-bubble {
    background: color-mix(in srgb, var(--accent) 28%, var(--surface));
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }
  .msg-time { font-size: 10px; color: var(--muted); margin-left: 8px; vertical-align: baseline; }

  .chat-compose { flex: none; border-top: 1px solid var(--border); padding: 8px; }
  .compose-note { font-size: 11px; color: var(--bad, #ef4444); margin: 0 2px 6px; }
  .compose-row { display: flex; align-items: flex-end; gap: 6px; }
  .compose-input {
    flex: 1; resize: none; max-height: 96px; min-height: 34px; padding: 8px 10px;
    border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2, var(--surface));
    color: inherit; font: inherit; font-size: 13px; line-height: 1.3;
  }
  .compose-input:focus { outline: none; border-color: var(--accent); }
  .compose-send {
    flex: none; width: 36px; height: 34px; border-radius: 8px; cursor: pointer; font-size: 14px;
  }
  .compose-send:disabled { opacity: 0.5; cursor: default; }
</style>
