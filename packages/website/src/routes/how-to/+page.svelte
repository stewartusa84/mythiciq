<script lang="ts">
  import {
    BarChart3,
    BookOpen,
    CirclePlay,
    Crosshair,
    Download,
    ExternalLink,
    FolderOpen,
    Gauge,
    MonitorDown,
    PlayCircle,
    Radio,
    Search,
    ShieldCheck,
    WandSparkles
  } from '@lucide/svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';
  import SiteHeader from '$lib/SiteHeader.svelte';
  import { loggerheadLiteUrl } from '$lib/links';

  const walkthroughEmbedUrl = '';

  const setupSteps = [
    {
      title: 'Choose web or desktop',
      body: 'Open the web app for browser-based review, or install the desktop app for the simpler regular-use flow with recent-run history and automatic encounter loading.',
      icon: MonitorDown
    },
    {
      title: 'Enable combat logging in WoW',
      body: 'World of Warcraft only writes a useful review file when combat logging is enabled. A lightweight helper add-on can handle turning logging on and off for the content you care about.',
      icon: Radio
    },
    {
      title: 'Run your key normally',
      body: 'Play the dungeon as usual. After the run, the combat log in your WoW Logs folder has the events MythicIQ needs for replay and analysis.',
      icon: Gauge
    },
    {
      title: 'Open the log in MythicIQ',
      body: 'In the web app, drop in the latest WoWCombatLog file. In the desktop app, use recent history, the file picker, or automatic encounter loading after a wipe or completed run.',
      icon: FolderOpen
    }
  ];

  const reviewSteps = [
    {
      title: 'Start with Overview',
      body: 'Confirm the dungeon, run time, deaths, party composition, and the broad read on how the key went.',
      icon: BookOpen
    },
    {
      title: 'Check Mechanics',
      body: 'Review avoidable damage, dangerous casts, dispels, cleanse opportunities, and the moments that usually decide whether a run feels clean.',
      icon: Crosshair
    },
    {
      title: 'Use Role Review',
      body: 'Look at tank, healer, and DPS-specific signals such as mitigation, interrupts, survivability, and useful team plays.',
      icon: ShieldCheck
    },
    {
      title: 'Drill into Pulls and Deaths',
      body: 'Open a bad pull or death recap, then use the replay timeline to see what happened around the mistake.',
      icon: Search
    },
    {
      title: 'Finish with Insights',
      body: 'Use data insights and custom review windows when you want to understand repeat patterns instead of a single event.',
      icon: BarChart3
    }
  ];

  const useOptions = [
    {
      title: 'Web App',
      badge: 'Browser',
      body: 'Use MythicIQ directly from the website when you want a quick review without installing anything. It is the full analyzer, not a demo.',
      icon: CirclePlay
    },
    {
      title: 'Desktop App',
      badge: 'Recommended',
      body: 'Use the desktop app when MythicIQ is part of your normal run routine: simpler UI, recent-run history, and automatic loading after wipes or run conclusions.',
      icon: WandSparkles
    }
  ];
</script>

<svelte:head>
  <title>How To Use MythicIQ | MythicIQ</title>
  <meta
    name="description"
    content="Learn how to use MythicIQ in the web app or desktop app, set up WoW combat logging, review mechanics, and use role insights."
  />
</svelte:head>

