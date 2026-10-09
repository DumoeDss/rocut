//! Heart shatter's real-beat anticipation, crack phases and camera timing.
#[path = "converge_math.rs"]
mod seeded;
#[derive(Debug)]
pub struct Timing {
    pub break_at: f64,
    pub next_beat: f64,
    pub tau: f64,
    pub broken: bool,
    pub impact: bool,
    pub crack: f64,
    pub anticipation: f64,
    pub zoom: f64,
    pub shake: [f64; 2],
    pub heat: f64,
}
pub struct Input<'a> {
    pub beats: &'a [f64],
    pub seconds_per_beat: f64,
    pub shot_start: f64,
    pub time: f64,
    pub progress: f64,
    pub break_beat: usize,
    pub break_at: Option<f64>,
}
fn inv(a: f64, b: f64, t: f64) -> f64 {
    ((t - a) / (b - a)).clamp(0.0, 1.0)
}
fn decay(x: f64, k: f64) -> f64 {
    if x < 0.0 {
        0.0
    } else {
        (-x * k).exp()
    }
}
fn out_expo(v: f64) -> f64 {
    if v == 1.0 {
        1.0
    } else {
        1.0 - 2.0f64.powf(-10.0 * v)
    }
}
pub fn beat_index(beats: &[f64], time: f64) -> usize {
    beats.partition_point(|b| *b < time - 0.04)
}
pub fn beat_time(beats: &[f64], index: usize, spb: f64) -> Option<f64> {
    beats.get(index).copied().or_else(|| {
        beats
            .last()
            .map(|last| last + (index - beats.len() + 1) as f64 * spb)
    })
}
pub fn shatter(input: Input<'_>) -> Result<Timing, &'static str> {
    break_clock(input, false)
}
pub fn break_clock(input: Input<'_>, burn: bool) -> Result<Timing, &'static str> {
    let Input {
        beats,
        seconds_per_beat: spb,
        shot_start: t0,
        time: t,
        progress: p,
        break_beat: n,
        break_at,
    } = input;
    if beats.is_empty()
        || beats.iter().any(|b| !b.is_finite())
        || !beats.windows(2).all(|b| b[0] < b[1])
        || ![spb, t0, t, p].iter().all(|v| v.is_finite())
        || spb <= 0.0
        || !(0.0..=1.0).contains(&p)
        || break_at.is_some_and(|v| !v.is_finite())
    {
        return Err("Invalid Heart shatter clock");
    }
    let i0 = beat_index(beats, t0);
    let target = i0.checked_add(n).ok_or("Heart break beat overflow")?;
    let tb = match break_at {
        Some(v) => v,
        None => beat_time(beats, target, spb).ok_or("Missing Heart beats")?,
    };
    let tm = if n >= 2 {
        beat_time(beats, i0.checked_add(1).ok_or("Heart beat overflow")?, spb)
            .ok_or("Missing Heart beats")?
    } else {
        t0 + (tb - t0) * 0.45
    };
    let tau = t - tb;
    let broken = tau >= 0.0;
    let impact = broken && tau < 0.067;
    let k1 = out_expo(inv(t0 + 0.02, t0 + 0.4, t));
    let k2 = out_expo(inv(tm, tm + 0.3, t));
    let k3 = inv(tb - 0.3, tb, t).powi(2);
    let weights = if burn {
        [0.4, 0.3, 0.3]
    } else {
        [0.28, 0.34, 0.38]
    };
    let crack = (weights[0] * k1 + weights[1] * k2 + weights[2] * k3).clamp(0.0, 1.0);
    let anticipation = inv(tb - 0.3, tb, t).powi(3);
    let zoom = 1.0
        + 0.05 * (-((std::f64::consts::PI * p).cos() - 1.0) / 2.0)
        + if broken {
            0.045 * decay(tau, 3.5)
        } else {
            0.012 * anticipation
        };
    let amp = if broken {
        9.0 * decay(tau, 7.0)
    } else {
        0.6 + 2.4 * decay(t - tm, 12.0) * if t > tm { 1.0 } else { 0.0 }
            + 1.5 * decay(t - t0, 12.0)
            + 4.5 * anticipation
    };
    let q = (t * 24.0).floor();
    let shake = [seeded::rnds(q, 7.0) * amp, seeded::rnds(q, 14.0) * amp];
    let heat = if broken {
        0.0
    } else {
        (0.15 + 0.55 * crack + 0.35 * anticipation).clamp(0.0, 1.0)
    };
    Ok(Timing {
        break_at: tb,
        next_beat: tm,
        tau,
        broken,
        impact,
        crack,
        anticipation,
        zoom,
        shake,
        heat,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drifting_beats_and_boundary() {
        let beats = [0.0, 0.49, 1.01, 1.54];
        // Preserve IEEE subtraction: .53-.04 is slightly above .49.
        assert_eq!(beat_index(&beats, 0.53), 2);
        assert_eq!(beat_time(&beats, 5, 0.51), Some(2.56));
        let run = |time| {
            shatter(Input {
                beats: &beats,
                seconds_per_beat: 0.51,
                shot_start: 0.0,
                time,
                progress: 0.3,
                break_beat: 2,
                break_at: None,
            })
            .unwrap()
        };
        assert!(!run(1.009).broken);
        assert!(run(1.01).impact);
        assert!(!run(1.078).impact);
        assert_eq!(run(1.01).heat, 0.0);
    }

    #[test]
    fn original_allows_earlier_explicit_break_and_zero_break_beat() {
        let beats = [0.0, 0.5, 1.0, 1.5, 2.0];
        let earlier = shatter(Input {
            beats: &beats,
            seconds_per_beat: 0.5,
            shot_start: 1.0,
            time: 1.1,
            progress: 0.1,
            break_beat: 2,
            break_at: Some(0.25),
        })
        .unwrap();
        assert!(earlier.broken);
        assert_eq!(earlier.break_at, 0.25);
        let zero = shatter(Input {
            beats: &beats,
            seconds_per_beat: 0.5,
            shot_start: 0.0,
            time: 0.0,
            progress: 0.0,
            break_beat: 0,
            break_at: None,
        })
        .unwrap();
        assert!(zero.impact);
        assert_eq!(zero.next_beat, 0.0);
        // Original beatIdx does not manufacture elapsed extrapolated beat indices.
        let late = shatter(Input {
            beats: &beats[..2],
            seconds_per_beat: 0.5,
            shot_start: 4.0,
            time: 4.1,
            progress: 0.1,
            break_beat: 2,
            break_at: None,
        })
        .unwrap();
        assert_eq!(late.break_at, 2.0);
        assert_eq!(late.next_beat, 1.5);
        assert!(late.broken);
    }
}
