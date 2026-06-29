//! String interning table.
//!
//! WoW combat logs repeat the same strings constantly: player/NPC GUIDs, unit
//! names, spell names. We map each distinct string to a `u32` id once, and store
//! the raw UTF-8 bytes packed back-to-back with an offsets array so the engine can
//! reconstruct any string as `bytes[offsets[id] .. offsets[id + 1]]`.
//!
//! Both `bytes` and `offsets` are exposed to TS as zero-copy typed-array views.

use rustc_hash::FxHashMap;

pub struct Interner {
    /// key -> id. Owns its keys (`Box<str>`); lookups borrow as `&str`.
    map: FxHashMap<Box<str>, u32>,
    /// Packed UTF-8 bytes of every interned string, concatenated.
    bytes: Vec<u8>,
    /// `offsets.len() == count + 1`. String `id` is `bytes[offsets[id]..offsets[id+1]]`.
    offsets: Vec<u32>,
}

impl Interner {
    pub fn new() -> Self {
        let mut offsets = Vec::with_capacity(4096);
        offsets.push(0);
        let mut this = Self {
            map: FxHashMap::default(),
            bytes: Vec::with_capacity(256 * 1024),
            offsets,
        };
        // Reserve id 0 for the empty / "missing" string so callers can use 0 as a
        // sentinel (no source, no target, unresolved name, ...). MUST run in release
        // too — keep it outside any debug_assert (which is stripped in release).
        let id0 = this.intern("");
        debug_assert_eq!(id0, 0);
        this
    }

    #[inline]
    pub fn intern(&mut self, s: &str) -> u32 {
        if let Some(&id) = self.map.get(s) {
            return id;
        }
        let id = (self.offsets.len() - 1) as u32;
        self.bytes.extend_from_slice(s.as_bytes());
        self.offsets.push(self.bytes.len() as u32);
        self.map.insert(s.into(), id);
        id
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.offsets.len() - 1
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn offsets(&self) -> &[u32] {
        &self.offsets
    }

    /// Resolve an interned id back to its string slice.
    pub fn get(&self, id: u32) -> &str {
        let i = id as usize;
        let start = self.offsets[i] as usize;
        let end = self.offsets[i + 1] as usize;
        // Safe: we only ever store valid UTF-8 (the bytes came from `&str`).
        unsafe { core::str::from_utf8_unchecked(&self.bytes[start..end]) }
    }
}
