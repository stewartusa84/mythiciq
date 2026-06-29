<script lang="ts">
  import {
    Activity,
    BadgeCheck,
    BarChart3,
    BookOpen,
    CheckCircle2,
    CirclePlay,
    Code2,
    Crosshair,
    Download,
    MessageCircle,
    MonitorDown,
    ShieldCheck,
    ShieldHalf,
    Trophy,
    Users
  } from '@lucide/svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';
  import SiteHeader from '$lib/SiteHeader.svelte';

  type FeatureSection = {
    id: string;
    title: string;
    paragraphs: string[];
    bulletLead?: string;
    bullets: string[];
    closing?: string;
    icon: typeof Activity;
    tone: 'blue' | 'cyan' | 'purple' | 'violet';
  };

  const intro = [
    'MythicIQ is a local-first WoW companion app for reviewing Mythic+ runs and raid pulls, improving faster, and finding groups with better-aligned expectations.',
    'Use the full analyzer in the web app whenever you want a browser-based review, or install the desktop app for the smoother day-to-day workflow with recent-run history and automatic encounter loading.'
  ];

  const featureSections: FeatureSection[] = [
    {
      id: 'automatic-run-review',
      title: 'Automatic Run and Pull Review',
      paragraphs: [
        'MythicIQ reviews completed Mythic+ runs today in both the web app and desktop app, with the desktop app adding automatic encounter loading after wipes and run conclusions.'
      ],
      bullets: [
        'Web app run review',
        'Desktop automatic encounter loading',
        'Raid-pull review foundation',
        'Local combat log parsing',
        'Fast post-run summaries',
        'Replay-style run review',
        'Death, pull, mechanic, and interrupt review',
        'Key moments surfaced automatically'
      ],
      closing: 'The goal is simple: finish a run, open MythicIQ, and quickly understand what happened.',
      icon: Activity,
      tone: 'blue'
    },
    {
      id: 'local-first-replay-system',
      title: 'Local-First Replay System',
      paragraphs: [
        'Your review happens locally by default. The web app can analyze logs in your browser, while the desktop app keeps the more intuitive regular-use flow close to your machine.'
      ],
      bullets: [
        'Full browser-based web app',
        'Local replay review',
        'Desktop recent run and pull history',
        'No full log upload required for normal review',
        'Optional sharing when you choose to share a run',
        'Temporary shared logs/replays when needed'
      ],
      closing: 'MythicIQ is useful without making cloud uploads the default.',
      icon: MonitorDown,
      tone: 'cyan'
    },
    {
      id: 'mechanics-and-mistake-review',
      title: 'Mechanics and Mistake Review',
      paragraphs: [
        'MythicIQ helps identify the events that usually decide whether a dungeon run or raid pull feels smooth or painful.'
      ],
      bullets: [
        'Avoidable deaths',
        'Large damage events',
        'Dangerous casts',
        'Missed interrupts',
        'Dispel-related problems',
        'Boss and trash mechanic issues',
        'Role-specific improvement signals'
      ],
      closing:
        'The goal is not to shame players. The goal is to make it easier to learn what happened and what to improve next time.',
      icon: Crosshair,
      tone: 'purple'
    },
    {
      id: 'intent-based-group-finder',
      title: 'Intent-Based Group Finder',
      paragraphs: [
        "Most pug frustration starts before the group ever begins. MythicIQ's LFG system is built around matching players by intent, not just score, item level, or meta status.",
        'Rating can be useful, but it does not always tell the whole story. Many players have run into highly rated characters who still miss important mechanics, ignore dangerous casts, or do not understand what caused a run or raid pull to fall apart. Progression history can show experience, but it does not directly measure role competency, mechanic awareness, or whether players share the same expectations for the night.',
        'That gap is one of the main reasons MythicIQ includes its own group-finding system.'
      ],
      bulletLead: 'Group intents include:',
      bullets: [
        'Growth and learning',
        'Crest and vault runs',
        'Raid progression nights',
        'Alt and farm clears',
        'Timing-focused runs',
        'Progression push groups',
        'Helper and mentor-friendly groups'
      ],
      closing:
        'A +10 crest run, a raid farm clear, and a serious progression night do not have the same social contract. MythicIQ makes those expectations clear before anyone joins, then uses verified characters, history, clean-run signals, and queue-relevant badges to help form groups that actually fit the goal.',
      icon: Users,
      tone: 'violet'
    },
    {
      id: 'verified-characters',
      title: 'Verified Characters',
      paragraphs: [
        'Battle.net linking allows MythicIQ to verify that a character belongs to the user claiming it.'
      ],
      bullets: [
        'Battle.net character verification',
        'Verified character signals',
        'Cleaner LFG identity',
        'Stronger trust for review stats and group history'
      ],
      closing: 'This eliminates fake profiles and makes group formation more trustworthy.',
      icon: BadgeCheck,
      tone: 'blue'
    },
    {
      id: 'clean-run-credit',
      title: 'Clean Run Credit',
      paragraphs: [
        'MythicIQ uses a clean-run system based on evidence, not client-submitted claims.',
        'Clean run credit rewards responsible, consistent play without requiring perfection.'
      ],
      bullets: [
        'Per-character clean run credit',
        'Timed clean run history',
        'Content and difficulty-aware thresholds',
        'Role-aware expectations',
        'Server-side validation',
        'Evidence-based trust checks'
      ],
      closing: 'Clean means "played responsibly and within the expected threshold," not "made zero mistakes."',
      icon: ShieldCheck,
      tone: 'cyan'
    },
    {
      id: 'badges-and-positive-signals',
      title: 'Badges and Positive Signals',
      paragraphs: [
        'Badges reward players for useful, team-focused performance without creating another public ranking ladder.'
      ],
      bulletLead: 'Badge areas include:',
      bullets: [
        'Interrupt awareness',
        'Clean run consistency',
        'Reliable damage',
        'Healer readiness',
        'Tank mitigation',
        'Utility-minded play',
        'Consumable readiness',
        'Helper and mentor behavior'
      ],
      closing:
        'Badges show demonstrated competency. They are not endless tiers like "A+ DPS" or "S-tier player."',
      icon: Trophy,
      tone: 'purple'
    },
    {
      id: 'queue-scoped-visibility',
      title: 'Queue-Scoped Visibility',
      paragraphs: [
        'MythicIQ does not show every signal in every queue.',
        'A learning run, crest farm, casual raid clear, and serious progression push do not need the same information. MythicIQ shows signals that match the type of group being formed.'
      ],
      bullets: [
        'Basic trust signals for casual and learning groups',
        'Relevant competency signals for timing and crest runs',
        'Raid-relevant review signals as support expands',
        'Stronger readiness signals for progression push groups',
        'Fewer unnecessary exclusion tools in normal queues'
      ],
      closing: 'The goal is better group fit, not more reasons to decline people.',
      icon: BarChart3,
      tone: 'violet'
    },
    {
      id: 'group-review-and-comments',
      title: 'Group Review and Comments',
      paragraphs: [
        'MythicIQ includes tools for shared review, mentoring, and constructive feedback, with optional replay sharing for guildmates, friends, or mentors so they can leave timeline-specific comments on the run or pull.'
      ],
      bullets: [
        'Shared run reviews',
        'Shared raid-pull reviews as support expands',
        'Comments on key moments',
        'Group discussion around runs and pulls',
        'Mentor and helper workflows',
        'Temporary shared replay/log support'
      ],
      closing: 'This helps players learn together without turning mistakes into public punishment.',
      icon: BookOpen,
      tone: 'blue'
    },
    {
      id: 'in-game-addon-bridge',
      title: 'In-Game Addon Bridge',
      paragraphs: [
        "MythicIQ uses a lightweight in-game addon to help bridge MythicIQ groups into WoW's Premade Group Finder."
      ],
      bullets: [
        'Create or assist with Premade Group listings',
        'Use MythicIQ group codes',
        'Help applicants find the correct listing',
        'Highlight MythicIQ-matched applicants',
        "Support cross-faction grouping through Blizzard's Premade Group system"
      ],
      closing: "The addon reduces friction while respecting WoW's addon restrictions.",
      icon: Code2,
      tone: 'cyan'
    },
    {
      id: 'mobile-companion',
      title: 'Mobile Companion',
      paragraphs: ['Mobile apps are planned after the full desktop release.'],
      bulletLead: 'The mobile companion is intended to help with:',
      bullets: [
        'Viewing recent run summaries',
        'Managing LFG applications',
        'Group finder chat and notifications',
        'Reviewing basic character history',
        'Accessing learning resources',
        'Coordinating groups while playing on desktop'
      ],
      closing: 'The desktop app remains the main run review experience.',
      icon: MessageCircle,
      tone: 'purple'
    },
    {
      id: 'built-around-trust',
      title: 'Built Around Trust',
      paragraphs: ['MythicIQ is designed to earn trust from the start.'],
      bullets: [
        'Local-first run review',
        'No full log upload by default',
        'Signed stat submissions',
        'Server-side validation',
        'Positive public signals',
        'No public shame ratios',
        'No ad-heavy experience',
        'Open-source release where practical'
      ],
      closing:
        'MythicIQ exists to make Mythic+ and raid content easier to review, easier to learn, and less frustrating to pug.',
      icon: ShieldHalf,
      tone: 'violet'
    }
  ];
