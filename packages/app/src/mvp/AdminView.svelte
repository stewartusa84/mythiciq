<!--
  Admin review workspace — shown only to backend-authorized admins (see admin.svelte.ts). Review queues
  cover mechanic-card edits, removal discoveries, bug reports, and comment moderation; SuperAdmin users
  also get a Cognito user-role tab. Each queue lazy-loads on first view and has a manual refresh.
-->
<script lang="ts">
  import WowheadLink from './WowheadLink.svelte';
  import MechanicCardView from './MechanicCard.svelte';
  import { tip } from './tip.js';
  import { mechanicsRuntime } from './mechanicsRuntime.svelte.js';
  import { auth } from './auth.svelte.js';
  import {
    admin,
    listMechanicEdits,
    reviewMechanicEdit,
    listDiscoveries,
    forgetDiscovery,
    listBugReports,
    listCommentReports,
    removeComment,
    blockUser,
    unblockUser,
    listAdminUsers,
    setAdminUserRoles,
    type MechanicEditRecord,
    type MechanicEditsResponse,
    type DiscoveriesResponse,
    type BugReportRecord,
    type CommentReportRecord,
    type AdminUserSummary,
    type AdminUsersResponse,
  } from './admin.svelte.js';
  import type { MechanicCard } from '@wow/engine';

  type Queue = 'edits' | 'discoveries' | 'bugs' | 'comments' | 'users';
  let active = $state<Queue>('edits');

  // --- mechanic edits ---
  let edits = $state<MechanicEditsResponse | null>(null);
  let editsBusy = $state(false);
  let editsErr = $state<string | null>(null);
  let acting = $state<Record<string, boolean>>({});
  let previewOpen = $state<Record<string, boolean>>({});
  let showRejectedEdits = $state(false);
  let pendingEditCount = $derived(edits ? edits.records.filter((r) => r.status === 'pending').length : 0);
  let rejectedEditCount = $derived(edits ? edits.records.filter((r) => r.status === 'rejected').length : 0);
  let visibleEditRecords = $derived(edits ? edits.records.filter((r) => showRejectedEdits || r.status !== 'rejected') : []);

  async function loadEdits(): Promise<void> {
    editsBusy = true;
    editsErr = null;
    try {
      edits = await listMechanicEdits();
    } catch (e) {
      editsErr = e instanceof Error ? e.message : String(e);
    } finally {
      editsBusy = false;
    }
  }

  async function decide(rec: MechanicEditRecord, decision: 'approve' | 'reject'): Promise<void> {
    acting = { ...acting, [rec.id]: true };
    try {
      const res = await reviewMechanicEdit(rec.id, decision);
      // Reflect the new status in place, then pull the fresh live bundle so the app UI updates too.
      if (edits) {
        edits = {
          ...edits,
          records: edits.records.map((r) => (r.id === rec.id ? { ...r, status: res.status, reviewedAt: new Date().toISOString() } : r)),
        };
      }
      void mechanicsRuntime.refresh();
    } catch (e) {
      editsErr = e instanceof Error ? e.message : String(e);
    } finally {
      acting = { ...acting, [rec.id]: false };
    }
  }

  // --- discoveries ---
  let discoveries = $state<DiscoveriesResponse | null>(null);
  let discBusy = $state(false);
  let discErr = $state<string | null>(null);
  let forgetting = $state<Record<string, boolean>>({});

  async function loadDiscoveries(): Promise<void> {
    discBusy = true;
    discErr = null;
    try {
      discoveries = await listDiscoveries();
    } catch (e) {
      discErr = e instanceof Error ? e.message : String(e);
    } finally {
      discBusy = false;
    }
  }

  async function forget(key: string): Promise<void> {
    forgetting = { ...forgetting, [key]: true };
    try {
      await forgetDiscovery(key);
      await loadDiscoveries();
      void mechanicsRuntime.refresh();
    } catch (e) {
      discErr = e instanceof Error ? e.message : String(e);
    } finally {
      forgetting = { ...forgetting, [key]: false };
    }
  }

  // --- bug reports ---
  let bugs = $state<{ total: number; records: BugReportRecord[] } | null>(null);
  let bugsBusy = $state(false);
  let bugsErr = $state<string | null>(null);

  async function loadBugs(): Promise<void> {
    bugsBusy = true;
    bugsErr = null;
    try {
      bugs = await listBugReports();
    } catch (e) {
      bugsErr = e instanceof Error ? e.message : String(e);
    } finally {
      bugsBusy = false;
    }
  }

  // --- comment reports ---
  let reports = $state<{ reports: CommentReportRecord[] } | null>(null);
  let repBusy = $state(false);
  let repErr = $state<string | null>(null);
  let repActing = $state<Record<string, boolean>>({});

  async function loadReports(): Promise<void> {
    repBusy = true;
    repErr = null;
    try {
      reports = await listCommentReports();
    } catch (e) {
      repErr = e instanceof Error ? e.message : String(e);
    } finally {
      repBusy = false;
    }
  }

  async function doRemove(r: CommentReportRecord): Promise<void> {
    const k = `${r.code}:${r.id}`;
    repActing = { ...repActing, [k]: true };
    try {
      await removeComment(r.code, r.id);
      await loadReports();
    } catch (e) {
      repErr = e instanceof Error ? e.message : String(e);
    } finally {
      repActing = { ...repActing, [k]: false };
    }
  }

  async function doBlock(sub: string, block: boolean): Promise<void> {
    repActing = { ...repActing, [`block:${sub}`]: true };
    try {
      await (block ? blockUser(sub) : unblockUser(sub));
    } catch (e) {
      repErr = e instanceof Error ? e.message : String(e);
    } finally {
      repActing = { ...repActing, [`block:${sub}`]: false };
    }
  }

  // --- users / roles (super-admin only) ---
  let users = $state<AdminUsersResponse | null>(null);
  let usersBusy = $state(false);
  let usersErr = $state<string | null>(null);
  let userActing = $state<Record<string, boolean>>({});

  async function loadUsers(nextToken?: string): Promise<void> {
    usersBusy = true;
    usersErr = null;
    try {
      const page = await listAdminUsers(nextToken);
      users = nextToken && users ? { users: [...users.users, ...page.users], nextToken: page.nextToken } : page;
    } catch (e) {
      usersErr = e instanceof Error ? e.message : String(e);
    } finally {
      usersBusy = false;
    }
  }

  async function setRole(u: AdminUserSummary, role: 'admin' | 'superAdmin', value: boolean): Promise<void> {
    const key = `${u.sub}:${role}`;
    userActing = { ...userActing, [key]: true };
    usersErr = null;
    try {
      const updated = await setAdminUserRoles(u.sub, { [role]: value });
      if (users) users = { ...users, users: users.users.map((x) => (x.sub === u.sub ? updated : x)) };
      if (u.sub === auth.user?.sub) void admin.refresh(true);
    } catch (e) {
      usersErr = e instanceof Error ? e.message : String(e);
    } finally {
      userActing = { ...userActing, [key]: false };
    }
  }

  // Lazy-load whichever queue is showing (once).
  $effect(() => {
    if (active === 'edits' && !edits && !editsBusy) void loadEdits();
    if (active === 'discoveries' && !discoveries && !discBusy) void loadDiscoveries();
    if (active === 'bugs' && !bugs && !bugsBusy) void loadBugs();
    if (active === 'comments' && !reports && !repBusy) void loadReports();
    if (active === 'users' && admin.isSuperAdmin && !users && !usersBusy) void loadUsers();
    if (active === 'users' && !admin.isSuperAdmin) active = 'edits';
  });

  const short = (id: string): string => id.slice(0, 8);
  const when = (iso?: string): string => (iso ? new Date(iso).toLocaleString() : '');
  const whenMs = (ms?: number): string => (ms ? new Date(ms).toLocaleString() : '');
  let EDIT_TABS: { id: Queue; label: string }[] = $derived([
    { id: 'edits', label: 'Mechanic edits' },
    { id: 'discoveries', label: 'Discoveries' },
    { id: 'bugs', label: 'Bug reports' },
    { id: 'comments', label: 'Comments' },
    ...(admin.isSuperAdmin ? ([{ id: 'users', label: 'Users' }] as { id: Queue; label: string }[]) : []),
  ]);

  // Render one proposed value compactly for the before/after diff.
  function valueLabel(key: string, v: unknown): string {
    if (v === null) return '(clear)';
    if (v === undefined) return '(unset)';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (key === 'advice' && v && typeof v === 'object') {
      return Object.entries(v as Record<string, string>)
        .map(([role, text]) => `${role}: ${text}`)
        .join('  •  ');
    }
    if (key === 'videos' && Array.isArray(v)) return `${v.length} video(s)`;
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  }

  function cardFor(spellId: number): MechanicCard | undefined {
    return edits?.cards[String(spellId)];
  }

  function proposedCard(rec: MechanicEditRecord, current?: MechanicCard): MechanicCard {
    const out: Record<string, unknown> = { ...(current ?? {}), spellId: rec.spellId };
    for (const [key, value] of Object.entries(rec.proposed)) {
      if (value === null || ((key === 'avoidable' || key === 'boss') && value === false)) delete out[key];
      else out[key] = value;
    }
    return out as unknown as MechanicCard;
  }

  const ADVICE_ORDER = ['generic', 'tank', 'healer', 'dps'] as const;
  type AdviceKey = (typeof ADVICE_ORDER)[number];
  const adviceLabel = (key: string): string => (key === 'generic' ? 'Everyone' : key.toUpperCase());

  type DiffPart = { text: string; kind: 'same' | 'removed' | 'added' };
  type DiffPair = { before: DiffPart[]; after: DiffPart[] };
  type AdviceDiffRow = {
    key: AdviceKey;
    label: string;
    before: DiffPart[];
    after: DiffPart[];
  };

  function isProposedRemoval(key: string, value: unknown): boolean {
    return value === null || ((key === 'avoidable' || key === 'boss') && value === false);
  }

  function tokenizeDiffText(text: string): string[] {
    return text.match(/\s+|[^\s]+/g) ?? [];
  }

  function pushPart(parts: DiffPart[], part: DiffPart): void {
    const prev = parts[parts.length - 1];
    if (prev?.kind === part.kind) prev.text += part.text;
    else parts.push(part);
  }

  function diffText(beforeText: string, afterText: string): DiffPair {
    if (beforeText === afterText) {
      const same = beforeText ? [{ text: beforeText, kind: 'same' as const }] : [];
      return { before: same, after: same };
    }

    const beforeTokens = tokenizeDiffText(beforeText);
    const afterTokens = tokenizeDiffText(afterText);
    const rows = beforeTokens.length + 1;
    const cols = afterTokens.length + 1;
    const lcs = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
    const cell = (row: number, col: number): number => lcs[row]?.[col] ?? 0;
    for (let i = beforeTokens.length - 1; i >= 0; i -= 1) {
      for (let j = afterTokens.length - 1; j >= 0; j -= 1) {
        const row = lcs[i];
        if (row) row[j] = beforeTokens[i] === afterTokens[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
      }
    }

    const before: DiffPart[] = [];
    const after: DiffPart[] = [];
    let i = 0;
    let j = 0;
    while (i < beforeTokens.length || j < afterTokens.length) {
      if (i < beforeTokens.length && j < afterTokens.length && beforeTokens[i] === afterTokens[j]) {
        pushPart(before, { text: beforeTokens[i] ?? '', kind: 'same' });
        pushPart(after, { text: afterTokens[j] ?? '', kind: 'same' });
        i += 1;
        j += 1;
      } else if (j < afterTokens.length && (i === beforeTokens.length || cell(i, j + 1) >= cell(i + 1, j))) {
        pushPart(after, { text: afterTokens[j] ?? '', kind: 'added' });
        j += 1;
      } else if (i < beforeTokens.length) {
        pushPart(before, { text: beforeTokens[i] ?? '', kind: 'removed' });
        i += 1;
      }
    }
    return { before, after };
  }

  function fieldDiff(key: string, currentValue: unknown, proposedValue: unknown): DiffPair {
    const beforeText = valueLabel(key, currentValue);
    const removal = isProposedRemoval(key, proposedValue);
    const afterText = removal ? '(removed)' : valueLabel(key, proposedValue);
    if (removal) return { before: [{ text: beforeText, kind: 'removed' }], after: [{ text: afterText, kind: 'same' }] };
    if (currentValue === undefined) return { before: [{ text: beforeText, kind: 'same' }], after: [{ text: afterText, kind: 'added' }] };
    return diffText(beforeText, afterText);
  }

  function adviceText(v: unknown, key: AdviceKey): string {
    if (!v || typeof v !== 'object') return '';
    const text = (v as Record<string, unknown>)[key];
    return typeof text === 'string' ? text.trim() : '';
  }

  function adviceDiffRows(current: unknown, proposed: unknown): AdviceDiffRow[] {
    const rows: AdviceDiffRow[] = [];
    for (const key of ADVICE_ORDER) {
      const beforeText = adviceText(current, key);
      const afterText = adviceText(proposed, key);
      if (!beforeText && !afterText) continue;
      const pair = !afterText && beforeText
        ? { before: [{ text: beforeText, kind: 'removed' as const }], after: [{ text: '(removed)', kind: 'same' as const }] }
        : !beforeText
          ? { before: [{ text: '(unset)', kind: 'same' as const }], after: [{ text: afterText, kind: 'added' as const }] }
          : diffText(beforeText, afterText);
      rows.push({ key, label: adviceLabel(key), before: pair.before, after: pair.after });
    }
    return rows;
  }

  const queueTotal = (name: Queue): number | undefined => {
    if (name === 'edits') return pendingEditCount;
    if (name === 'discoveries') return discoveries?.total;
    if (name === 'bugs') return bugs?.total;
    if (name === 'comments') return reports?.reports.length;
    if (name === 'users') return users?.users.length;
    return undefined;
  };
</script>

<div class="admin">
  <header class="admin-head">
    <div class="head-copy">
      <span class="eyebrow">Operations</span>
      <h1>Admin review</h1>
      <p>Review submitted changes, moderate community signals, and keep the live mechanics library tidy.</p>
    </div>
    <div class="head-stats" aria-label="Admin queue totals">
      {#each EDIT_TABS as tab (tab.id)}
        <button class="stat" class:on={active === tab.id} onclick={() => (active = tab.id)}>
          <span class="stat-k">{tab.label}</span>
          <span class="stat-v">{queueTotal(tab.id) ?? '—'}</span>
        </button>
      {/each}
    </div>
  </header>

  {#if active === 'edits'}
    <section class="queue">
      <div class="qbar">
        <span class="muted">Community edits to mechanic cards. Approving folds the change into the live bundle — no redeploy.</span>
        <div class="queue-tools">
          <button class="ghost tiny" class:on={showRejectedEdits} onclick={() => (showRejectedEdits = !showRejectedEdits)} disabled={!rejectedEditCount}>
            {showRejectedEdits ? 'Hide rejected' : `Show rejected${rejectedEditCount ? ` (${rejectedEditCount})` : ''}`}
          </button>
          <button class="ghost tiny" onclick={loadEdits} disabled={editsBusy}>{editsBusy ? 'Loading…' : '↻ Refresh'}</button>
        </div>
      </div>
      <p class="diff-note"><span class="sample added">Underlined</span> text is proposed new content; <span class="sample removed">struck</span> text is content the edit removes.</p>
      {#if editsErr}<p class="err">{editsErr}</p>{/if}
      {#if edits && visibleEditRecords.length === 0}
        <p class="empty">No mechanic-edit suggestions in the queue.</p>
      {:else if edits}
        <ul class="cards">
          {#each visibleEditRecords as rec (rec.id)}
            {@const current = cardFor(rec.spellId)}
            <li class="card edit" class:done={rec.status !== 'pending'}>
              <div class="edit-top">
                <div class="edit-title">
                  <WowheadLink id={rec.spellId} name={current?.name ?? rec.proposed.name ?? `Spell ${rec.spellId}`} />
                  <span class="dim">#{rec.spellId}{rec.dungeon ? ` · ${rec.dungeon}` : current?.dungeon ? ` · ${current.dungeon}` : ''}</span>
                </div>
                <div class="edit-state">
                  <button class="ghost tiny preview-btn" onclick={() => (previewOpen = { ...previewOpen, [rec.id]: !previewOpen[rec.id] })}>
                    {previewOpen[rec.id] ? 'Hide preview' : 'Preview'}
                  </button>
                  <span class="status {rec.status}">{rec.status}</span>
                </div>
              </div>
              <div class="diff">
                {#each Object.entries(rec.proposed) as [key, value] (key)}
                  {@const currentValue = current ? (current as unknown as Record<string, unknown>)[key] : undefined}
                  {@const parts = fieldDiff(key, currentValue, value)}
                  <div class="drow">
                    <span class="dkey">{key}</span>
                    {#if key === 'advice'}
                      {@const rows = adviceDiffRows(currentValue, value)}
                      <div class="advice-list before" use:tip={'current value'}>
                        {#each rows as row (row.key)}
                          <div class="advice-entry">
                            <span>{row.label}</span>
                            <p>
                              {#each row.before as part}
                                <span class:diff-remove={part.kind === 'removed'}>{part.text}</span>
                              {/each}
                            </p>
                          </div>
                        {:else}
                          <span class="empty-inline">(unset)</span>
                        {/each}
                      </div>
                      <span class="arrow">→</span>
                      <div class="advice-list after">
                        {#each rows as row (row.key)}
                          <div class="advice-entry">
                            <span>{row.label}</span>
                            <p>
                              {#each row.after as part}
                                <span class:diff-add={part.kind === 'added'}>{part.text}</span>
                              {/each}
                            </p>
                          </div>
                        {:else}
                          <span class="empty-inline">{valueLabel(key, value)}</span>
                        {/each}
                      </div>
                    {:else}
                      <span class="before" use:tip={'current value'}>
                        {#each parts.before as part}
                          <span class:diff-remove={part.kind === 'removed'}>{part.text}</span>
                        {/each}
                      </span>
                      <span class="arrow">→</span>
                      <span class="after">
                        {#each parts.after as part}
                          <span class:diff-add={part.kind === 'added'}>{part.text}</span>
                        {/each}
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
              {#if previewOpen[rec.id]}
                {@const nextCard = proposedCard(rec, current)}
                <div class="preview-pair" aria-label="Mechanic card preview">
                  <div class="preview-col">
                    <span class="preview-label">Current card</span>
                    <MechanicCardView card={current} />
                  </div>
                  <div class="preview-col">
                    <span class="preview-label">Proposed card</span>
                    <MechanicCardView card={nextCard} />
                  </div>
                </div>
              {/if}
              {#if rec.note}<p class="note">“{rec.note}”</p>{/if}
              <div class="edit-foot">
                <span class="dim">{short(rec.id)} · {when(rec.createdAt)}{rec.submitterSub ? ` · by ${short(rec.submitterSub)}` : ''}</span>
                {#if rec.status === 'pending'}
                  <div class="actions">
                    <button class="ghost tiny" onclick={() => decide(rec, 'reject')} disabled={acting[rec.id]}>Reject</button>
                    <button class="primary tiny" onclick={() => decide(rec, 'approve')} disabled={acting[rec.id]}>
                      {acting[rec.id] ? '…' : 'Approve'}
                    </button>
                  </div>
                {:else}
                  <div class="actions">
                    <button class="ghost tiny" onclick={() => decide(rec, rec.status === 'approved' ? 'reject' : 'approve')} disabled={acting[rec.id]}>
                      {rec.status === 'approved' ? 'Undo (reject)' : 'Approve instead'}
                    </button>
                  </div>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {:else if !editsBusy}
        <p class="empty">—</p>
      {/if}
    </section>
  {:else if active === 'discoveries'}
    <section class="queue">
      <div class="qbar">
        <span class="muted">Auto-discovered removal interactions. SPELL_DISPEL pairs auto-promote (≥2 runs); forgetting blocklists a bad pair.</span>
        <button class="ghost tiny" onclick={loadDiscoveries} disabled={discBusy}>{discBusy ? 'Loading…' : '↻ Refresh'}</button>
      </div>
      {#if discErr}<p class="err">{discErr}</p>{/if}
      {#if discoveries}
        <p class="muted small">{discoveries.total} pairs · {discoveries.promoted} promoted · {discoveries.pending} pending</p>
        {#if discoveries.records.length === 0}
          <p class="empty">No discoveries recorded.</p>
        {:else}
          <table class="tbl">
            <thead><tr><th>Remover</th><th>Removes</th><th>Runs</th><th>Via</th><th>State</th><th></th></tr></thead>
            <tbody>
              {#each discoveries.records as d (`${d.removerSpellId}:${d.removedSpellId}`)}
                {@const key = `${d.removerSpellId}:${d.removedSpellId}`}
                <tr>
                  <td><WowheadLink id={d.removerSpellId} name={d.removerName} /></td>
                  <td><WowheadLink id={d.removedSpellId} name={d.removedName} /></td>
                  <td class="num">{d.runIds?.length ?? d.occurrences ?? 0}</td>
                  <td>{d.via ?? 'dispel'}</td>
                  <td>{d.promoted ? `promoted${d.promotedAs ? ` (${d.promotedAs})` : ''}` : 'pending'}</td>
                  <td><button class="ghost tiny" onclick={() => forget(key)} disabled={forgetting[key]} use:tip={'Delete + blocklist this pair'}>Forget</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}
    </section>
  {:else if active === 'bugs'}
    <section class="queue">
      <div class="qbar">
        <span class="muted">User bug reports (metadata + attachment list; images aren’t fetched here).</span>
        <button class="ghost tiny" onclick={loadBugs} disabled={bugsBusy}>{bugsBusy ? 'Loading…' : '↻ Refresh'}</button>
      </div>
      {#if bugsErr}<p class="err">{bugsErr}</p>{/if}
      {#if bugs && bugs.records.length === 0}
        <p class="empty">No bug reports.</p>
      {:else if bugs}
        <ul class="cards">
          {#each bugs.records as b (b.id)}
            <li class="card bug">
              <p class="bug-msg">{b.message}</p>
              <div class="dim small">
                {short(b.id)} · {when(b.createdAt)}
                {#if b.attachments?.length}· {b.attachments.length} attachment(s){/if}
                {#if b.context?.appVersion}· v{String(b.context.appVersion)}{/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else if active === 'comments'}
    <section class="queue">
      <div class="qbar">
        <span class="muted">Reported discussion comments. Remove tombstones the comment; block stops a user from commenting.</span>
        <button class="ghost tiny" onclick={loadReports} disabled={repBusy}>{repBusy ? 'Loading…' : '↻ Refresh'}</button>
      </div>
      {#if repErr}<p class="err">{repErr}</p>{/if}
      {#if reports && reports.reports.length === 0}
        <p class="empty">No reported comments.</p>
      {:else if reports}
        <ul class="cards">
          {#each reports.reports as r (`${r.code}:${r.id}`)}
            {@const k = `${r.code}:${r.id}`}
            <li class="card report">
              <p class="cmt-body">{r.comment?.deletedAt ? '(removed)' : r.comment?.body ?? '(comment unavailable)'}</p>
              <div class="dim small">
                by {r.comment?.authorHandle ?? (r.comment?.authorSub ? short(r.comment.authorSub) : 'unknown')} ·
                share {r.code} · reported {r.reporters?.length ?? 0}× {r.reportedAt ? `· ${whenMs(r.reportedAt)}` : ''}
              </div>
              <div class="actions">
                <button class="ghost tiny" onclick={() => doRemove(r)} disabled={repActing[k]}>Remove</button>
                {#if r.comment?.authorSub}
                  <button class="ghost tiny" onclick={() => doBlock(r.comment!.authorSub!, true)} disabled={repActing[`block:${r.comment.authorSub}`]}>Block author</button>
                  <button class="ghost tiny" onclick={() => doBlock(r.comment!.authorSub!, false)} disabled={repActing[`block:${r.comment.authorSub}`]}>Unblock</button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else if admin.isSuperAdmin}
    <section class="queue">
      <div class="qbar">
        <span class="muted">Cognito users and MythicIQ admin roles.</span>
        <button class="ghost tiny" onclick={() => loadUsers()} disabled={usersBusy}>{usersBusy ? 'Loading…' : '↻ Refresh'}</button>
      </div>
      {#if usersErr}<p class="err">{usersErr}</p>{/if}
      {#if users && users.users.length === 0}
        <p class="empty">No Cognito users found.</p>
      {:else if users}
        <table class="tbl users">
          <thead><tr><th>User</th><th>Status</th><th>Admin</th><th>Super</th><th>Groups</th></tr></thead>
          <tbody>
            {#each users.users as u (u.sub)}
              <tr>
                <td>
                  <div class="user-main">{u.email ?? u.username}</div>
                  <div class="dim small">{short(u.sub)}{u.emailVerified === false ? ' · email unverified' : ''}</div>
                </td>
                <td>{u.enabled === false ? 'disabled' : u.status ?? 'active'}</td>
                <td>
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={u.admin}
                      disabled={u.superAdmin || userActing[`${u.sub}:admin`]}
                      onchange={(e) => setRole(u, 'admin', (e.currentTarget as HTMLInputElement).checked)}
                    />
                    <span>Admin</span>
                  </label>
                </td>
                <td>
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={u.superAdmin}
                      disabled={(u.sub === auth.user?.sub && u.superAdmin) || userActing[`${u.sub}:superAdmin`]}
                      onchange={(e) => setRole(u, 'superAdmin', (e.currentTarget as HTMLInputElement).checked)}
                    />
                    <span>Super</span>
                  </label>
                </td>
                <td class="dim small">{u.groups.length ? u.groups.join(', ') : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if users.nextToken}
          <div class="actions">
            <button class="ghost tiny" onclick={() => loadUsers(users?.nextToken)} disabled={usersBusy}>Load more</button>
          </div>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  .admin {
    position: relative;
    height: 100%;
    overflow-y: auto;
    max-width: 1180px;
    margin: 0 auto;
    padding: 24px 28px 70px;
    color: var(--text, #e7e9ee);
    background:
      linear-gradient(145deg, rgba(11, 28, 55, 0.56), rgba(3, 8, 18, 0.18) 42%, rgba(18, 14, 44, 0.36)),
      linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 28%);
  }
  .admin-head {
    display: grid;
    grid-template-columns: minmax(260px, 1fr) minmax(360px, 0.9fr);
    gap: 24px;
    align-items: end;
    margin-bottom: 18px;
  }
  .head-copy { min-width: 0; }
  .eyebrow {
    display: inline-flex;
    margin-bottom: 7px;
    color: #57e2e4;
    font-size: 10px;
    font-weight: 850;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1 {
    font-size: 26px;
    line-height: 1.05;
    margin: 0 0 8px;
    letter-spacing: 0;
  }
  .head-copy p {
    max-width: 620px;
    margin: 0;
    color: var(--muted, #a6b0c2);
    font-size: 13px;
    line-height: 1.55;
  }
  .head-stats {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }
  .stat {
    min-width: 0;
    min-height: 62px;
    padding: 9px 10px;
    cursor: pointer;
    text-align: left;
    border: 1px solid rgba(143, 171, 222, 0.2);
    border-radius: 8px;
    color: var(--text, #e7e9ee);
    background:
      linear-gradient(180deg, rgba(15, 30, 58, 0.74), rgba(5, 12, 26, 0.66)),
      rgba(5, 12, 26, 0.64);
    transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
  }
  .stat:hover,
  .stat.on {
    border-color: rgba(87, 226, 228, 0.46);
    background:
      linear-gradient(180deg, rgba(20, 40, 74, 0.86), rgba(7, 16, 34, 0.76)),
      rgba(39, 136, 255, 0.1);
    transform: translateY(-1px);
  }
  .stat-k,
  .stat-v {
    display: block;
    min-width: 0;
  }
  .stat-k {
    overflow: hidden;
    color: var(--muted, #a6b0c2);
    font-size: 10px;
    font-weight: 750;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stat-v {
    margin-top: 6px;
    color: #f8fbff;
    font-size: 22px;
    font-weight: 850;
    font-variant-numeric: tabular-nums;
  }
  .queue {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .qbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 38px;
  }
  .queue-tools {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 7px;
  }
  .queue-tools .tiny.on {
    border-color: rgba(87, 226, 228, 0.46);
    color: #57e2e4;
    background: rgba(87, 226, 228, 0.1);
  }
  .muted {
    color: var(--muted, #9aa0ab);
    font-size: 13px;
  }
  .small {
    font-size: 12px;
  }
  .err {
    color: #ff8080;
    font-size: 13px;
  }
  .empty {
    color: var(--muted, #9aa0ab);
    padding: 20px 0;
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card {
    padding: 14px 16px;
    border: 1px solid rgba(143, 171, 222, 0.18);
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(16, 31, 58, 0.62), rgba(7, 13, 27, 0.72)),
      var(--surface, #171a21);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }
  .edit.done {
    opacity: 0.66;
  }
  .edit-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .edit-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-weight: 600;
  }
  .edit-state {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: none;
  }
  .dim {
    color: var(--muted, #9aa0ab);
    font-weight: 400;
    font-size: 12px;
  }
  .status {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border, #2a2e37);
    color: var(--muted, #9aa0ab);
  }
  .status.approved {
    color: #63d18b;
    border-color: color-mix(in srgb, #63d18b 40%, transparent);
  }
  .status.rejected {
    color: #ff9b9b;
    border-color: color-mix(in srgb, #ff9b9b 40%, transparent);
  }
  .diff {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 0;
    font-size: 13px;
  }
  .diff-note {
    margin: -4px 0 0;
    color: var(--muted, #a6b0c2);
    font-size: 12px;
    line-height: 1.45;
  }
  .sample {
    color: var(--text, #e7e9ee);
  }
  .sample.added,
  .diff-add {
    text-decoration-line: underline;
    text-decoration-thickness: 1.5px;
    text-decoration-color: rgba(87, 226, 228, 0.5);
    text-underline-offset: 3px;
  }
  .sample.removed,
  .diff-remove {
    text-decoration-line: line-through;
    text-decoration-thickness: 1.5px;
    text-decoration-color: rgba(255, 155, 155, 0.62);
  }
  .drow {
    display: grid;
    grid-template-columns: 118px minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    padding: 8px 0;
    border-top: 1px solid rgba(143, 171, 222, 0.1);
  }
  .drow:first-child {
    border-top: 0;
  }
  .dkey {
    color: var(--accent, #5b8def);
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }
  .before {
    color: var(--muted, #9aa0ab);
    overflow-wrap: anywhere;
  }
  .after {
    color: var(--text, #e7e9ee);
    overflow-wrap: anywhere;
  }
  .arrow {
    color: var(--muted, #9aa0ab);
    padding-top: 1px;
  }
  .advice-list {
    display: grid;
    gap: 7px;
    text-decoration: none;
  }
  .advice-list.before .advice-entry p {
    color: var(--muted, #a6adba);
  }
  .advice-entry {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .advice-entry span {
    color: #57e2e4;
    font-size: 10px;
    font-weight: 850;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .advice-entry p {
    margin: 0;
    color: var(--text, #e7e9ee);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .empty-inline {
    color: var(--muted, #9aa0ab);
  }
  .note {
    margin: 6px 0;
    font-style: italic;
    color: var(--muted, #cfd3db);
    font-size: 13px;
  }
  .edit-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 6px;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .preview-pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 12px 0;
    padding: 12px;
    border: 1px solid rgba(143, 171, 222, 0.16);
    border-radius: 8px;
    background: rgba(3, 8, 18, 0.28);
  }
  .preview-col {
    display: grid;
    gap: 7px;
    min-width: 0;
  }
  .preview-label {
    color: var(--muted, #a6b0c2);
    font-size: 10px;
    font-weight: 850;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .tbl th,
  .tbl td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(143, 171, 222, 0.15);
  }
  .tbl th {
    color: var(--muted, #9aa0ab);
    font-weight: 500;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .user-main {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text, #e7e9ee);
    font-size: 13px;
  }
  .bug-msg,
  .cmt-body {
    margin: 0 0 6px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  @media (max-width: 980px) {
    .admin {
      padding: 20px 18px 58px;
    }
    .admin-head {
      grid-template-columns: 1fr;
      gap: 14px;
    }
    .head-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .drow,
    .preview-pair {
      grid-template-columns: 1fr;
    }
    .dkey {
      font-size: 11px;
    }
    .arrow {
      display: none;
    }
  }
  @media (max-width: 560px) {
    .admin {
      padding: 16px 12px 48px;
    }
    .edit-top,
    .edit-foot,
    .qbar {
      align-items: stretch;
      flex-direction: column;
    }
    .edit-state,
    .actions {
      justify-content: flex-start;
      flex-wrap: wrap;
    }
    .head-stats {
      grid-template-columns: 1fr;
    }
  }
</style>
