//! Scalar arithmetic for explicit animation sampling and domain inspection.
//!
//! This module does not replace legacy runtime or admission policy. `Safe` is a
//! numerical certificate; `Unresolved` is not admission success. Bezier checks
//! bound the actual floating-point expression and the existing twenty-step
//! time inversion, rather than treating a set of sampled times as a proof.

mod domain;
mod interval;
mod model;
mod sample;
mod tight;

pub use model::*;
pub use sample::ValidatedChannel;