</script>

<svelte:head>
  <title>Features | MythicIQ</title>
  <meta
    name="description"
    content="Explore MythicIQ features for local Mythic+ and raid review, replay analysis, LFG, verified characters, clean-run credit, badges, and trust systems."
  />
</svelte:head>

<main class="site-shell features-page">
  <SiteHeader active="features" />

  <section class="features-hero" aria-labelledby="features-title">
    <div class="features-hero-inner">
      <div class="features-copy">
        <p class="eyebrow left">Local-First WoW Review Tools</p>
        <h1 id="features-title">Features</h1>
        {#each intro as paragraph}
          <p class="features-lede">{paragraph}</p>
        {/each}
      </div>

      <aside class="features-index" aria-label="Feature sections">
        <p class="features-index-kicker">Feature Map</p>
        <nav>
          {#each featureSections as section, index}
            <a href={`#${section.id}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              {section.title}
            </a>
          {/each}
        </nav>
      </aside>
    </div>
  </section>

  <section class="features-list" aria-label="MythicIQ feature details">
    {#each featureSections as section, index}
      <article class="feature-detail" id={section.id} aria-labelledby={`${section.id}-title`}>
        <div class="feature-detail-heading">
          <span
            class="feature-detail-icon"
            class:cyan={section.tone === 'cyan'}
            class:purple={section.tone === 'purple'}
            class:violet={section.tone === 'violet'}
          >
            <svelte:component this={section.icon} size={25} />
          </span>
          <div>
            <p class="eyebrow left">Feature {String(index + 1).padStart(2, '0')}</p>
            <h2 id={`${section.id}-title`}>{section.title}</h2>
          </div>
        </div>

        <div class="feature-detail-body">
          {#each section.paragraphs as paragraph}
            <p>{paragraph}</p>
          {/each}

          {#if section.bulletLead}
            <p class="feature-bullet-lead">{section.bulletLead}</p>
          {/if}

          <ul>
            {#each section.bullets as bullet}
              <li>
                <CheckCircle2 size={18} />
                <span>{bullet}</span>
              </li>
            {/each}
          </ul>

          {#if section.closing}
            <p class="feature-closing">{section.closing}</p>
          {/if}
        </div>
      </article>
    {/each}
  </section>

  <section class="features-download" aria-labelledby="features-download-title">
    <div>
      <p class="eyebrow left">Web or Desktop</p>
      <h2 id="features-download-title">Use the web app now, or install desktop for regular review.</h2>
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
