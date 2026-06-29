//! Watch the WoW logs folder and carve completed M+ runs out of the live-growing combat log.
//!
//! This is the ONLY native logic in the Tier-0 desktop shell. It does NOT parse or analyze — it just
//! tails the newest `WoWCombatLog-*.txt`, feeds appended bytes through the dependency-free
//! [`carve::RunCarver`], and hands each completed run's standalone sub-log BYTES to the webview, which
//! runs them through the exact same WASM parse path the web app uses (see `src/mvp/desktop.ts`). The
//! perf contract ("never serialize per-event across a boundary") is respected: only the bounded
//! sub-log bytes cross once per run, exactly like opening a run from local history does today.
//!
//! Why `PollWatcher` and not the OS-native recommended watcher: log tailing wants robust, snapshot
//! based growth detection. ReadDirectoryChangesW can coalesce or miss rapid appends to an
//! actively-written file; a short-interval poll reliably sees the file grow and we always re-tail the
//! NEWEST matching file, so log rotation (a relog mid-session) is handled for free.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use carve::{CarveKind, RunCarver};
use notify::{Config, PollWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// Poll the watched directory this often. Correctness over latency — a couple of seconds after a key
/// completes is fine for a post-run companion.
const POLL_INTERVAL: Duration = Duration::from_millis(1500);

/// Carved-run byte buffer, drained by [`take_carved_run`]. Bytes live here only between the
/// `run-carved` event and the webview fetching them (immediately), so it stays small in practice.
#[derive(Default)]
pub struct CarvedStore {
    runs: HashMap<u64, Vec<u8>>,
    next_id: u64,
}

/// Per-file tail position + the streaming carver for the file currently being followed.
struct Tailer {
    dir: PathBuf,
    current: Option<PathBuf>,
    offset: u64,
    carver: RunCarver,
}

#[derive(Default)]
pub struct WatchState {
    store: Mutex<CarvedStore>,
    /// The live poll watcher; `None` when not watching. Dropping it stops watching.
    watcher: Mutex<Option<PollWatcher>>,
    tailer: Mutex<Option<Tailer>>,
}

/// Emitted (`run-carved`) for every completed run OR raid pull. Carries lightweight headline metadata
/// parsed from the carve's START/END lines so the webview can show a toast/notification WITHOUT
/// fetching or parsing the full sub-log; `id` fetches the bytes via [`take_carved_run`] on demand.
/// `kind` routes M+ runs (the notifications bell) vs raid pulls (the boss-grouped Pulls feed).
#[derive(Clone, Serialize)]
struct RunCarvedEvent {
    id: u64,
    #[serde(rename = "fileName")]
    file_name: String,
    lines: usize,
    /// `"mplus"` (CHALLENGE_MODE run) or `"raid-encounter"` (a single raid boss pull).
    kind: &'static str,
    /// True for runs already present in the file when watching started (initial backfill scan).
    backfill: bool,
    /// M+ dungeon name (CHALLENGE_MODE_START) — None for raid pulls.
    dungeon: Option<String>,
    /// M+ keystone level — None for raid pulls.
    level: Option<i64>,
    /// Raid boss name (ENCOUNTER_START) — None for M+ runs.
    #[serde(rename = "bossName")]
    boss_name: Option<String>,
    /// Run/pull outcome: M+ key success, or raid kill (true) / wipe (false).
    success: Option<bool>,
    #[serde(rename = "durationMs")]
    duration_ms: Option<i64>,
}

#[derive(Clone, Serialize)]
struct BackfillDoneEvent {
    count: usize,
}

/// Standard retail Logs locations, probed in order. Returns the first that exists.
#[tauri::command]
pub fn default_log_dir() -> Option<String> {
    const CANDIDATES: &[&str] = &[
        r"C:\Program Files (x86)\World of Warcraft\_retail_\Logs",
        r"C:\Program Files\World of Warcraft\_retail_\Logs",
        r"D:\Program Files (x86)\World of Warcraft\_retail_\Logs",
        r"D:\World of Warcraft\_retail_\Logs",
        r"D:\Games\World of Warcraft\_retail_\Logs",
        r"E:\World of Warcraft\_retail_\Logs",
    ];
    CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_dir())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Begin watching `dir`. Backfills every completed run already in the active log file, then follows it
/// for new completions. Replaces any existing watch.
#[tauri::command]
pub fn start_watching(app: AppHandle, state: State<WatchState>, dir: String) -> Result<(), String> {
    let dirp = PathBuf::from(&dir);
    if !dirp.is_dir() {
        return Err(format!("not a directory: {dir}"));
    }

    // Tear down any existing watch first. Drop any carved bytes not yet fetched — a fresh backfill
    // re-scans the active file from the top and re-emits them, so undrained entries (e.g. runs carved
    // while the webview was unloaded in low-resource mode) would otherwise leak in the buffer.
    *state.watcher.lock().unwrap() = None;
    state.store.lock().unwrap().runs.clear();
    *state.tailer.lock().unwrap() = Some(Tailer {
        dir: dirp.clone(),
        current: None,
        offset: 0,
        carver: RunCarver::new(),
    });

    // Initial backfill scan (reads the active file from the start), then announce the count.
    let count = tail(&app, true);
    let _ = app.emit("backfill-complete", BackfillDoneEvent { count });

    // Follow the directory for growth.
    let app2 = app.clone();
    let mut watcher = PollWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                tail(&app2, false);
            }
        },
        Config::default().with_poll_interval(POLL_INTERVAL),
    )
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&dirp, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn stop_watching(state: State<WatchState>) {
    *state.watcher.lock().unwrap() = None;
    *state.tailer.lock().unwrap() = None;
}

