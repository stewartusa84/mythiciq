<script lang="ts">
  import { Activity, CirclePlay, Code2, MessageCircle } from '@lucide/svelte';
  import BrandLockup from '$lib/BrandLockup.svelte';
  import { discordInviteUrl } from '$lib/links';

  export let desktopHref = '/#download';

  const lastUpdated = 'June 29, 2026';
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
      <a href="/#community">GitHub</a>
      <a href="/#community">Reddit</a>
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
      ><MessageCircle size={20} /></a
    >
    <a href="/#community" aria-label="GitHub"><Code2 size={20} /></a>
    <a href="/#community" aria-label="Reddit"><MessageCircle size={20} /></a>
    <a href="/#community" aria-label="YouTube"><CirclePlay size={20} /></a>
    <a href="/#community" aria-label="Status"><Activity size={20} /></a>
    <p>
      © 2026 Paul Stewart<br />
      All rights reserved.<br />
      <span class="footer-updated">Last updated: {lastUpdated} · Active development.</span>
    </p>
  </div>
</footer>
