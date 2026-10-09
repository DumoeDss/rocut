//! Portable gain semantics for normalized HyperFrames automation and volume
//! keyframes. Times in points are clip-local; evaluation receives timeline time.
//! Adapted and modified from @hyperframes/core 0.8.139, Copyright 2026 HeyGen,
//! Inc., Apache-2.0. Full license and modification notice: rust/wasm/NOTICE.
use super::MAX_SECONDS;
use serde::{Deserialize, Serialize};

// Automation lanes have a smaller native limit, but GSAP volume probes can
// legitimately produce more points. Bound both representations at admission.
pub(super) const MAX_GAIN_POINTS: usize = 4096;

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Point {
    pub t: f64,
    pub v: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub curve: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via_y: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GainEnvelope {
    pub version: u32,
    pub start: f64,
    pub duration: f64,
    pub base_gain: f64,
    pub fade_in: f64,
    pub fade_out: f64,
    pub points: Vec<Point>,
}

impl GainEnvelope {
    pub fn validate(&self) -> Result<(), String> {
        let seconds = |n: f64| n.is_finite() && (0.0..=MAX_SECONDS).contains(&n);
        let gain = |n: f64| n.is_finite() && (0.0..=64.0).contains(&n);
        if self.version != 1
            || !seconds(self.start)
            || !seconds(self.duration)
            || self.duration == 0.0
            || self.start + self.duration > MAX_SECONDS
            || !gain(self.base_gain)
            || !seconds(self.fade_in)
            || !seconds(self.fade_out)
            || self.points.len() > MAX_GAIN_POINTS
        {
            return Err("Invalid or excessive audio gain envelope".into());
        }
        let mut previous = None;
        for point in &self.points {
            let valid_via = match (point.via_x, point.via_y) {
                (None, None) => true,
                (Some(x), Some(y)) => {
                    x.is_finite()
                        && y.is_finite()
                        && (0.001..=0.999).contains(&x)
                        && (0.001..=0.999).contains(&y)
                }
                _ => false,
            };
            if !seconds(point.t)
                || !gain(point.v)
                || previous.is_some_and(|t| point.t <= t)
                || point
                    .curve
                    .is_some_and(|v| !v.is_finite() || !(-1.0..=1.0).contains(&v))
                || !valid_via
            {
                return Err("Invalid or unordered audio gain envelope points".into());
            }
            previous = Some(point.t);
        }
        Ok(())
    }

    /// Evaluate an admitted envelope, on the absolute output sample clock.
    /// A nonempty lane replaces the static gain; clip fades multiply it last.
    pub fn evaluate(&self, timeline_seconds: f64) -> f64 {
        let elapsed = timeline_seconds - self.start;
        // Native media.js clamps the resolved lane/keyframe level to +12 dB
        // before applying clip fades. Legal extreme via points can overshoot
        // the endpoint gains, so clamping only the authored points is insufficient.
        let level = self.level(elapsed).clamp(0.0, 10.0_f64.powf(12.0 / 20.0));
        let total = self.fade_in + self.fade_out;
        let scale = if total > self.duration {
            self.duration / total
        } else {
            1.0
        };
        let fade_in = self.fade_in * scale;
        let fade_out = self.fade_out * scale;
        let mut fade = 1.0;
        if fade_in > 0.0 {
            fade *= (elapsed / fade_in).clamp(0.0, 1.0);
        }
        if fade_out > 0.0 {
            fade *= ((self.duration - elapsed) / fade_out).clamp(0.0, 1.0);
        }
        level * fade
    }

    // Bus AudioParam scheduling uses the same curve before track-only clamp/fades.
    pub(super) fn level(&self, elapsed: f64) -> f64 {
        let Some(first) = self.points.first() else {
            return self.base_gain;
        };
        if elapsed <= first.t {
            return first.v;
        }
        let last = self.points.last().unwrap();
        if elapsed >= last.t {
            return last.v;
        }
        let upper = self.points.partition_point(|p| p.t <= elapsed);
        let a = &self.points[upper - 1];
        let b = &self.points[upper];
        let progress = (elapsed - a.t) / (b.t - a.t);
        let shaped = match (a.via_x, a.via_y) {
            // Matches native clampVia: a point on the diagonal has no bend,
            // so any authored exponent remains in effect.
            (Some(x), Some(y)) if (x - y).abs() >= 1e-6 => {
                shape_via(progress.clamp(0.0, 1.0), x, y)
            }
            _ => match a.curve {
                Some(curve) if curve != 0.0 => progress.powf(2.0_f64.powf(2.0 * curve)),
                _ => progress,
            },
        };
        a.v + (b.v - a.v) * shaped
    }
}

// HyperFrames audioAutomation.js viaConic/shapeVia/conicParam semantics: a
// rational quadratic from (0,0) to (1,1) passes through the via point at t=1/2.
pub(super) fn shape_via(x: f64, via_x: f64, via_y: f64) -> f64 {
    let edge = 0.999;
    let need = |coordinate: f64| {
        let delta = coordinate - 0.5;
        if delta > 0.0 {
            delta / (edge - coordinate)
        } else if delta < 0.0 {
            -delta / (coordinate - (1.0 - edge))
        } else {
            0.0
        }
    };
    let weight = 1.0_f64.max(need(via_x)).max(need(via_y)).min(1e6);
    let cx = via_x + (via_x - 0.5) / weight;
    let cy = via_y + (via_y - 0.5) / weight;
    let spread = 2.0 - 2.0 * weight;
    let a = x * spread - 1.0 + 2.0 * weight * cx;
    let b = -x * spread - 2.0 * weight * cx;
    let t = conic_parameter(a, b, x);
    let rest = 1.0 - t;
    let denominator = rest * rest + 2.0 * weight * t * rest + t * t;
    if denominator <= 0.0 {
        return x;
    }
    (2.0 * weight * cy * t * rest + t * t) / denominator
}

fn conic_parameter(a: f64, b: f64, c: f64) -> f64 {
    if a.abs() < 1e-12 {
        return if b.abs() < 1e-12 { c } else { -c / b };
    }
    let root = (b * b - 4.0 * a * c).max(0.0).sqrt();
    for t in [(-b + root) / (2.0 * a), (-b - root) / (2.0 * a)] {
        if (-1e-9..=1.0 + 1e-9).contains(&t) {
            return t.clamp(0.0, 1.0);
        }
    }
    c
}