/// Remove and return a carved run's sub-log bytes as a RAW IPC response (not JSON) — a multi-MB run
/// would balloon as a JSON number array, so we use `tauri::ipc::Response`.
#[tauri::command]
pub fn take_carved_run(state: State<WatchState>, id: u64) -> Result<tauri::ipc::Response, String> {
    let mut store = state.store.lock().unwrap();
    match store.runs.remove(&id) {
        Some(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        None => Err(format!("no carved run {id}")),
    }
}

/// Read any newly-appended bytes from the newest matching log file, carve completed runs, and emit a
/// `run-carved` event for each. Returns how many runs were emitted. Safe to call repeatedly.
fn tail(app: &AppHandle, backfill: bool) -> usize {
    let state = app.state::<WatchState>();
    let mut tguard = state.tailer.lock().unwrap();
    let Some(tailer) = tguard.as_mut() else {
        return 0;
    };

    let Some(path) = newest_log(&tailer.dir) else {
        return 0;
    };

    // Log rotation (relog → a newer file): restart the carver on the new file.
    if tailer.current.as_deref() != Some(path.as_path()) {
        tailer.current = Some(path.clone());
        tailer.offset = 0;
        tailer.carver = RunCarver::new();
    }

    let len = match std::fs::metadata(&path) {
        Ok(m) => m.len(),
        Err(_) => return 0,
    };
    // File shrank/replaced under us — restart from the top.
    if len < tailer.offset {
        tailer.offset = 0;
        tailer.carver = RunCarver::new();
    }
    if len <= tailer.offset {
        return 0; // no growth
    }

    let to_read = (len - tailer.offset) as usize;
    let mut buf = vec![0u8; to_read];
    let read_ok = (|| -> std::io::Result<()> {
        let mut f = File::open(&path)?;
        f.seek(SeekFrom::Start(tailer.offset))?;
        f.read_exact(&mut buf)
    })();
    if read_ok.is_err() {
        // The file changed between the metadata read and the read; leave the offset and retry next tick.
        return 0;
    }
    tailer.offset = len;

    let runs = tailer.carver.push_bytes(&buf);
    if runs.is_empty() {
        return 0;
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("run.txt")
        .to_string();

    let mut emitted = 0;
    for run in runs {
        // Headline fields differ by bracket: M+ runs read CHALLENGE_MODE_START/END; raid pulls read
        // ENCOUNTER_START/END. The webview also re-derives rich metadata from the parsed report, so
        // this is just the cheap pre-parse toast/feed label.
        let (kind, dungeon, level, boss_name, success, duration_ms) = match run.kind {
            CarveKind::Mplus => {
                let (dungeon, level, success, duration_ms) = run_meta(&run.bytes);
                ("mplus", dungeon, level, None, success, duration_ms)
            }
            CarveKind::RaidEncounter => {
                let (boss_name, success) = encounter_meta(&run.bytes);
                ("raid-encounter", None, None, boss_name, success, None)
            }
        };
        let id = {
            let mut store = state.store.lock().unwrap();
            let id = store.next_id;
            store.next_id += 1;
            store.runs.insert(id, run.bytes);
            id
        };
        let _ = app.emit(
            "run-carved",
            RunCarvedEvent {
                id,
                file_name: file_name.clone(),
                lines: run.lines,
                kind,
                backfill,
                dungeon,
                level,
                boss_name,
                success,
                duration_ms,
            },
        );
        emitted += 1;
    }
    emitted
}

/// The newest (latest-modified) `WoWCombatLog-*.txt` in `dir`, if any.
fn newest_log(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("WoWCombatLog") && n.ends_with(".txt"))
                .unwrap_or(false)
        })
        .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
}

