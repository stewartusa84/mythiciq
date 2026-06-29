<!-- Discussion thread for a shared (anonymized, signed-in) run. Signed-in viewers comment, reply,
     react, and flag moments: an `@mm:ss` in a comment renders as a button that scrubs the replay to
     that time (minus the controller's lead-in). Replies render indented under their parent. The thread
     stays ~live by POLLING with an ETag (cheap 304s when nothing changed; paused when the tab is hidden)
     — the right fit for a Lambda backend with no persistent sockets. Posting needs a one-time handle. -->
<script lang="ts">
  import { auth } from '../mvp/auth.svelte.js';
  import { mmss } from '../mvp/report.js';
  import type { ReplayController } from '../mvp/replayController.svelte.js';
  import {
    fetchThread, postComment, deleteComment, reportComment, reactComment, getProfile, setHandle,
    setDiscussionLocked, REACTIONS, type Comment,
  } from '../mvp/comments.js';

  let {
    code,
    controller,
    runFirstMs,
    isOwner = false,
    locked = false,
  }: { code: string; controller: ReplayController; runFirstMs: number; isOwner?: boolean; locked?: boolean } = $props();

  const POLL_MS = 6000;

  let closed = $state(false); // owner can toggle; synced from the share's `locked` flag
  $effect(() => {
    closed = locked;
  });

  let comments = $state<Comment[]>([]);
  let etag = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let error = $state('');

  let handle = $state<string | null>(null);
  let handleDraft = $state('');
  let needHandle = $state(false);
  let savingHandle = $state(false);

  let draft = $state('');
  let draftAtMs = $state<number | null>(null);
  let replyTo = $state<Comment | null>(null); // when set, the next post is a reply to this comment
  let posting = $state(false);
  let reactingId = $state<string | null>(null); // which comment's reaction palette is open
  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  const mySub = $derived(auth.user?.sub ?? null);

  // Top-level comments + a parent→replies index (one level deep).
  let roots = $derived(comments.filter((c) => !c.parentId));
  let repliesByParent = $derived.by(() => {
    const m = new Map<string, Comment[]>();
    for (const c of comments) if (c.parentId) (m.get(c.parentId) ?? m.set(c.parentId, []).get(c.parentId)!).push(c);
    return m;
  });
  const liveCount = $derived(comments.filter((c) => !c.deletedAt).length);

  async function initialLoad(c: string) {
    status = 'loading';
    const [thread, prof] = await Promise.all([fetchThread(c), getProfile()]);
    if (thread.status === 'ok') {
      comments = thread.comments;
      etag = thread.etag;
      status = 'ready';
    } else if (thread.status === 'error') {
      status = 'error';
      error = thread.error;
    } else {
      status = 'ready';
    }
    if (prof.ok) handle = prof.value.handle;
  }

  // Cheap poll: a 304 leaves everything untouched; a 200 swaps in the new thread (keyed `{#each}` so the
  // DOM reconciles, and the composer's own state is separate, so a poll never disrupts what you're typing).
  async function poll() {
    if (status !== 'ready') return;
    const res = await fetchThread(code, etag);
    if (res.status === 'ok') {
      comments = res.comments;
      etag = res.etag;
    }
  }

  $effect(() => {
    const c = code; // re-run if the share changes
    void initialLoad(c);
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void poll();
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  });

  // Called by the replay viewer's "comment on this moment" button (bind:this from the parent).
  export function addMoment(offsetMs: number): void {
    draftAtMs = Math.max(0, Math.round(offsetMs));
    const tag = `@${mmss(draftAtMs)}`;
    draft = draft.trim() ? `${draft.trim()} ${tag} ` : `${tag} `;
    textareaEl?.focus();
  }

  function startReply(c: Comment) {
    replyTo = c;
    textareaEl?.focus();
  }

  async function post() {
    const body = draft.trim();
    if (!body || posting) return;
    posting = true;
    const parentId = replyTo ? (replyTo.parentId ?? replyTo.id) : undefined;
    const res = await postComment(code, body, draftAtMs ?? undefined, parentId);
    posting = false;
    if (res.ok) {
      comments = [...comments, res.value]; // optimistic; the poll will reconcile
      etag = null; // force the next poll to fetch fresh
      draft = '';
      draftAtMs = null;
      replyTo = null;
      needHandle = false;
    } else if (res.needsHandle) {
      needHandle = true;
    } else {
      error = res.error;
    }
  }

  async function saveHandle() {
    const h = handleDraft.trim();
    if (!h || savingHandle) return;
    savingHandle = true;
    const res = await setHandle(h);
    savingHandle = false;
    if (res.ok) {
      handle = res.value.handle;
      needHandle = false;
      void post();
    } else {
      error = res.error;
    }
  }

  async function remove(id: string) {
    const res = await deleteComment(code, id);
    if (res.ok) {
      comments = comments.map((c) => (c.id === id ? { ...c, deletedAt: Date.now(), body: '' } : c));
      etag = null;
    }
  }
  async function flag(id: string) {
    await reportComment(code, id);
  }
  async function react(id: string, emoji: string) {
    reactingId = null;
    const res = await reactComment(code, id, emoji);
    if (res.ok) {
      comments = comments.map((c) => (c.id === id ? res.value : c));
      etag = null;
    }
  }
  async function toggleLock() {
    const res = await setDiscussionLocked(code, !closed);
    if (res.ok) closed = res.value.locked;
  }

  function seek(offsetMs: number) {
    controller.seekTo(runFirstMs + offsetMs, { label: `@${mmss(offsetMs)}` });
  }

  type Seg = { t: 'text'; v: string } | { t: 'ts'; v: string; ms: number };
  function parseBody(body: string): Seg[] {
    const re = /@(\d{1,3}):([0-5]\d)/g;
    const segs: Seg[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      if (m.index > last) segs.push({ t: 'text', v: body.slice(last, m.index) });
      segs.push({ t: 'ts', v: m[0], ms: (Number(m[1]) * 60 + Number(m[2])) * 1000 });
      last = m.index + m[0].length;
    }
    if (last < body.length) segs.push({ t: 'text', v: body.slice(last) });
    return segs;
  }

  const when = (ms: number) => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const reactionList = (c: Comment) => Object.entries(c.reactions ?? {}).filter(([, subs]) => subs.length > 0);
</script>

{#snippet commentRow(c: Comment, reply: boolean)}
  <li class="dt-item" class:deleted={!!c.deletedAt} class:reply>
    <div class="dt-meta">
      <span class="dt-author">{c.deletedAt ? 'deleted' : c.authorHandle}</span>
      <span class="dt-time">{when(c.createdAt)}</span>
      {#if !c.deletedAt}
        <span class="dt-acts">
          {#if !closed}<button class="dt-link" onclick={() => startReply(c)}>reply</button>{/if}
          {#if c.authorSub === mySub || isOwner}
            <button class="dt-link" onclick={() => remove(c.id)}>delete</button>
          {:else}
            <button class="dt-link" onclick={() => flag(c.id)} title="Flag for moderation">report</button>
          {/if}
        </span>
      {/if}
    </div>
    {#if c.deletedAt}
      <p class="dt-body dt-gone">— comment removed —</p>
    {:else}
      <p class="dt-body">
        {#each parseBody(c.body) as seg}
          {#if seg.t === 'ts'}<button class="dt-ts" onclick={() => seek(seg.ms)}>{seg.v}</button>{:else}{seg.v}{/if}
        {/each}
      </p>
      <div class="dt-react">
        {#each reactionList(c) as [emoji, subs]}
          <button class="dt-chip" class:mine={mySub != null && subs.includes(mySub)} onclick={() => react(c.id, emoji)}>
            {emoji} {subs.length}
          </button>
        {/each}
        {#if !closed}
          <button class="dt-addreact" title="Add a reaction" onclick={() => (reactingId = reactingId === c.id ? null : c.id)}>☺﹢</button>
          {#if reactingId === c.id}
            <span class="dt-palette">
              {#each REACTIONS as emoji}
                <button class="dt-pemoji" onclick={() => react(c.id, emoji)}>{emoji}</button>
              {/each}
            </span>
          {/if}
        {/if}
      </div>
    {/if}
  </li>
{/snippet}

<section class="thread">
  <h3 class="dt-head">
    Discussion {#if liveCount}<span class="dt-count">{liveCount}</span>{/if}
    {#if isOwner}<button class="dt-link dt-lock" onclick={toggleLock}>{closed ? 'reopen' : 'close'}</button>{/if}
  </h3>

  {#if status === 'loading'}
    <p class="dt-muted">Loading discussion…</p>
  {:else if status === 'error'}
    <p class="dt-err">{error}</p>
  {:else}
    <ul class="dt-list">
      {#each roots as c (c.id)}
        {@render commentRow(c, false)}
        {#each repliesByParent.get(c.id) ?? [] as r (r.id)}
          {@render commentRow(r, true)}
        {/each}
      {/each}
      {#if comments.length === 0}
        <li class="dt-empty dt-muted">No comments yet — be the first to weigh in. Tip: type <code>@1:52</code> to link a moment.</li>
      {/if}
    </ul>

    {#if closed}
      <p class="dt-muted dt-closed">💬 This discussion is closed to new comments{isOwner ? ' — “reopen” above to allow them again.' : '.'}</p>
    {:else}
      {#if needHandle}
        <div class="dt-handle">
          <p class="dt-muted">Pick a display name to comment:</p>
          <div class="dt-row">
            <input class="dt-input" bind:value={handleDraft} placeholder="display name" maxlength="24" />
            <button class="dt-btn" onclick={saveHandle} disabled={savingHandle || !handleDraft.trim()}>Save</button>
          </div>
        </div>
      {/if}

      <div class="dt-compose">
        {#if replyTo}
          <span class="dt-pin">↪ replying to <b>{replyTo.authorHandle}</b> <button class="dt-link" onclick={() => (replyTo = null)}>clear</button></span>
        {/if}
        {#if draftAtMs != null}
          <span class="dt-pin">📍 {mmss(draftAtMs)} <button class="dt-link" onclick={() => (draftAtMs = null)}>clear</button></span>
        {/if}
        <textarea
          bind:this={textareaEl}
          bind:value={draft}
          class="dt-input dt-area"
          rows="2"
          placeholder="Add a comment…  (@1:52 links a moment)"
          onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post(); }}
        ></textarea>
        <div class="dt-row dt-end">
          {#if handle}<span class="dt-as">commenting as <b>{handle}</b></span>{/if}
          <button class="dt-btn" onclick={post} disabled={posting || !draft.trim()}>{posting ? 'Posting…' : replyTo ? 'Reply' : 'Comment'}</button>
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .thread {
    border: 1px solid var(--border, #2a2d36); border-radius: 12px; padding: 14px 16px;
    background: var(--surface, #14161c); color: var(--text, #e8e8ea);
    display: flex; flex-direction: column; gap: 10px;
  }
  .dt-head { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .dt-lock { margin-left: auto; }
  .dt-closed { font-style: italic; padding: 4px 0; }
  .dt-count {
    font-size: 11px; font-weight: 800; color: var(--accent, #6ea8fe);
    background: color-mix(in srgb, var(--accent, #6ea8fe) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent, #6ea8fe) 45%, var(--border, #2a2d36));
    border-radius: 999px; padding: 0 7px;
  }
  .dt-muted { color: var(--muted, #8b97a8); font-size: 12.5px; margin: 0; }
  .dt-err { color: var(--danger, #ff6b6b); font-size: 12.5px; margin: 0; }
  .dt-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .dt-empty { padding: 6px 0; }
  .dt-empty code { background: var(--surface-2, rgba(255,255,255,0.05)); padding: 0 4px; border-radius: 4px; }
  .dt-item { display: flex; flex-direction: column; gap: 3px; }
  /* Replies sit indented under their parent with a left rule. */
  .dt-item.reply {
    margin-left: 18px; padding-left: 10px; border-left: 2px solid var(--border, #2a2d36);
  }
  .dt-meta { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
  .dt-author { font-weight: 700; }
  .dt-time { color: var(--muted, #8b97a8); font-size: 11px; }
  .dt-acts { margin-left: auto; display: flex; gap: 8px; }
  .dt-link {
    background: none; border: none; color: var(--muted, #8b97a8); cursor: pointer;
    font-size: 11px; padding: 0; text-decoration: underline;
  }
  .dt-link:hover { color: var(--text, #e8e8ea); }
  .dt-body { margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .dt-gone { color: var(--muted, #8b97a8); font-style: italic; }
  .dt-ts {
    background: color-mix(in srgb, var(--accent, #6ea8fe) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent, #6ea8fe) 45%, var(--border, #2a2d36));
    color: var(--accent, #6ea8fe); border-radius: 5px; padding: 0 5px; cursor: pointer;
    font-size: 12px; font-variant-numeric: tabular-nums;
  }
  .dt-ts:hover { background: color-mix(in srgb, var(--accent, #6ea8fe) 28%, transparent); }
  /* Reactions. */
  .dt-react { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 2px; }
  .dt-chip {
    font-size: 11.5px; padding: 1px 7px; border-radius: 999px; cursor: pointer;
    background: var(--surface-2, rgba(255,255,255,0.04)); border: 1px solid var(--border, #2a2d36);
    color: var(--text, #e8e8ea); font-variant-numeric: tabular-nums;
  }
  .dt-chip.mine { border-color: var(--accent, #6ea8fe); background: color-mix(in srgb, var(--accent, #6ea8fe) 16%, transparent); }
  .dt-addreact {
    font-size: 11px; padding: 1px 6px; border-radius: 999px; cursor: pointer;
    background: none; border: 1px solid var(--border, #2a2d36); color: var(--muted, #8b97a8);
  }
  .dt-addreact:hover { color: var(--text, #e8e8ea); border-color: var(--muted, #8b97a8); }
  .dt-palette {
    display: inline-flex; gap: 2px; padding: 2px 4px; border-radius: 999px;
    background: var(--surface-2, rgba(255,255,255,0.06)); border: 1px solid var(--border, #2a2d36);
  }
  .dt-pemoji { background: none; border: none; cursor: pointer; font-size: 15px; padding: 0 2px; line-height: 1.4; }
  .dt-pemoji:hover { transform: scale(1.25); }
  .dt-handle { border-top: 1px solid var(--border, #2a2d36); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .dt-compose { border-top: 1px solid var(--border, #2a2d36); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .dt-pin { font-size: 11.5px; color: var(--accent, #6ea8fe); }
  .dt-row { display: flex; gap: 8px; align-items: center; }
  .dt-end { justify-content: flex-end; }
  .dt-as { font-size: 11px; color: var(--muted, #8b97a8); margin-right: auto; }
  .dt-as b { color: var(--text, #e8e8ea); }
  .dt-input {
    background: var(--surface-2, rgba(255,255,255,0.04)); color: var(--text, #e8e8ea);
    border: 1px solid var(--border, #2a2d36); border-radius: 7px; padding: 7px 9px; font-size: 13px;
    color-scheme: dark; font-family: inherit;
  }
  .dt-input:focus { outline: none; border-color: var(--accent, #6ea8fe); }
  .dt-area { width: 100%; box-sizing: border-box; resize: vertical; }
  .dt-handle .dt-input { flex: 1; }
  .dt-btn {
    background: var(--accent, #6ea8fe); color: #0a0c10; border: none; border-radius: 7px;
    padding: 7px 14px; font-weight: 700; font-size: 12.5px; cursor: pointer; white-space: nowrap;
  }
  .dt-btn:disabled { opacity: 0.5; cursor: default; }
</style>
