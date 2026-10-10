use super::{
    camera::Camera,
    math::*,
    model::{Args, Sample},
};
pub struct Tear {
    pub start: f64,
    pub end: f64,
    pub impact: f64,
    pub horizon: f64,
    pub open: f64,
    pub dolly: f64,
}
pub fn tear(a: &Args, s: &Sample<'_>) -> Tear {
    let start = s.shot_start_ticks as f64 / 120000.0;
    let end = s.shot_end_ticks as f64 / 120000.0;
    let i0 = s
        .beats
        .partition_point(|b| *b as f64 / 120000.0 <= start - 0.08);
    let bt = |n: usize| {
        s.beats
            .get(i0 + n)
            .map(|t| *t as f64 / 120000.0)
            .unwrap_or_else(|| {
                s.beats.last().unwrap().to_owned() as f64 / 120000.0
                    + (i0 + n - s.beats.len() + 1) as f64 * 60.0 / s.bpm
            })
    };
    Tear {
        start,
        end,
        impact: a.impact.unwrap_or_else(|| bt(3)),
        horizon: a.horizon.unwrap_or_else(|| bt(6)),
        open: a.open.unwrap_or_else(|| bt(8)),
        dolly: a.dolly.unwrap_or_else(|| bt(12)),
    }
}
pub fn tear_pitch(t: &Tear, time: f64) -> f64 {
    if time < t.impact {
        lerp(-0.46, 0.15, sine(inv(t.start, t.impact, time)))
    } else {
        lerp(0.15, 0.105, sine(inv(t.impact + 0.15, t.open + 0.6, time)))
    }
}
pub fn tear_camera(t: &Tear, time: f64) -> Camera {
    let mut pitch = tear_pitch(t, time);
    let (mut z, mut f) = (0.0, 1150.0);
    if time > t.dolly {
        let k = inv(t.dolly, t.end, time);
        z = 3.4 * k * k * k + 0.4 * k * k;
        pitch -= 0.03 * sine(k);
        f = lerp(1150.0, 1040.0, k * k * k);
    }
    pitch += 0.0022 * fbm(time * 0.55, 3.0);
    Camera::new([0.0, 1.25, z], 0.0028 * fbm(time * 0.45, 9.0), pitch, f)
}
pub fn drop_y(t: &Tear, time: f64) -> f64 {
    let k = inv(t.start, t.impact, time);
    let p = tear_pitch(t, time);
    let imp = Camera::new([0.0, 1.25, 0.0], 0.0, 0.15, 1150.0)
        .p([0.0, 0.0, 4.0])
        .unwrap()[1];
    let y = lerp(-90.0, imp, 0.72 * k + 0.28 * k * k * k);
    let m = (540.0 - y) / 1150.0;
    (1.25 + 4.0 * (m * p.cos() - p.sin()) / (p.cos() + m * p.sin())).max(0.0)
}
pub struct Run {
    pub start: f64,
    pub end: f64,
    pub freeze: f64,
    pub slow: f64,
}
pub fn run(a: &Args, s: &Sample<'_>) -> Run {
    let start = s.shot_start_ticks as f64 / 120000.0;
    let end = s.shot_end_ticks as f64 / 120000.0;
    let freeze = a.freeze_at.unwrap_or_else(|| {
        s.stops
            .iter()
            .map(|t| *t as f64 / 120000.0)
            .find(|t| *t > start + 0.3 && *t < end + 0.6)
            .unwrap_or(f64::INFINITY)
    });
    let slow = a.slow_at.unwrap_or_else(|| {
        s.downbeats
            .iter()
            .map(|t| *t as f64 / 120000.0)
            .find(|t| *t > start + 0.25)
            .filter(|t| *t < freeze)
            .unwrap_or(f64::INFINITY)
    });
    Run {
        start,
        end,
        freeze,
        slow,
    }
}
pub fn distance(time: f64, t: &Run) -> f64 {
    let time = time.min(t.freeze);
    if time <= t.slow {
        return 8.5 * (time - t.start);
    }
    let d0 = 8.5 * (t.slow - t.start);
    let a = time - t.slow;
    if a <= 0.4 {
        let s = a / 0.4;
        d0 + 8.5 * a + (1.5 - 8.5) * 0.4 * (s * s * s - s * s * s * s / 2.0)
    } else {
        d0 + 8.5 * 0.4 + (1.5 - 8.5) * 0.4 * 0.5 + 1.5 * (a - 0.4)
    }
}
pub fn speed(time: f64, t: &Run) -> f64 {
    if time >= t.freeze {
        0.0
    } else if time <= t.slow {
        8.5
    } else {
        lerp(8.5, 1.5, smooth(0.0, 1.0, (time - t.slow) / 0.4))
    }
}
pub fn pulse(time: f64, s: &Sample<'_>) -> f64 {
    let n = s.beats.partition_point(|v| *v as f64 / 120000.0 <= time);
    if n == 0 {
        0.0
    } else {
        (-6.5 * (time - s.beats[n - 1] as f64 / 120000.0)).exp()
    }
}