/// Pull headline fields out of a carved run's bytes: dungeon name + keystone level from
/// CHALLENGE_MODE_START, success + total time from CHALLENGE_MODE_END. Cheap — it locates just those
/// two lines (START is near the front, END is the last line) rather than decoding the whole run.
fn run_meta(bytes: &[u8]) -> (Option<String>, Option<i64>, Option<bool>, Option<i64>) {
    let mut dungeon = None;
    let mut level = None;
    let mut success = None;
    let mut duration_ms = None;

    if let Some(line) = extract_line(bytes, b"CHALLENGE_MODE_START") {
        let f = line_fields(&line);
        // CHALLENGE_MODE_START,"Dungeon",mapId,challengeId,keystoneLevel,[affixes]
        dungeon = f.get(1).cloned().filter(|s| !s.is_empty());
        level = f.get(4).and_then(|s| s.trim().parse().ok());
    }
    if let Some(line) = extract_line(bytes, b"CHALLENGE_MODE_END") {
        let f = line_fields(&line);
        // CHALLENGE_MODE_END,mapId,success,keystoneLevel,totalTimeMs,runScore,overallRating
        success = f.get(2).map(|s| s.trim() == "1");
        duration_ms = f.get(4).and_then(|s| s.trim().parse().ok());
    }
    (dungeon, level, success, duration_ms)
}

/// Pull headline fields out of a carved raid pull: boss name from `ENCOUNTER_START`, kill/wipe from
/// `ENCOUNTER_END`. Layouts: `ENCOUNTER_START,encounterID,"name",difficultyID,groupSize,instanceID`
/// and `ENCOUNTER_END,encounterID,"name",difficultyID,groupSize,success` (success is the last field).
fn encounter_meta(bytes: &[u8]) -> (Option<String>, Option<bool>) {
    let mut boss = None;
    let mut success = None;
    if let Some(line) = extract_line(bytes, b"ENCOUNTER_START") {
        let f = line_fields(&line);
        // f = [event, encounterID, name, difficultyID, groupSize, instanceID]
        boss = f.get(2).cloned().filter(|s| !s.is_empty());
    }
    if let Some(line) = extract_line(bytes, b"ENCOUNTER_END") {
        let f = line_fields(&line);
        // f = [event, encounterID, name, difficultyID, groupSize, success]
        success = f.get(5).map(|s| s.trim() == "1");
    }
    (boss, success)
}

/// The full line (as a `String`) containing the first occurrence of `needle`, sans trailing newline.
fn extract_line(bytes: &[u8], needle: &[u8]) -> Option<String> {
    let pos = find_sub(bytes, needle)?;
    let start = bytes[..pos]
        .iter()
        .rposition(|&b| b == b'\n')
        .map(|i| i + 1)
        .unwrap_or(0);
    let end = bytes[pos..]
        .iter()
        .position(|&b| b == b'\n')
        .map(|i| pos + i)
        .unwrap_or(bytes.len());
    Some(String::from_utf8_lossy(&bytes[start..end]).into_owned())
}

