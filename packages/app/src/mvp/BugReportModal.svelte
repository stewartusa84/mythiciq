<!-- Bug-report modal: freeform text + optional screenshot attachments (file pick, paste, or drag-drop).
     Posts to the backend via submitBugReport. Attachments preview as thumbnails with remove buttons.
     Self-contained; App toggles `open`. Screenshots are read client-side to base64 — nothing else
     leaves the browser. -->
<script lang="ts">
  import { submitBugReport, bugReportingEnabled, type BugReportContext } from '../bugReport.js';

  let { open = $bindable(false), context }: { open?: boolean; context?: BugReportContext } = $props();

  type Att = { file: File; url: string };
  let message = $state('');
  let atts = $state<Att[]>([]);
  let phase = $state<'idle' | 'sending' | 'done' | 'error'>('idle');
  let resultMsg = $state('');
  let dragOver = $state(false);
  let fileInput = $state<HTMLInputElement>();

  const enabled = bugReportingEnabled();
  const MAX = 6;

  function addFiles(files: Iterable<File> | FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      if (atts.length >= MAX) break;
      atts = [...atts, { file: f, url: URL.createObjectURL(f) }];
    }
  }

  function removeAt(i: number) {
    const a = atts[i];
    if (a) URL.revokeObjectURL(a.url);
    atts = atts.filter((_, idx) => idx !== i);
  }

  function onPaste(e: ClipboardEvent) {
    const imgs = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    addFiles(e.dataTransfer?.files ?? null);
  }

  function reset() {
    for (const a of atts) URL.revokeObjectURL(a.url);
    atts = [];
    message = '';
    phase = 'idle';
    resultMsg = '';
  }

  function close() {
    reset();
    open = false;
  }

  async function send() {
    if (phase === 'sending') return;
    phase = 'sending';
    resultMsg = '';
    const res = await submitBugReport(message, atts.map((a) => a.file), context);
    if (res.ok) {
      phase = 'done';
      resultMsg = `Thanks — report sent${res.attachments ? ` with ${res.attachments} screenshot${res.attachments > 1 ? 's' : ''}` : ''}.${res.rejected ? ` (${res.rejected} attachment(s) skipped.)` : ''}`;
    } else {
      phase = 'error';
      resultMsg = res.error ?? 'Something went wrong.';
    }
  }
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') close(); }} />

{#if open}
  <!-- Backdrop: click-to-dismiss. Escape also closes (svelte:window above); role=presentation so it's
       not an interactive control itself — the dialog inside is the focus target. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div
      class="modal {dragOver ? 'drag' : ''}"
      role="dialog"
      aria-modal="true"
      aria-label="Report a bug"
      tabindex="-1"
      ondragover={(e) => { e.preventDefault(); dragOver = true; }}
      ondragleave={() => (dragOver = false)}
      ondrop={onDrop}
      onpaste={onPaste}
    >
      <div class="head">
        <h2>Report a bug</h2>
        <button class="x" onclick={close} aria-label="Close">✕</button>
      </div>

      {#if phase === 'done'}
        <p class="ok">{resultMsg}</p>
        <div class="actions"><button class="primary" onclick={close}>Done</button></div>
      {:else}
        <p class="intro">
          This is an early version, and some interactions, mechanics, or analysis may be wrong. If you
          spot something that's <b>definitely incorrect</b> — a mechanic credited to the wrong player, a
          removal/interrupt that didn't register, a number that can't be right — please report it. Ideas
          for <b>additional metrics or features</b> you'd like to see are very welcome too.
        </p>
        <p class="hint muted">
          Describe what happened and what you expected. Attach screenshots if they help — paste, drag, or pick them.
        </p>

        <textarea
          bind:value={message}
          placeholder="What went wrong? Steps to reproduce, what you expected vs. what you saw…"
          rows="6"
          disabled={phase === 'sending'}
        ></textarea>

        <div class="attrow">
          <button class="attach" onclick={() => fileInput?.click()} disabled={phase === 'sending' || atts.length >= MAX}>
            📎 Add screenshot
          </button>
          <span class="muted small">{atts.length}/{MAX} · paste or drag images here too</span>
          <input
            bind:this={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onchange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ''; }}
          />
        </div>

        {#if atts.length}
          <div class="thumbs">
            {#each atts as a, i (a.url)}
              <div class="thumb">
                <img src={a.url} alt={a.file.name} />
                <button class="rm" onclick={() => removeAt(i)} aria-label="Remove">✕</button>
              </div>
            {/each}
          </div>
        {/if}

        {#if !enabled}
          <p class="warn small">⚠ Bug reporting isn't wired up in this build (no backend configured).</p>
        {/if}
        {#if phase === 'error'}<p class="err small">{resultMsg}</p>{/if}

        <div class="actions">
          <button class="ghost" onclick={close}>Cancel</button>
          <button class="primary" onclick={send} disabled={!enabled || !message.trim() || phase === 'sending'}>
            {phase === 'sending' ? 'Sending…' : 'Send report'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .modal {
    width: min(560px, 100%); max-height: 90vh; overflow: auto;
    background: var(--bg, #14161c); color: var(--text, #e8e8ea);
    border: 1px solid var(--border, #2a2d36); border-radius: 12px;
    padding: 18px 20px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }
  .modal.drag { border-color: var(--accent, #6ea8fe); box-shadow: 0 0 0 2px var(--accent, #6ea8fe) inset; }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .head h2 { margin: 0; font-size: 16px; }
  .x { background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; padding: 4px; }
  .x:hover { color: var(--text); }
  .intro {
    margin: 4px 0 8px; font-size: 13px; line-height: 1.5;
    padding: 10px 12px; border-radius: 8px;
    background: rgba(110, 168, 254, 0.08); border: 1px solid rgba(110, 168, 254, 0.25);
  }
  .intro b { color: var(--text); }
  .hint { margin: 4px 0 10px; font-size: 13px; }
  .small { font-size: 12px; }
  textarea {
    width: 100%; box-sizing: border-box; resize: vertical;
    background: var(--surface-2, rgba(255,255,255,0.03)); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 10px; font: inherit; font-size: 13px;
  }
  textarea:focus { outline: none; border-color: var(--accent, #6ea8fe); }
  .attrow { display: flex; align-items: center; gap: 10px; margin: 10px 0; flex-wrap: wrap; }
  .attach {
    background: var(--surface-2, rgba(255,255,255,0.05)); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 13px;
  }
  .attach:hover:not(:disabled) { border-color: var(--hover-accent, #8a5cff); }
  .attach:disabled { opacity: 0.5; cursor: default; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .thumb { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb .rm {
    position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%;
    border: none; background: rgba(0,0,0,0.65); color: #fff; font-size: 10px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .primary {
    background: var(--accent, #6ea8fe); color: #0a0c10; border: none; border-radius: 8px;
    padding: 8px 16px; font-weight: 600; cursor: pointer; font-size: 13px;
  }
  .primary:disabled { opacity: 0.5; cursor: default; }
  .ghost { background: none; border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 8px 16px; cursor: pointer; font-size: 13px; }
  .ghost:hover { border-color: var(--hover-accent, #8a5cff); }
  .ok { color: var(--good, #5fd08a); font-size: 14px; }
  .err { color: var(--bad, crimson); }
  .warn { color: var(--warn, #e0a82e); }
</style>
