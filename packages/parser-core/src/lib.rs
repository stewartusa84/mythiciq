//! parser-core: raw WoW combat-log bytes -> columnar (SoA) event store in WASM
//! linear memory, exposed to TypeScript via raw `extern "C"` pointer/length exports.
//!
//! The field-mapping logic is ported from the ground-truth `lib.rs` (see `wow/` and
//! `builder.rs`); only the output sink changed (typed columns + side table instead of
//! per-event serde_json). No per-event JSON crosses the boundary — only flat columns.
//!
//! Lifecycle from the JS/Worker side:
//!   1. `let ptr = alloc(len)`           — reserve a byte buffer in wasm memory
//!   2. write the log bytes into memory at `ptr`
//!   3. `let count = parse(ptr, len)`    — parse; columns now live in wasm memory
//!   4. read columns via the `*_ptr`/`*_len` accessors as zero-copy typed arrays
//!   5. `dealloc(ptr, len)`              — free the input buffer (columns persist)
//!   6. `reset()`                        — drop the store before parsing another log

mod builder;
mod intern;
mod store;
mod wow;

#[cfg(test)]
mod reference;
#[cfg(test)]
mod differential_test;

use core::cell::RefCell;
use std::alloc::{alloc as raw_alloc, dealloc as raw_dealloc, Layout};

use store::EventStore;

// The lol_alloc allocator is wasm32-only; on the host (cargo test / differential
// test) we fall back to the system allocator.
#[cfg(target_arch = "wasm32")]
#[global_allocator]
static ALLOCATOR: lol_alloc::AssumeSingleThreaded<lol_alloc::FreeListAllocator> =
    unsafe { lol_alloc::AssumeSingleThreaded::new(lol_alloc::FreeListAllocator::new()) };

thread_local! {
    static STATE: RefCell<Option<EventStore>> = const { RefCell::new(None) };
}

#[inline]
fn with_store<R>(f: impl FnOnce(&EventStore) -> R) -> R {
    STATE.with(|s| {
        let b = s.borrow();
        let store = b.as_ref().expect("parse() must be called before reading columns");
        f(store)
    })
}

// ---------------------------------------------------------------------------
// Input buffer management
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return core::ptr::null_mut();
    }
    let layout = Layout::from_size_align(len, 1).expect("bad layout");
    unsafe { raw_alloc(layout) }
}

/// # Safety
/// `ptr` must come from [`alloc`] with the same `len`, freed at most once.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    let layout = Layout::from_size_align(len, 1).expect("bad layout");
    raw_dealloc(ptr, layout);
}

// ---------------------------------------------------------------------------
// Parse entry point
// ---------------------------------------------------------------------------

/// Parse `len` UTF-8 bytes at `ptr` into the resident columnar store. Returns the
/// number of rows (events + version + malformed lines).
///
/// # Safety
/// `ptr..ptr+len` must be initialized UTF-8 bytes (combat logs are UTF-8).
#[no_mangle]
pub unsafe extern "C" fn parse(ptr: *const u8, len: usize) -> usize {
    let bytes = core::slice::from_raw_parts(ptr, len);
    let text = core::str::from_utf8_unchecked(bytes);

    let mut store = EventStore::with_capacity(len / 96 + 16);
    builder::parse_into(text, &mut store);
    let count = store.len();
    STATE.with(|s| *s.borrow_mut() = Some(store));
    count
}

#[no_mangle]
pub extern "C" fn reset() {
    STATE.with(|s| *s.borrow_mut() = None);
}

#[no_mangle]
pub extern "C" fn event_count() -> usize {
    with_store(EventStore::len)
}

// ---------------------------------------------------------------------------
// Hot column accessors (zero-copy typed-array views on the TS side)
// ---------------------------------------------------------------------------

macro_rules! col_ptr {
    ($name:ident, $field:ident, $ty:ty) => {
        #[no_mangle]
        pub extern "C" fn $name() -> *const $ty {
            with_store(|s| s.$field.as_ptr())
        }
    };
}

col_ptr!(col_ts_ptr, ts_ms, f64);
col_ptr!(col_event_type_ptr, event_type_id, u32);
col_ptr!(col_record_kind_ptr, record_kind, u8);
col_ptr!(col_format_ptr, format_id, u8);
col_ptr!(col_source_guid_ptr, source_guid, u32);
col_ptr!(col_source_name_ptr, source_name, u32);
col_ptr!(col_source_flags_ptr, source_flags, i64);
col_ptr!(col_source_raid_ptr, source_raid_flags, i64);
col_ptr!(col_target_guid_ptr, target_guid, u32);
col_ptr!(col_target_name_ptr, target_name, u32);
col_ptr!(col_target_flags_ptr, target_flags, i64);
col_ptr!(col_target_raid_ptr, target_raid_flags, i64);
col_ptr!(col_spell_id_ptr, spell_id, i32);
col_ptr!(col_spell_name_ptr, spell_name, u32);
col_ptr!(col_spell_school_ptr, spell_school, i64);
col_ptr!(col_amount_ptr, amount, f64);

// ---------------------------------------------------------------------------
// Side table accessors (per-event long-tail fields)
// ---------------------------------------------------------------------------

/// `event_count() + 1` offsets; event `i`'s entries are `[off[i]..off[i+1])`.
#[no_mangle]
pub extern "C" fn side_offsets_ptr() -> *const u32 {
    with_store(|s| s.side_offsets.as_ptr())
}

#[no_mangle]
pub extern "C" fn side_len() -> usize {
    with_store(|s| s.side_name.len())
}

col_ptr!(side_name_ptr, side_name, u32);
col_ptr!(side_kind_ptr, side_kind, u8);
col_ptr!(side_ival_ptr, side_ival, i64);
col_ptr!(side_fval_ptr, side_fval, f64);

// ---------------------------------------------------------------------------
// Intern table accessors
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn intern_count() -> usize {
    with_store(|s| s.interner.len())
}

#[no_mangle]
pub extern "C" fn intern_bytes_ptr() -> *const u8 {
    with_store(|s| s.interner.bytes().as_ptr())
}

#[no_mangle]
pub extern "C" fn intern_bytes_len() -> usize {
    with_store(|s| s.interner.bytes().len())
}

#[no_mangle]
pub extern "C" fn intern_offsets_ptr() -> *const u32 {
    with_store(|s| s.interner.offsets().as_ptr())
}

// ---------------------------------------------------------------------------
// Actor table (guid id -> name id) / Spell table (numeric id -> name id)
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn actor_count() -> usize {
    with_store(|s| s.actor_guid.len())
}
col_ptr!(actor_guid_ptr, actor_guid, u32);
col_ptr!(actor_name_ptr, actor_name, u32);

#[no_mangle]
pub extern "C" fn spell_count() -> usize {
    with_store(|s| s.spell_ids.len())
}
col_ptr!(spell_id_ptr, spell_ids, i32);
col_ptr!(spell_name_ptr, spell_names, u32);
