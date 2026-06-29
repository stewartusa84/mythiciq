<script lang="ts">
  import {
    Activity,
    CheckCircle2,
    Download,
    ExternalLink,
    Heart,
    Smartphone,
    ShieldCheck,
    Users
  } from '@lucide/svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';
  import SiteHeader from '$lib/SiteHeader.svelte';
  import { venmoProfileUrl, venmoUsername } from '$lib/links';

  const intro = [
    'MythicIQ is a free, local-first WoW combat-log companion app available as a full web app and a desktop app.',
    'The goal is to make Mythic+ and raid content easier to review, easier to learn, and less frustrating to pug without turning the game into another public shame board or ad-filled score site.'
  ];

  const runningCopy = [
    'MythicIQ is free to use, but it is not free to run.',
    'Even with local-first replay review, MythicIQ still has real costs: servers, account services, Battle.net verification, LFG traffic, shared run reviews, temporary log storage, website hosting, and future community features.',
    'If MythicIQ helps you, a small contribution helps keep it available and independent.'
  ];

  const supportItems = [
    'Server and hosting costs',
    'Battle.net verification and account services',
    'LFG and community features',
    'Shared run reviews and temporary replay/log hosting',
    'App distribution and infrastructure',
    'Continued development time'
  ];

  const helpItems = [
    'Testing the web app and desktop app with real runs',
    'Reporting bugs or confusing results',
    'Giving honest feedback on LFG flows',
    'Calling out unfair or misleading analysis',
    'Helping identify dungeon and raid mechanics',
    'Sharing MythicIQ with friends or guilds',
    'Contributing code or documentation once open-source work is available'
  ];

  const avoidItems = [
    'No full log uploads by default',
    'No public shame ratios',
    'No pay-to-win matchmaking',
    'No ad-heavy experience',
    'No turning every badge into another exclusion tool',
    'No hiding how the app works from the community'
  ];

  const venmoDisplay = `@${venmoUsername}`;
</script>

<svelte:head>
  <title>Contribute | MythicIQ</title>
  <meta
    name="description"
    content="Support MythicIQ and help keep the local-first WoW companion app for Mythic+ and raid free, independent, and community-aligned."
  />
</svelte:head>

<main class="site-shell contribute-page">
  <SiteHeader active="contribute" />

  <section class="contribute-hero" aria-labelledby="contribute-title">
    <div class="contribute-hero-inner">
      <div class="contribute-copy">
        <p class="eyebrow left">Community Supported</p>
        <h1 id="contribute-title">Contribute</h1>
        <p class="contribute-lede">{intro[0]}</p>
        <p>{intro[1]}</p>
      </div>

      <aside class="contribute-panel" aria-label="MythicIQ contribution principles">
        <ShieldCheck size={34} />
        <p class="contribute-panel-kicker">Built to stay useful</p>
        <h2>Support keeps MythicIQ aligned with the principles it was built around.</h2>
        <ul>
          {#each avoidItems.slice(0, 4) as item}
            <li>
              <CheckCircle2 size={18} />
              <span>{item}</span>
            </li>
          {/each}
        </ul>
      </aside>
    </div>
  </section>

  <section class="contribute-section community-contribution-section" aria-labelledby="other-ways-title">
    <div class="contribute-section-inner two-column">
      <div class="contribute-heading">
        <p class="eyebrow left">Most Important Contribution</p>
        <h2 id="other-ways-title">Use MythicIQ, test it hard, and tell us what needs to be better.</h2>
        <p>
          Money helps cover infrastructure, but this is the contribution MythicIQ needs most from
          everyone: real runs, real feedback, bug reports, mechanic notes, and honest reactions to
          what feels useful, confusing, unfair, or missing.
        </p>
        <p class="contribution-priority">
          If you want to help, start here. The best version of MythicIQ will come from players using
          it in real keys and raid nights and telling us where it should be sharper.
        </p>
      </div>

      <ul class="contribute-list">
        {#each helpItems as item}
          <li>
            <Users size={18} />
            <span>{item}</span>
          </li>
        {/each}
      </ul>
    </div>
  </section>

  <section class="contribute-section" aria-labelledby="running-title">
    <div class="contribute-section-inner">
      <div class="contribute-heading">
        <p class="eyebrow left">Help Keep MythicIQ Running</p>
        <h2 id="running-title">Free to use, but not free to run.</h2>
      </div>

      <div class="contribute-body">
        {#each runningCopy as paragraph}
          <p>{paragraph}</p>
        {/each}
      </div>
    </div>
  </section>

  {#if venmoProfileUrl}
    <section class="contribute-section alt donation-section" aria-labelledby="donation-title">
      <div class="contribute-section-inner donation-inner">
        <div class="contribute-heading">
          <p class="eyebrow left">One-Time Support</p>
          <h2 id="donation-title">Support MythicIQ with Venmo.</h2>
          <p>
            Venmo is the simplest current option for one-time contributions while MythicIQ is still a
            small independent project.
          </p>
        </div>

        <div class="donation-panel">
          <div class="donation-method">
            <span class="donation-icon" aria-hidden="true"><Smartphone size={24} /></span>
            <div class="donation-method-copy">
              <p class="donation-label">Venmo</p>
              <h3>{venmoDisplay}</h3>
              <p>
                Contributions help cover hosting, shared replay infrastructure, account services, and
                continued development.
              </p>
            </div>

            <a class="button button-primary" href={venmoProfileUrl} target="_blank" rel="noreferrer">
              <Heart size={18} />
              Support on Venmo
              <ExternalLink size={17} />
            </a>
          </div>

          <p class="donation-fine-print">
            This is project support, not a tax-deductible charitable donation. Please only contribute
            if it is useful and comfortable for you.
          </p>
        </div>
      </div>
    </section>
  {/if}

  <section class="contribute-section alt" aria-labelledby="support-title">
    <div class="contribute-section-inner">
      <div class="contribute-heading">
        <p class="eyebrow left">What Contributions Support</p>
        <h2 id="support-title">The practical costs behind a local-first app.</h2>
        <p>Contributions help cover:</p>
      </div>

      <div class="support-grid">
        {#each supportItems as item}
          <article class="support-card">
            <Activity size={21} />
            <span>{item}</span>
          </article>
        {/each}
      </div>

      <p class="contribute-closing">The goal is to keep the core app free and avoid loading the site with ads.</p>
    </div>
  </section>

  <section class="contribute-section alt" aria-labelledby="avoid-title">
    <div class="contribute-section-inner two-column">
      <div class="contribute-heading">
        <p class="eyebrow left">What MythicIQ Is Trying to Avoid</p>
        <h2 id="avoid-title">Strong principles shape the product.</h2>
        <p>MythicIQ is being built with a few strong principles:</p>
      </div>

      <div>
        <ul class="contribute-list avoid">
          {#each avoidItems as item}
            <li>
              <ShieldCheck size={18} />
              <span>{item}</span>
            </li>
          {/each}
        </ul>
        <p class="contribute-closing">Support helps MythicIQ stay aligned with those principles.</p>
      </div>
    </div>
  </section>

  <section class="contribute-note" aria-labelledby="note-title">
    <div>
      <p class="eyebrow left">A Quick Note</p>
      <h2 id="note-title">Contributions support the project.</h2>
      <p>
        MythicIQ is not a nonprofit, and contributions are not tax-deductible charitable donations.
        They are simply a way to support the project, help cover costs, and keep development moving.
      </p>
    </div>

    <a class="button button-primary" href="/#download">
      <Download size={20} />
      Desktop App
    </a>
  </section>

  <SiteFooter />
</main>
