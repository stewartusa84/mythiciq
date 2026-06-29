<script lang="ts">
  import {
    BookOpen,
    CirclePlay,
    Download,
    ShieldCheck,
    Users
  } from '@lucide/svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';
  import SiteHeader from '$lib/SiteHeader.svelte';
  import mythicMark from '../../assets/img/mythiciq-m-large.png';

  const story = [
    'MythicIQ is a WoW combat-log companion app built to help players review Mythic+ runs and raid pulls, improve their play, and find groups with better-aligned expectations.',
    'It started as a hobby project from one developer who loves challenging group content, but kept running into the same problems many players do: confusing post-run feedback, group finder frustration, rating that does not always reflect actual mechanic knowledge, and too many tools that feel more focused on ads or public scorekeeping than helping players get better.',
    'MythicIQ is built around a different idea: review your content locally, understand what happened quickly, and use positive trust signals to form better groups without turning every mistake into public shame.',
    'The goal is not to replace player judgment or create another exclusion tool. The goal is to make Mythic+ and raid content easier to learn, easier to review, and less frustrating to pug.',
    'MythicIQ now works as a web app for browser-based review, with the desktop app recommended for regular use because it has a simpler interface, recent-run history, and automatic encounter loading.'
  ];

  const principles = [
    {
      title: 'Review Locally',
      body: 'Review in the browser or keep the smoother desktop workflow close to your machine.',
      icon: BookOpen,
      tone: 'cyan'
    },
    {
      title: 'Learn Without Shame',
      body: 'Turn confusing post-run moments into private clarity.',
      icon: ShieldCheck,
      tone: 'purple'
    },
    {
      title: 'Group With Better Signals',
      body: 'Use positive trust signals to find players with aligned expectations.',
      icon: Users,
      tone: 'violet'
    }
  ];
</script>

<svelte:head>
  <title>About MythicIQ | MythicIQ</title>
  <meta
    name="description"
    content="Learn why MythicIQ exists and how it helps WoW players review Mythic+ runs and raid pulls, improve, and find better-aligned groups."
  />
</svelte:head>

<main class="site-shell about-page">
  <SiteHeader active="about" />

  <section class="about-hero" aria-labelledby="about-title">
    <div class="about-hero-inner">
      <div class="about-copy">
        <p class="eyebrow left">Built by WoW Players</p>
        <h1 id="about-title">About Mythic<span>IQ</span></h1>
        <p class="about-lede">{story[0]}</p>

        <article class="about-story" aria-label="About MythicIQ story">
          {#each story.slice(1) as paragraph}
            <p>{paragraph}</p>
          {/each}
        </article>
      </div>

      <aside class="about-panel" aria-label="MythicIQ product principles">
        <div class="about-panel-mark">
          <img src={mythicMark} alt="" aria-hidden="true" />
        </div>
        <p class="about-panel-kicker">A different idea for group content</p>
        <h2>Review runs. Learn faster. Pug with less friction.</h2>

        <div class="about-principles">
          {#each principles as principle}
            <div class="about-principle">
              <span class:cyan={principle.tone === 'cyan'} class:violet={principle.tone === 'violet'}>
                <svelte:component this={principle.icon} size={21} />
              </span>
              <div>
                <h3>{principle.title}</h3>
                <p>{principle.body}</p>
              </div>
            </div>
          {/each}
        </div>
      </aside>
    </div>
  </section>

  <section class="about-development" aria-labelledby="development-title">
    <div>
      <p class="eyebrow left">Web and Desktop</p>
      <h2 id="development-title">Use the web app now; install desktop for the smoothest review flow.</h2>
      <p>
        The web app gives you the full analyzer in the browser. The desktop app is the better fit
        for regular play, with recent-run history and automatic loading after wipes or completed
        runs.
      </p>
    </div>
    <div class="features-download-actions">
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
