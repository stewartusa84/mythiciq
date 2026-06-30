<script lang="ts">
  import BrandLockup from '$lib/BrandLockup.svelte';
  import {
    discordInviteUrl,
    githubUrl,
    tiktokProfileUrl,
    tiktokUsername,
    venmoProfileUrl,
    venmoUsername
  } from '$lib/links';

  export let desktopHref = '/#download';

  const lastUpdated = 'June 30, 2026';
  const venmoLabel = `Venmo @${venmoUsername}`;
  const tiktokLabel = `TikTok @${tiktokUsername}`;
</script>

<footer class="footer" id="community">
  <div class="footer-brand">
    <a class="brand" href="/" aria-label="MythicIQ home">
      <BrandLockup small />
    </a>
    <p>
      The WoW combat-log companion that helps you find better groups, play better, and build a
      reputation that matters.
    </p>
  </div>

  <div class="footer-links" id="docs">
    <div>
      <h3>Product</h3>
      <a href="/app/" rel="external" data-sveltekit-reload>Web App</a>
      <a href={desktopHref}>Desktop App</a>
      <a href="/features">Features</a>
      <a href="/how-to">How To</a>
      <a href="/roadmap">Roadmap</a>
    </div>
    <div>
      <h3>Resources</h3>
      <a href="/how-to">Getting Started</a>
      <a href="/#docs">Docs</a>
      <a href="/#docs">Changelog</a>
    </div>
    <div>
      <h3>Community</h3>
      <a href={discordInviteUrl} target="_blank" rel="noreferrer">Discord</a>
      <a href={githubUrl} target="_blank" rel="noreferrer">GitHub</a>
      <a href={tiktokProfileUrl} target="_blank" rel="noreferrer">TikTok</a>
    </div>
    <div>
      <h3>Company</h3>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/contribute">Contribute</a>
    </div>
  </div>

  <div class="socials" aria-label="Social links">
    <a href={discordInviteUrl} aria-label="Discord" target="_blank" rel="noreferrer"
      ><svg
        aria-hidden="true"
        class="brand-icon"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="currentColor"
      >
        <path
          d="M20.32 4.37A19.82 19.82 0 0 0 16.56 3c-.17.3-.35.7-.49 1.03a18.27 18.27 0 0 0-4.14 0A12.23 12.23 0 0 0 11.44 3a19.77 19.77 0 0 0-3.76 1.37c-2.38 3.53-3.02 6.97-2.7 10.37a19.9 19.9 0 0 0 4.61 2.33c.37-.5.7-1.03.98-1.59-.54-.2-1.06-.45-1.55-.74.13-.1.26-.2.38-.3 2.99 1.39 6.24 1.39 9.19 0 .12.1.25.2.38.3-.49.29-1.01.54-1.55.74.28.56.61 1.09.98 1.59A19.84 19.84 0 0 0 23 14.74c.38-3.93-.64-7.35-2.68-10.37ZM10.14 12.65c-.9 0-1.64-.83-1.64-1.85s.72-1.85 1.64-1.85 1.65.84 1.64 1.85c0 1.02-.72 1.85-1.64 1.85Zm5.72 0c-.9 0-1.64-.83-1.64-1.85s.72-1.85 1.64-1.85 1.65.84 1.64 1.85c0 1.02-.72 1.85-1.64 1.85Z"
        />
      </svg></a
    >
    <a href={githubUrl} aria-label="GitHub" target="_blank" rel="noreferrer"
      ><svg
        aria-hidden="true"
        class="brand-icon"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="currentColor"
      >
        <path
          d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.61-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0 1 12 6.99c.85 0 1.7.11 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
        />
      </svg></a
    >
    <a href={tiktokProfileUrl} aria-label={tiktokLabel} target="_blank" rel="noreferrer"
      ><svg
        aria-hidden="true"
        class="brand-icon"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="currentColor"
      >
        <path
          d="M16.6 3.4c.27 1.82 1.34 3.13 3.1 3.66v3.08a7.09 7.09 0 0 1-3.08-.87v5.95a5.38 5.38 0 1 1-5.39-5.38c.3 0 .58.02.85.07v3.19a2.28 2.28 0 1 0 1.38 2.1V3.4h3.14Z"
        />
      </svg></a
    >
    {#if venmoProfileUrl}
      <a href={venmoProfileUrl} aria-label={venmoLabel} target="_blank" rel="noreferrer"
        ><svg
          aria-hidden="true"
          class="brand-icon"
          viewBox="6 3 12 13"
          width="20"
          height="20"
          fill="currentColor"
        >
          <path d="M16.47 4.5c.36.6.52 1.22.52 2.02 0 2.56-2.19 5.88-3.98 8.25h-4.07L7.31 5.28l3.56-.33.86 6.75c.8-1.3 1.79-3.32 1.79-4.7 0-.76-.13-1.28-.33-1.72l3.28-.78Z" />
        </svg></a
      >
    {/if}
    <p>
      © 2026 Paul Stewart<br />
      All rights reserved.<br />
      <span class="footer-updated">Last updated: {lastUpdated} · Active development.</span>
    </p>
  </div>
</footer>
