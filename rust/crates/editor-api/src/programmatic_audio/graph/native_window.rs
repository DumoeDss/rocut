//! Pinned core 0.8.139 clipFacts.js / runtime/clipWindow.js predicates.
//! Adapted and modified from @hyperframes/core, Copyright 2026 HeyGen, Inc.,
//! Apache-2.0. Full license and modification notice: rust/wasm/NOTICE.

fn same_instant(a: f64, b: f64) -> bool {
    (a - b).abs() <= 4.0 * f64::EPSILON * 1.0_f64.max(a.abs()).max(b.abs())
}

fn started(time: f64, start: f64) -> bool {
    time >= start || same_instant(time, start)
}

/// Inputs have already passed finite, nonnegative native-clock admission.
pub(super) fn active(time: f64, start: f64, end: f64) -> bool {
    started(time, start) && time < end && !same_instant(time, end)
}

/// Find the first representable nonnegative native start instant. With time
/// below start, the tolerance scale is constant, so `started` is monotonic.
/// Positive f64 bit order is numeric order: at most 63 predicate probes, no
/// epsilon guessing, sample rounding or unbounded nextafter walk.
fn first_started(start: f64) -> f64 {
    let mut low = 0u64;
    let mut high = if start == 0.0 { 0 } else { start.to_bits() };
    while low < high {
        let mid = low + (high - low) / 2;
        if started(f64::from_bits(mid), start) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    f64::from_bits(low)
}

pub(super) fn discovery_time(start: f64, end: f64, composition_end: f64) -> Option<f64> {
    let eligible = |time: f64| time >= 0.0 && time < composition_end && active(time, start, end);
    let clipped_end = end.min(composition_end);
    if start < clipped_end {
        // Keep ordinary discovery interior and away from native end tolerance.
        let midpoint = start + (clipped_end - start) / 2.0;
        if eligible(midpoint) {
            return Some(midpoint);
        }
        if eligible(start) {
            return Some(start);
        }
    }
    let first = first_started(start);
    // Once started, the native end predicate and the composition bound only
    // turn false, never true again. If this first instant fails, none exists.
    eligible(first).then_some(first)
}
