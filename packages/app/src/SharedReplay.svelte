<!-- Public shared-replay viewer, mounted at /r/<code> (see main.ts). Anyone with the link can watch the
     replay WITHOUT signing in: it fetches the share (no auth), downloads + gunzips the run's sub-log,
     re-parses it with the normal worker, and renders the run header + the replay. Read-only — no history,
     no watch, no tabs. The replay shows real player names (the share owner chose to publish them). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { ParserClient, type FullReport, type RunReport, type DeathRecapResult } from '@wow/engine';
  import { fetchShare } from './mvp/share.js';
  import { gunzip } from './mvp/history.js';
  import { analytic } from './mvp/report.js';
  import { auth } from './mvp/auth.svelte.js';
  import { ReplayController } from './mvp/replayController.svelte.js';
  import RunSummary from './mvp/RunSummary.svelte';
  import ReplayViewer from './panels/ReplayViewer.svelte';
  import DiscussionThread from './panels/DiscussionThread.svelte';

  let { code }: { code: string } = $props();

  let status = $state<'loading' | 'needs-auth' | 'ready' | 'error'>('loading');
  let error = $state('');
  let anonymized = $state(false);
  let discussion = $state(false);
  let locked = $state(false);
  let isOwner = $state(false);
  let thread = $state<{ addMoment: (offsetMs: number) => void } | null>(null);
  let report = $state<FullReport | null>(null);
  let client = $state.raw<ParserClient | null>(null);
  const controller = new ReplayController();

  let run = $derived<RunReport | null>(report ? (report.runs[0] ?? null) : null);
  let deathCount = $derived(run ? (analytic<DeathRecapResult>(run, 'deaths.recap')?.deaths.length ?? 0) : 0);

  async function load() {
    status = 'loading';
    // Complete any returning Hosted-UI redirect / restore a session, then fetch with the token (a
    // signed-in discussion share 401s without it).
    await auth.init();
    const token = auth.configured ? ((await auth.getAccessToken()) ?? undefined) : undefined;
    const res = await fetchShare(code, token);
    if (!res.ok) {
      if (res.needsAuth) {
        status = 'needs-auth';
        return;
      }
      status = 'error';
      error = res.error;
      return;
    }
    anonymized = res.value.anonymized;
    discussion = res.value.discussion;
    locked = res.value.locked;
    isOwner = res.value.viewerIsOwner;
    try {
      const bytes = await gunzip(res.value.logGz);
      const file = new File([bytes as BlobPart], 'shared-run.txt', { type: 'text/plain' });
      const c = new ParserClient();
      client = c;
      await c.parse(file, {
        onReport: (rep) => {
          report = rep;
          status = 'ready';
        },
      });
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function signIn() {
    void auth.login(undefined, window.location.pathname + window.location.search);
  }

  onMount(load);
</script>

<div class="mvp shared">
  <header class="sr-top">
    <a class="sr-brand" href="https://mythiciq.app/">MythicIQ</a>
    <span class="sr-tag">Shared replay</span>
    {#if anonymized}<span class="sr-tag anon">Anonymized</span>{/if}
    <a class="sr-cta" href="https://mythiciq.app/">Analyze your own logs →</a>
  </header>

  {#if status === 'loading'}
    <div class="sr-state"><div class="sr-spinner"></div><p>Loading shared replay…</p></div>
  {:else if status === 'needs-auth'}
    <div class="sr-state">
      <p>This run was shared for discussion — sign in to view it and join the conversation.</p>
      {#if auth.configured}
        <button class="sr-btn" onclick={signIn}>Sign in</button>
      {:else}
        <p class="sr-err">Sign-in isn’t available here.</p>
      {/if}
      <a class="sr-cta" href="https://mythiciq.app/">Go to MythicIQ →</a>
    </div>
  {:else if status === 'error'}
    <div class="sr-state">
      <p class="sr-err">{error}</p>
      <a class="sr-cta" href="https://mythiciq.app/">Go to MythicIQ →</a>
    </div>
  {:else if status === 'ready' && report && run && client}
    <div class="sr-body">
      <RunSummary report={run} {deathCount} />
      <ReplayViewer
        {client}
        runIndex={0}
        {controller}
        embedded
        title="Replay"
        enabled={true}
        onCommentAtMoment={discussion ? (clockMs) => thread?.addMoment(clockMs - run.firstMs) : null}
      />
      {#if discussion}
        <DiscussionThread bind:this={thread} {code} {controller} runFirstMs={run.firstMs} {isOwner} {locked} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .shared { min-height: 100vh; background: var(--bg, #0e1116); color: var(--text, #e8e8ea); }
  .sr-top {
    display: flex; align-items: center; gap: 12px; padding: 10px 16px;
    border-bottom: 1px solid var(--border, #2a2d36);
  }
  .sr-brand { font-weight: 800; font-size: 16px; color: var(--text, #e8e8ea); text-decoration: none; }
  .sr-tag {
    font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--accent, #6ea8fe); border: 1px solid color-mix(in srgb, var(--accent, #6ea8fe) 55%, var(--border, #2a2d36));
    background: color-mix(in srgb, var(--accent, #6ea8fe) 14%, transparent); padding: 1px 6px; border-radius: 999px;
  }
  .sr-tag.anon {
    color: #8fe3b0; border-color: color-mix(in srgb, #8fe3b0 55%, var(--border, #2a2d36));
    background: color-mix(in srgb, #8fe3b0 14%, transparent);
  }
  .sr-cta { margin-left: auto; font-size: 13px; color: var(--accent, #6ea8fe); text-decoration: none; }
  .sr-cta:hover { text-decoration: underline; }
  .sr-btn {
    background: var(--accent, #6ea8fe); color: #0a0c10; border: none; border-radius: 8px;
    padding: 8px 18px; font-weight: 700; font-size: 13px; cursor: pointer;
  }
  .sr-btn:hover { filter: brightness(1.07); }
  .sr-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
  .sr-state { display: flex; flex-direction: column; align-items: center; gap: 14px; padding-top: 120px; }
  .sr-err { color: var(--danger, #ff6b6b); font-size: 14px; }
  .sr-spinner {
    width: 32px; height: 32px; border-radius: 50%;
    border: 3px solid var(--border, #2a2d36); border-top-color: var(--accent, #6ea8fe);
    animation: sr-spin 0.8s linear infinite;
  }
  @keyframes sr-spin { to { transform: rotate(360deg); } }
</style>
