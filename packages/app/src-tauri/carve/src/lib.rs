//! Carve completed Mythic+ runs and raid boss pulls out of a streaming WoW combat log.
//!
//! An **M+ run** = the byte range from a `CHALLENGE_MODE_START` line through its matching
//! `CHALLENGE_MODE_END` line (inclusive). A **raid pull** = a single `ENCOUNTER_START` through its
//! matching `ENCOUNTER_END` (inclusive), but ONLY for raid difficulties (Normal/Heroic/Mythic/LFR =
//! 14/15/16/17) — M+ boss pulls (difficulty 8) live inside the whole-dungeon carve, so the
//! difficulty gate keeps them out. Each carve is prefixed with the log's leading
//! `COMBAT_LOG_VERSION` header line so the slice parses as a STANDALONE sub-log. The TS engine
//! decides field layout per-line by field count (see `packages/app/src/mvp/runExtract.ts`), so a
//! `START..=END` slice + header parses on its own and yields exactly one real run/raid session —
//! which is what the companion feeds to the parser.
//!
//! We only emit on the matching `END`, so a run/pull is picked up exactly once it has COMPLETED
//! (kill OR wipe). A `START` seen while the same bracket is already open (a re-rolled key, or a
//! pull restarted without an END) discards the incomplete buffer and starts fresh. The two brackets
//! buffer independently — in real logs they never overlap (a raid has no CHALLENGE_MODE; an M+
//! encounter is difficulty 8 and is gated out), so a robust two-buffer state machine is simplest.
//!
//! Kept free of the `tauri`/`notify` dependency graph so it unit-tests standalone with no network.

/// What kind of bracket a carve came from. Drives how the desktop app surfaces it (M+ runs → the
/// notifications bell; raid pulls → the boss-grouped Pulls feed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CarveKind {
    /// A `CHALLENGE_MODE_START..END` Mythic+ run.
    Mplus,
    /// A single raid-difficulty `ENCOUNTER_START..END` boss pull (wipe or kill).
    RaidEncounter,
}

/// A completed run/pull carved into a standalone sub-log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CarvedRun {
    /// Standalone sub-log bytes: the `COMBAT_LOG_VERSION` header line (if one was seen) followed by
    /// the body (`START` line .. `END` line, inclusive). Each line is newline-terminated.
    pub bytes: Vec<u8>,
    /// Number of log lines in the body (`START..=END`), for diagnostics / tests.
    pub lines: usize,
    /// Which bracket produced this carve.
    pub kind: CarveKind,
}

const START: &[u8] = b"CHALLENGE_MODE_START";
const END: &[u8] = b"CHALLENGE_MODE_END";
const ENC_START: &[u8] = b"ENCOUNTER_START";
const ENC_END: &[u8] = b"ENCOUNTER_END";
const VERSION: &[u8] = b"COMBAT_LOG_VERSION";

/// Raid difficulty ids (Normal/Heroic/Mythic/LFR) — mirrors `engine/src/segments/difficulty.ts`.
/// Only these drive raid-pull carving; M+ encounters (difficulty 8) are skipped.
const RAID_DIFFICULTIES: &[i64] = &[14, 15, 16, 17];

/// Streaming carver. Feed newly-appended bytes via [`RunCarver::push_bytes`]; it returns any
/// runs/pulls that completed within that chunk. Holds a partial trailing line until its newline
/// arrives, so callers can hand it arbitrary byte chunks (e.g. each `notify` growth event).
#[derive(Default)]
pub struct RunCarver {
    /// `COMBAT_LOG_VERSION` line (newline-terminated), empty until seen. Captured once.
    header: Vec<u8>,
    // M+ challenge-mode bracket.
    in_run: bool,
    body: Vec<u8>,
    lines: usize,
    // Raid encounter bracket (independent — see module docs).
    in_encounter: bool,
    enc_body: Vec<u8>,
    enc_lines: usize,
    /// Partial trailing line awaiting its newline.
    pending: Vec<u8>,
}

