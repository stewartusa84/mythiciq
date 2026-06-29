<script lang="ts">
  import { Menu } from '@lucide/svelte';
  import BrandLockup from '$lib/BrandLockup.svelte';

  type NavKey = 'features' | 'how-to' | 'roadmap' | 'about' | 'contact' | 'contribute';

  export let active: NavKey | undefined = undefined;
  export let desktopHref = '/#download';
</script>

<header class="nav" class:about-nav={active !== undefined}>
  <a class="brand" href="/" aria-label="MythicIQ home">
    <BrandLockup />
  </a>

  <nav class="nav-links" aria-label="Main navigation">
    <a href="/features" aria-current={active === 'features' ? 'page' : undefined}>Features</a>
    <a href="/how-to" aria-current={active === 'how-to' ? 'page' : undefined}>How To</a>
    <a href="/roadmap" aria-current={active === 'roadmap' ? 'page' : undefined}>Roadmap</a>
    <a href="/about" aria-current={active === 'about' ? 'page' : undefined}>About</a>
    <a href="/contact" aria-current={active === 'contact' ? 'page' : undefined}>Contact</a>
    <a href="/contribute" aria-current={active === 'contribute' ? 'page' : undefined}>Contribute</a>
  </nav>

  <div class="nav-actions">
    <a class="button button-primary compact" href="/app/" rel="external" data-sveltekit-reload>
      Open Web App
    </a>
    <a class="button button-ghost compact" href={desktopHref}>Desktop App</a>
    <button class="icon-button" aria-label="Open menu">
      <Menu size={22} />
    </button>
  </div>
</header>
