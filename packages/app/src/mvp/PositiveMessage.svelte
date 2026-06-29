<!-- Subtle, rotating positive message / Scripture on the topbar (center). Cross-fades to the next entry
     on a long timer so it's calm, not distracting. Source is curated in
     packages/data/curation/positive-messages.json (ESV verses carry their reference; see the ESV
     attribution in Settings → About). -->
<script lang="ts">
  import data from '@wow/data/curation/positive-messages';

  const ROTATE_MS = 30 * 60 * 1000; // rotate every 30 minutes — deliberately unobtrusive
  const FADE_MS = 600;
  const messages = data.messages ?? [];

  // Start on a random message so it isn't always the same one at launch.
  let i = $state(messages.length ? Math.floor(Math.random() * messages.length) : 0);
  let shown = $state(true);
  let current = $derived(messages[i]);

  $effect(() => {
    if (messages.length < 2) return;
    const id = setInterval(() => {
      shown = false; // fade out
      setTimeout(() => {
        i = (i + 1) % messages.length;
        shown = true; // swap text while invisible, then fade the next one in
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(id);
  });
</script>

{#if current}
  <div class="topmsg">
    <span
      class="msg"
      class:show={shown}
      title={current.ref ? `${current.text} — ${current.ref} (ESV)` : current.text}
    >
      {current.text}{#if current.ref}<span class="ref"> — {current.ref}</span>{/if}
    </span>
  </div>
{/if}

<style>
  .topmsg {
    flex: 1 1 0;
    min-width: 0;
    text-align: center;
    padding: 0 16px;
    overflow: hidden;
  }
  .msg {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    color: var(--muted);
    opacity: 0;
    transition: opacity 0.6s ease;
  }
  .msg.show {
    opacity: 0.85;
  }
  .ref {
    font-style: italic;
    opacity: 0.8;
  }
</style>
