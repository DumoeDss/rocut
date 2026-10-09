//! Pinned core 0.8.139 speedRamp.js: logarithmic interpolation, 48-cell
//! trapezoid tables, then piecewise-linear lookup (not an analytic integral).
//! Adapted from @hyperframes/core, Copyright 2026 HeyGen, Inc., Apache-2.0.
//! Full license and modification notice: rust/wasm/NOTICE.
use crate::programmatic_audio::envelope::{Point, shape_via};

pub(super) fn rate_at(points: &[Point], time: f64) -> f64 {
    let first = &points[0];
    let last = points.last().unwrap();
    if time <= first.t {
        return first.v;
    }
    if time >= last.t {
        return last.v;
    }
    let upper = points.partition_point(|point| point.t <= time);
    let a = &points[upper - 1];
    let b = &points[upper];
    let progress = (time - a.t) / (b.t - a.t);
    let shaped = match (a.via_x, a.via_y) {
        (Some(x), Some(y)) if (x - y).abs() >= 1e-6 => shape_via(progress.clamp(0.0, 1.0), x, y),
        _ => match a.curve {
            Some(curve) if curve != 0.0 => progress.powf(2.0_f64.powf(2.0 * curve)),
            _ => progress,
        },
    };
    (a.v.ln() + (b.v.ln() - a.v.ln()) * shaped).exp()
}

pub(super) struct RateClock {
    times: Vec<f64>,
    sources: Vec<f64>,
    first_rate: f64,
    last_rate: f64,
}

impl RateClock {
    pub fn new(points: &[Point]) -> Result<Self, String> {
        if points.is_empty() || points.len() > 512 {
            return Err("Invalid HyperFrames normalized rate point count".into());
        }
        let mut clock = Self {
            times: vec![0.0],
            sources: vec![0.0],
            first_rate: points[0].v,
            last_rate: points.last().unwrap().v,
        };
        let mut push = |time: f64| -> Result<(), String> {
            let previous = *clock.times.last().unwrap();
            if time <= previous {
                return Ok(());
            }
            let source = clock.sources.last().unwrap()
                + ((rate_at(points, previous) + rate_at(points, time)) / 2.0) * (time - previous);
            if !source.is_finite() || source < *clock.sources.last().unwrap() {
                return Err("HyperFrames rate source clock is not finite and monotonic".into());
            }
            clock.times.push(time);
            clock.sources.push(source);
            Ok(())
        };
        push(points[0].t.max(0.0))?;
        for pair in points.windows(2) {
            let a = pair[0].t;
            let b = pair[1].t;
            if b <= 0.0 {
                continue;
            }
            for k in 1..=48 {
                push(a.max(0.0) + ((b - a) * f64::from(k)) / 48.0)?;
            }
        }
        Ok(clock)
    }

    pub fn source_time_at(&self, time: f64) -> f64 {
        if time <= 0.0 {
            return time * self.first_rate;
        }
        let last = self.times.len() - 1;
        if time >= self.times[last] {
            return self.sources[last] + (time - self.times[last]) * self.last_rate;
        }
        let upper = self.times.partition_point(|value| *value <= time);
        let lower = upper - 1;
        self.sources[lower]
            + ((self.sources[upper] - self.sources[lower]) * (time - self.times[lower]))
                / (self.times[upper] - self.times[lower])
    }
}