impl RunCarver {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether the log header has been captured yet (used to decide whether a from-scratch scan is
    /// still needed when attaching to a file mid-stream).
    pub fn has_header(&self) -> bool {
        !self.header.is_empty()
    }

    /// Feed a chunk of newly-appended bytes; returns any runs that COMPLETED within this chunk.
    pub fn push_bytes(&mut self, chunk: &[u8]) -> Vec<CarvedRun> {
        let mut out = Vec::new();
        for &b in chunk {
            self.pending.push(b);
            if b == b'\n' {
                let line = std::mem::take(&mut self.pending);
                if let Some(run) = self.process_line(&line) {
                    out.push(run);
                }
            }
        }
        out
    }

    /// Flush a final line with no trailing newline (e.g. EOF of a static file). Live logs append
    /// whole lines, so this is rarely needed during monitoring.
    pub fn finish(&mut self) -> Vec<CarvedRun> {
        if self.pending.is_empty() {
            return Vec::new();
        }
        let line = std::mem::take(&mut self.pending);
        self.process_line(&line).into_iter().collect()
    }

    fn process_line(&mut self, line: &[u8]) -> Option<CarvedRun> {
        let ev = event_name(line);
        if ev == VERSION && self.header.is_empty() {
            let mut h = line.to_vec();
            ensure_newline(&mut h);
            self.header = h;
        }

        // --- Raid encounter bracket (independent of the M+ bracket; see module docs) ---
        if ev == ENC_START {
            // Only carve raid-difficulty pulls; M+ boss pulls (difficulty 8) are inside the
            // whole-dungeon carve and must not double-emit.
            if is_raid_encounter_start(line) {
                self.in_encounter = true;
                self.enc_body.clear();
                self.enc_lines = 0;
                self.push_enc_body(line);
            } else {
                // A non-raid encounter start aborts any (stale) open raid buffer.
                self.in_encounter = false;
                self.enc_body.clear();
                self.enc_lines = 0;
            }
        } else if self.in_encounter {
            self.push_enc_body(line);
            if ev == ENC_END {
                self.in_encounter = false;
                let mut bytes = self.header.clone();
                bytes.extend_from_slice(&self.enc_body);
                let pull = CarvedRun { bytes, lines: self.enc_lines, kind: CarveKind::RaidEncounter };
                self.enc_body.clear();
                self.enc_lines = 0;
                return Some(pull);
            }
        }

        // --- M+ challenge-mode bracket ---
        if ev == START {
            // New run: drop any incomplete previous run (re-rolled/abandoned key, no END).
            self.in_run = true;
            self.body.clear();
            self.lines = 0;
            self.push_body(line);
            return None;
        }
        if !self.in_run {
            return None;
        }
        self.push_body(line);
        if ev == END {
            self.in_run = false;
            let mut bytes = self.header.clone();
            bytes.extend_from_slice(&self.body);
            let run = CarvedRun { bytes, lines: self.lines, kind: CarveKind::Mplus };
            self.body.clear();
            self.lines = 0;
            return Some(run);
        }
        None
    }

    fn push_body(&mut self, line: &[u8]) {
        self.body.extend_from_slice(line);
        ensure_newline(&mut self.body);
        self.lines += 1;
    }

    fn push_enc_body(&mut self, line: &[u8]) {
        self.enc_body.extend_from_slice(line);
        ensure_newline(&mut self.enc_body);
        self.enc_lines += 1;
    }
}

/// The event-name token of a combat-log line: the field between the timestamp separator and the
/// first comma. Separator-agnostic (tab or spaces) — we take the last whitespace-delimited token
/// before the first comma. Returns an empty slice for a line with no comma.
fn event_name(line: &[u8]) -> &[u8] {
    let mut end = line.len();
    while end > 0 && (line[end - 1] == b'\n' || line[end - 1] == b'\r') {
        end -= 1;
    }
    let line = &line[..end];
    let comma = line.iter().position(|&c| c == b',').unwrap_or(line.len());
    let head = &line[..comma];
    let start = head
        .iter()
        .rposition(|&c| c == b' ' || c == b'\t')
        .map(|i| i + 1)
        .unwrap_or(0);
    &head[start..]
}

/// Append a `\n` unless the buffer already ends with one.
fn ensure_newline(buf: &mut Vec<u8>) {
    if buf.last() != Some(&b'\n') {
        buf.push(b'\n');
    }
}

/// Whether an `ENCOUNTER_START` line is for a RAID difficulty (14/15/16/17), so it should be carved
/// as a raid pull. Layout: `ts  ENCOUNTER_START,encounterID,"name",difficultyID,groupSize,instanceID`.
/// `difficultyID` is the 3rd field after the event token (index 2). Quote-aware because the encounter
/// name field can itself contain commas. Returns false for non-raid (e.g. M+ difficulty 8) or malformed.
fn is_raid_encounter_start(line: &[u8]) -> bool {
    let fields = fields_after_event(line);
    let Some(diff_raw) = fields.get(2) else { return false };
    match diff_raw.trim().parse::<i64>() {
        Ok(d) => RAID_DIFFICULTIES.contains(&d),
        Err(_) => false,
    }
}

/// Quote-aware split of a combat-log line into the comma-separated fields AFTER the event token
/// (i.e. everything past the first comma). A `"..."` field is kept whole even if it contains commas;
/// the surrounding quotes are stripped. Mirrors `watch.rs::line_fields` (sans the event token), kept
/// here so the carver stays dependency-free.
fn fields_after_event(line: &[u8]) -> Vec<String> {
    let s = String::from_utf8_lossy(line);
    let Some(comma) = s.find(',') else { return Vec::new() };
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    for ch in s[comma + 1..].chars() {
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

    fn run_block(idx: u32) -> String {
        format!(
            "6/6/2026 22:0{i}:01.000-0500  CHALLENGE_MODE_START,\"Pit of Saron\",658,556,12,[10,9,147]\n\
             6/6/2026 22:0{i}:02.000-0500  SPELL_DAMAGE,Player-1,\"A\",0x511,0x0,Creature-1,\"M\",0xa48,0x0,1,\"X\",0x1,100,0\n\
             6/6/2026 22:0{i}:30.000-0500  CHALLENGE_MODE_END,658,1,12,1620000,250.5,2810.3\n",
            i = idx
        )
    }

    fn as_str(run: &CarvedRun) -> String {
        String::from_utf8(run.bytes.clone()).unwrap()
    }

    #[test]
    fn carves_single_completed_run_with_header() {
        let log = format!("{HEADER}{}", run_block(0));
        let mut c = RunCarver::new();
        let runs = c.push_bytes(log.as_bytes());
        assert_eq!(runs.len(), 1);
        let s = as_str(&runs[0]);
        assert!(s.starts_with("6/6/2026 22:00:00.000-0500  COMBAT_LOG_VERSION"), "header prepended");
        assert!(s.contains("CHALLENGE_MODE_START"));
        assert!(s.contains("CHALLENGE_MODE_END"));
        assert_eq!(runs[0].lines, 3, "START + 1 event + END");
    }

    #[test]
    fn ignores_events_outside_a_run() {
        let log = format!(
            "{HEADER}6/6/2026 22:00:00.500-0500  SPELL_DAMAGE,Player-1,\"A\",0,0,C,\"M\",0,0,1,\"X\",0,1,0\n{}",
            run_block(0)
        );
        let mut c = RunCarver::new();
        let runs = c.push_bytes(log.as_bytes());
        assert_eq!(runs.len(), 1);
        // The pre-run SPELL_DAMAGE line must NOT be in the carved body.
        assert!(!as_str(&runs[0]).contains("22:00:00.500"));
    }

    #[test]
    fn emits_only_after_end_is_seen() {
        let mut c = RunCarver::new();
        // Header + START + a body line, but no END yet.
        let partial = format!(
            "{HEADER}6/6/2026 22:00:01.000-0500  CHALLENGE_MODE_START,\"Pit of Saron\",658,556,12,[]\n\
             6/6/2026 22:00:02.000-0500  SPELL_DAMAGE,P,\"A\",0,0,C,\"M\",0,0,1,\"X\",0,1,0\n"
        );
        assert!(c.push_bytes(partial.as_bytes()).is_empty(), "no END → nothing emitted");
        let end = "6/6/2026 22:00:30.000-0500  CHALLENGE_MODE_END,658,1,12,1620000,250.5,2810.3\n";
        assert_eq!(c.push_bytes(end.as_bytes()).len(), 1, "END completes the run");
    }

    #[test]
    fn handles_chunk_split_mid_line() {
        let log = format!("{HEADER}{}", run_block(0));
        let bytes = log.as_bytes();
        let mid = bytes.len() / 2;
        let mut c = RunCarver::new();
        let mut runs = c.push_bytes(&bytes[..mid]);
        runs.extend(c.push_bytes(&bytes[mid..]));
        assert_eq!(runs.len(), 1);
        // Identical to the single-chunk carve.
        let mut c2 = RunCarver::new();
        assert_eq!(runs[0], c2.push_bytes(bytes).remove(0));
    }

    #[test]
    fn carves_two_back_to_back_runs() {
        let log = format!("{HEADER}{}{}", run_block(0), run_block(1));
        let mut c = RunCarver::new();
        let runs = c.push_bytes(log.as_bytes());
        assert_eq!(runs.len(), 2);
        for r in &runs {
            assert!(as_str(r).contains("COMBAT_LOG_VERSION"), "each run carries the header");
        }
    }

    #[test]
    fn rerolled_key_without_end_is_dropped() {
        // A START with no END, immediately followed by a fresh START..END. Only the completed one emits.
        let log = format!(
            "{HEADER}6/6/2026 22:00:01.000-0500  CHALLENGE_MODE_START,\"Pit of Saron\",658,556,12,[]\n\
             6/6/2026 22:00:02.000-0500  SPELL_DAMAGE,P,\"A\",0,0,C,\"M\",0,0,1,\"X\",0,1,0\n{}",
            run_block(1)
        );
        let mut c = RunCarver::new();
        let runs = c.push_bytes(log.as_bytes());
        assert_eq!(runs.len(), 1, "only the completed run");
        assert_eq!(runs[0].lines, 3);
    }

    #[test]
    fn crlf_lines_are_handled() {
        let log = format!("{HEADER}{}", run_block(0)).replace('\n', "\r\n");
        let mut c = RunCarver::new();
        let runs = c.push_bytes(log.as_bytes());
        assert_eq!(runs.len(), 1);
        assert!(as_str(&runs[0]).contains("CHALLENGE_MODE_END"));
    }

    /// A raid pull block: ENCOUNTER_START (raid difficulty `diff`) .. ENCOUNTER_END (`success`).
    fn enc_block(diff: i64, success: i64) -> String {
        format!(
            "6/6/2026 22:05:01.000-0500  ENCOUNTER_START,2902,\"Ulgrax, the Devourer\",{diff},5,2769\n\
             6/6/2026 22:05:02.000-0500  SPELL_DAMAGE,Player-1,\"A\",0x511,0x0,Creature-1,\"M\",0xa48,0x0,1,\"X\",0x1,100,0\n\
             6/6/2026 22:08:30.000-0500  ENCOUNTER_END,2902,\"Ulgrax, the Devourer\",{diff},5,{success}\n"
        )
    }

    #[test]
    fn carves_a_raid_pull_with_header() {
        let log = format!("{HEADER}{}", enc_block(15, 0)); // Heroic wipe
        let mut c = RunCarver::new();
        let runs = c.push_bytes(log.as_bytes());
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].kind, CarveKind::RaidEncounter);
        let s = as_str(&runs[0]);
        assert!(s.starts_with("6/6/2026 22:00:00.000-0500  COMBAT_LOG_VERSION"), "header prepended");
        assert!(s.contains("ENCOUNTER_START"));
        assert!(s.contains("ENCOUNTER_END"));
        assert_eq!(runs[0].lines, 3, "START + 1 event + END");
    }

