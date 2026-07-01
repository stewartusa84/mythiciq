<script lang="ts">
  import {
    BadgeCheck,
    BarChart3,
    Bot,
    Check,
    ChevronDown,
    CirclePlay,
    Code2,
    Crosshair,
    Download,
    ExternalLink,
    MonitorDown,
    Play,
    ShieldCheck,
    ShieldHalf,
    Sparkles,
    Swords,
    Trophy,
    Users,
    WandSparkles
  } from '@lucide/svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';
  import SiteHeader from '$lib/SiteHeader.svelte';

  const groupRows = [
    {
      activity: '+16 Waycrest Manor',
      tag: 'Push',
      comp: '1 Healer, 2 DPS',
      avatars: ['#6ee7d8', '#8b5cf6', '#f59e0b']
    },
    {
      activity: 'Heroic Raid Prog',
      tag: 'Prog',
      comp: '2 Healers, 5 DPS',
      avatars: ['#34d399', '#38bdf8', '#f472b6']
    },
    {
      activity: '+15 Court of Stars',
      tag: 'Vault',
      comp: '1 Healer, 1 DPS',
      avatars: ['#8b5cf6', '#f97316', '#2dd4bf']
    },
    {
      activity: 'Normal Alt Raid',
      tag: 'Clear',
      comp: '1 Tank, 3 DPS',
      avatars: ['#f43f5e', '#60a5fa']
    }
  ];

  const stats = [
    ['Score', '2,578', '+82'],
    ['Time', '28:34', '-02:11'],
    ['Deaths', '2', 'Best: 0'],
    ['Rating', '+16', '+82']
  ];

  const mechanics = [
    ['Cleansing Protocol', '3'],
    ['Magnetic Crush', '2'],
    ['Deploy Spark Bot', '1'],
    ['Shock Blast', '1']
  ];

  const reputation = [
    ['Clean Runs', '92%', 'Top 12%', 'good'],
    ['Mechanics Consistency', '88%', 'Top 15%', 'steady'],
    ['Helper Score', '4.8/5', 'Top 8%', 'helper'],
    ['Community Endorsements', '92', 'Top 10%', 'good']
  ];

  const values = [
    {
      title: 'No Ad Sludge',
      body: 'No popups, takeovers, or clutter. Sponsors, if any, stay tasteful.',
      icon: Bot,
      tone: 'purple'
    },
    {
      title: 'Free to Use',
      body: 'Always.',
      icon: Sparkles,
      tone: 'cyan'
    },
    {
      title: 'Open Source',
      body: 'Transparency matters.',
      icon: Code2,
      tone: 'violet'
    },
    {
      title: 'Community First',
      body: 'Built with feedback from players like you.',
      icon: Users,
      tone: 'purple'
    },
    {
      title: 'Privacy Focused',
      body: 'Your data stays yours.',
      icon: ShieldHalf,
      tone: 'cyan'
    },
    {
      title: 'Made for Runs and Raids',
      body: 'Built around real group content.',
      icon: WandSparkles,
      tone: 'violet'
    }
  ];

  const desktopRelease = {
    version: '0.1.0',
    installerHref: '/releases/desktop/0.1.0/MythicIQ-0.1.0-windows-x64-setup.exe',
    checksumHref: '/releases/desktop/0.1.0/MythicIQ-0.1.0-windows-x64-setup.exe.sha256',
    manifestHref: '/releases/desktop/0.1.0/manifest.json',
    verifyHref: '/releases/desktop/README.md'
  };

  const accessCards = [
    {
      kind: 'web',
      title: 'Web App',
      kicker: 'Use it in your browser',
      body:
        'Open the full MythicIQ analyzer from the website and load a combat log without installing anything.',
      action: 'Open Web App',
      href: '/app/',
      release: null,
      icon: CirclePlay,
      featured: false,
      bullets: ['No install required', 'Same combat-log analyzer', 'Best for quick reviews']
    },
    {
      kind: 'desktop',
      title: 'Desktop App',
      kicker: 'Recommended for regular play',
      body:
        'Install the simpler desktop experience with recent-run history and automatic encounter loading after a wipe or when a run concludes.',
      action: 'Download Desktop App',
      href: desktopRelease.installerHref,
      release: desktopRelease,
      icon: MonitorDown,
      featured: true,
      bullets: [
        'Simpler, more intuitive interface',
        'Recent run history for review',
        'Auto-loads wipes and completed runs'
      ]
    }
  ];
</script>

<svelte:head>
  <title>MythicIQ | WoW Run and Raid Review</title>
</svelte:head>

