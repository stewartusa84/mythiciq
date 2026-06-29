# Desktop companion app (Tauri) — Tier 0 built (on `desktop-companion`)

**Status:** Tier 0 **implemented** on the `desktop-companion` branch — a Tauri shell that watches the
WoW logs folder, carves each completed M+ run, and auto-analyzes it through the existing web frontend +
WASM worker. Builds/typechecks green; runnable locally via `pnpm --filter @wow/app desktop:dev`.
**Distribution stays deferred** (no funding for code-signing/notarization + the auto-updater yet — see
"Distribution" below), so this branch is NOT shipped to users; it's a working local companion. Web app
stays primary. See "Tier-0 implementation" below for the exact wiring.

## Why this is a good fit for *this* project (not generic "desktop is nicer")

Three wins are specific to MythicIQ's architecture:

1. **The parser is already Rust.** Today it's a `wasm32` cdylib in a Worker, zero-copying into JS
   typed arrays. wasm32 has a hard ~4GB linear-memory ceiling and is effectively single-threaded; a
   238MB log at ~99 MB/s already brushes the `<2s` perf contract. A native host build (parser-core as
   an `rlib`) lifts the ceiling, opens up `rayon`, and could `mmap` the file instead of the
   `LineIndex` re-scan.
2. **Live log tailing — the feature the web app structurally cannot have.** Tail
   `WoWCombatLog-*.txt`, emit each run the instant its `CHALLENGE_MODE_END` lands, parse + notify
   ("Pit of Saron +12 — timed ★★, 3 missed kicks"). No drag-drop, no upload, no re-importing a 239MB
   file. The browser File API can't watch a directory; this is a UX category the site can't reach.
   **This is the actual point of going desktop.**
3. **The frontend ports nearly free.** Tauri runs the existing Svelte/Vite build in a webview, so the
   whole `@wow/app` MVP comes along.

## Already started: the `carve` crate

`packages/app/src-tauri/carve/` is a pure, dependency-free streaming run-carver — the Tier-0
ingestion path. `RunCarver::push_bytes(chunk)` accepts arbitrary byte chunks (e.g. each file-growth
event) and returns runs that COMPLETED in that chunk: it buffers `CHALLENGE_MODE_START..=END`
(inclusive), prepends the leading `COMBAT_LOG_VERSION` header so each slice is a STANDALONE sub-log
(the TS engine decides field layout per-line by field count — see `src/mvp/runExtract.ts`), and emits
only on `END` (so a run is picked up exactly once it's done; a re-rolled key with no END is dropped).
Kept out of the `tauri`/`notify` dependency graph so it unit-tests standalone:
`cargo test --manifest-path packages/app/src-tauri/carve/Cargo.toml`.

## The one real architectural trap

The **non-negotiable perf contract** — "never serialize per-event across the boundary" — applies to
the WASM↔JS internal path. In Tauri the webview is NOT in the host's address space, and Tauri IPC
serializes. So the naive "parse natively, send events up to the webview" **violates the contract** —
you cannot just move the parser to the host and pipe events.

The saving grace: `RunReport` / `FullReport` are ALREADY small, structured-cloneable, and
serialization-friendly (they cross the Worker boundary today). The contract bans per-*event*
serialization, not the analytics *output*. So the boundary is a bounded problem, not a blocker.

## Scope tiers — pick deliberately

| Tier | Scope | Reuse | Cost |
| --- | --- | --- | --- |
| **0 (recommended start)** | Tauri = native shell around the EXISTING web frontend + WASM worker, unchanged. Add: native file dialog, live tailing (`carve` → Tauri command → feed carved sub-logs into the CURRENT WASM `parse()` path), OS notifications. | ~100% | Low |
| 1 | + native parse (parser-core as host `rlib`, hand columns to the webview via a shared buffer). Beats the 4GB ceiling, faster on huge logs. | High | Re-plumbs the zero-copy seam |
| 2 | + analytics in native Rust too. **Don't** — full rewrite of the TS engine. | Low | Huge |

**Tier 0 is the move.** Almost entirely additive, keeps ONE codebase (web + desktop share
engine/app), and delivers the live-companion UX without touching the zero-copy contract. The `carve`
crate is exactly the Tier-0 ingestion path. Tier 1 is a fast-follow ONLY if real 250MB+ logs choke
the webview's memory — profile before committing.

### Tier-0 implementation (built)

The shell lives in `packages/app/src-tauri/` (a Tauri v2 app beside the existing `carve/` crate). The
golden rule held: **zero `parser-core`/engine/analytics changes** — only native watching + carving was
added; everything else is the unchanged web app running in a webview.

**Native (`src-tauri/src/watch.rs`)** — Tauri commands + a poll-based watcher:
- `default_log_dir()` → the standard retail Logs path if present (probes common drives).
- `start_watching(dir)` → seeds a `RunCarver`, **backfills** by reading the active
  `WoWCombatLog-*.txt` from offset 0 (emits every already-completed run), then fires
  `backfill-complete {count}` and attaches a `notify::PollWatcher` (1.5s interval — robust for tailing
  an actively-written file; also picks up log rotation on relog). On each growth it reads the appended
  bytes, runs `RunCarver::push_bytes`, and emits a `run-carved` event per completed run.
- Each `run-carved` carries lightweight headline metadata (`dungeon`/`level`/`success`/`durationMs`)
  parsed from the run's CHALLENGE_MODE_START/END lines, so the UI can toast/notify **without** fetching
  or parsing the full sub-log. The bytes sit in a state map keyed by `id`.
- `take_carved_run(id)` returns the sub-log bytes as a **raw `tauri::ipc::Response`** (not JSON — a
  multi-MB run would balloon as a JSON number array). This is the one bounded boundary crossing per
  run; the perf contract (no per-*event* serialization) is intact, identical to a history open today.
- `stop_watching()` drops the watcher.

**Tray + close-to-tray (`src-tauri/src/tray.rs` + main.rs, `tauri` `tray-icon` feature)** — a companion
should keep watching during a session, so the window's close (X) is intercepted (`CloseRequested` →
`prevent_close()` + `hide()`) and minimizes to the system tray rather than quitting; the webview stays
alive so watching continues. A tray icon restores it (left-click / "Show MythicIQ") and "Quit" is the
only real exit.