fn find_sub(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Quote-aware comma split of a combat-log line, returning `[event, field1, field2, ...]`. The event
/// token is the last whitespace-delimited word before the first comma (separator-agnostic, like the
/// carve crate's `event_name`). Quotes around a field (e.g. the dungeon name) are stripped.
fn line_fields(line: &str) -> Vec<String> {
    let Some(comma) = line.find(',') else {
        return Vec::new();
    };
    let head = &line[..comma];
    let event = head
        .rsplit(|c| c == ' ' || c == '\t')
        .next()
        .unwrap_or("")
        .to_string();
    let mut fields = vec![event];
    let mut cur = String::new();
    let mut in_quotes = false;
    for ch in line[comma + 1..].chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => fields.push(std::mem::take(&mut cur)),
            '\r' | '\n' => {}
            _ => cur.push(ch),
        }
    }
    fields.push(cur);
    fields
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "6/6/2026 22:00:00.000-0500  COMBAT_LOG_VERSION,21,ADVANCED_LOG_ENABLED,1\n";

    fn sample_run() -> Vec<u8> {
        format!(
            "{HEADER}\
             6/6/2026 22:01:01.000-0500  CHALLENGE_MODE_START,\"Pit of Saron\",658,556,12,[10,9,147]\n\
             6/6/2026 22:01:02.000-0500  SPELL_DAMAGE,Player-1,\"A\",0x511,0x0,Creature-1,\"M\",0xa48,0x0,1,\"X\",0x1,100,0\n\
             6/6/2026 22:30:30.000-0500  CHALLENGE_MODE_END,658,1,12,1770000,250.5,2810.3\n"
        )
        .into_bytes()
    }

    #[test]
    fn extracts_run_headline() {
        let (dungeon, level, success, duration) = run_meta(&sample_run());
        assert_eq!(dungeon.as_deref(), Some("Pit of Saron"));
        assert_eq!(level, Some(12));
        assert_eq!(success, Some(true));
        assert_eq!(duration, Some(1_770_000));
    }

    #[test]
    fn depleted_run_reads_success_false() {
        let bytes = String::from_utf8(sample_run())
            .unwrap()
            .replace("CHALLENGE_MODE_END,658,1,12", "CHALLENGE_MODE_END,658,0,12")
            .into_bytes();
        let (_, _, success, _) = run_meta(&bytes);
        assert_eq!(success, Some(false));
    }

    fn sample_pull(success: i64) -> Vec<u8> {
        format!(
            "{HEADER}\
             6/6/2026 22:05:01.000-0500  ENCOUNTER_START,2902,\"Ulgrax, the Devourer\",15,5,2769\n\
             6/6/2026 22:05:02.000-0500  SPELL_DAMAGE,Player-1,\"A\",0x511,0x0,Creature-1,\"M\",0xa48,0x0,1,\"X\",0x1,100,0\n\
             6/6/2026 22:08:30.000-0500  ENCOUNTER_END,2902,\"Ulgrax, the Devourer\",15,5,{success}\n"
        )
        .into_bytes()
    }

    #[test]
    fn extracts_pull_headline() {
        let (boss, success) = encounter_meta(&sample_pull(0));
        assert_eq!(boss.as_deref(), Some("Ulgrax, the Devourer"));
        assert_eq!(success, Some(false), "success=0 is a wipe");
        let (_, kill) = encounter_meta(&sample_pull(1));
        assert_eq!(kill, Some(true), "success=1 is a kill");
    }

    #[test]
    fn line_fields_strips_quotes_and_finds_event() {
        let f = line_fields("6/6 22:00:01.0  CHALLENGE_MODE_START,\"Pit of Saron\",658,556,12,[10,9]");
        assert_eq!(f[0], "CHALLENGE_MODE_START");
        assert_eq!(f[1], "Pit of Saron");
        assert_eq!(f[4], "12");
    }

    #[test]
    fn newest_log_ignores_non_matching() {
        // Sanity: filter predicate logic on names.
        let ok = "WoWCombatLog-060626_150120.txt";
        let bad = "notes.txt";
        let pred = |n: &str| n.starts_with("WoWCombatLog") && n.ends_with(".txt");
        assert!(pred(ok));
        assert!(!pred(bad));
    }
}
