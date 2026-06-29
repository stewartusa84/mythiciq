<script lang="ts">
  import {
    CheckCircle2,
    Circle,
    CirclePlay,
    Clock3,
    Download,
    Sparkles
  } from '@lucide/svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';
  import SiteHeader from '$lib/SiteHeader.svelte';

  type ProgressItem = {
    id: string;
    title: string;
    body: string;
    status: string;
  };

  type RoadmapItem = {
    id: string;
    label: string;
    done: boolean;
  };

  type RoadmapGroup = {
    id: string;
    title: string;
    items: RoadmapItem[];
  };

  // Add or remove IDs here to highlight roadmap sections/items as active development.
  const activeDevelopmentIds = new Set([
    'near-beta',
    'desktop-app-polish',
    'lfg-real-user-testing',
    'addon-bridge',
    'signed-run-evidence',
    'server-side-run-validation',
    'basic-clean-run-credit',
    'early-badge-framework'
  ]);

  const currentProgress: ProgressItem[] = [
    {
      id: 'core-replay-system',
      title: 'Core Replay System',
      body: 'The web app and desktop app can parse combat logs locally for run review, with raid support growing from the same foundation.',
      status: 'Complete'
    },
    {
      id: 'near-beta',
      title: 'Near Beta',
      body: 'We are currently polishing the desktop app flow, LFG testing, stat verification, and the first version of clean run credit.',
      status: 'Current Focus'
    },
    {
      id: 'public-release',
      title: 'Public Release',
      body: 'Full public release will follow once the desktop app, LFG, addon bridge, and trust systems are stable enough for wider use.',
      status: 'Next'
    },
    {
      id: 'mobile-companion',
      title: 'Mobile Companion',
      body: 'Mobile apps are planned after the full desktop release.',
      status: 'Later'
    }
  ];

  const roadmapGroups: RoadmapGroup[] = [
    {
      id: 'beta-roadmap',
      title: 'Beta Roadmap',
      items: [
        { id: 'local-replay-system', label: 'Local replay system', done: true },
        { id: 'automatic-run-detection', label: 'Automatic run detection', done: true },
        { id: 'desktop-app-polish', label: 'Desktop app polish', done: false },
        { id: 'website-redesign', label: 'Website redesign', done: true },
        { id: 'public-web-app', label: 'Public web app analyzer', done: true },
        { id: 'battle-net-character-verification', label: 'Battle.net character verification', done: true },
        { id: 'lfg-real-user-testing', label: 'LFG real-user testing', done: false },
        { id: 'addon-bridge', label: 'In-game addon bridge for Premade Groups', done: false },
        { id: 'signed-run-evidence', label: 'Signed run evidence submission', done: false },
        { id: 'server-side-run-validation', label: 'Server-side run validation', done: false },
        { id: 'basic-clean-run-credit', label: 'Basic clean run credit', done: false },
        { id: 'early-badge-framework', label: 'Early badge framework', done: false },
        { id: 'group-review-comments', label: 'Group review and comments', done: false }
      ]
    },
    {
      id: 'release-roadmap',
      title: 'Release Roadmap',
      items: [
        { id: 'stable-windows-desktop-release', label: 'Stable Windows desktop release', done: false },
        { id: 'improved-installer-update-flow', label: 'Improved installer/update flow', done: false },
        { id: 'public-lfg-system', label: 'Public LFG system', done: false },
        { id: 'queue-specific-run-intents', label: 'Queue-specific run intents', done: false },
        { id: 'verified-character-signals', label: 'Verified character signals', done: false },
        { id: 'clean-run-timed-clean-run-history', label: 'Clean run and timed clean run history', done: false },
        { id: 'queue-scoped-badge-visibility', label: 'Queue-scoped badge visibility', done: false },
        { id: 'better-group-fit-signals', label: 'Better group-fit signals', done: false },
        { id: 'privacy-trust-documentation', label: 'Privacy and trust documentation', done: false },
        { id: 'open-source-release', label: 'Open-source release where practical', done: false },
        { id: 'support-donation-page', label: 'Support/donation page', done: true }
      ]
    },
    {
      id: 'later',
      title: 'Later',
      items: [
        { id: 'mobile-companion-apps', label: 'Mobile companion apps', done: false },
        { id: 'expanded-learning-library', label: 'Expanded learning library', done: false },
        { id: 'short-mechanic-clips', label: 'Short mechanic clips', done: false },
        { id: 'communities-mentoring', label: 'Communities and mentoring', done: false },
        { id: 'shared-replay-review', label: 'Shared replay review', done: false },
        { id: 'advanced-role-badges', label: 'Advanced role badges', done: false },
        { id: 'smarter-group-suggestions', label: 'Smarter group suggestions', done: false },
        {
          id: 'automatic-group-formation',
          label: 'More automatic group formation as the community grows',
          done: false
        }
      ]
    }
  ];

  const isActive = (id: string) => activeDevelopmentIds.has(id);
  const groupIsActive = (group: RoadmapGroup) =>
    isActive(group.id) || group.items.some((item) => isActive(item.id));