<main class="site-shell howto-page">
  <SiteHeader active="how-to" />

  <section class="howto-hero" aria-labelledby="howto-title">
    <div class="howto-hero-inner">
      <div class="howto-copy">
        <p class="eyebrow left">Getting Started</p>
        <h1 id="howto-title">How to use Mythic<span>IQ</span></h1>
        <p class="howto-lede">
          Set up combat logging once, run your key, then use the web app or desktop app to review
          what happened: mechanics, deaths, role decisions, and the data patterns that point to
          your next improvement.
        </p>

        <div class="howto-actions">
          <a class="button button-primary" href="/app/" rel="external" data-sveltekit-reload>
            <CirclePlay size={20} />
            Open Web App
          </a>
          <a class="button button-ghost" href="/#download">
            <Download size={20} />
            Desktop App
          </a>
        </div>
      </div>

      <aside class="howto-video-card" id="video" aria-label="Video walkthrough">
        <div class="video-frame">
          {#if walkthroughEmbedUrl}
            <iframe
              src={walkthroughEmbedUrl}
              title="MythicIQ setup walkthrough"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
            ></iframe>
          {:else}
            <div class="video-placeholder">
              <PlayCircle size={46} />
              <p>Video walkthrough coming soon</p>
              <span>A short YouTube or Loom walkthrough will live here during beta.</span>
            </div>
          {/if}
        </div>
      </aside>
    </div>
  </section>

  <section class="howto-section" id="setup" aria-labelledby="setup-title">
    <div class="howto-section-heading">
      <p class="eyebrow left">Basic Setup</p>
      <h2 id="setup-title">Get combat logging ready for review.</h2>
      <p>
        MythicIQ does the analysis, but World of Warcraft still has to write the combat log. The
        standard setup is simple: choose the web app or desktop app, make sure logging is enabled
        for dungeons, run your key, then review the newest log file.
      </p>
    </div>

    <div class="setup-grid">
      {#each setupSteps as step, index}
        <article class="setup-card">
          <span class="setup-number">{String(index + 1).padStart(2, '0')}</span>
          <svelte:component this={step.icon} size={28} />
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </article>
      {/each}
    </div>

    <article class="logger-card" aria-labelledby="logger-title">
      <div>
        <p class="eyebrow left">Logging Helper</p>
        <h2 id="logger-title">Use a lightweight add-on to manage logging.</h2>
        <p>
          MythicIQ does not currently turn combat logging on and off inside WoW. You can use a
          simple helper such as LoggerHeadLite on Wago Addons, or any equivalent add-on you already
          trust, to enable logging for the instances you want reviewed.
        </p>
      </div>

      <a class="button button-panel" href={loggerheadLiteUrl} target="_blank" rel="noreferrer">
        LoggerHeadLite on Wago
        <ExternalLink size={17} />
      </a>
    </article>
  </section>

  <section class="howto-section review-flow" aria-labelledby="review-title">
    <div class="howto-section-heading">
      <p class="eyebrow left">Review Your Play</p>
      <h2 id="review-title">A practical run-review pass.</h2>
      <p>
        You do not need to inspect every event. Use MythicIQ like a review checklist: confirm the
        run, find the costly moments, replay the context, and look for patterns you can improve next
        key.
      </p>
    </div>

    <div class="review-grid">
      {#each reviewSteps as step, index}
        <article class="review-card">
          <span class="review-icon">
            <svelte:component this={step.icon} size={24} />
          </span>
          <div>
            <p>Step {index + 1}</p>
            <h3>{step.title}</h3>
            <span>{step.body}</span>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section class="howto-section soon-section" aria-labelledby="soon-title">
    <div class="howto-section-heading">
      <p class="eyebrow left">Two Ways to Review</p>
      <h2 id="soon-title">Use the web app for quick review, desktop for the smoothest flow.</h2>
      <p>
        Both methods use the MythicIQ analyzer. The desktop app adds the quality-of-life features
        that matter when you review lots of keys and pulls.
      </p>
    </div>

    <div class="soon-grid">
      {#each useOptions as item}
        <article class="soon-card">
          <div class="soon-card-top">
            <svelte:component this={item.icon} size={30} />
            <strong>{item.badge}</strong>
          </div>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
        </article>
      {/each}
    </div>
  </section>

  <section class="howto-finish" aria-labelledby="finish-title">
    <div>
      <p class="eyebrow left">Ready for a Run</p>
      <h2 id="finish-title">Log the key, then let MythicIQ do the review.</h2>
      <p>
        Once logging is handled, the workflow is straightforward: play, open MythicIQ in the browser
        or desktop app, and review the moments that matter.
      </p>
    </div>

    <div class="howto-actions">
      <a class="button button-primary" href="/app/" rel="external" data-sveltekit-reload>
        <CirclePlay size={20} />
        Open Web App
      </a>
      <a class="button button-ghost" href="/#download">
        <Download size={20} />
        Desktop App
      </a>
    </div>
  </section>

  <SiteFooter />
</main>
