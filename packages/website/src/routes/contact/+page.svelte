<script lang="ts">
  import { CheckCircle2, Clock3, ExternalLink, Mail, MessageCircle, ShieldCheck } from '@lucide/svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';
  import SiteHeader from '$lib/SiteHeader.svelte';
  import { contactEmailAddress, discordInviteUrl } from '$lib/links';

  const contactTopics = [
    'Bug reports or confusing analyzer results',
    'Feature ideas for Mythic+ or raid review',
    'LFG, trust, and clean-run feedback',
    'Mechanic notes from real dungeon or raid logs',
    'Questions about supporting or contributing to MythicIQ'
  ];
</script>

<svelte:head>
  <title>Contact | MythicIQ</title>
  <meta
    name="description"
    content="Contact MythicIQ for questions, feedback, bug reports, and notes about the WoW combat-log analyzer."
  />
</svelte:head>

<main class="site-shell contact-page">
  <SiteHeader active="contact" />

  <section class="contact-hero" aria-labelledby="contact-title">
    <div class="contact-hero-inner">
      <div class="contact-copy">
        <p class="eyebrow left">Contact</p>
        <h1 id="contact-title">Get in touch with Mythic<span>IQ</span></h1>
        <p class="contact-lede">
          Send questions, bug reports, mechanic notes, or feedback about what would make MythicIQ
          more useful for real keys and raid nights.
        </p>
      </div>

      <aside class="contact-panel" aria-label="MythicIQ contact options">
        <div class="contact-card primary">
          <div class="contact-card-top">
            <span class="contact-icon">
              <Mail size={24} />
            </span>
            <strong>Planned Email</strong>
          </div>
          <h2>{contactEmailAddress}</h2>
          <p>
            Mail for mythiciq.app is not configured yet. This is the address we plan to use, and
            setup is still TBA.
          </p>
          <span class="contact-status">
            <Clock3 size={16} />
            TBA: domain mail setup pending
          </span>
        </div>

        <a class="contact-card link" href={discordInviteUrl} target="_blank" rel="noreferrer">
          <div class="contact-card-top">
            <span class="contact-icon cyan">
              <MessageCircle size={24} />
            </span>
            <ExternalLink size={17} />
          </div>
          <h2>Discord</h2>
          <p>Use Discord for community feedback while the domain email is being configured.</p>
        </a>
      </aside>
    </div>
  </section>

  <section class="contact-section" aria-labelledby="contact-topics-title">
    <div class="contact-section-inner">
      <div class="contact-heading">
        <p class="eyebrow left">What To Send</p>
        <h2 id="contact-topics-title">The best feedback is specific and grounded in real runs.</h2>
        <p>
          MythicIQ is still actively evolving, so concrete examples are especially useful: what you
          expected, what the app showed, and what would have helped you understand the pull faster.
        </p>
      </div>

      <ul class="contact-list">
        {#each contactTopics as topic}
          <li>
            <CheckCircle2 size={18} />
            <span>{topic}</span>
          </li>
        {/each}
      </ul>
    </div>
  </section>

  <section class="contact-note" aria-labelledby="contact-note-title">
    <span class="contact-note-icon">
      <ShieldCheck size={26} />
    </span>
    <div>
      <p class="eyebrow left">Privacy Note</p>
      <h2 id="contact-note-title">Please avoid sending full combat logs by email.</h2>
      <p>
        MythicIQ is local-first by design. For bugs, a short description, screenshot, shared replay
        link, or the smallest useful excerpt is better than sending a full raw log.
      </p>
    </div>
  </section>

  <SiteFooter />
</main>