**Frontend seam (`src/mvp/desktop.ts`, `watchStore.svelte.ts`)** — the ONLY place the
app touches Tauri, all dynamic-imported + `isDesktop()`-guarded so the web build stays inert (the JS
deps fall into tiny lazy chunks). `App.svelte`:
- On mount (desktop only) subscribes to `run-carved`/`backfill-complete` and auto-starts watching the
  remembered folder (or the detected default).
- A **serial queue** feeds each carved run's bytes → `new File(...)` → `carveToHistory` (SILENT parse +
  awaited `persistRuns` → compressed sub-log + cached side-pane report in local history). Runs are
  **never auto-opened** into the viewer — they're saved + surfaced as a **card on the notifications
  bell** (`watch.addRun(...)`), and clicking the card re-opens the run from history.
- Notification routing is **foreground-aware** (`isAppForeground()` = webview `visibilityState ===
  'visible' && document.hasFocus()`, no Tauri perms): FOREGROUND → just the bell card; BACKGROUND (tray /
  minimized / behind WoW) → **never raise the window over the game**, also a Windows corner **OS
  notification** ("MythicIQ — new run"). One worker = one resident store, so serializing parses is
  deliberate.
- A topbar **Live** pill (green pulsing dot + "Live") shows watch state; clicking it opens a small
  options modal with the current folder + Change folder / Stop watching.

**Build/run:** `pnpm --filter @wow/app desktop:dev` (Tauri runs `vite --mode desktop` on :5175 in a webview),
`desktop:build` (bundles after `vite build`; run `pnpm build:wasm` first, same as the web build). Desktop
icons/favicons are generated from `packages/assets/img/mythiciq-m-round.png` (real alpha outside the
medallion, no baked checkerboard): pad it into a transparent square source, run `tauri icon` for
`src-tauri/icons/`, then mirror the same mark into `public/favicon-*`, `public/apple-touch-icon.png`,
and `public/favicon.ico`. `src-tauri/build.rs` explicitly watches the configured icon files so a desktop
rebuild refreshes the embedded tray/taskbar/window icon resources.

## Distribution (still deferred — the reason this isn't shipped)

The CODE is done for Tier 0; **shipping it to users** is what's gated:
- **The web app stays primary** — zero-install on-ramp, shareable link, drive-by user. Desktop is a
  companion IN ADDITION TO the site, not a replacement. "App and site all in one" isn't fully
  achievable: Tauri can't *be* the site.
- **Distribution tax:** Windows code-signing cert (~$200–400/yr, else users get SmartScreen
  warnings), Apple notarization ($99/yr) for Mac, plus the Tauri auto-updater to wire + maintain.
  Ongoing cost, unlike `git push` = deploy. **No budget yet — gated on donations.** Until then the
  branch stays a working LOCAL companion (build + run it yourself), not a release.

## Next (when funded / if pursued further)
- **Idle memory** — shipped default: a minute after the tray X hides the window, the parse worker is
  terminated to release its WASM store (measured ~600→140MB webview2, ~68→2MB host; re-parses ~1–2s on
  reopen). A further step (destroy-and-recreate the window to reclaim the residual baseline) + the
  rebuttal to "why 68 MB?" are in [desktop-memory.md](desktop-memory.md).
- Code-signing + `tauri-plugin-updater` for real distribution.
- Tier 1 (native parse via `parser-core` as an `rlib`) ONLY if real 250MB+ logs choke the webview's
  memory — profile first.
- Optionally surface the run headline ("3 missed kicks") in the notification by reusing the parsed
  report once a 2nd worker (or a cheap headline pass) makes background analysis non-disruptive.
