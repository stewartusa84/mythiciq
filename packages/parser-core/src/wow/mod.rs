//! Ground-truth WoW combat-log field logic, ported verbatim from the original
//! `lib.rs`. These modules are pure (no output-sink dependency); `crate::builder`
//! drives them and routes decoded values into the columnar store.

pub mod csv;
pub mod fieldspec;
pub mod line;
pub mod scalars;
pub mod shape;
pub mod timestamp;