</script>

<svelte:head>
  <title>Roadmap | MythicIQ</title>
  <meta
    name="description"
    content="See the MythicIQ roadmap for beta, release, and future Mythic+ and raid companion features."
  />
</svelte:head>

<main class="site-shell roadmap-page">
  <SiteHeader active="roadmap" />

  <section class="roadmap-hero" aria-labelledby="roadmap-title">
    <div class="roadmap-hero-inner">
      <div>
        <p class="eyebrow left">Nearing Beta</p>
        <h1 id="roadmap-title">Mythic<span>IQ</span> Roadmap</h1>
        <p class="roadmap-lede">
          MythicIQ is nearing beta. The web app and core replay system are working, and the current
          focus is polishing the desktop app, testing LFG, and building the trust systems that
          support clean runs, badges, and better groups for Mythic+ and raid.
        </p>
      </div>

      <aside class="roadmap-status-card" aria-label="Current roadmap focus">
        <Clock3 size={34} />
        <p>Current Focus</p>
        <h2>Desktop polish, LFG testing, clean-run trust systems.</h2>
      </aside>
    </div>
  </section>

  <section class="roadmap-section roadmap-progress" aria-labelledby="current-progress-title">
    <div class="section-heading">
      <p class="eyebrow left">Current Progress</p>
      <h2 id="current-progress-title">Where MythicIQ stands now.</h2>
    </div>

    <div class="progress-grid">
      {#each currentProgress as item}
        <article class="progress-card" class:active={isActive(item.id)}>
          <div class="progress-card-top">
            {#if !isActive(item.id)}
              <span>{item.status}</span>
            {/if}
            {#if isActive(item.id)}
              <strong>Active Development</strong>
            {/if}
          </div>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
        </article>
      {/each}
    </div>
  </section>

  <section class="roadmap-section roadmap-groups" aria-label="Roadmap checklists">
    {#each roadmapGroups as group}
      <article class="roadmap-group" class:active={groupIsActive(group)}>
        <header>
          <div>
            <p class="eyebrow left">Roadmap</p>
            <h2>{group.title}</h2>
          </div>
          {#if groupIsActive(group)}
            <span class="active-badge">
              <Sparkles size={15} />
              Active Development
            </span>
          {/if}
        </header>

        <ul class="roadmap-list" aria-label={group.title}>
          {#each group.items as item}
            <li class:done={item.done} class:active={isActive(item.id)}>
              {#if item.done}
                <CheckCircle2 size={20} />
              {:else}
                <Circle size={20} />
              {/if}
              <span>{item.label}</span>
              {#if isActive(item.id)}
                <strong>Active</strong>
              {/if}
            </li>
          {/each}
        </ul>
      </article>
    {/each}
  </section>

  <section class="roadmap-goal" aria-labelledby="goal-title">
    <div>
      <p class="eyebrow left">Long-Term Goal</p>
      <h2 id="goal-title">Local-first tools for better WoW groups.</h2>
      <p>
        MythicIQ is being built as a local-first companion for reviewing Mythic+ runs and raid
        pulls in the web app or desktop app, improving play, and finding groups with aligned
        expectations.
      </p>
      <p>
        The goal is simple: better tools for group content without turning the game into another
        public shame board or ad-filled score site.
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
