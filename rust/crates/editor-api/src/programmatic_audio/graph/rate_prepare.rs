//! Original exporter preparation semantics, not continuous MediaElement preview.
//! Pinned @hyperframes/engine 0.8.139 audioMixer.js, Apache-2.0; see NOTICE.
use super::model::NativeClip;
use super::participation::sample_aligned;
use super::rate_clock::RateClock;
use super::rate_lane::{MAX_RATE, MIN_RATE};
use crate::programmatic_audio::envelope::Point;
use crate::programmatic_audio::{MAX_PCM_BYTES, MAX_SECONDS};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RatePreparation {
    pub profile: &'static str,
    pub media_start_seconds: String,
    pub source_duration_seconds: String,
    pub duration_seconds: String,
    pub native_sample_rate: u32,
    pub native_max_frames: u64,
    pub native_max_bytes: u64,
    pub stereo_filter: String,
    pub mono_filter: String,
    pub resample_filter: String,
    pub slices: usize,
    pub clock_cells: usize,
}

/// Number(value.toFixed(6)).toString() for admitted nonnegative bounded values.
/// Integer significand arithmetic avoids a second f64 rounding at x * 1e6;
/// exact ties round upward, unlike Rust's ties-to-even fixed formatter.
pub(super) fn filter_number(value: f64) -> String {
    debug_assert!(value.is_finite() && value >= 0.0 && value < 1e12);
    let bits = value.to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let significand = if exponent == 0 {
        bits & ((1u64 << 52) - 1)
    } else {
        (bits & ((1u64 << 52) - 1)) | (1u64 << 52)
    };
    let binary_power = if exponent == 0 {
        -1074
    } else {
        exponent - 1023 - 52
    };
    let scaled = u128::from(significand) * 1_000_000;
    let micro = if binary_power >= 0 {
        scaled << binary_power
    } else if binary_power <= -128 {
        0
    } else {
        let shift = (-binary_power) as u32;
        (scaled >> shift) + u128::from((scaled & ((1u128 << shift) - 1)) >= (1u128 << (shift - 1)))
    };
    let whole = micro / 1_000_000;
    let fraction = micro % 1_000_000;
    if fraction == 0 {
        whole.to_string()
    } else {
        format!("{whole}.{fraction:06}")
            .trim_end_matches('0')
            .to_owned()
    }
}

fn tempo(rate: f64) -> String {
    let mut remaining = if rate.is_finite() && rate > 0.0 {
        rate.clamp(MIN_RATE, MAX_RATE)
    } else {
        1.0
    };
    let mut stages = Vec::new();
    while remaining < 0.5 - 1e-9 {
        stages.push(0.5);
        remaining /= 0.5;
    }
    while remaining > 2.0 + 1e-9 {
        stages.push(2.0);
        remaining /= 2.0;
    }
    if (remaining - 1.0).abs() >= 1e-9 {
        stages.push(remaining);
    }
    stages
        .into_iter()
        .map(|rate| format!("atempo={}", filter_number(rate)))
        .collect::<Vec<_>>()
        .join(",")
}

fn ramp(clock: &RateClock, duration: f64, slices: usize, mono: bool) -> String {
    let step = duration / slices as f64;
    let split: String = (0..slices).map(|i| format!("[s{i}]")).collect();
    let mut parts = vec![format!("[0:a]asplit={slices}{split}")];
    for i in 0..slices {
        let from = clock.source_time_at(i as f64 * step);
        let to = clock.source_time_at((i + 1) as f64 * step);
        let tempo = tempo((to - from) / step);
        parts.push(format!("[s{i}]atrim=start={}:end={},asetpts=PTS-STARTPTS,{}apad,asetpts=N/SR/TB,atrim=0:{}[t{i}]",
            filter_number(from), filter_number(to), if tempo.is_empty() { String::new() } else { format!("{tempo},") }, filter_number(step)));
    }
    let joined: String = (0..slices).map(|i| format!("[t{i}]")).collect();
    parts.push(format!(
        "{joined}concat=n={slices}:v=0:a=1{}",
        if mono { "[cat]" } else { "[out]" }
    ));
    if mono {
        parts.push("[cat]pan=stereo|FL=FL+FC|FR=FR+FC[out]".into());
    }
    parts.join(";")
}

pub(super) fn prepare(
    native: &NativeClip,
    points: &[Point],
    sample_rate: u32,
) -> Result<RatePreparation, String> {
    if native.r#loop {
        return Err("HyperFrames variable-rate loop needs its own native history oracle".into());
    }
    // Preserve the strict phase boundary at both graph and native preparation rates.
    for sr in [sample_rate, 48000] {
        sample_aligned(
            native.media_start * f64::from(sr),
            "variable-rate media trim",
        )?;
        sample_aligned(
            native.duration * f64::from(sr),
            "variable-rate clip duration",
        )?;
    }
    let frames = sample_aligned(
        native.duration * f64::from(sample_rate),
        "variable-rate clip duration",
    )?;
    let native_frames = sample_aligned(
        native.duration * 48000.0,
        "native rate preparation duration",
    )?;
    if frames > MAX_PCM_BYTES / 8 || native_frames > MAX_PCM_BYTES / 8 {
        return Err("HyperFrames full-clip rate preparation exceeds the PCM safety budget".into());
    }
    let clock = RateClock::new(points)?;
    let source_duration = clock.source_time_at(native.duration);
    if !source_duration.is_finite()
        || source_duration < 0.0
        || source_duration > MAX_SECONDS * MAX_RATE
    {
        return Err("HyperFrames variable-rate source span exceeds its safety bound".into());
    }
    let slices = (native.duration / 0.25).ceil().clamp(1.0, 240.0) as usize;
    Ok(RatePreparation {
        profile: "hyperframes-0.8.139-exporter-prepare-s16-48k-v1",
        media_start_seconds: native.media_start.to_string(),
        source_duration_seconds: source_duration.to_string(),
        duration_seconds: native.duration.to_string(),
        native_sample_rate: 48000,
        native_max_frames: native_frames + 1,
        native_max_bytes: (native_frames + 1) * 4,
        stereo_filter: ramp(&clock, native.duration, slices, false),
        mono_filter: ramp(&clock, native.duration, slices, true),
        resample_filter: format!(
            "aresample={sample_rate},apad=whole_len={frames},atrim=end_sample={frames}"
        ),
        slices,
        clock_cells: 2 + (points.len() - 1) * 48,
    })
}
