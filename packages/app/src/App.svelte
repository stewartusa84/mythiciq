<!-- MVP analyzer shell. A topbar, an ACTIVITY RAIL on the far left — an accordion of sections (Review:
     desktop History + the per-run panels Overview / Pulls / Role Review / Mechanics / Deaths / Insights;
     plus Groups and desktop Capture scaffolding) — a collapsible+resizable SIDEBAR that folds out from
     the rail with the active panel, and the REPLAY as the persistent MAIN STAGE filling the rest — the
     evidence layer is now the centerpiece, not a bottom drawer. The replay is mounted once (outside the
     panel switch) so it survives panel changes; clicking a finding (a death, a pull) in the sidebar
     drives the stage replay's clock + spotlight via a shared ReplayController. Fully client-side — only
     discovered removers leave the browser. -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ParserClient, type FullReport, type RunReport, type DeathRecapResult } from '@wow/engine';
  import { recordDiscoveries, syncToBackend } from './discoveryStore.js';
  import { analytic, runLabel, mmss, runResult, resultLabel } from './mvp/report.js';
  import {
    isDesktop,
    isDebugBuild,
    defaultLogDir,
    startWatching,
    stopWatching,
    takeCarvedRun,
    pickFolder,
    notify as osNotify,
    onRunCarved,
    onBackfillComplete,
    onWindowShown,
    onWindowHidden,
    setLowResourceMode,
    type CarvedRun,
  } from './mvp/desktop.js';
  import { loadBench } from './mvp/loadBench.svelte.js';
  import { watch } from './mvp/watchStore.svelte.js';
  import { raidPulls } from './mvp/raidPulls.svelte.js';
  import RaidPullsPanel from './mvp/RaidPullsPanel.svelte';
  import PositiveMessage from './mvp/PositiveMessage.svelte';
  import { ReplayController, type SeekOptions } from './mvp/replayController.svelte.js';
  import { anon } from './mvp/anon.svelte.js';
  import ReplayViewer from './panels/ReplayViewer.svelte';
  import BugReportModal from './mvp/BugReportModal.svelte';
  import SettingsModal from './mvp/SettingsModal.svelte';
  import NotificationsBell from './mvp/NotificationsBell.svelte';
  import CelebrationOverlay from './mvp/CelebrationOverlay.svelte';
  import Walkthrough, { type TourStep } from './mvp/Walkthrough.svelte';
  import DevPanel from './mvp/DevPanel.svelte';
  import AccountMenu from './mvp/AccountMenu.svelte';
  import GroupsView from './mvp/GroupsView.svelte';
  import MechanicsLibrary from './mvp/MechanicsLibrary.svelte';
  import MechanicDetailOverlay from './mvp/MechanicDetailOverlay.svelte';
  import { mechanicsRuntime } from './mvp/mechanicsRuntime.svelte.js';
  import { FLAGS } from './mvp/flags.js';
  import { auth } from './mvp/auth.svelte.js';
  import AdminView from './mvp/AdminView.svelte';
  import { admin } from './mvp/admin.svelte.js';
  import { blizzardLink } from './mvp/blizzardLink.svelte.js';
  import { lfgLive } from './mvp/lfgLive.svelte.js';
  import { lfgStatus } from './mvp/lfgStatus.svelte.js';
  import { lfgConn } from './mvp/lfgConn.svelte.js';
  import { lfgChat } from './mvp/lfgChat.svelte.js';
  import ChatWidget from './mvp/ChatWidget.svelte';
  import { startLfgSocket, stopLfgSocket, lfgSocketConfigured, type LfgBoardMessage } from './mvp/lfgSocket.js';
  import { runTypeLabel, listLooking, listRunCards, lfgConfigured, extendMyLookingCards, dropMyLookingCards, recordCleanRun, type RunCard } from './mvp/lfg.js';
  import { buildCleanRunSubmission } from './mvp/cleanRun.js';
  import { submitVerifiedRun, verifiedCreditConfigured } from './mvp/verifiedCredit.js';
  import { playSound } from './mvp/sound.js';
  import { osToast, requestToastPermission } from './mvp/osToast.js';
  import { settings } from './mvp/settings.svelte.js';
  import type { NotificationLink } from './mvp/notifications.js';
  import { runHash } from './mvp/runHash.js';
  import { LineIndex } from './lineIndex.js';
  import RunHistory from './mvp/RunHistory.svelte';
  import { extractRunLog, buildHistoryMeta } from './mvp/runExtract.js';
  import {
    listRuns,
    cachedRuns,
    saveRun,
    saveRunReport,
    loadRunBytes,
    loadRunReport,
    deleteRun,
    gzip,
    gunzip,
    MAX_RUNS,
    type HistoryEntry,
  } from './mvp/history.js';
  import { buildRunStatsPayload, submitRunStats, runStatsEnabled, type RunComparison } from './mvp/runStats.js';
  import { APP_VERSION, BUILD_DATE } from './version.js';
  import Overview from './mvp/tabs/Overview.svelte';
  import Pulls from './mvp/tabs/Pulls.svelte';
  import RoleReview from './mvp/tabs/RoleReview.svelte';
  import Mechanics from './mvp/tabs/Mechanics.svelte';
  import Enemies from './mvp/tabs/Enemies.svelte';
  import Insights from './mvp/tabs/Insights.svelte';
  import Deaths from './mvp/Deaths.svelte';
  import imgMainBg from '../../assets/img/dungeon.png';
  import logoNew from '../../website/src/assets/img/logo-new.png';
  import siteRuins from '../../website/src/assets/img/ancient-ruins.png';
  // Stage backdrop art — one of these is chosen at random per loaded run (see `stageArt`) so the replay
  // stays visually fresh. Only the selected one is fetched by the browser (the rest are emitted assets).
  import artArmory from '../../assets/img/armory.png';
  import artDungeonParty from '../../assets/img/dungeon-party.png';
  import artRoles from '../../assets/img/roles.png';
  import artMechanics from '../../assets/img/mechanics.png';
  import artSkull from '../../assets/img/skull-dungeon.png';
  import artInsights from '../../assets/img/insights.png';
  import artReplay from '../../assets/img/replay.png';
  // Learn section uses the custom "m-book" mark (tinted via CSS mask, see `.sec-ico-img`).
  import mBookIcon from '../../assets/img/m-book.svg';
  const STAGE_ART = [siteRuins, artArmory, artDungeonParty, imgMainBg, artRoles, artMechanics, artSkull, artInsights, artReplay];
  const desktop = isDesktop();
  const historyEnabled = desktop && !FLAGS.demo;
  const captureEnabled = desktop && !FLAGS.demo;

  let client = $state.raw<ParserClient | null>(null);
  // ParserClient has one active handler set and resolves `parse()` at summary time, before the full
  // report arrives. Keep visible/replay parses serialized until their report lands, and let newer loads
  // supersede older callbacks so a late report can't repaint the app with the wrong run.
  let uiParseChain: Promise<void> = Promise.resolve();
  let visibleLoadSeq = 0;
  // The currently-displayed log file, retained so the tray-unload feature can terminate the worker
  // (the only way to release its WASM memory — WebAssembly.Memory can't shrink) and re-parse on restore.
  let loadedFile = $state.raw<File | null>(null);

  // Human-readable "last updated" date for the landing page (from the build-time BUILD_DATE).
  const lastUpdated = (() => {
    const d = new Date(BUILD_DATE);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  })();

  let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  // Show the DEV reset panel on the Vite dev server OR a standalone desktop DEBUG build (resolved async
  // below). Release desktop / prod web builds never set this, so the panel stays out of users' hands.
  let showDevPanel = $state(import.meta.env.DEV);
  let statusText = $state('');
  let error = $state<string | null>(null);
  let report = $state<FullReport | null>(null);
  let dragging = $state(false);
  // True while a history run's LOG is re-parsing in the background to power the replay — its side panes
  // are already showing (from cached data), so the stage shows a "building replay…" state, not a loader.
  let replayPending = $state(false);
  // Desktop: a minute after the window is hidden to the tray we TERMINATE the parse worker — the only
  // way to actually return its memory (the WASM linear memory holding the resident columnar store + the
  // per-run replay cache; WebAssembly.Memory can grow but never shrink, so nulling it isn't enough).
  // This is always-on (measured ~600MB→140MB webview2 + ~68MB→2MB host on hide). The lightweight
  // analysis `report` stays on the main thread so the tabs remain visible. On restore we re-parse the
  // retained file (~1-2s for one run), which rebuilds the worker + replay. The delay tolerates a quick
  // hide/peek-back without a reload.
  let replayUnloaded = $state(false);
  let trayUnloadTimer: ReturnType<typeof setTimeout> | undefined;
  // Low-resource mode's tray grace period — must match src-tauri/src/lowres.rs `UNLOAD_DELAY` (5s) so the
  // replay/worker unload and the native webview teardown happen together at the deadline.
  const LOW_RESOURCE_UNLOAD_DELAY_MS = 5_000;

  function unloadForTray() {
    if (replayUnloaded || !client || !loadedFile) {
      loadBench.trayEvent(`unload skipped (client=${!!client} file=${!!loadedFile})`);
      return; // nothing loaded → nothing to free
    }
    replayUnloaded = true;     // ReplayViewer drops its client-side view (enabled → false)
    client.terminate();        // kill the worker → release its WASM memory + replay cache
    client = null;             // a fresh worker is created by the restore re-parse
    loadBench.trayEvent('worker terminated (memory freed)');
  }
  function restoreFromTray() {
    if (!replayUnloaded) return;
    replayUnloaded = false;
    loadBench.trayEvent('restoring (re-parse)');
    // Re-parse the displayed file in the background: keeps the current tab/report up while the worker
    // + replay rebuild (onFile recreates the client). Skip history (it's already saved).
    if (loadedFile) {
      void onFile(loadedFile, {
        skipHistory: true,
        background: true,
        ...(currentRun ? { preferredHash: runHash(currentRun) } : {}),
      });
    }
  }

  function onTrayHidden() {
    loadBench.markHidden();
    clearTimeout(trayUnloadTimer);
    // Low-resource mode unloads the replay on the same short grace period the native side uses to tear
    // down the webview (LOW_RESOURCE_UNLOAD_DELAY_MS, = src-tauri lowres.rs UNLOAD_DELAY): within the
    // grace window a pop-back keeps everything intact (instant restore, no re-parse); at the deadline the
    // replay/worker is freed and the webview is destroyed together. Otherwise the always-on saver uses
    // the longer (DEV-tunable) delay.
    const delay = settings.lowResourceMode ? LOW_RESOURCE_UNLOAD_DELAY_MS : loadBench.trayUnloadDelayMs;
    loadBench.trayEvent(`hidden (unload in ${Math.round(delay / 1000)}s)`);
    trayUnloadTimer = setTimeout(unloadForTray, delay);
  }
  function onTrayShown() {
    loadBench.markShown();
    loadBench.trayEvent('shown');
    clearTimeout(trayUnloadTimer);
    trayUnloadTimer = undefined;
    restoreFromTray();
  }

  // Per-phase parse progress for the loader screen — one labeled bar each, so a fresh parse reads as a
  // pipeline making progress rather than one spinner+% rewriting itself. Keys match engine ParsePhase.
  const PARSE_PHASES = [
    { key: 'read', label: 'Reading log file' },
    { key: 'parse', label: 'Parsing events' },
    { key: 'segment', label: 'Detecting pulls & runs' },
    { key: 'summary', label: 'Running analytics' },
  ] as const;
  let phaseRatio = $state<Record<string, number>>({});
  const resetPhases = () => (phaseRatio = {});
  function setPhase(phase: string, ratio: number) {
    const i = PARSE_PHASES.findIndex((p) => p.key === phase);
    const next = { ...phaseRatio };
    PARSE_PHASES.forEach((p, j) => { if (i >= 0 && j < i) next[p.key] = 1; }); // earlier phases are done
    next[phase] = Math.max(next[phase] ?? 0, ratio);
    phaseRatio = next;
  }

  let selectedRun = $state(0);
  let currentRun = $derived<RunReport | null>(report ? (report.runs[selectedRun] ?? null) : null);
  let currentRunHash = $derived(currentRun ? runHash(currentRun) : null);
  type CelebrationRequest = { kind: 'timed' | 'pb' | 'kill'; stars: number; label: string; seq: number };
  let celebration = $state<CelebrationRequest | null>(null);
  let celebrationSeq = 0;
  let celebrationTimer: ReturnType<typeof setTimeout> | undefined;
  function showCelebration(c: Omit<CelebrationRequest, 'seq'>): void {
    clearTimeout(celebrationTimer);
    celebration = { ...c, seq: ++celebrationSeq };
    celebrationTimer = setTimeout(() => {
      celebration = null;
      celebrationTimer = undefined;
    }, c.kind === 'pb' ? 3400 : 1700);
  }
  onDestroy(() => clearTimeout(celebrationTimer));

  // Stage backdrop: a slow, ambient CROSSFADE between artworks on a timer — DECOUPLED from run loading
  // (re-rolling per run flashed twice during a single load). Two layers (artA/artB); we set the hidden
  // one to the next image then flip `showA` so CSS opacity crossfades. Starts on a random image.
  const ART_ROTATE_MS = 5 * 60 * 1000; // swap every 5 minutes
  let artIdx = 0;
  let artA = $state<string>(STAGE_ART[artIdx]!);
  let artB = $state<string>('');
  let showA = $state(true);
  function advanceArt() {
    if (STAGE_ART.length < 2) return;
    artIdx = (artIdx + 1) % STAGE_ART.length;
    const next = STAGE_ART[artIdx]!;
    if (showA) artB = next;
    else artA = next;
    showA = !showA;
  }
  // Self-rescheduling timeout (NOT setInterval): a hidden tab throttles timers, and setInterval then
  // delivers the missed ticks in a BURST on refocus (the "cycles through several images quickly" bug).
  // A setTimeout only ever has one callback pending, so it can't burst; the visibilitychange handler
  // then advances at most once when we return, by the wall-clock time elapsed since the last swap.
  let artTimer: ReturnType<typeof setTimeout> | undefined;
  let lastArtMs = Date.now();
  function scheduleArt(delay = ART_ROTATE_MS) {
    clearTimeout(artTimer);
    artTimer = setTimeout(() => {
      advanceArt();
      lastArtMs = Date.now();
      scheduleArt();
    }, delay);
  }
  function onArtVisibility() {
    if (document.hidden) return; // pause is implicit (throttled timer can't burst); resume on return
    const due = ART_ROTATE_MS - (Date.now() - lastArtMs);
    scheduleArt(Math.max(0, due)); // overdue ⇒ one prompt swap, else finish the remaining time
  }
  $effect(() => {
    scheduleArt();
    document.addEventListener('visibilitychange', onArtVisibility);
    return () => {
      clearTimeout(artTimer);
      document.removeEventListener('visibilitychange', onArtVisibility);
    };
  });

  // "Load Another Log" → back to the landing dropzone (history stays reachable in the rail).
  let recap = $derived<DeathRecapResult | null>(currentRun ? analytic<DeathRecapResult>(currentRun, 'deaths.recap') : null);

  // Custom-metric windows (from Insights) → drawn as bands on the replay; held here so they persist
  // across tab switches and feed the always-mounted drawer.
  type WindowLite = { label: string; startMs: number; endMs: number; unitName?: string; detail?: string; color?: string; spellId?: number; id?: string };
  let metricWindows = $state<WindowLite[]>([]);

  // Metric windows are per-run, so they're invalid the moment the run (or report) changes — clear them
  // immediately. Insights is keyed on selectedRun: if its tab is open it remounts and re-evaluates for
  // the new run (refilling these); if it's on another tab, the stale bands/designators just disappear
  // instead of lingering with empty data (the misleading state). `currentRun` covers run-switch + reload.
  $effect(() => {
    currentRun; // track
    metricWindows = [];
  });

  // The shared replay state. One instance for App's lifetime → the drawer's loaded model + clock
  // survive tab switches (only a run change resets the replay, inside ReplayViewer).
  const replay = new ReplayController();
  const seek = (ms: number, opts?: SeekOptions) => replay.seekTo(ms, opts);

  type TabId = 'overview' | 'pulls' | 'role' | 'mechanics' | 'enemies' | 'deaths' | 'insights';
  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'pulls', label: 'Pulls' },
    { id: 'role', label: 'Role Review' },
    { id: 'mechanics', label: 'Mechanics' },
    { id: 'enemies', label: 'Enemies' },
    { id: 'deaths', label: 'Deaths' },
    { id: 'insights', label: 'Insights' },
  ];
  // Inline line-icons per panel (Lucide, ISC-licensed) — rendered in an SVG that inherits currentColor
  // and the stroke attrs from the wrapper, so no icon dependency is added.
  const ICONS: Record<TabId, string> = {
    overview: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    pulls:
      '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
    role:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    mechanics:
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    enemies:
      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    deaths:
      '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="m12.5 17-.5-1-.5 1h1z"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/>',
    insights:
      '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  };
  // The rail also has a non-run-scoped "history" entry, grouped under the "Review" section below, plus
  // the run-independent Learn section scopes.
  type RailId = TabId | 'history' | 'pilot' | 'learn-dungeon' | 'learn-raid' | 'admin';
  // Run-history icon (Lucide "history").
  const HISTORY_ICON =
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>';
  // Combat-log icon for the companion-status section (Lucide "scroll-text").
  const LOG_ICON =
    '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>';
  const BUG_ICON =
    '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3 3 0 0 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Z"/><path d="M4 13H2"/><path d="M22 13h-2"/><path d="M5 19l2-2"/><path d="m17 17 2 2"/><path d="M12 20v-9"/><path d="M8 11h8"/>';

  // ---- Left navigation: accordion sections that OWN their sub-items -----------------------------
  // The rail groups panels under collapsible sections, each visually owning its items (an indented guide
  // line). "Review" holds today's analysis panels (desktop History + the per-run tabs); "Groups" is
  // available in app/web builds; "Capture" stays desktop-only scaffolding.
  type RailEntry = { id: RailId; label: string; icon: string };
  type SectionId = 'review' | 'learn' | 'groups' | 'capture' | 'admin';
  const REVIEW_ITEMS: RailEntry[] = [
    ...(historyEnabled ? [{ id: 'history' as const, label: 'History', icon: HISTORY_ICON }] : []),
    ...TABS.map((t) => ({ id: t.id, label: t.label, icon: ICONS[t.id] })),
  ];
  const GROUP_ITEMS: RailEntry[] = [];
  // Learn sub-items: the run-independent mechanics library, scoped to dungeon vs raid content.
  // Icons (Lucide: swords / skull).
  const SWORDS_ICON =
    '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>';
  const SKULL_ICON =
    '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="m12.5 17-.5-1-.5 1h1z"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/>';
  const LEARN_ITEMS: RailEntry[] = [
    { id: 'learn-dungeon', label: 'Dungeon', icon: SWORDS_ICON },
    { id: 'learn-raid', label: 'Raid', icon: SKULL_ICON },
  ];
  // Admin section: AdminView owns its internal queues, so the rail does not need a duplicate sub-item.
  const SHIELD_CHECK_ICON =
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>';
  const ADMIN_ITEMS: RailEntry[] = [];
  // Section-header icons (Lucide: clipboard-check / graduation-cap / users-round / radio).
  const SECTION_ICONS: Record<SectionId, string> = {
    review:
      '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    learn:
      '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    groups:
      '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>',
    capture:
      '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    admin: SHIELD_CHECK_ICON,
  };
  const ALL_SECTIONS: { id: SectionId; label: string; items: RailEntry[] }[] = [
    { id: 'admin', label: 'Admin', items: ADMIN_ITEMS },
    { id: 'review', label: 'Review', items: REVIEW_ITEMS },
    { id: 'learn', label: 'Learn', items: LEARN_ITEMS },
    { id: 'groups', label: 'Groups', items: GROUP_ITEMS },
    { id: 'capture', label: 'Capture', items: [] },
  ];
  let visibleSections = $derived(
    FLAGS.demo
      ? ALL_SECTIONS.filter((s) => s.id === 'review' || s.id === 'learn')
      : ALL_SECTIONS.filter((s) => {
          if (s.id === 'groups') return FLAGS.groups;
          if (s.id === 'capture') return captureEnabled;
          if (s.id === 'admin') return admin.isAdmin;
          return true;
        }),
  );
  // Section expansion is now DERIVED, not toggled: a section is open iff it's the ACTIVE one (the one
  // whose main window is showing — it stays open so you can see where you are) OR it's being HOVERED
  // (point at a section and it expands; the others fall closed). `hoveredSection` is set on each
  // section's mouseenter and cleared when the pointer leaves the rail.
  let hoveredSection = $state<SectionId | null>(null);
  function isExpanded(id: SectionId): boolean {
    return activeSection === id || hoveredSection === id;
  }
  function sectionStep(id: SectionId, visibleIndex: number): string {
    if (id === 'admin') return '00';
    const priorNonAdmin = visibleSections.slice(0, visibleIndex).filter((s) => s.id !== 'admin').length;
    return String(priorNonAdmin + 1).padStart(2, '0');
  }
  // The section whose MAIN WINDOW is showing. Each accordion section drives a different main area:
  // Review = the analysis workspace (panel sidebar + replay stage); Groups = the group-coordination
  // workspace; Capture = placeholder for later. Clicking a section header (or one of its sub-items)
  // switches the main window to that section.
  let activeSection = $state<SectionId>('review');
  // Which sub-item is the current navigation point inside the Groups section (only "pilot" today).
  let groupTab = $state<RailId>('pilot');
  // Learn section scope: which slice of the mechanics library is showing (dungeon vs raid content).
  let learnScope = $state<'all' | 'dungeon' | 'raid'>('dungeon');
  function selectSection(id: SectionId): void {
    activeSection = id;
  }
  // Click a sub-item: route to the right per-section handler so the highlight tracks the real nav point.
  function selectItem(secId: SectionId, itemId: RailId): void {
    if (secId === 'review') {
      selectTab(itemId);
      return;
    }
    if (secId === 'learn') {
      activeSection = 'learn';
      learnScope = itemId === 'learn-raid' ? 'raid' : 'dungeon';
      return;
    }
    if (secId === 'groups') {
      if (!FLAGS.groups) return;
      activeSection = 'groups';
      groupTab = itemId;
      return;
    }
    activeSection = secId;
  }
  // A sub-item is highlighted ONLY when it's the current nav point of the ACTIVE section — so switching
  // sections (or collapsing the Review sidebar) moves the highlight off a now-stale button.
  function isItemActive(secId: SectionId, itemId: RailId): boolean {
    if (activeSection !== secId) return false;
    if (secId === 'review') return sidebarOpen && activeTab === itemId;
    if (secId === 'learn') return learnScope === (itemId === 'learn-raid' ? 'raid' : 'dungeon');
    if (secId === 'groups') return groupTab === itemId;
    if (secId === 'admin') return true; // single item; active whenever the Admin section is showing
    return false;
  }
  // Desktop landing defaults to History; the web app lands on Overview beside the dropzone and keeps no
  // browser history surface. A fresh load flips to Overview (see onReport).
  let activeTab = $state<RailId>(historyEnabled ? 'history' : 'overview');
  let activeLabel = $derived(activeTab === 'history' ? 'Run History' : TABS.find((t) => t.id === activeTab)?.label ?? 'Overview');
  // Group Finder topbar status dot. "Looking" = ≥1 active Looking Card OR owning an open Run Card
  // (lfgStatus.looking) — the SAME predicate that holds the push socket open, so the dot matches the
  // GroupsView "Live" flag (lfgConn.connected). Detail names the reason(s) you're active.
  let lfgLooking = $derived(lfgStatus.looking);
  let lfgStatusDetail = $derived(
    [
      lfgStatus.activeCards > 0 ? `${lfgStatus.activeCards} card${lfgStatus.activeCards === 1 ? '' : 's'}` : '',
      lfgStatus.ownsOpenRun ? 'hosting a run' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  // Whether the LFG push socket SHOULD be open. This is a coarse, slow-changing BOOLEAN on purpose: the
  // socket lifecycle must NOT be driven by the volatile presence counts (activeCards/inGroups ticking
  // 1→2, a run flipping open→locked, etc.). Because this is a `$derived`, Svelte only re-runs the socket
  // effect when the boolean VALUE flips — not on every count change that leaves it `true`. So the socket
  // opens once when you join the pool and stays open through every in-pool action, and only tears down
  // when you leave the pool entirely (active → false). "Leaving" includes the inactivity timeout: when the
  // "still looking?" prompt goes unanswered, the user's Looking Cards hit their 30-min TTL, activeCards
  // drops to 0, and this flips false — closing the socket through the same path (no separate lever).
  let lfgShouldConnect = $derived(
    FLAGS.groups && auth.status === 'signed-in' && lfgSocketConfigured() && lfgStatus.active,
  );
  // The sidebar's scroll container — reset to the top whenever the panel changes so a switched-to tab
  // (e.g. the Overview → Mechanics link) starts at its top, not wherever the previous panel was scrolled.
  let sideBodyEl = $state<HTMLElement | null>(null);
  $effect(() => {
    activeTab; // track
    sideBodyEl?.scrollTo({ top: 0 });
  });

  // The left sidebar holds the active panel and folds out from the activity rail. Default OPEN to
  // Overview on load (so a fresh report shows context), collapsible to give the replay the full stage.
  let sidebarOpen = $state(true);
  // Initialized from the persisted client preference; updated live while dragging, saved on release.
  let sidebarWidth = $state(settings.panelWidth);
  // Clicking a Review sub-item: ensure the Review main window is showing, then open that panel; clicking
  // the ALREADY-open panel (while already in Review) collapses the sidebar (toggle).
  function selectTab(id: RailId) {
    if (id === 'history' && !historyEnabled) id = 'overview';
    if (activeSection !== 'review') {
      activeSection = 'review';
      activeTab = id;
      sidebarOpen = true;
      return;
    }
    if (sidebarOpen && activeTab === id) sidebarOpen = false;
    else {
      activeTab = id;
      sidebarOpen = true;
    }
  }

  // Sidebar resize (drag the right edge). Bounds keep it usable while leaving the replay room.
  let rzActive = $state(false);
  let rzStartX = 0;
  let rzStartW = 0;
  function sidebarMax(): number {
    return typeof window !== 'undefined' ? Math.min(760, window.innerWidth * 0.62) : 760;
  }
  function rzDown(e: PointerEvent) {
    rzActive = true;
    rzStartX = e.clientX;
    rzStartW = sidebarWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function rzMove(e: PointerEvent) {
    if (!rzActive) return;
    sidebarWidth = Math.max(320, Math.min(rzStartW + (e.clientX - rzStartX), sidebarMax()));
  }
  function rzUp(e: PointerEvent) {
    if (!rzActive) return;
    rzActive = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    settings.setPanelWidth(sidebarWidth); // persist the new width (once, on release)
  }

  // Bug report modal. Context (current run + url + viewport) is attached so reports are triageable.
  let bugOpen = $state(false);
  let settingsOpen = $state(false);
  // Desktop "Live" pill → options modal (stop / change folder / current folder). Desktop-only.
  let liveOpen = $state(false);

  // A notification card was clicked → jump to where it points: open Settings, or switch to a tab (which
  // needs the sidebar open; a tab link only reaches here when a run is loaded — see NotificationsBell).
  function navigateNotification(link: NotificationLink) {
    if (link.kind === 'settings') {
      settingsOpen = true;
    } else {
      activeSection = 'review';
      activeTab = link.tab;
      sidebarOpen = true;
    }
  }

  // First-run guided walkthrough — auto-runs once when the first log finishes loading (a real log or the
  // sample), then never again unless replayed from Settings. Targets are `[data-tour]` anchors below.
  let tourActive = $state(false);
  const TOUR_STEPS: TourStep[] = [
    {
      target: '[data-tour="stage"]',
      title: 'Replay the run, moment by moment',
      body: 'Scrub through the timeline to see exactly what happened — health, damage, healing, casts, cooldowns, and key events all lined up in one place.',
      placement: 'left',
    },
    {
      target: '[data-tour="deaths"]',
      title: 'Understand each death',
      body: 'Deaths are broken down with context: the killing blow, recent damage, available defensives, missed interrupts, and whether the danger was avoidable or preventable.',
      placement: 'right',
    },
    {
      target: '[data-tour="mechanics"]',
      title: 'Review mechanics and clean plays',
      body: 'See avoidable damage, dispels, interrupts, and mechanic handling across the group — including moments where players handled danger well.',
      placement: 'right',
    },
    ...(historyEnabled
      ? [
          {
            target: '[data-tour="history"]',
            title: 'Reopen runs from history',
            body: 'History is where you return to previous runs. MythicIQ keeps your latest imported log, or at least your 3 most recent runs, available locally — no need to re-import the original log.',
            placement: 'right' as const,
          },
        ]
      : []),
    ...(FLAGS.demo
      ? []
      : [
          {
            target: '[data-tour="settings"]',
            title: 'Compare against similar runs',
            body: 'Opt in to anonymous aggregate stats to see how your run compares with the community — things like damage patterns, recovery windows, mechanics, and cooldown usage.',
            placement: 'bottom' as const,
          },
        ]),
  ];
  function endTour() {
    tourActive = false;
    settings.markTourSeen();
  }
  // Auto-start the tour shortly after a foreground report renders (so the chrome has laid out), driven
  // purely by `tourSeen`: it runs once for a new user, and Settings' "Replay walkthrough" (resetTour)
  // re-arms it. `!tourActive` prevents a re-render from restarting an in-progress tour.
  $effect(() => {
    if (status === 'ready' && report && !settings.tourSeen && !tourActive) {
      const id = setTimeout(() => (tourActive = true), 700);
      return () => clearTimeout(id);
    }
  });

  // Shared run-stats comparison feedback, keyed by run hash (only when the user opted in). Submitted
  // once per run per session; the backend dedupes by hash anyway.
  let comparisons = $state(new Map<string, RunComparison>());
  const submitted = new Set<string>();
  let currentComparison = $derived(currentRun ? comparisons.get(runHash(currentRun)) : undefined);

  // Submit the selected run's name-free stats when sharing is enabled, then keep the comparison.
  $effect(() => {
    if (FLAGS.demo || !settings.shareStats || !runStatsEnabled() || !report || !currentRun) return;
    const hash = runHash(currentRun);
    if (submitted.has(hash)) return;
    const payload = buildRunStatsPayload(currentRun, report, settings.anonymizeShared);
    if (!payload) return; // not a finished key
    submitted.add(hash);
    void submitRunStats(payload).then((r) => {
      if (r.ok && r.comparison) comparisons = new Map(comparisons).set(hash, r.comparison);
    });
  });

  // Record clean runs for the signed-in user (the LFG eligibility metric — a timed run with ≤1 owner
  // mechanic failure). Tied to the account, NOT shared publicly, so it doesn't depend on the share-stats
  // opt-in — only on being signed in with Groups + a backend configured. Submitted once per run/session
  // (the backend dedupes by runHash anyway); non-clean runs are a harmless no-op server-side.
  const submittedCleanRuns = new Set<string>();
  // Runs whose compressed sub-log we've already uploaded for verified credit this session (fire-once).
  const verifiedSubmitted = new Set<string>();
  $effect(() => {
    if (!FLAGS.groups || auth.status !== 'signed-in' || !lfgConfigured() || !report) return;
    for (const run of report.runs) {
      const sub = buildCleanRunSubmission(run, report);
      if (!sub || submittedCleanRuns.has(sub.runHash)) continue;
      submittedCleanRuns.add(sub.runHash);
      void recordCleanRun(sub);
    }
  });
  let bugContext = $derived({
    appUrl: typeof location !== 'undefined' ? location.href : undefined,
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : undefined,
    run: report && currentRun ? runLabel(currentRun, selectedRun) : undefined,
    tab: activeTab,
    appVersion: APP_VERSION,
  });

  // Feed the anonymizer the player roster so name→alias is ready as soon as the report arrives.
  $effect(() => {
    if (report) anon.setRoster(report.roster);
  });

  // ---- Local run history (last 3 M+ runs, compressed in IndexedDB; see historyStore.ts) ----------
  // Seed from the localStorage snapshot synchronously so a low-resource-mode webview rebuild shows the
  // History list instantly (no waiting on the folder/IndexedDB re-index); refreshHistory() reconciles.
  let historyList = $state<HistoryEntry[]>(historyEnabled ? cachedRuns() : []);
  let historyBusy = $state<string | null>(null); // hash of a run currently being opened
  async function refreshHistory() {
    if (!historyEnabled) {
      historyList = [];
      return;
    }
    historyList = await listRuns();
  }
  // Load the saved-run list once on mount (so the landing page can show it before any log is loaded).
  $effect(() => {
    if (historyEnabled) void refreshHistory();
  });
  // Complete any Cognito Hosted-UI redirect / restore a stored session (no-op when auth isn't configured).
  $effect(() => {
    void auth.init();
  });
  // Resolve backend admin status when signed in (drives the admin-only rail section). Cached per sub.
  $effect(() => {
    if (auth.status === 'signed-in') void admin.refresh();
    else admin.reset();
  });
  // Load the live mechanics bundle once per app session when a backend is configured. The runtime keeps
  // the build-time bundle as the offline baseline and falls back to it on any fetch/cache failure.
  $effect(() => {
    void mechanicsRuntime.init();
  });
  // Returning from a Battle.net account-link redirect (?bnet=linked|error)? Hand off to the link state
  // machine (GroupsView resumes the roster import once mounted), switch to Groups, and strip the param so
  // a refresh doesn't re-trigger. Mirrors auth.svelte.ts's ?code cleanup.
  $effect(() => {
    const params = new URLSearchParams(window.location.search);
    const bnet = params.get('bnet');
    if (bnet !== 'linked' && bnet !== 'error') return;
    if (FLAGS.groups) {
      blizzardLink.markReturn(bnet);
      activeSection = 'groups';
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('bnet');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  });

  // ---- Desktop live watch (Tauri only; see mvp/desktop.ts + watchStore.svelte.ts) ------------------
  // The native side tails the WoW logs folder, carves each completed run into a standalone sub-log, and
  // emits `run-carved`. We feed those bytes through the SAME `onFile` parse path as a drag-drop / history
  // open. A serial queue keeps parses from overlapping (one resident store in the worker).
  //  - We NEVER auto-open a carved run into the viewer (logs are loaded manually). A completed run is
  //    always surfaced as a click-to-open TOAST (top-middle), and — only when the app isn't in the
  //    foreground — a Windows corner notification ("hey, new run") so a tray-minimized / behind-the-game
  //    session still gets the nudge. Foreground is the webview's own visibility/focus (no Tauri perms).
  //  - BACKFILL (startup scan of the active log): the older runs are imported to history SILENTLY (no
  //    visible parse) so they're in the History panel immediately; the NEWEST is offered as the pending
  //    toast. Deferred until `backfill-complete` so we know which carved run is the newest (file order =
  //    oldest→newest).
  let carveQueue: CarvedRun[] = [];
  let backfillBuffer: CarvedRun[] = [];
  let carveBusy = false;

  function isAppForeground(): boolean {
    if (!isDesktop() || typeof document === 'undefined') return true;
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  // Surface a saved carved run as a bell card (+ a Windows corner notification only when the app isn't in
  // front, so a tray-minimized / behind-the-game session still gets the nudge). The result label is read
  // from the PARSED report via `runResult` — NOT the native quick-parse `success` flag, which conflates
  // "timed" (within the dungeon timer) with merely "completed" (so a timed run was mislabeled "Depleted").
  function surfaceCarvedRun(hash: string, run: RunReport) {
    const { result, stars } = runResult(run.run);
    const dungeon = run.run.dungeonName ?? null;
    const level = run.run.keystoneLevel ?? null;
    const durationMs = run.run.completionTimeMs ?? run.run.durationMs ?? null;
    watch.addRun({ hash, dungeon, level, result, stars, durationMs });
    if (!isAppForeground()) {
      const name = `${dungeon ?? 'Run'}${level ? ` +${level}` : ''}`;
      void osNotify('MythicIQ — new run', `${name} — ${resultLabel(result, stars)}${durationMs ? ` ${mmss(durationMs)}` : ''}`);
    }
  }

  // Surface a completed RAID PULL on the boss-grouped sidebar switcher (desktop raid review). The pull's
  // details come from the PARSED report's boss bucket (a single-encounter carve → one boss / one
  // attempt); the native `bossName`/`success` are a cosmetic fallback if bucketing came up empty.
  //  - `silent` (backfill): populate the feed only, no toast.
  //  - Otherwise: OS toast when backgrounded. Returns whether the caller should AUTO-OPEN this pull
  //    into the replay (a WIPE, when the user opted in) — the open itself is done by the caller, AWAITED
  //    inside the serial carve queue so its parse doesn't race the next carve's parse on the one worker.
  function surfaceRaidPull(hash: string, run: RunReport, r: CarvedRun, opts: { seen?: boolean; silent?: boolean } = {}): boolean {
    const bucket = run.bosses?.[0];
    const attempt = bucket?.attempts[0];
    const bossName = bucket?.name ?? r.bossName ?? run.run.instanceName ?? 'Boss';
    const encounterId = bucket?.encounterId ?? 0;
    const success = attempt?.success ?? r.success ?? false;
    const durationMs = attempt?.durationMs ?? run.run.durationMs ?? null;
    const difficultyName = run.run.difficultyName ?? null;
    raidPulls.addPull({ hash, encounterId, bossName, difficultyName, success, durationMs }, { seen: opts.seen });
    if (opts.silent) return false;
    if (!isAppForeground()) {
      void osNotify('MythicIQ — pull complete', `${bossName} — ${success ? 'Kill' : 'Wipe'}${durationMs ? ` ${mmss(durationMs)}` : ''}`);
    }
    return settings.autoOpenWipe && !success;
  }

  // Carve → local history. Takes the one-shot carved bytes and SILENTLY parses + saves the compressed
  // sub-log to history (gz log + cached side-pane report + meta), never showing it. Returns the saved
  // run's history hash + its parsed RunReport (so the caller can surface a correct bell card), or null if
  // it couldn't be parsed. We persist explicitly (awaited) rather than via onFile's fire-and-forget, so
  // the run is in history BEFORE we surface it — `take_carved_run` is one-shot, so history is the only copy.
  async function carveToHistory(r: CarvedRun): Promise<{ hash: string; run: RunReport } | null> {
    try {
      const bytes = await takeCarvedRun(r.id);
      const file = new File([bytes as BlobPart], r.fileName, { type: 'text/plain' });
      let captured: FullReport | null = null;
      await onFile(file, { silent: true, skipHistory: true, onParsed: (rep) => { captured = rep; } });
      if (!captured) return null;
      const rep: FullReport = captured;
      await persistRuns(file, rep); // awaited compress + save (no double-save: onFile skipped history)
      const real = rep.runs.find((x) => !x.run.synthetic);
      return real ? { hash: runHash(real), run: real } : null;
    } catch {
      return null; // one bad carve shouldn't stall the rest of the queue
    }
  }

  async function drainCarve() {
    if (carveBusy) return;
    carveBusy = true;
    try {
      while (carveQueue.length) {
        const r = carveQueue.shift()!;
        // Save the carved sub-log to history first, then surface it: an M+ run → a click-to-open bell
        // card; a raid pull → the boss-grouped sidebar switcher (which may auto-open a wipe if opted in).
        const saved = await carveToHistory(r);
        if (!saved) continue; // couldn't parse → nothing in history to surface
        if (r.kind === 'raid-encounter') {
          // Auto-open (a wipe, opted in) is AWAITED here so its parse runs after this carve and before
          // the next one — keeping the single resident-store worker serialized.
          if (surfaceRaidPull(saved.hash, saved.run, r)) await openFromHistory(saved.hash);
        } else surfaceCarvedRun(saved.hash, saved.run);
      }
    } finally {
      carveBusy = false;
    }
  }

  // Startup backfill: import EVERY prior run to history silently (compressed sub-log, no flashing on
  // screen), then surface the newest as a bell card — never auto-opening it. File order is oldest→newest,
  // so the last successfully imported run is the most recent. Runs once per `backfill-complete`, by which
  // point every backfill `run-carved` has been buffered.
  async function processBackfill() {
    const runs = backfillBuffer;
    backfillBuffer = [];
    if (runs.length === 0) return;
    let newest: { hash: string; run: RunReport } | null = null;
    for (const r of runs) {
      const saved = await carveToHistory(r);
      if (!saved) continue;
      // Raid pulls populate the sidebar switcher (marked SEEN, no toast / no auto-open) so a leader opening
      // the app mid-night sees the whole pull list; the newest M+ run surfaces as a bell card.
      if (r.kind === 'raid-encounter') surfaceRaidPull(saved.hash, saved.run, r, { seen: true, silent: true });
      else newest = saved;
    }
    // The runs are now in History (the landing tab); surface the newest M+ run as a bell card too.
    if (newest) surfaceCarvedRun(newest.hash, newest.run);
  }

  // A run notification card was clicked → open it from history and clear the card (it's been actioned).
  function openRunNotification(hash: string) {
    watch.dismissRun(hash);
    void openFromHistory(hash);
  }

  // A raid-pull card was clicked → open it from history (keeps the card so the boss group stays intact
  // for further review of the same pull list).
  function openRaidPull(hash: string) {
    void openFromHistory(hash);
  }

  // A clicked LFG-match bell card → open the Groups workspace (where the run is on the board / inbox).
  function openLfgMatch(id: string) {
    if (!FLAGS.groups) return;
    lfgLive.dismiss(id);
    selectSection('groups');
  }

  // A clicked LFG board-event card (applied / accepted / declined / locked / group-full) → Groups board.
  function openLfgEvent(id: string) {
    if (!FLAGS.groups) return;
    lfgLive.dismissEvent(id);
    selectSection('groups');
  }

  function folderTail(p: string | null): string {
    if (!p) return '';
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts.slice(-2).join('\\');
  }

  async function startWatch(dir: string) {
    watch.setDir(dir);
    watch.scanning = true;
    watch.watching = true;
    try {
      await startWatching(dir);
    } catch (e) {
      watch.watching = false;
      watch.scanning = false;
      statusText = `watch failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function stopWatch() {
    await stopWatching();
    watch.watching = false;
    watch.scanning = false;
  }

  async function changeWatchFolder() {
    const dir = await pickFolder(watch.dir ?? undefined);
    if (dir) await startWatch(dir);
  }

  // Mark the app interactive for the load benchmark (cold UI load = nav start → first effect).
  $effect(() => {
    loadBench.markInteractive();
  });

  // A run-card label for a board notification, from the baked summary ("Timed Completion · Pit of Saron +10").
  function boardWhere(card: LfgBoardMessage['card']): string {
    if (!card) return 'your run';
    return `${runTypeLabel(card.runType)}${card.dungeon ? ` · ${card.dungeon}` : ''}${card.keyLevel ? ` +${card.keyLevel}` : ''}`;
  }
  // Map a board event → its notification card (icon/title/detail + whether it dings + the toast title).
  // Returns null for events that shouldn't notify (a withdrawn application is just a board refetch).
  function boardNote(m: LfgBoardMessage): { icon: string; title: string; detail: string; toastTitle: string; sound: boolean } | null {
    const where = boardWhere(m.card);
    switch (m.event) {
      case 'application':
        return { icon: '📥', title: `New applicant · ${where}`, detail: 'Someone applied to your run.', toastTitle: 'new applicant', sound: false };
      case 'accepted':
        return { icon: '✅', title: `You're in! · ${where}`, detail: m.card?.ownerHandle ? `Accepted by ${m.card.ownerHandle}.` : 'You were accepted into the run.', toastTitle: "you're in", sound: true };
      case 'declined':
        return { icon: '🚫', title: `Application declined · ${where}`, detail: 'Your application was declined.', toastTitle: 'application declined', sound: false };
      case 'run-updated':
        return { icon: '🔄', title: `Run updated · ${where}`, detail: 'A run you joined was locked or changed.', toastTitle: 'run updated', sound: false };
      case 'roster-full':
        return { icon: '🎉', title: `Group ready · ${where}`, detail: 'Your group is full — ready to begin!', toastTitle: 'group ready', sound: true };
      default:
        return null; // application-withdrawn etc → board refetch only, no notification
    }
  }

  // LFG near-instant push: hold the WebSocket open WHILE the user is active in Group Finder — i.e. they're
  // looking (≥1 Looking Card) OR they own an open Run Card (so a leader receives application pushes). We
  // don't connect for a signed-in user who isn't participating (nothing to receive). Two message kinds:
  //  • lfg-match  → a broadcast matching a Looking Card: bell card + sound + OS toast when backgrounded.
  //  • lfg-board  → a change to a run you're in (application/accept/decline/lock): GroupsView refetches off
  //    lfgConn.boardRev (bumped in lfgSocket); here we also OS-toast a new APPLICATION when backgrounded so
  //    an in-game leader knows someone applied.
  // No-op without FLAGS.groups / the WS env / sign-in / participation.
  $effect(() => {
    // Gate ONLY on the coarse `lfgShouldConnect` boolean — reading it (a $derived) means this effect
    // re-runs solely when that value flips, NOT on every presence-count tick. So we don't close+reopen
    // the socket for ordinary in-pool actions; it stays open until you leave the pool / go idle.
    if (!lfgShouldConnect) return;
    void requestToastPermission();
    startLfgSocket((m) => {
      if (m.type === 'lfg-match') {
        lfgLive.add({
          id: m.card.id,
          runType: m.card.runType,
          label: runTypeLabel(m.card.runType),
          dungeon: m.card.dungeon ?? null,
          keyLevel: m.card.keyLevel ?? null,
          ownerHandle: m.card.ownerHandle ?? null,
          reason: m.reason,
        });
        playSound('lfg-match');
        // Reach the user outside the app window when they're in-game / looking elsewhere.
        if (!isAppForeground()) {
          const where = `${runTypeLabel(m.card.runType)}${m.card.dungeon ? ` · ${m.card.dungeon}` : ''}${m.card.keyLevel ? ` +${m.card.keyLevel}` : ''}`;
          void osToast('MythicIQ — group match', `${where}. ${m.reason}.`);
        }
      } else if (m.type === 'lfg-board') {
        // The board refetches via lfgConn.boardRev regardless; here we surface a NOTIFICATION the same
        // three ways as a match — a bell card (always), a sound (positive events), and an OS toast when
        // the app is backgrounded (so an in-game user is reached). Quiet events (e.g. a withdrawn
        // application) return null → board refetch only, no card/toast.
        const note = boardNote(m);
        if (note) {
          lfgLive.addEvent({
            id: `${m.runCardId}:${m.event}`,
            runCardId: m.runCardId,
            icon: note.icon,
            title: note.title,
            detail: note.detail,
          });
          if (note.sound) playSound('lfg-match');
          if (!isAppForeground()) void osToast(`MythicIQ — ${note.toastTitle}`, note.detail);
        }
      } else if (m.type === 'lfg-chat') {
        // A group-chat message: append to its channel (lfgChat bumps unread unless it's the open one).
        // Ding + OS-toast an incoming message from someone else when the app is backgrounded.
        lfgChat.receive(m.message);
        if (m.message.authorSub !== auth.user?.sub) {
          if (!isAppForeground()) void osToast(`MythicIQ — ${m.message.authorHandle}`, m.message.body.slice(0, 120));
        }
      }
    });
    return () => stopLfgSocket();
  });

  // A chat-channel title from a run card ("Timed Completion · Pit of Saron +10").
  function groupTitle(c: RunCard): string {
    return `${runTypeLabel(c.runType)}${c.dungeon ? ` · ${c.dungeon}` : ''}${c.keyLevel ? ` +${c.keyLevel}` : ''}`;
  }
  // Reconcile Group Finder presence + chat channels from the board: whether the user owns an open run
  // (a leader stays connected for application pushes), how many groups they're IN (a member stays
  // connected for chat), and the chat channel list (one per non-cancelled run whose roster they're on).
  async function syncLfgGroups(): Promise<void> {
    const r = await listRunCards();
    if (!r.ok) return;
    const mySub = r.value.mySub;
    lfgStatus.setOwnsOpenRun(r.value.runCards.some((c) => c.ownerSub === mySub && c.status === 'open'));
    const myGroups = r.value.runCards.filter((c) => c.status !== 'cancelled' && c.roster.some((m) => m.sub === mySub));
    lfgStatus.setInGroups(myGroups.length);
    lfgChat.setGroups(myGroups.map((c) => ({ runCardId: c.id, title: groupTitle(c), status: c.status, members: c.roster.length })));
  }

  // Pull my active Looking Cards and mirror them into lfgStatus (count + soonest expiry). Shared by the
  // sign-in seed, the "still looking?" confirm/leave handlers, and the post-expiry reconcile so the
  // topbar dot, the socket lifecycle, and the inactivity prompt all read the same fresh truth.
  async function refreshLookingPresence(): Promise<void> {
    const r = await listLooking();
    if (!r.ok) return;
    const mine = r.value.mine;
    lfgStatus.setActiveCards(mine.length);
    lfgStatus.setSoonestCardExpiry(mine.length ? Math.min(...mine.map((c) => c.expiresAt)) : null);
  }

  // Seed the Group Finder presence from the server once on sign-in so the topbar dot is accurate AND the
  // WS connects before the user ever opens Groups: their active Looking Cards, whether they own an open
  // Run Card, and the groups they're in (for chat). GroupsView keeps looking/runs live thereafter; the
  // board-revision effect below keeps chat channels current as rosters change.
  $effect(() => {
    if (!FLAGS.groups) return;
    if (auth.status !== 'signed-in') return;
    if (!lfgConfigured()) return;
    void refreshLookingPresence();
    void syncLfgGroups();
  });

  // -- Inactivity "still looking?" prompt (pool-intent timeout) --
  // The socket stays open as long as you're in the pool; this is the mechanism that eventually takes you
  // OUT if you've wandered off. A few minutes before your soonest Looking Card hits its 30-min TTL we ask
  // "still looking?". Confirm → extend all cards (fresh TTL, stay in). Ignore → the cards lapse on their
  // own, activeCards drops to 0, and the socket closes through the normal lifecycle. Reaches an in-game
  // user via an OS toast when the app is backgrounded.
  const STILL_LOOKING_LEAD_MS = 3 * 60 * 1000; // nudge this long before the soonest card expires
  const STILL_LOOKING_RECONCILE_MS = 20 * 1000; // refetch this long after expiry to reflect the drop
  let stillLookingPrompt = $state(false);
  let promptedForExpiry = 0; // de-dupe: the expiry timestamp we've already prompted for this cycle

  $effect(() => {
    const exp = lfgStatus.soonestCardExpiry;
    const looking = lfgStatus.activeCards > 0;
    if (!FLAGS.groups || auth.status !== 'signed-in' || !lfgConfigured() || !looking || !exp) return;
    if (promptedForExpiry === exp) return; // already scheduled/handled this expiry
    const now = Date.now();
    const promptT = setTimeout(() => {
      promptedForExpiry = exp;
      stillLookingPrompt = true;
      if (!isAppForeground()) void osToast('MythicIQ — still looking?', 'Open MythicIQ to stay in the group pool.');
    }, Math.max(0, exp - STILL_LOOKING_LEAD_MS - now));
    // If they never answer, the card expires server-side; refetch so activeCards → 0 closes the socket.
    const reconcileT = setTimeout(() => {
      if (stillLookingPrompt) { stillLookingPrompt = false; void refreshLookingPresence(); }
    }, Math.max(0, exp + STILL_LOOKING_RECONCILE_MS - now));
    return () => { clearTimeout(promptT); clearTimeout(reconcileT); };
  });

  async function confirmStillLooking(): Promise<void> {
    stillLookingPrompt = false;
    await extendMyLookingCards();
    await refreshLookingPresence(); // new expiresAt → the effect reschedules the next prompt
  }
  function leaveLookingPool(): void {
    stillLookingPrompt = false;
    void dropMyLookingCards().then(() => refreshLookingPresence());
  }

  // -- Reconciliation pull (the socket is a HINT, HTTP is the truth) --
  // WS pushes are fire-and-forget with no replay: a frame dropped during a reconnect gap, a cold Lambda,
  // or a momentarily-unregistered connection is gone for good. To stop that from being PERMANENT, we
  // periodically re-pull the authoritative state so a missed push degrades to "a few seconds late" rather
  // than "never". Reuses the existing refetch wiring: `bumpBoard` makes GroupsView (if open) refetch the
  // board/applications AND App re-run syncLfgGroups; `refreshLookingPresence` covers my Looking Cards when
  // Groups isn't mounted. Triggered when the user returns to the app (focus/visible — e.g. alt-tabbing back
  // from WoW), when the network comes back (online), and on a slow backstop interval while connected.
  let lastReconcile = 0;
  function reconcileLfg(force = false): void {
    if (!FLAGS.groups || auth.status !== 'signed-in' || !lfgConfigured()) return;
    const now = Date.now();
    if (!force && now - lastReconcile < 3000) return; // debounce focus/visibility bursts
    lastReconcile = now;
    void refreshLookingPresence();
    lfgConn.bumpBoard();
  }

  $effect(() => {
    if (!lfgShouldConnect) return; // only reconcile while we're meant to be in the pool
    const onVis = () => { if (document.visibilityState === 'visible') reconcileLfg(); };
    const onFocus = () => reconcileLfg();
    const onOnline = () => reconcileLfg(true);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    const iv = setInterval(() => reconcileLfg(true), 30_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      clearInterval(iv);
    };
  });

  // Re-reconcile chat channels whenever a board push lands (an accept/lock/cancel changed a roster the
  // user is part of) so the chat window's group list + member counts stay current without opening Groups.
  $effect(() => {
    void lfgConn.boardRev; // track
    if (!FLAGS.groups || auth.status !== 'signed-in' || !lfgConfigured()) return;
    void syncLfgGroups();
  });

  $effect(() => {
    if (!isDesktop()) return;
    // A standalone desktop DEBUG build (tauri build --debug) gets the DEV reset panel too.
    if (!showDevPanel) void isDebugBuild().then((d) => { if (d) showDevPanel = true; });
    let unRun: (() => void) | undefined;
    let unBackfill: (() => void) | undefined;
    let unShown: (() => void) | undefined;
    let unHidden: (() => void) | undefined;
    void (async () => {
      // Tray hide/show: load-benchmark timing + the optional unload-replay-on-tray memory saver.
      unHidden = await onWindowHidden(onTrayHidden);
      unShown = await onWindowShown(onTrayShown);
      unRun = await onRunCarved((r) => {
        // Backfill runs are buffered and handled together once the scan finishes (see processBackfill),
        // so we can import the older ones silently and open only the newest. Live runs drain immediately.
        if (r.backfill) {
          backfillBuffer.push(r);
          return;
        }
        carveQueue.push(r);
        void drainCarve();
      });
      unBackfill = await onBackfillComplete((count) => {
        watch.scanning = false;
        if (count > 0) void osNotify('MythicIQ', `Found ${count} completed ${count === 1 ? 'run' : 'runs'} in your log.`);
        void processBackfill();
      });
      // Auto-start on the remembered folder, else the detected retail Logs path.
      const dir = watch.dir ?? (await defaultLogDir());
      if (dir) await startWatch(dir);
    })();
    return () => {
      unRun?.();
      unBackfill?.();
      unShown?.();
      unHidden?.();
      clearTimeout(trayUnloadTimer);
      void stopWatching();
    };
  });

  // Mirror the low-resource-mode setting to the native side (push on startup + whenever it changes).
  // When enabled, the native shell tears down this webview shortly after it's minimized to the tray —
  // the log watcher keeps running, and the tray "Show" rebuilds the window.
  $effect(() => {
    if (!isDesktop()) return;
    void setLowResourceMode(settings.lowResourceMode);
  });

  // After a report is ready, persist the log's real (non-synthetic) runs as compressed sub-logs,
  // keeping only the MAX_RUNS most recent overall. Best-effort + fully in the background (building the
  // LineIndex is a second full-file scan), so it never delays the visible result.
  async function persistRuns(file: File, rep: FullReport) {
    if (!historyEnabled) return;
    try {
      const real = rep.runs.filter((r) => !r.run.synthetic);
      if (real.length === 0) return;
      const existing = await listRuns();
      const cand = real.map((r) => ({ rep: r, hash: runHash(r), startedAtMs: r.firstMs }));
      // Retention = max(this file's runs, floor): keep ALL of a multi-run night from one log, but never
      // fewer than the floor. Desktop has a roomy on-disk folder (configurable cap, default 100); the web
      // IndexedDB store uses MAX_RUNS. The same `keep` is passed to saveRun so its prune matches.
      const keep = Math.max(real.length, isDesktop() ? settings.historyCap : MAX_RUNS);
      // Only bother saving runs that are new AND would survive the prune-to-`keep` (by play-time).
      const newTimes = cand.filter((c) => !existing.some((e) => e.hash === c.hash)).map((c) => c.startedAtMs);
      const merged = [...existing.map((e) => e.startedAtMs), ...newTimes].sort((a, b) => b - a);
      const cutoff = merged[keep - 1] ?? -Infinity;
      // Save a run if it's NEW (and within the keep window) OR it exists but predates the side-pane cache
      // (a legacy record to upgrade, so opening it becomes instant) — see openFromHistory.
      const toSave = cand.filter((c) => {
        const ex = existing.find((e) => e.hash === c.hash);
        return ex ? !ex.hasReport : c.startedAtMs >= cutoff;
      });
      if (toSave.length === 0) return;
      const lineIndex = await LineIndex.build(file);
      for (const c of toSave) {
        const raw = await extractRunLog(lineIndex, c.rep.run);
        const gz = await gzip(raw);
        // Opt-in "verified credit": upload the compressed sub-log so the backend re-parses it and credits
        // the verified party members. Reuses the gz we just built; fire-once per run/session, signed-in
        // + configured only. The combat log leaves the browser ONLY here, and only when explicitly enabled.
        if (
          settings.verifiedCredit &&
          auth.status === 'signed-in' &&
          verifiedCreditConfigured() &&
          c.rep.run.completed === true &&
          !c.rep.run.synthetic &&
          !verifiedSubmitted.has(c.hash)
        ) {
          verifiedSubmitted.add(c.hash);
          void submitVerifiedRun(c.hash, gz);
        }
        // Cache the SIDE-PANE data as a single-run FullReport so re-opening shows the analysis instantly
        // (the gz log is only needed to rebuild the replay). owner is whole-log; roster is per-run.
        const cachedFull: FullReport = {
          phases: [],
          totalEvents: c.rep.totalEvents,
          durationSeconds: c.rep.durationSeconds,
          firstMs: c.rep.firstMs,
          lastMs: c.rep.lastMs,
          runs: [c.rep],
          owner: rep.owner,
          roster: c.rep.roster,
        };
        const reportGz = await gzip(new TextEncoder().encode(JSON.stringify(cachedFull)));
        await saveRun({
          hash: c.hash,
          savedAt: Date.now(),
          startedAtMs: c.startedAtMs,
          gzSize: gz.length,
          meta: buildHistoryMeta(c.rep, file.name),
          gz,
          report: reportGz,
        }, keep);
      }
    } catch {
      /* history is best-effort */
    } finally {
      await refreshHistory();
    }
  }

  // Re-open a stored run. If we have its cached SIDE-PANE data, show the analysis INSTANTLY and re-parse
  // the log in the BACKGROUND to power the replay (no loader screen, no dropzone). Falls back to a normal
  // foreground re-parse for older records saved without the cached report. (skipHistory: already saved.)
  async function openFromHistory(hash: string) {
    if (!historyEnabled) return;
    if (historyBusy) return;
    historyBusy = hash;
    try {
      const gz = await loadRunBytes(hash);
      if (!gz) return;
      const name = historyList.find((e) => e.hash === hash)?.meta.fileName ?? 'run.txt';
      const file = new File([(await gunzip(gz)) as BlobPart], name, { type: 'text/plain' });
      const cached = await loadRunReport(hash);
      if (cached) {
        // Instant: paint the side panes from cache, then build the replay in the background.
        report = cached;
        selectedRun = Math.max(0, cached.runs.length - 1);
        status = 'ready';
        activeSection = 'review';
        activeTab = 'overview';
        sidebarOpen = true;
        replayPending = true; // stage shows "building replay…" until the background parse lands
        statusText = 'building replay…';
        void onFile(file, { skipHistory: true, background: true, preferredHash: hash });
      } else {
        // Legacy record (saved before the side-pane cache existed): full re-parse this once, and
        // BACKFILL the cache (inside onReport, which has the report) so the next open is instant.
        await onFile(file, { skipHistory: true, backfillHash: hash });
        activeSection = 'review';
        activeTab = 'overview';
        sidebarOpen = true;
      }
    } finally {
      historyBusy = null;
    }
  }
  async function deleteFromHistory(hash: string) {
    if (!historyEnabled) return;
    await deleteRun(hash);
    await refreshHistory();
  }

  // `background` (history open with cached side-pane data already shown): DON'T blank the report or take
  // over with the loader screen — keep the analysis visible and only (re)build the replay when the store
  // is resident. Otherwise (fresh log): blank + show the loader screen with the per-phase progress bars.
  async function onFile(
    file: File,
    opts: {
      skipHistory?: boolean;
      background?: boolean;
      backfillHash?: string;
      preferredHash?: string;
      silent?: boolean;
      onParsed?: (rep: FullReport) => void;
    } = {},
  ) {
    const visibleLoadId = opts.silent ? null : ++visibleLoadSeq;
    const current = () => visibleLoadId === null || visibleLoadId === visibleLoadSeq;

    error = null;
    if (!opts.background && !opts.silent) {
      report = null;
      status = 'loading';
      activeSection = 'review'; // a foreground load shows the analysis workspace (loader → replay stage)
      replayPending = false; // a fresh load always (re)enables the stage replay, never leaves it gated
      resetPhases();
    }
    statusText = opts.silent
      ? 'Importing previous runs…'
      : `Loading ${file.name} (${(file.size / 1e6).toFixed(0)} MB)…`;
    // Remember the displayed file so tray-unload can free the worker and re-parse on restore. Silent
    // backfill imports of OLDER runs aren't the displayed run, so they don't replace this.
    if (!opts.silent) loadedFile = file;

    const runParse = async () => {
      const runId = crypto.randomUUID(); // one id per parse → backend counts distinct logs
      // Silent imports are for history persistence only. Give them their own worker so a backfill/live
      // carve can't replace the visible replay worker's callbacks or resident store mid-open.
      const parseClient = opts.silent ? new ParserClient() : (client ??= new ParserClient());
      let resolveReport!: () => void;
      const reportDone = new Promise<void>((resolve) => {
        resolveReport = resolve;
      });

      try {
        await parseClient.parse(file, {
          onProgress: (phase, r) => {
            if (opts.silent || !current()) return; // silent/stale parses don't drive the loader UI
            setPhase(phase, r);
            statusText = `${phase} ${(r * 100) | 0}%`;
          },
          onReport: (rep) => {
            try {
              // `silent`: parse purely to SAVE to history (older backfill runs) — never take over the view.
              if (!opts.silent && current()) {
                const preferredIdx = opts.preferredHash
                  ? rep.runs.findIndex((r) => runHash(r) === opts.preferredHash)
                  : -1;
                if (opts.background && opts.preferredHash && preferredIdx < 0) {
                  replayPending = true;
                  statusText = 'replay unavailable: saved log does not match this history entry';
                  return;
                }
                report = rep;
                // Default to the most recent run — set BEFORE `status` renders the stage so the replay
                // loads the same run the dropdown shows (avoids a load-run-0-then-switch race).
                selectedRun =
                  preferredIdx >= 0
                    ? preferredIdx
                    : opts.background && selectedRun < rep.runs.length
                      ? selectedRun
                      : Math.max(0, rep.runs.length - 1);
                status = 'ready';
                replayPending = false; // store is resident → let the stage replay build for this run
                if (!opts.background) {
                  activeTab = 'overview'; // a fresh foreground load lands on Overview (history opens stay put)
                  sidebarOpen = true;
                }
                statusText = ''; // run/event counts live on the Overview tab, not the topbar
              }
              // Save desktop-visible history in the background (unless this load came FROM history).
              if (!opts.skipHistory && historyEnabled) void persistRuns(file, rep);
              // Opening a legacy history record (no cached side data): backfill its cache from this parse —
              // the sublog yields a single-run report, so the whole `rep` IS that run's side-pane data —
              // so the NEXT open is instant. Done here (not after `parse()`, which resolves summary-first).
              if (opts.backfillHash && current()) {
                void (async () => {
                  try {
                    await saveRunReport(opts.backfillHash!, await gzip(new TextEncoder().encode(JSON.stringify(rep))));
                    await refreshHistory();
                  } catch {
                    /* best-effort cache backfill */
                  }
                })();
              }
              // Hand the parsed report to the caller (carve imports capture it to persist + key history).
              opts.onParsed?.(rep);
            } finally {
              resolveReport();
            }
          },
          onDiscovery: (d) => {
            if (!opts.silent && !current()) return;
            recordDiscoveries(d);
            void syncToBackend(runId, d); // fire-and-forget (no-op unless VITE_BACKEND_URL set)
          },
        });
        await reportDone;
      } catch (e) {
        if (opts.silent) {
          /* a failed silent backfill import shouldn't surface anywhere — just skip it */
        } else if (!current()) {
          /* superseded by a newer visible load */
        } else if (opts.background) {
          // The side panes are already up from cache; only the replay failed to build — don't tear the
          // whole view down to an error screen. Surface it in the status line and stop the building state.
          replayPending = false;
          statusText = `replay unavailable: ${e instanceof Error ? e.message : String(e)}`;
        } else {
          status = 'error';
          error = e instanceof Error ? e.message : String(e);
        }
      } finally {
        if (opts.silent) parseClient.terminate();
        // A silent backfill import never runs onReport's `statusText=''` clear, so its "Importing previous
        // runs…" toast would otherwise linger forever. Clear it once the import settles so the
        // status only shows WHILE work is happening (guard on the silent message so we don't stomp a
        // foreground load's status).
        if (opts.silent && statusText === 'Importing previous runs…') statusText = '';
      }
    };

    if (opts.silent) return runParse();
    const queued = uiParseChain.catch(() => {}).then(runParse);
    uiParseChain = queued.catch(() => {});
    return queued;
  }

  function pick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f) void onFile(f);
  }

  // "Try a Sample Log" — fetch a bundled, anonymized sample log and run it through the normal parse flow,
  // so a first-time visitor can see the analyzer without a log of their own. Served GZIPPED (the raw log
  // is ~36MB; gzip is ~2.4MB) and decompressed in-browser — CloudFront won't auto-compress files >10MB,
  // so we ship it pre-compressed. Skipped from local history (it's a bundled sample).
  const SAMPLE_LOG_NAME = 'MythicIQ_Skyreach_7_anonymized.txt';
  // Served as gzip bytes under a NEUTRAL .bin extension on purpose: a .gz URL gets auto-handled as
  // Content-Encoding: gzip by dev/preview servers (and some CDNs), which collides with our manual
  // gunzip (content-length mismatch → "Failed to fetch"). .bin = raw octet-stream, we decompress.
  const SAMPLE_LOG_URL = `${import.meta.env.BASE_URL}sample/${SAMPLE_LOG_NAME}.bin`;
  // Download progress (0..1) for fetched logs (the sample now; cloud-restored runs later). null = not
  // downloading, so the loader shows a download bar only while bytes are actually streaming in.
  let downloadRatio = $state<number | null>(null);
  let sampleLoading = $state(false);

  /** Fetch a URL with streaming progress, reporting bytes-received / Content-Length via `onRatio`. */
  async function fetchWithProgress(url: string, onRatio: (r: number) => void): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) onRatio(Math.min(1, received / total));
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  async function loadSample() {
    if (sampleLoading || status === 'loading') return;
    sampleLoading = true;
    error = null;
    report = null;
    status = 'loading';
    activeSection = 'review';
    replayPending = false;
    resetPhases();
    downloadRatio = 0;
    statusText = 'Downloading sample log…';
    try {
      const compressed = await fetchWithProgress(SAMPLE_LOG_URL, (r) => (downloadRatio = r));
      downloadRatio = null; // download done → hand off to the parse phases
      const bytes = await gunzip(compressed);
      const file = new File([bytes as BlobPart], SAMPLE_LOG_NAME, { type: 'text/plain' });
      await onFile(file, { skipHistory: true });
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
    } finally {
      downloadRatio = null;
      sampleLoading = false;
    }
  }

  // File drag-and-drop (landing drop zone AND dropping a new log over a loaded report). A depth
  // counter avoids the flicker from dragleave firing as the cursor crosses child elements.
  let dragDepth = 0;
  function hasFiles(e: DragEvent) {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
  }
  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dragging = true;
  }
  function onDragOver(e: DragEvent) {
    if (hasFiles(e)) e.preventDefault(); // allow drop
  }
  function onDragLeave() {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragging = false;
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    dragDepth = 0;
    const f = e.dataTransfer?.files?.[0];
    if (f) void onFile(f);
  }
</script>

<!-- Drag/drop handlers live on the shell root so dropping a log ANYWHERE loads it (and the browser
     never falls back to navigating to the file); the overlay is just a hint. -->
<div
  class="mvp shell"
  style={`--chrome-ruins: url(${siteRuins})`}
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  role="application"
>
  <header class="topbar">
    <a class="brand" href="/" aria-label="MythicIQ home"><img src={logoNew} alt="MythicIQ" /></a>
    <span
      class="beta"
      title="MythicIQ is in beta. Numbers are still being refined and may differ from other tools — trust your in-game/Details numbers over ours when they disagree, and please send a bug report."
      >BETA</span
    >
    <!-- Companion-status section: one cordoned-off cell per live capability (log watching / Group Finder /
         desktop Capture), each an icon + a dot that pulses green when active, sits grey when idle. Richer hover
         cards come later; for now the icon + dot + title is the read. -->
    {#if watch.available || FLAGS.groups || captureEnabled}
      <div class="statusbar" role="group" aria-label="Companion status">
        {#if watch.available}
          <button
            class="statseg"
            class:active={watch.watching}
            onclick={() => { if (watch.watching) liveOpen = true; else void changeWatchFolder(); }}
            title={watch.watching ? (watch.scanning ? 'Scanning your log…' : 'Watching your WoW Logs folder — click for options') : 'Click to watch your WoW Logs folder'}
            aria-label={`Log watching: ${watch.watching ? (watch.scanning ? 'scanning' : 'live') : 'idle'}`}
          >
            <svg class="statico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LOG_ICON}</svg>
            <span class="statdot" class:on={watch.watching} class:pulse={watch.watching && !watch.scanning}></span>
          </button>
        {/if}
        {#if FLAGS.groups}
          <!-- Dot: gray when not looking; green pulse when looking AND the push socket is live; red when
               looking but the socket is down (you'd miss live match pings — open Groups / check connection). -->
          <button
            class="statseg"
            class:active={lfgLooking}
            onclick={() => selectSection('groups')}
            title={!lfgLooking
              ? 'Group Finder — idle (no character in a pool)'
              : lfgConn.connected
                ? `Group Finder — looking · ${lfgStatusDetail} · live`
                : `Group Finder — looking · ${lfgStatusDetail} · not connected`}
            aria-label={`Group Finder: ${!lfgLooking ? 'idle' : lfgConn.connected ? 'looking, connected' : 'looking, disconnected'}`}
          >
            <svg class="statico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html SECTION_ICONS.groups}</svg>
            <span
              class="statdot"
              class:on={lfgLooking && lfgConn.connected}
              class:pulse={lfgLooking && lfgConn.connected}
              class:warn={lfgLooking && !lfgConn.connected}
            ></span>
          </button>
        {/if}
        {#if captureEnabled}
          <button
            class="statseg"
            onclick={() => selectSection('capture')}
            title="Capture — idle"
            aria-label="Capture: idle"
          >
            <svg class="statico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html SECTION_ICONS.capture}</svg>
            <span class="statdot"></span>
          </button>
        {/if}
      </div>
    {/if}
    {#if status === 'ready' && report && report.runs.length > 1}
      <div class="topbar-run">
        <label class="runsel">
          <span class="muted">Run</span>
          <select bind:value={selectedRun}>
            {#each report.runs as r, i (r.run.index)}
              <option value={i}>#{i + 1} · {runLabel(r, i)}</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}
    <!-- Subtle rotating positive message / Scripture, centered in the remaining topbar space. -->
    <PositiveMessage />
    <div class="right">
      <button class="bugbtn" title="Report a bug" onclick={() => (bugOpen = true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html BUG_ICON}</svg>
        <span>Report Bug</span>
      </button>
      <!-- Notifications: a bell + dropdown of recent-update cards + completed-run cards (desktop live
           watch). Click to jump / open the run / ✕ to dismiss. -->
      <NotificationsBell
        hasReport={!!report}
        onNavigate={navigateNotification}
        runNotifications={watch.runNotifications}
        onOpenRun={openRunNotification}
        onDismissRun={(hash) => watch.dismissRun(hash)}
        onSeenRuns={() => watch.markRunsSeen()}
        lfgMatches={lfgLive.matches}
        onOpenLfg={openLfgMatch}
        onDismissLfg={(id) => lfgLive.dismiss(id)}
        onSeenLfg={() => lfgLive.markSeen()}
        lfgEvents={lfgLive.events}
        onOpenLfgEvent={openLfgEvent}
        onDismissLfgEvent={(id) => lfgLive.dismissEvent(id)}
      />
      <!-- Account menu: sign in / account, settings, anonymize. -->
      <div class="gearwrap">
        <AccountMenu hasReport={!!report} onOpenSettings={() => (settingsOpen = true)} />
        {#if !FLAGS.demo && report && !settings.madeChoice}
          <div class="hint" role="note">
            <button class="hint-x" aria-label="Dismiss" onclick={() => settings.markChoiceMade()}>✕</button>
            <b>New:</b> opt into sharing <b>anonymized</b> run stats (you choose what to anonymize) to see
            how your runs compare to others. It's off by default — open <span class="gear-inline">⚙ Settings</span> to turn it on.
          </div>
        {/if}
      </div>
    </div>
  </header>

  <BugReportModal bind:open={bugOpen} context={bugContext} />
  <SettingsModal bind:open={settingsOpen} />
  {#if tourActive}<Walkthrough steps={TOUR_STEPS} onDone={endTour} />{/if}
  {#if showDevPanel}<DevPanel />{/if}

  {#if liveOpen}
    <div class="live-overlay" role="presentation" onclick={() => (liveOpen = false)}
         onkeydown={(e) => { if (e.key === 'Escape') liveOpen = false; }}>
      <div class="live-modal" role="dialog" aria-modal="true" aria-label="Live log watching" tabindex="-1"
           onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
        <div class="lm-head">
          <div class="lm-title"><span class="livedot" class:pulse={watch.watching && !watch.scanning}></span> Live log watching</div>
          <button class="lm-x" aria-label="Close" onclick={() => (liveOpen = false)}>✕</button>
        </div>
        <p class="lm-status">{watch.scanning ? 'Scanning your log for completed runs…' : 'Watching for completed M+ runs. New runs appear on the 🔔 bell.'}</p>
        <div class="lm-folder">
          <span class="lm-flabel">Folder</span>
          <span class="lm-fpath" title={watch.dir ?? ''}>{watch.dir ? folderTail(watch.dir) : 'none'}</span>
        </div>
        <div class="lm-actions">
          <button class="lm-btn" onclick={() => { liveOpen = false; void changeWatchFolder(); }}>Change folder…</button>
          <button class="lm-btn danger" onclick={() => { liveOpen = false; void stopWatch(); }}>Stop watching</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Inactivity ("still looking?") prompt: surfaces a few minutes before the soonest Looking Card lapses.
       Confirm extends all cards (stay in the pool); Leave drops them now; ignoring lets the TTL drop you. -->
  {#if stillLookingPrompt}
    <div class="live-overlay" role="presentation" onclick={() => (stillLookingPrompt = false)}
         onkeydown={(e) => { if (e.key === 'Escape') stillLookingPrompt = false; }}>
      <div class="live-modal" role="dialog" aria-modal="true" aria-label="Still looking for a group?" tabindex="-1"
           onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
        <div class="lm-head">
          <div class="lm-title">Still looking for a group?</div>
        </div>
        <p class="lm-status">Your spot in the group pool is about to expire. Keep you in the pool?</p>
        <div class="lm-actions">
          <button class="lm-btn" onclick={() => void confirmStillLooking()}>Yes, keep me in</button>
          <button class="lm-btn danger" onclick={leaveLookingPool}>Leave pool</button>
        </div>
      </div>
    </div>
  {/if}

    <div class="workspace">
      <!-- Activity rail: accordion sections (Review / Groups / desktop Capture), each owning its sub-items.
           A section expands when it's the active one (so you see where you are) or when hovered; the
           rest fall closed. Click a section header to switch its main window; click a sub-item to open
           that panel (in Review, clicking the already-open panel collapses the sidebar). -->
      <nav class="rail" aria-label="Navigation" onmouseleave={() => (hoveredSection = null)}>
        {#each visibleSections as sec, sectionIndex (sec.id)}
          {@const expanded = isExpanded(sec.id)}
          <div
            class="railsec"
            class:expanded
            class:current={activeSection === sec.id}
            onmouseenter={() => (hoveredSection = sec.id)}
            role="group"
          >
            <button
              class="secheader"
              class:active={activeSection === sec.id}
              aria-expanded={expanded}
              aria-current={activeSection === sec.id ? 'page' : undefined}
              title={sec.label}
              onclick={() => selectSection(sec.id)}
            >
              <span class="sec-step" aria-hidden="true">{sectionStep(sec.id, sectionIndex)}</span>
              <span class="sec-copy">
                <span class="sec-ico" aria-hidden="true">
                  {#if sec.id === 'learn'}
                    <span class="sec-ico-img" style="--mbook: url({mBookIcon})"></span>
                  {:else}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html SECTION_ICONS[sec.id]}</svg>
                  {/if}
                </span>
                <span class="sec-lbl">{sec.label}</span>
              </span>
              <span class="sec-chev" class:open={expanded} aria-hidden="true">▸</span>
            </button>
            {#if expanded}
              <div class="secitems" transition:slide={{ duration: 160 }}>
                {#each sec.items as it (it.id)}
                  {@const itemActive = isItemActive(sec.id, it.id)}
                  <button
                    class="railbtn"
                    class:active={itemActive}
                    data-tour={it.id}
                    title={it.label}
                    aria-pressed={itemActive}
                    onclick={() => selectItem(sec.id, it.id)}
                  >
                    <span class="rail-ico" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html it.icon}</svg>
                    </span>
                    <span class="rail-lbl">{it.label}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>

      {#if activeSection === 'review'}
      <!-- Fold-out sidebar holding the active panel. Width animates on toggle; .side-inner keeps a
           fixed width so the content doesn't squish during the collapse. -->
      <aside class="sidebar" class:open={sidebarOpen} style="width:{sidebarOpen ? sidebarWidth : 0}px">
        <div class="side-inner" style="width:{sidebarWidth}px">
          <div class="side-head">
            <span class="side-title">{activeLabel}</span>
            <button class="side-x" title="Collapse panel" aria-label="Collapse panel" onclick={() => (sidebarOpen = false)}>◀</button>
          </div>
          <div class="side-body" bind:this={sideBodyEl}>
            {#if historyEnabled && activeTab === 'history'}
              <RunHistory entries={historyList} onOpen={openFromHistory} onDelete={deleteFromHistory} busyHash={historyBusy} />
            {:else if currentRun && report}
              {#if currentRun.run.contentType === 'raid'}
                <RaidPullsPanel currentHash={currentRunHash} onOpenPull={openRaidPull} />
              {/if}
              {#key selectedRun}
                {#if activeTab === 'overview'}
                  <Overview report={currentRun} onSeek={seek} roster={currentRun.roster} comparison={currentComparison} onCelebrate={showCelebration} onNavigate={(id) => { activeTab = id; sidebarOpen = true; }} />
                {:else if activeTab === 'pulls'}
                  <Pulls report={currentRun} onSeek={seek} />
                {:else if activeTab === 'role'}
                  <RoleReview report={currentRun} owner={report.owner} roster={currentRun.roster} />
                {:else if activeTab === 'mechanics'}
                  <Mechanics report={currentRun} roster={currentRun.roster} owner={report.owner} />
                {:else if activeTab === 'enemies'}
                  <Enemies report={currentRun} />
                {:else if activeTab === 'deaths'}
                  <Deaths {recap} firstMs={currentRun.firstMs} onSeek={seek} />
                {:else if activeTab === 'insights'}
                  <Insights
                    {client}
                    runIndex={selectedRun}
                    owner={report.owner}
                    firstMs={currentRun.firstMs}
                    onWindows={(w) => (metricWindows = w)}
                  />
                {/if}
              {/key}
            {:else}
              <div class="side-empty muted">
                {historyEnabled ? 'Load a log to see analysis here, or open a saved run from History.' : 'Load a log to see analysis here.'}
              </div>
            {/if}
          </div>
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        {#if sidebarOpen}
          <div
            class="rz"
            class:active={rzActive}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            onpointerdown={rzDown}
            onpointermove={rzMove}
            onpointerup={rzUp}
          ></div>
        {/if}
      </aside>

      <!-- The replay is the main stage. It hosts THREE states — the dropzone (no log), the per-phase
           loader (parsing), and the replay (ready) — over an ambient crossfading backdrop. Mounted once
           so the replay survives panel changes; only a RUN change resets it (ReplayViewer's effect). -->
      <main class="stage" data-tour="stage">
        <!-- Ambient backdrop: two crossfading art layers (timer-driven) + a darken/vignette veil. The
             art uses background-attachment:fixed so resizing/collapsing the sidebar never rescales it. -->
        <div class="stage-bg" aria-hidden="true">
          <div class="stage-art" class:show={showA} style="background-image: url({artA})"></div>
          {#if artB}<div class="stage-art" class:show={!showA} style="background-image: url({artB})"></div>{/if}
          <div class="stage-veil"></div>
        </div>
        <div class="stage-scroll">
          {#if status === 'loading'}
            <!-- Parsing: brand logo + a per-phase progress bar each, so it reads as a pipeline making
                 progress. Background history re-parses keep status 'ready' and never show this. -->
            <div class="stage-state" role="status" aria-live="polite">
              <div class="loadcard">
                <img class="herologo" src={logoNew} alt="MythicIQ" />
                <div class="loadtext">{downloadRatio !== null ? 'Downloading log…' : 'Analyzing your log…'}</div>
                {#if downloadRatio !== null}
                  <!-- Downloading a remote log (sample now; cloud-restored runs later). -->
                  <div class="phases">
                    <div class="phase">
                      <div class="phase-head">
                        <span class="phase-lbl">Downloading</span>
                        <span class="phase-pct">{Math.round(downloadRatio * 100)}%</span>
                      </div>
                      <div class="phase-track"><div class="phase-fill" style="width:{Math.round(downloadRatio * 100)}%"></div></div>
                    </div>
                  </div>
                {:else}
                  <div class="phases">
                    {#each PARSE_PHASES as p (p.key)}
                      {@const r = phaseRatio[p.key] ?? 0}
                      <div class="phase" class:done={r >= 1}>
                        <div class="phase-head">
                          <span class="phase-lbl">{p.label}</span>
                          <span class="phase-pct">{r >= 1 ? '✓' : `${Math.round(r * 100)}%`}</span>
                        </div>
                        <div class="phase-track"><div class="phase-fill" style="width:{Math.round(r * 100)}%"></div></div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {:else if status === 'ready' && report}
            <ReplayViewer {client} runIndex={selectedRun} windows={metricWindows} controller={replay} embedded title="Replay" enabled={!replayPending && !replayUnloaded} />
          {:else}
            <!-- No log loaded: the dropzone lives here in the stage. Desktop history remains in the rail. -->
            <div class="stage-state">
              <div class="drop {dragging ? 'over' : ''}">
                <div class="drop-inner">
                  <img class="herologo" src={logoNew} alt="MythicIQ" />
                  <span class="beta-pill">BETA</span>
                  <div class="big">{FLAGS.demo ? 'Explore the MythicIQ web app' : 'Drop a combat log to analyze'}</div>
                  <div class="muted">
                    {FLAGS.demo
                      ? 'Start with the sample run, or drop your own combat log for an in-browser review.'
                      : '…or choose a file. Your log is analyzed right here in your browser.'}
                  </div>
                  <div class="dropbtns">
                    {#if FLAGS.demo}
                      <button type="button" class="filebtn" onclick={loadSample} disabled={sampleLoading}>
                        Try Sample Run
                      </button>
                      <label class="filebtn ghost">
                        <input type="file" accept=".txt,.log" onchange={pick} hidden />
                        Choose log file
                      </label>
                      <a class="filebtn ghost" href="/#download">Download App</a>
                    {:else}
                      <label class="filebtn">
                        <input type="file" accept=".txt,.log" onchange={pick} hidden />
                        Choose log file
                      </label>
                      <button type="button" class="filebtn ghost" onclick={loadSample} disabled={sampleLoading}>
                        Try a Sample Log
                      </button>
                    {/if}
                  </div>
                  {#if status === 'error'}<div class="err">Error: {error}</div>{/if}
                  {#if lastUpdated}
                    <p class="last-update" title="version {APP_VERSION}">
                      <span class="pulse" aria-hidden="true"></span> Last updated {lastUpdated}
                    </p>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </div>
      </main>
      {:else if activeSection === 'learn'}
        <!-- Learn main window: the run-independent mechanics library (Dungeon / Raid scope). -->
        <main class="sectionpane">
          <MechanicsLibrary scope={learnScope} />
        </main>
      {:else if activeSection === 'groups'}
        <!-- Groups main window: the global group-coordination workspace (enabled by FLAGS.groups).
             Shares the replay stage's ambient crossfading backdrop (same artA/artB/showA timer state) so
             the Group Finder reads as atmosphere too, not a flat panel. -->
        <main class="sectionpane groupstage">
          {#if FLAGS.groups}
            <div class="stage-bg" aria-hidden="true">
              <div class="stage-art" class:show={showA} style="background-image: url({artA})"></div>
              {#if artB}<div class="stage-art" class:show={!showA} style="background-image: url({artB})"></div>{/if}
              <div class="stage-veil"></div>
            </div>
            <div class="groupstage-scroll">
              <GroupsView />
            </div>
          {:else}
            <div class="comingsoon">
              <div class="cs-card">
                <h2>Groups</h2>
                <p>Coordinate Mythic+ groups from a global community pool — advertise the roles you play, form a group, and staff it from everyone available.</p>
              </div>
            </div>
          {/if}
        </main>
      {:else if activeSection === 'admin'}
        <!-- Admin main window: the review-queue workspace (visible only to backend-allowlisted admins). -->
        <main class="sectionpane">
          {#if admin.isAdmin}
            <AdminView />
          {:else}
            <div class="comingsoon">
              <div class="cs-card">
                <h2>Admin</h2>
                <p>This area is restricted to administrators.</p>
              </div>
            </div>
          {/if}
        </main>
      {:else}
        <!-- Capture main window: placeholder scaffolding for later work. -->
        <main class="sectionpane">
          <div class="comingsoon">
            <div class="cs-card">
              <h2>Capture</h2>
              <p>Tools for capturing and sharing moments from your runs will live here.</p>
            </div>
          </div>
        </main>
      {/if}
    </div>

  <!-- Drop-a-new-log hint (shown only over a loaded report; the stage dropzone has its own highlight). -->
  {#if dragging && status === 'ready'}
    <div class="dropover">
      <div class="dropover-inner">⤓ Drop to analyze a new log</div>
    </div>
  {/if}

  {#if celebration}
    {#key celebration.seq}
      <CelebrationOverlay kind={celebration.kind} stars={celebration.stars} label={celebration.label} />
    {/key}
  {/if}

  {#if statusText}
    <div class="status-toast" role="status" aria-live="polite">{statusText}</div>
  {/if}

  <!-- Floating group chat (bottom-right). Renders nothing unless the user is in ≥1 group; gated on Groups
       being enabled + signed in + a configured backend. -->
  {#if FLAGS.groups && auth.status === 'signed-in' && lfgConfigured()}
    <ChatWidget />
  {/if}

  <!-- Root-level mechanic detail overlay — floats over everything when a mechanic is focused. -->
  <MechanicDetailOverlay />
</div>

<style>
  .shell {
    position: relative;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    isolation: isolate;
    --chrome-panel: rgba(8, 17, 35, 0.82);
    --chrome-panel-strong: rgba(12, 25, 50, 0.94);
    --chrome-line: rgba(143, 171, 222, 0.24);
    --chrome-glow: rgba(39, 136, 255, 0.25);
  }
  .shell::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: 0.28;
    background-image:
      linear-gradient(rgba(103, 56, 239, 0.09) 1px, transparent 1px),
      linear-gradient(90deg, rgba(51, 120, 214, 0.06) 1px, transparent 1px);
    background-size: 72px 72px;
    mask-image: linear-gradient(to bottom, transparent, black 16%, black 84%, transparent);
  }
  .topbar {
    position: relative;
    z-index: 3;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 66px;
    padding: 0 20px;
    border-bottom: 1px solid rgba(143, 171, 222, 0.18);
    background:
      linear-gradient(90deg, rgba(2, 7, 15, 0.96), rgba(8, 17, 35, 0.82) 52%, rgba(2, 7, 15, 0.9)),
      var(--chrome-panel);
    box-shadow:
      0 12px 38px rgba(0, 0, 0, 0.28),
      inset 0 -1px 0 rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(18px);
  }
  .topbar::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      linear-gradient(90deg, transparent 34%, rgba(39, 136, 255, 0.1) 62%, rgba(103, 56, 239, 0.12) 100%),
      var(--chrome-ruins) right -7rem center / auto 10.5rem no-repeat;
    opacity: 0.24;
    mask-image:
      linear-gradient(90deg, transparent 28%, black 58%, black 88%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%);
    mask-composite: intersect;
    -webkit-mask-image:
      linear-gradient(90deg, transparent 28%, black 58%, black 88%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%);
    -webkit-mask-composite: source-in;
  }
  .topbar::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1px;
    pointer-events: none;
    background: linear-gradient(90deg, transparent 10%, rgba(84, 223, 224, 0.36), rgba(138, 92, 255, 0.24), transparent 92%);
  }
  .brand {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    min-width: 0;
    line-height: 0;
  }
  .brand img {
    display: block;
    width: 192px;
    height: auto;
    max-height: 46px;
    object-fit: contain;
    filter:
      drop-shadow(0 0 14px rgba(102, 91, 255, 0.24))
      drop-shadow(0 6px 18px rgba(0, 0, 0, 0.38));
  }
  @media (max-width: 900px) { .brand img { width: 166px; } }
  @media (max-width: 560px) { .brand img { width: 132px; } }
  .beta {
    position: relative;
    z-index: 1;
    margin-left: -4px; cursor: help; user-select: none;
    font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
    color: #d9e6ff; padding: 4px 7px; border-radius: 6px;
    border: 1px solid rgba(143, 171, 222, 0.28);
    background: rgba(3, 8, 18, 0.42);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  /* Live dot (used by the live-watch options modal title). */
  .livedot { width: 8px; height: 8px; border-radius: 999px; background: var(--muted); flex: none; }
  .livedot.pulse { animation: livepulse 1.8s ease-in-out infinite; }
  @keyframes livepulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--good, #4ade80) 60%, transparent); }
    50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--good, #4ade80) 0%, transparent); }
  }

  /* Companion-status section: cordoned-off icon cells (log watch / Group Finder / desktop Capture), each with a
     status dot (green pulse = active, grey = idle). Reuses the livepulse keyframes above. */
  .statusbar {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 2px;
    padding: 3px;
    border: 1px solid rgba(143, 171, 222, 0.22);
    border-radius: 8px;
    background:
      linear-gradient(145deg, rgba(13, 27, 54, 0.62), rgba(5, 12, 27, 0.46)),
      rgba(3, 8, 18, 0.38);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 10px 26px rgba(0, 0, 0, 0.16);
  }
  .statseg {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 30px;
    padding: 0;
    cursor: pointer;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: rgba(231, 237, 249, 0.7);
    transition: color 0.15s, background 0.15s, transform 0.15s, box-shadow 0.15s;
  }
  .statseg:hover {
    color: #fff;
    background: rgba(139, 198, 255, 0.1);
    box-shadow: inset 0 0 0 1px rgba(139, 198, 255, 0.18);
    transform: translateY(-1px);
  }
  .statseg.active {
    color: #fff;
    background:
      linear-gradient(135deg, rgba(103, 56, 239, 0.18), rgba(39, 136, 255, 0.12)),
      rgba(3, 9, 20, 0.48);
    box-shadow: inset 0 0 0 1px rgba(139, 198, 255, 0.18);
  }
  .statico { width: 16px; height: 16px; flex: none; }
  .statdot {
    position: absolute;
    right: 7px;
    bottom: 6px;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgba(118, 131, 157, 0.82);
    border: 1px solid rgba(2, 7, 15, 0.92);
    box-shadow: 0 0 0 1px rgba(248, 251, 255, 0.06);
  }
  .statdot.on { background: var(--good, #4ade80); }
  .statdot.warn { background: var(--bad, #f87171); }
  .statdot.pulse { animation: livepulse 1.8s ease-in-out infinite; }

  /* Live-watch options modal. */
  .live-overlay {
    position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .live-modal {
    width: min(380px, 100%); background: var(--bg, #14161c); color: var(--text);
    border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  }
  .lm-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .lm-title { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; }
  .lm-title .livedot { background: var(--good, #4ade80); }
  .lm-x { background: none; border: none; color: var(--muted); font-size: 15px; cursor: pointer; padding: 4px; }
  .lm-x:hover { color: var(--text); }
  .lm-status { margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: var(--muted); }
  .lm-folder {
    display: flex; align-items: baseline; gap: 8px; margin-bottom: 14px; padding: 8px 10px;
    border-radius: 8px; background: var(--surface-2, rgba(255,255,255,0.03)); border: 1px solid var(--border);
  }
  .lm-flabel { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .lm-fpath { font-size: 12.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lm-actions { display: flex; gap: 8px; }
  .lm-btn {
    flex: 1; background: var(--surface-2, rgba(255,255,255,0.05)); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: 13px; font-weight: 600;
  }
  .lm-btn:hover { border-color: var(--muted); }
  .lm-btn.danger { color: var(--bad, #f87171); border-color: color-mix(in srgb, var(--bad, #f87171) 40%, var(--border)); }
  .lm-btn.danger:hover { border-color: var(--bad, #f87171); }

  .topbar .right { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .status-toast {
    position: fixed;
    left: 50%;
    bottom: calc(22px + env(safe-area-inset-bottom, 0px));
    z-index: 110;
    max-width: min(560px, calc(100vw - 32px));
    transform: translateX(-50%);
    padding: 9px 14px;
    border: 1px solid rgba(143, 171, 222, 0.28);
    border-radius: 8px;
    background: rgba(3, 8, 18, 0.88);
    color: #e7edf9;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(16px);
    font-size: 12.5px;
    font-weight: 700;
    line-height: 1.35;
    text-align: center;
    pointer-events: none;
    animation: statustoastin 0.16s ease-out;
  }
  @keyframes statustoastin {
    from { opacity: 0; transform: translate(-50%, 6px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  @media (prefers-reduced-motion: reduce) { .status-toast { animation: none; } }
  .bugbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 34px;
    background: rgba(3, 8, 18, 0.48); color: rgba(248, 251, 255, 0.88);
    border: 1px solid rgba(165, 184, 226, 0.3);
    border-radius: 8px; padding: 0 12px; cursor: pointer; font-size: 12px; font-weight: 700;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
    transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  }
  .bugbtn:hover {
    color: #fff;
    border-color: var(--hover-accent-border);
    background: rgba(103, 56, 239, 0.18);
    box-shadow: 0 10px 28px rgba(103, 56, 239, 0.2);
    transform: translateY(-1px);
  }
  .bugbtn svg {
    width: 15px;
    height: 15px;
    flex: none;
  }
  @media (max-width: 480px) {
    .topbar {
      gap: 8px;
      padding: 0 12px;
    }
    .brand img { width: 118px; }
    .beta {
      margin-left: -6px;
      padding: 4px 6px;
    }
    .topbar .right {
      flex: 0 0 auto;
      gap: 6px;
    }
    .bugbtn {
      width: 34px;
      padding: 0;
      gap: 0;
    }
    .bugbtn span {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  }
  :global(.topbar .bellbtn),
  :global(.topbar .acctbtn) {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    border-color: rgba(165, 184, 226, 0.3);
    background: rgba(3, 8, 18, 0.48);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
    transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  }
  :global(.topbar .bellbtn:hover),
  :global(.topbar .acctbtn:hover) {
    color: #fff;
    border-color: var(--hover-accent-border);
    background: rgba(103, 56, 239, 0.18);
    box-shadow: 0 10px 28px rgba(103, 56, 239, 0.2);
    transform: translateY(-1px);
  }
  :global(.topbar .bellbtn svg),
  :global(.topbar .acctbtn svg) { width: 16px; height: 16px; }
  /* Wraps the AccountMenu + its first-time share-stats hint popover. */
  .gearwrap { position: relative; display: inline-flex; }
  .hint {
    position: absolute; top: calc(100% + 9px); right: 0; z-index: 70;
    width: 260px; padding: 10px 28px 10px 12px; border-radius: 8px;
    background: var(--surface-2); border: 1px solid rgba(78, 161, 255, 0.4);
    box-shadow: 0 10px 26px rgba(0,0,0,0.5);
    font-size: 12px; line-height: 1.5; color: var(--text); font-weight: 400;
    /* Informational only — never swallow clicks meant for the account dropdown it sits under (the
       dropdown is z-index 80, so it also paints over this). The ✕ re-enables pointer events. */
    pointer-events: none;
  }
  .hint b { font-weight: 700; }
  .hint::before {
    content: ''; position: absolute; top: -6px; right: 9px; width: 10px; height: 10px;
    background: var(--surface-2); border-left: 1px solid rgba(78, 161, 255, 0.4); border-top: 1px solid rgba(78, 161, 255, 0.4);
    transform: rotate(45deg);
  }
  .hint-x {
    position: absolute; top: 5px; right: 6px; width: 18px; height: 18px; border: none; border-radius: 50%;
    background: none; color: var(--muted); font-size: 11px; cursor: pointer; line-height: 1;
    pointer-events: auto; /* keep the dismiss button clickable even though the hint body is click-through */
  }
  .hint-x:hover { color: var(--text); }
  .gear-inline { white-space: nowrap; color: var(--accent); font-weight: 600; }


  /* Run picker — topbar global selector, shown only for multi-run (multi-key) logs. */
  .topbar-run { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; margin-left: 4px; }
  .runsel { display: flex; align-items: center; gap: 8px; }
  .runsel select {
    min-height: 34px;
    background: rgba(3, 8, 18, 0.48); color: var(--text); border: 1px solid rgba(165, 184, 226, 0.3);
    border-radius: 8px; padding: 6px 10px; font-size: 13px; max-width: 320px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  /* Workspace: activity rail | fold-out sidebar | replay stage. */
  .workspace {
    position: relative;
    z-index: 1;
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 14px;
    padding: 14px;
    background:
      linear-gradient(to bottom, rgba(2, 7, 15, 0.1), rgba(2, 7, 15, 0.62)),
      radial-gradient(circle at 88% 64%, rgba(18, 129, 255, 0.12), transparent 24rem);
  }

  /* Activity rail. */
  .rail {
    position: relative;
    flex: none;
    width: 252px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    overflow-y: auto;
    border: 1px solid rgba(143, 171, 222, 0.26);
    border-radius: 8px;
    background:
      linear-gradient(145deg, rgba(13, 27, 54, 0.88), rgba(5, 12, 27, 0.82)),
      rgba(8, 17, 35, 0.76);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(18px);
  }
  .rail::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background:
      linear-gradient(145deg, rgba(4, 10, 22, 0.28), rgba(2, 7, 15, 0.7)),
      linear-gradient(180deg, rgba(39, 136, 255, 0.09), transparent 26%),
      linear-gradient(135deg, rgba(103, 56, 239, 0.18), transparent 48%),
      var(--chrome-ruins) center center / auto 118% no-repeat;
    opacity: 0.42;
    mask-image:
      linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, black 8%, black 82%, transparent 100%);
    mask-composite: intersect;
    -webkit-mask-image:
      linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, black 8%, black 82%, transparent 100%);
    -webkit-mask-composite: source-in;
  }
  .rail::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.07), transparent 38%, rgba(84, 223, 224, 0.09));
    opacity: 0.72;
  }
  .railsec {
    position: relative;
    z-index: 1;
  }

  .railsec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .secheader {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 62px;
    padding: 10px;
    cursor: pointer;
    text-align: left;
    border: 1px solid rgba(143, 171, 222, 0.16);
    border-radius: 8px;
    color: #dce5f4;
    background:
      linear-gradient(180deg, rgba(8, 18, 38, 0.74), rgba(3, 9, 20, 0.5)),
      rgba(3, 9, 20, 0.42);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    transition:
      background 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease,
      transform 160ms ease;
  }
  .secheader:hover {
    border-color: rgba(138, 92, 255, 0.55);
    background:
      linear-gradient(180deg, rgba(13, 27, 54, 0.84), rgba(3, 9, 20, 0.58)),
      rgba(103, 56, 239, 0.1);
    transform: translateY(-1px);
  }
  .secheader.active {
    border-color: rgba(164, 93, 255, 0.66);
    background:
      linear-gradient(145deg, rgba(103, 56, 239, 0.24), rgba(8, 18, 38, 0.76)),
      rgba(8, 18, 38, 0.72);
    box-shadow:
      0 0 0 1px rgba(160, 91, 255, 0.1),
      0 22px 72px rgba(103, 56, 239, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }
  .secheader.active::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    border-radius: 8px 0 0 8px;
    background: linear-gradient(to bottom, #8a5cff, #2788ff 58%, #54dfe0);
    box-shadow: 0 0 18px rgba(138, 92, 255, 0.36);
  }
  .sec-step {
    min-width: 38px;
    color: #8b5cf6;
    font-size: 28px;
    font-weight: 800;
    line-height: 0.95;
  }
  .secheader.active .sec-step {
    color: transparent;
    background: linear-gradient(135deg, #b86cff 0%, #7b55ff 45%, #238cff 100%);
    background-clip: text;
    -webkit-background-clip: text;
  }
  .sec-copy {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .sec-ico {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: #91bfff;
    background: rgba(39, 136, 255, 0.14);
  }
  .sec-ico svg { width: 16px; height: 16px; display: block; }
  /* Learn's custom "m-book" mark: an SVG file tinted with currentColor via mask (so it shares the
     other section icons' color/hover treatment). Wider aspect ratio than the 16px stroke icons. */
  .sec-ico-img {
    width: 20px;
    height: 16px;
    display: block;
    background: currentColor;
    -webkit-mask: var(--mbook) center / contain no-repeat;
    mask: var(--mbook) center / contain no-repeat;
  }
  .railsec:nth-of-type(4) .sec-ico {
    color: #57e2e4;
    background: rgba(31, 155, 196, 0.18);
  }
  .sec-lbl {
    min-width: 0;
    overflow: hidden;
    color: #f8fbff;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sec-chev {
    flex: none;
    color: rgba(170, 181, 202, 0.74);
    font-size: 11px;
    transition: transform 160ms ease, color 160ms ease;
  }
  .secheader:hover .sec-chev,
  .secheader.active .sec-chev {
    color: #dce5f4;
  }
  .sec-chev.open { transform: rotate(90deg); }

  .secitems {
    display: grid;
    gap: 5px;
  }
  .railbtn {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 36px;
    padding: 6px 10px;
    cursor: pointer;
    text-align: left;
    border: 1px solid rgba(143, 171, 222, 0.12);
    border-radius: 8px;
    color: #d7dfed;
    background: rgba(3, 9, 20, 0.42);
    transition:
      background 160ms ease,
      border-color 160ms ease,
      color 160ms ease,
      transform 160ms ease;
  }
  .railbtn::before,
  .railbtn::after {
    content: none;
  }
  .rail-ico {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 8px;
    color: #91bfff;
    background: rgba(39, 136, 255, 0.12);
  }
  .rail-ico svg { width: 14px; height: 14px; display: block; }
  .rail-lbl {
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
    font-weight: 650;
    line-height: 1.3;
    letter-spacing: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .railbtn:hover {
    color: #ffffff;
    border-color: rgba(138, 92, 255, 0.55);
    background: rgba(103, 56, 239, 0.16);
    transform: translateY(-1px);
  }
  .railbtn.active {
    color: #ffffff;
    border-color: rgba(138, 92, 255, 0.62);
    background:
      linear-gradient(135deg, rgba(103, 56, 239, 0.18), rgba(39, 136, 255, 0.1)),
      rgba(3, 9, 20, 0.58);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }
  .railbtn.active .rail-ico {
    color: #57e2e4;
    background: rgba(31, 155, 196, 0.18);
    filter: none;
  }

  @media (max-width: 1100px) {
    .workspace { gap: 10px; padding: 10px; }
    .rail { width: 216px; padding: 14px 12px; }
    .secheader { min-height: 62px; padding: 10px; gap: 10px; }
    .sec-step { min-width: 36px; font-size: 26px; }
    .sec-lbl { font-size: 14px; }
    .railbtn { min-height: 38px; }
  }

  @media (max-width: 980px) {
    .rail {
      width: 76px;
      align-items: stretch;
      padding: 10px 8px;
    }
    .sec-step,
    .sec-lbl,
    .sec-chev,
    .rail-lbl {
      display: none;
    }
    .secheader {
      grid-template-columns: 1fr;
      min-height: 48px;
      padding: 8px;
      place-items: center;
    }
    .sec-copy {
      justify-content: center;
    }
    .sec-ico {
      width: 32px;
      height: 32px;
    }
    .secitems {
      display: grid;
      gap: 6px;
    }
    .railbtn {
      grid-template-columns: 1fr;
      min-height: 38px;
      padding: 7px;
      place-items: center;
    }
    .rail-ico {
      width: 28px;
      height: 28px;
    }
  }

  /* Fold-out sidebar holding the active panel. */
  .sidebar {
    flex: none; position: relative; overflow: hidden;
    background:
      linear-gradient(145deg, rgba(13, 27, 54, 0.82), rgba(5, 12, 27, 0.78)),
      rgba(8, 17, 35, 0.72);
    border: 1px solid rgba(143, 171, 222, 0.22);
    border-radius: 8px;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(18px);
    transition: width 0.16s ease;
  }
  .sidebar:not(.open) { border: 0; box-shadow: none; }
  .side-inner { height: 100%; display: flex; flex-direction: column; }
  .side-head {
    flex: none; display: flex; align-items: center; justify-content: space-between;
    min-height: 52px;
    padding: 10px 10px 10px 16px;
    border-bottom: 1px solid rgba(143, 171, 222, 0.2);
    background:
      linear-gradient(90deg, rgba(13, 27, 54, 0.82), rgba(5, 12, 27, 0.58)),
      rgba(8, 17, 35, 0.72);
    box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.03);
  }
  .side-title { font-size: 12px; font-weight: 850; text-transform: uppercase; letter-spacing: 0.1em; color: #e7edf9; }
  .side-x {
    background: rgba(3, 8, 18, 0.45); color: rgba(170, 181, 202, 0.84); border: 1px solid rgba(143, 171, 222, 0.24);
    border-radius: 8px; width: 30px; height: 28px; cursor: pointer; font-size: 11px; line-height: 1;
    transition: color 0.15s, border-color 0.15s, background 0.15s, transform 0.15s;
  }
  .side-x:hover { color: #fff; border-color: var(--hover-accent-border); background: rgba(13, 27, 54, 0.78); transform: translateY(-1px); }
  .side-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 16px; }
  /* Resize handle on the sidebar's right edge. */
  .rz {
    position: absolute; top: 0; right: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 3;
    touch-action: none;
  }
  .rz:hover, .rz.active { background: color-mix(in srgb, var(--accent) 45%, transparent); }

  /* Non-Review section main windows (Groups / desktop Capture) fill the same area the sidebar+stage occupy. */
  .sectionpane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    margin: 0;
    border: 1px solid rgba(143, 171, 222, 0.2);
    border-radius: 8px;
    background-color: var(--bg);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24);
  }
  /* Groups main window reuses the stage backdrop (`.stage-bg`/`.stage-art`/`.stage-veil`, below): a
     relative box clips the absolute art, and the scroll layer floats GroupsView above the veil. */
  .groupstage { position: relative; }
  .groupstage-scroll { position: relative; z-index: 1; height: 100%; }
  .comingsoon { height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .cs-card { max-width: 460px; text-align: center; }
  .cs-card h2 { margin: 0 0 10px; font-size: 22px; font-weight: 800; }
  .cs-card p { margin: 0 0 16px; color: var(--muted); font-size: 14px; line-height: 1.6; }
  /* The replay main stage. An ambient artwork crossfades behind a dark veil so it reads as atmosphere,
     not clutter. Structure: a pinned `.stage-bg` (two crossfading `.stage-art` layers + a darken/vignette
     `.stage-veil`) behind a scrolling `.stage-scroll` that holds the dropzone / loader / replay. The art
     uses `background-attachment: fixed` (viewport-anchored) so resizing/collapsing the sidebar — which
     changes the stage WIDTH — never rescales it; `.stage-bg` is `overflow:hidden` so it clips to the box. */
  .stage {
    position: relative;
    flex: 1; min-width: 0; min-height: 0; overflow: hidden;
    margin: 0; /* override the global `main { margin: 12px }` (diagnostic-inspector rule) — that was the edge gap */
    border: 1px solid rgba(143, 171, 222, 0.2);
    border-radius: 8px;
    background-color: var(--bg);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24);
  }
  .stage-bg { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
  .stage-art {
    position: absolute; inset: 0;
    background-position: center top; background-repeat: no-repeat;
    background-size: cover; background-attachment: fixed;
    opacity: 0; transition: opacity 1.6s ease;
  }
  .stage-art.show { opacity: 1; }
  .stage-veil {
    position: absolute; inset: 0;
    background:
      radial-gradient(120% 120% at 68% 18%, rgba(39, 136, 255, 0.24), transparent 32rem),
      radial-gradient(110% 120% at 16% 86%, rgba(138, 92, 255, 0.2), transparent 30rem),
      radial-gradient(135% 130% at 50% 0%, transparent 54%, var(--bg) 100%),
      linear-gradient(180deg, rgba(2, 7, 15, 0.78) 0%, rgba(2, 7, 15, 0.9) 58%, rgba(2, 7, 15, 0.96) 100%);
  }
  .stage-scroll { position: relative; z-index: 1; height: 100%; overflow-y: auto; }
  /* The dropzone / loader states fill the stage and center their card. */
  .stage-state { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 18px; }
  @media (prefers-reduced-motion: reduce) { .stage-art { transition: none; } }
  /* The replay's section padding + its player mini-cards (which reuse the generic `.card` class) —
     ported from the old bottom drawer so the stage replay keeps its compact chrome. */
  .stage :global(.section) { padding: 12px 16px; }
  .stage :global(.cards .card) {
    padding: 6px 8px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--border);
  }

  /* Drop zone */
  .drop {
    border: 1px dashed rgba(165, 184, 226, 0.36);
    border-radius: 8px;
    padding: 38px 28px;
    text-align: center;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
    width: min(620px, 100%);
    background: rgba(8, 17, 35, 0.74);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 24px 80px rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(16px);
  }
  .drop.over {
    border-color: var(--accent);
    background: rgba(12, 25, 50, 0.88);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.07),
      0 24px 80px rgba(0, 0, 0, 0.34),
      0 0 0 3px rgba(84, 223, 224, 0.12);
  }
  .drop-inner { display: flex; flex-direction: column; align-items: center; gap: 7px; }
  /* Brand logo on the dropzone, with the BETA pill directly beneath so it reads "MythicIQ / BETA". */
  .herologo { width: min(320px, 82%); height: auto; filter: drop-shadow(0 6px 24px rgba(0, 0, 0, 0.55)); }
  .beta-pill {
    display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.12em;
    color: var(--accent); padding: 2px 9px; border-radius: 999px; margin: 2px 0 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .last-update {
    margin: 6px 0 0; display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; color: var(--muted, #9aa4b2); cursor: default;
  }
  .pulse {
    width: 7px; height: 7px; border-radius: 999px; background: #4ade80;
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6); animation: pulse 2.4s ease-out infinite;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5); }
    70% { box-shadow: 0 0 0 6px rgba(74, 222, 128, 0); }
    100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
  }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
  .big { font-size: 22px; font-weight: 800; letter-spacing: 0; }
  .side-empty { padding: 24px 16px; font-size: 13px; line-height: 1.5; }
  .dropbtns { margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .filebtn {
    display: inline-flex; align-items: center; justify-content: center; min-height: 40px;
    cursor: pointer;
    background: linear-gradient(135deg, #8b5cf6, #0678ff);
    color: #ffffff;
    font-weight: 700;
    padding: 0 18px;
    border-radius: 8px;
    font-size: 14px;
    border: 1px solid transparent;
    line-height: 1;
    text-decoration: none;
    box-shadow: 0 18px 40px rgba(36, 108, 255, 0.24);
    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  }
  .filebtn:hover { transform: translateY(-1px); filter: brightness(1.06); }
  .filebtn.ghost {
    background: rgba(3, 8, 18, 0.5);
    color: var(--text);
    border-color: rgba(165, 184, 226, 0.32);
    box-shadow: none;
  }
  .filebtn.ghost:hover {
    border-color: var(--hover-accent-border);
    box-shadow: 0 14px 34px rgba(103, 56, 239, 0.2);
    filter: none;
  }
  .filebtn.ghost:disabled { opacity: 0.6; cursor: default; }

  /* Drop-a-new-log banner over a loaded report. Fixed + pointer-events:none so the drop event still
     reaches the shell-root handler wherever the cursor is. */
  .dropover {
    position: fixed; inset: 0; z-index: 40;
    background: rgba(14, 17, 22, 0.72); backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center; pointer-events: none;
  }
  .dropover-inner {
    border: 2px dashed var(--accent); color: var(--text); border-radius: 14px;
    padding: 26px 40px; font-size: 19px; font-weight: 600; background: rgba(78, 161, 255, 0.08);
  }

  /* Parse loader card (in the stage): brand logo + per-phase progress bars. */
  .loadcard {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    width: min(440px, 92vw); text-align: center;
  }
  .loadtext { font-size: 16px; font-weight: 700; }
  .phases { width: 100%; display: flex; flex-direction: column; gap: 12px; margin: 6px 0 2px; }
  .phase { display: flex; flex-direction: column; gap: 5px; transition: opacity 0.2s; }
  .phase-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; }
  .phase-lbl { color: var(--text); font-weight: 600; }
  .phase-pct { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--muted); }
  .phase.done .phase-pct { color: var(--good, #5fd08a); font-weight: 700; }
  .phase-track { height: 7px; border-radius: 4px; background: var(--surface-2, rgba(255,255,255,0.08)); overflow: hidden; }
  .phase-fill {
    height: 100%; border-radius: 4px; background: var(--accent);
    transition: width 0.25s ease; min-width: 0;
  }
  .phase.done .phase-fill { background: var(--good, #5fd08a); }
</style>