<main class="site-shell">
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-art" aria-hidden="true">
      <div class="portal">
        <div class="portal-ring"></div>
        <div class="portal-core">
          <span>+15</span>
        </div>
      </div>
      <div class="ruins ruins-left"></div>
      <div class="ruins ruins-right"></div>
    </div>

    <SiteHeader desktopHref="#download" />

    <div class="hero-content">
      <div class="hero-copy">
        <h1 id="hero-title">The Better Way <span>to Review WoW.</span></h1>
        <p>
          Find groups that fit your goals. Review Mythic+ runs and raid pulls in seconds. Learn
          mechanics, improve consistency, and build a reputation based on how you actually play.
        </p>

        <div class="hero-buttons">
          <a class="button button-primary" href="/app/" rel="external" data-sveltekit-reload>
            <CirclePlay size={20} />
            Open Web App
          </a>
          <a class="button button-ghost" href="#download">
            <Download size={20} />
            Get Desktop App
          </a>
        </div>

        <ul class="trust-list" aria-label="Product commitments">
          <li><ShieldCheck size={18} /> Free.</li>
          <li><ShieldCheck size={18} /> No ad sludge.</li>
          <li><Users size={18} /> Community-first.</li>
        </ul>
      </div>

      <aside class="party-card" aria-label="Built for Mythic+ and raid players">
        <h2>Built for Mythic+ and raid players.</h2>
        <p>Because we live it too.</p>
        <!-- Restore this block once MythicIQ has live player counts to show.
        <div class="party-row">
          <span class="avatar" style="--avatar: #f59e0b"></span>
          <span class="avatar" style="--avatar: #ef4444"></span>
          <span class="avatar" style="--avatar: #38bdf8"></span>
          <span class="avatar" style="--avatar: #a78bfa"></span>
          <span class="guild">+M</span>
          <strong>+1.2K</strong>
        </div>
        <small>Players and counting</small>
        -->
      </aside>
    </div>
  </section>

  <section class="journey" id="features" aria-labelledby="journey-heading">
    <p class="eyebrow" id="journey-heading">Your Journey, Elevated.</p>
    <div class="journey-grid">
      <article class="journey-card featured">
        <div class="card-heading">
          <span class="step">01</span>
          <div>
            <h2><Users size={26} /> Find</h2>
            <p>Find groups with shared expectations from the start.</p>
          </div>
        </div>

        <div class="glass-panel group-panel">
          <header>
            <strong>Looking for Group</strong>
            <div class="mini-tabs">
              <button>Growth</button>
              <button>Vault</button>
              <button>Raid</button>
              <button class="active">Push</button>
              <button>Learn</button>
            </div>
          </header>
          <div class="filter-row">
            <button>All Roles <ChevronDown size={12} /></button>
            <button>All Content <ChevronDown size={12} /></button>
            <button>All Regions <ChevronDown size={12} /></button>
          </div>

          {#each groupRows as row}
            <div class="group-row">
              <div>
                <strong>{row.activity}</strong>
                <span>{row.comp}</span>
              </div>
              <em>{row.tag}</em>
              <div class="mini-avatars" aria-hidden="true">
                {#each row.avatars as color}
                  <span style={`--avatar: ${color}`}></span>
                {/each}
              </div>
            </div>
          {/each}

          <a class="panel-link" href="#community">View all groups <ExternalLink size={15} /></a>
        </div>
      </article>

      <article class="journey-card">
        <div class="card-heading">
          <span class="step blue">02</span>
          <div>
            <h2><Swords size={26} /> Play</h2>
            <p>Automatic capture. Instant post-run and post-pull insights.</p>
          </div>
        </div>

        <div class="glass-panel report-panel">
          <header>
            <div>
              <strong>Combat Log Review</strong>
              <span>Completed</span>
            </div>
            <div class="run-time">
              <strong>Raid</strong>
              <span>28:34</span>
            </div>
          </header>
          <small>Bosses · Mechanics · Deaths · Cooldowns</small>

          <div class="divider"></div>

          <h3>Overview</h3>
          <div class="stat-grid">
            {#each stats as stat}
              <div>
                <span>{stat[0]}</span>
                <strong>{stat[1]}</strong>
                <em>{stat[2]}</em>
              </div>
            {/each}
          </div>

          <h3>Highlights</h3>
          <div class="highlight-grid">
            <div><strong>100.0%</strong><span>Bosses Defeated</span></div>
            <div><strong>89.7%</strong><span>Mechanics Handled</span></div>
            <div><strong>12</strong><span>Interrupts</span></div>
            <div><strong>3</strong><span>Deaths</span></div>
          </div>

          <a class="button button-primary button-block" href="/app/" rel="external" data-sveltekit-reload>Open Web App <ExternalLink size={15} /></a>
        </div>
      </article>

      <article class="journey-card">
        <div class="card-heading">
          <span class="step green">03</span>
          <div>
            <h2><BarChart3 size={26} /> Improve</h2>
            <p>Know exactly what happened and how to do better next time.</p>
          </div>
        </div>

        <div class="glass-panel analysis-panel">
          <div class="timeline-tabs">
            <button class="active">Timeline</button>
            <button>Deaths</button>
            <button>Ints</button>
            <button>Dmg</button>
            <button>Heals</button>
          </div>

          <div class="timeline" aria-label="Run timeline">
            <span class="line"></span>
            <span class="event danger" style="left: 7%"></span>
            <span class="event blue" style="left: 24%"></span>
            <span class="event green" style="left: 37%"></span>
            <span class="event purple" style="left: 55%"></span>
            <span class="event danger" style="left: 84%"></span>
            <span class="event orange" style="left: 95%"></span>
          </div>

          <div class="time-labels">
            <span>00:00</span>
            <span>10:00</span>
            <span>20:00</span>
            <span>28:34</span>
          </div>

          <h3>Mechanics</h3>
          {#each mechanics as mechanic}
            <div class="mechanic-row">
              <span><Crosshair size={13} /> {mechanic[0]}</span>
              <strong>{mechanic[1]}</strong>
            </div>
          {/each}

          <div class="learning-card">
            <div class="thumb">
              <Play size={18} fill="currentColor" />
              <span>0:05</span>
            </div>
            <div>
              <strong>Cleansing Protocol</strong>
              <span>How to handle this mechanic</span>
            </div>
          </div>

          <a class="panel-link centered" href="/app/" rel="external" data-sveltekit-reload>Open Web App <ExternalLink size={15} /></a>
        </div>
      </article>

      <article class="journey-card">
        <div class="card-heading">
          <span class="step">04</span>
          <div>
            <h2><ShieldCheck size={26} /> Earn Trust</h2>
            <p>Your reputation reflects how you play, not just your score.</p>
          </div>
        </div>

        <div class="glass-panel profile-panel">
          <header class="profile-header">
            <span class="portrait"></span>
            <div>
              <strong>Arcanist</strong>
              <span>Tichondrius · Horde</span>
            </div>
            <span class="crest"><Trophy size={22} /></span>
          </header>

          <div class="divider"></div>

          <div class="profile-title">
            <strong>Reputation</strong>
            <a href="/app/" rel="external" data-sveltekit-reload>Open Web App <ExternalLink size={13} /></a>
          </div>

          {#each reputation as item}
            <div class="rep-row">
              <span class={`rep-icon ${item[3]}`}>
                <BadgeCheck size={18} />
              </span>
              <div>
                <span>{item[0]}</span>
                <div class="meter"><span style={`width: ${item[1].includes('/') ? '96%' : item[1]}`}></span></div>
              </div>
              <strong>{item[1]}<small>{item[2]}</small></strong>
            </div>
          {/each}

          <a class="panel-link centered" href="/app/" rel="external" data-sveltekit-reload>Open Web App <ExternalLink size={15} /></a>
        </div>
      </article>
    </div>
  </section>

  <section class="origin-band" id="about" aria-labelledby="about-title">
    <div class="origin-copy">
      <p class="eyebrow left">Built by WoW Players<br />For WoW Players</p>
      <h2 id="about-title">We built MythicIQ because post-run feedback should be clearer.</h2>
      <p>
        Group Finder frustration, raid-night confusion, and vague "what went wrong?" recaps waste
        time. MythicIQ is our way to make the combat log useful for the people actually playing.
      </p>
    </div>

    <div class="value-grid">
      {#each values as value}
        <article class="value-card">
          <span class={`value-icon ${value.tone}`}>
            <svelte:component this={value.icon} size={28} />
          </span>
          <div>
            <h3>{value.title}</h3>
            <p>{value.body}</p>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section class="download-section" id="download" aria-labelledby="download-heading">
    <p class="eyebrow">Use MythicIQ Your Way</p>
    <h2 id="download-heading">Web app or desktop app.</h2>
    <p class="download-lede">
      The web app is the full MythicIQ analyzer in your browser. The desktop app is best for regular
      review: it has a simpler interface, keeps recent runs handy, and can auto-load encounters after
      a wipe or when a run ends.
    </p>

    <div class="download-grid">
      {#each accessCards as card}
        <article class="download-card" class:featured={card.featured}>
          <svelte:component this={card.icon} size={46} />
          <div>
            <p class="download-kicker">{card.kicker}</p>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
            <ul>
              {#each card.bullets as bullet}
                <li><Check size={15} /> {bullet}</li>
              {/each}
            </ul>
            {#if card.kind === 'web'}
              <a class="button button-primary button-block" href={card.href} rel="external" data-sveltekit-reload>
                {card.action}
              </a>
            {:else}
              <a class="button button-panel" href={card.href} download>
                <Download size={16} />
                {card.action}
              </a>
              {#if card.release}
                <div class="release-meta" aria-label={`Desktop release ${card.release.version} verification`}>
                  <span>Windows x64 · v{card.release.version}</span>
                  <a href={card.release.checksumHref}>SHA-256</a>
                  <a href={card.release.manifestHref}>Manifest</a>
                  <a href={card.release.verifyHref}>Verify</a>
                </div>
              {/if}
            {/if}
          </div>
        </article>
      {/each}
    </div>
  </section>

  <SiteFooter desktopHref="#download" />
</main>