    #[test]
    fn carves_both_wipe_and_kill() {
        // A wipe then a kill of the same boss → two separate pulls.
        let log = format!("{HEADER}{}{}", enc_block(16, 0), enc_block(16, 1));
        let mut c = RunCarver::new();
        let runs = c.push_bytes(log.as_bytes());
        assert_eq!(runs.len(), 2);
        for r in &runs {
            assert_eq!(r.kind, CarveKind::RaidEncounter);
            assert!(as_str(r).contains("COMBAT_LOG_VERSION"), "each pull carries the header");
        }
    }

    #[test]
    fn mplus_encounter_is_not_carved_as_raid_pull() {
        // Difficulty 8 (Mythic Keystone) ENCOUNTER_START must NOT produce a raid-pull carve.
        let log = format!("{HEADER}{}", enc_block(8, 1));
        let mut c = RunCarver::new();
        let runs = c.push_bytes(log.as_bytes());
        assert!(runs.is_empty(), "M+ boss pulls (difficulty 8) are gated out");
    }

    #[test]
    fn mplus_run_carves_without_double_emitting_inner_encounters() {
        // An M+ run whose body contains a difficulty-8 boss ENCOUNTER_START..END emits ONE Mplus carve
        // and zero raid pulls.
        let log = format!(
            "{HEADER}6/6/2026 22:01:01.000-0500  CHALLENGE_MODE_START,\"Ara-Kara\",503,556,12,[10,9,147]\n\
             {}\
             6/6/2026 22:30:30.000-0500  CHALLENGE_MODE_END,503,1,12,1620000,250.5,2810.3\n",
            enc_block(8, 1)
        );
        let mut c = RunCarver::new();
        let runs = c.push_bytes(log.as_bytes());
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].kind, CarveKind::Mplus);
        assert!(as_str(&runs[0]).contains("ENCOUNTER_END"), "inner boss stays inside the run carve");
    }

    #[test]
    fn raid_pull_split_across_chunks() {
        let log = format!("{HEADER}{}", enc_block(14, 1));
        let bytes = log.as_bytes();
        let mid = bytes.len() / 2;
        let mut c = RunCarver::new();
        let mut runs = c.push_bytes(&bytes[..mid]);
        runs.extend(c.push_bytes(&bytes[mid..]));
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].kind, CarveKind::RaidEncounter);
    }

    #[test]
    fn is_raid_encounter_start_reads_difficulty() {
        let raid = b"6/6 22:05:01.0  ENCOUNTER_START,2902,\"Ulgrax, the Devourer\",15,5,2769\n";
        let mplus = b"6/6 22:05:01.0  ENCOUNTER_START,2902,\"Ulgrax, the Devourer\",8,5,2769\n";
        assert!(is_raid_encounter_start(raid), "Heroic difficulty 15 is a raid pull");
        assert!(!is_raid_encounter_start(mplus), "difficulty 8 is not");
    }

    #[test]
    fn event_name_is_separator_agnostic() {
        assert_eq!(event_name(b"6/6 22:00:01.0  CHALLENGE_MODE_START,a,b\n"), START);
        assert_eq!(event_name(b"6/6 22:00:01.0\tCHALLENGE_MODE_END,a,b"), END);
        assert_eq!(event_name(b"x COMBAT_LOG_VERSION,21\n"), VERSION);
        assert_eq!(event_name(b"no-comma-line"), b"no-comma-line");
    }
}
