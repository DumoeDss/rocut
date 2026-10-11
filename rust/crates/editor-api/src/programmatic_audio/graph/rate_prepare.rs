//! Original exporter preparation semantics, not continuous MediaElement preview.
//! Pinned @hyperframes/engine 0.8.139 audioMixer.js, Apache-2.0; see NOTICE.
use super::model::NativeClip;
use super::participation::sample_aligned;
use super::rate_clock::RateClock;
use super::rate_lane::{MAX_RATE, MIN_RATE};
use crate::programmatic_audio::envelope::Point;
use crate::programmatic_audio::timing::AudioTiming;
use crate::programmatic_audio::{MAX_PCM_BYTES, MAX_SECONDS};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RatePreparation {
    pub profile: &'static str,
    pub preparation_kind: &'static str,
    pub output_duration_required: bool,
    pub media_start_seconds: String,
    pub source_duration_seconds: String,
    pub duration_seconds: String,
    pub native_sample_rate: u32,
    pub native_max_frames: u64,
    pub native_max_bytes: u64,
    pub graph_max_frames: u64,
    pub observed_pcm: bool,
    pub stereo_filter: String,
    pub mono_filter: String,
    pub resample_filter: String,
    pub slices: usize,
    pub clock_cells: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_loop: Option<super::rate_loop::SourceLoop>,
}

/// Preserve measured native length independently of declared coverage. Loop
/// source trim/period still have their separate source-domain phase admission.
pub(super) fn observed_pcm(native: &NativeClip, sample_rate: u32) -> bool {
    [sample_rate, 48000].into_iter().any(|rate| {
        sample_aligned(native.duration * f64::from(rate), "clip duration").is_err()
            || (native.r#loop
                && (sample_aligned(native.media_start * f64::from(rate), "loop trim").is_err()
                    || sample_aligned(
                        (native.source_duration - native.media_start) * f64::from(rate),
                        "loop period",
                    )
                    .is_err()))
    })
}

/// A scalar clip with fractional source facts needs the pinned exporter's
/// prepareAudioTrack, not a crop of a generally tempo-adjusted source buffer.
/// Loops retain their separate source-domain phase admission.
pub(super) fn needs_scalar_preparation(native: &NativeClip, sample_rate: u32) -> bool {
    [sample_rate, 48000].into_iter().any(|rate| {
        sample_aligned(native.duration * f64::from(rate), "clip duration").is_err()
            || sample_aligned(native.media_start * f64::from(rate), "media trim").is_err()
            || (native.r#loop
                && sample_aligned(
                    (native.source_duration - native.media_start) * f64::from(rate),
                    "loop period",
                )
                .is_err())
            || sample_aligned(
                native.media_start / native.playback_rate * f64::from(rate),
                "tempo-adjusted media trim",
            )
            .is_err()
    })
}

pub(super) fn prepare_scalar(
    native: &NativeClip,
    sample_rate: u32,
    timing: AudioTiming,
) -> Result<RatePreparation, String> {
    if !super::facts::seconds(native.media_start)
        || !super::facts::seconds(native.duration)
        || !native.playback_rate.is_finite()
        || !(MIN_RATE..=MAX_RATE).contains(&native.playback_rate)
    {
        return Err("Invalid HyperFrames native scalar preparation".into());
    }
    let source_duration = native.duration * native.playback_rate;
    if !source_duration.is_finite() || source_duration > MAX_SECONDS * MAX_RATE {
        return Err("HyperFrames scalar source span exceeds its safety bound".into());
    }
    // Native -ss/-t and atempo determine actual output. Do not force duration
    // geometry before running the original full-clip preparation.
    // Rate one has no native output -t. Reserve source trim endpoint
    // quantization before knowing source metadata: decode.rs admits >=1000 Hz,
    // so two source samples plus conversion rounding occupy at most 98 frames
    // at 48 kHz. This is capacity only; no silence/padding is added to PCM.
    let endpoint_capacity = if native.playback_rate == 1.0 {
        2 * (48000 / 1000) + 2
    } else {
        1
    };
    let native_max_frames = (native.duration * 48000.0).ceil() as u64 + endpoint_capacity;
    let graph_max_frames = (native_max_frames * u64::from(sample_rate)).div_ceil(48000) + 1;
    if native_max_frames > MAX_PCM_BYTES / 8 || graph_max_frames > MAX_PCM_BYTES / 8 {
        return Err("HyperFrames scalar preparation exceeds the PCM safety budget".into());
    }
    let stereo_filter = tempo(native.playback_rate);
    let mono_filter = format!(
        "pan=stereo|FL=FL+FC|FR=FR+FC{}{}",
        if stereo_filter.is_empty() { "" } else { "," },
        stereo_filter,
    );
    let source_loop = if native.r#loop {
        // Reuse the admitted source-domain extension, before native scalar
        // preparation/FX; duration is not rounded to the loop tile geometry.
        Some(super::rate_loop::prepare_with_timing(
            native,
            source_duration,
            sample_rate,
            timing,
        )?)
    } else {
        None
    };
    Ok(RatePreparation {
        profile: "hyperframes-0.8.139-exporter-prepare-s16-48k-v1",
        preparation_kind: "scalar",
        output_duration_required: native.playback_rate != 1.0,
        media_start_seconds: if source_loop.is_some() {
            "0".into()
        } else {
            parameter_number(native.media_start)
        },
        source_duration_seconds: parameter_number(source_duration),
        duration_seconds: parameter_number(native.duration),
        native_sample_rate: 48000,
        native_max_frames,
        native_max_bytes: native_max_frames * 4,
        graph_max_frames,
        observed_pcm: true,
        stereo_filter,
        mono_filter,
        resample_filter: format!("aresample={sample_rate}"),
        slices: 0,
        clock_cells: 0,
        source_loop,
    })
}

fn parameter_number(value: f64) -> String {
    // JS String, unlike toFixed filter parameters, keeps tiny values in exponent
    // notation. Preserve native FFmpeg's acceptance/rejection of those strings.
    if value == 0.0 {
        "0".into()
    } else if value < 1e-6 {
        format!("{:e}", value)
    } else {
        value.to_string()
    }
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

#[cfg(test)]
pub(super) fn prepare(
    native: &NativeClip,
    points: &[Point],
    sample_rate: u32,
) -> Result<RatePreparation, String> {
    prepare_with_timing(native, points, sample_rate, AudioTiming::SampleAligned)
}

pub(super) fn prepare_with_timing(
    native: &NativeClip,
    points: &[Point],
    sample_rate: u32,
    timing: AudioTiming,
) -> Result<RatePreparation, String> {
    if !super::facts::seconds(native.media_start) {
        return Err("Invalid HyperFrames variable-rate media trim".into());
    }
    // Nonloop preparation forwards the original fractional trim to FFmpeg.
    // Its time-parser/source-sample rounding must not be replaced with ours.
    // The independent source-loop extension still requires aligned tile phase;
    // its full clip's fractional duration now uses measured PCM geometry.
    let observed_pcm = observed_pcm(native, sample_rate);
    for sr in [sample_rate, 48000] {
        if !observed_pcm {
            sample_aligned(
                native.duration * f64::from(sr),
                "variable-rate clip duration",
            )?;
        }
    }
    if !super::facts::seconds(native.duration) {
        return Err("Invalid HyperFrames variable-rate clip duration".into());
    }
    let native_frames = if observed_pcm {
        (native.duration * 48000.0).ceil() as u64
    } else {
        sample_aligned(
            native.duration * 48000.0,
            "native rate preparation duration",
        )?
    };
    // Capacity is deliberately not the semantic duration or measured PCM count.
    let frames = if observed_pcm {
        ((native_frames + 1) * u64::from(sample_rate)).div_ceil(48000) + 1
    } else {
        sample_aligned(
            native.duration * f64::from(sample_rate),
            "variable-rate clip duration",
        )?
    };
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
    let source_loop = native
        .r#loop
        .then(|| {
            super::rate_loop::prepare_with_timing(native, source_duration, sample_rate, timing)
        })
        .transpose()?;
    Ok(RatePreparation {
        profile: "hyperframes-0.8.139-exporter-prepare-s16-48k-v1",
        preparation_kind: "ramp",
        output_duration_required: true,
        media_start_seconds: if source_loop.is_some() {
            "0".into()
        } else {
            parameter_number(native.media_start)
        },
        source_duration_seconds: parameter_number(source_duration),
        duration_seconds: parameter_number(native.duration),
        native_sample_rate: 48000,
        native_max_frames: native_frames + 1,
        native_max_bytes: (native_frames + 1) * 4,
        graph_max_frames: frames,
        observed_pcm,
        stereo_filter: ramp(&clock, native.duration, slices, false),
        mono_filter: ramp(&clock, native.duration, slices, true),
        resample_filter: if observed_pcm {
            format!("aresample={sample_rate}")
        } else {
            format!("aresample={sample_rate},apad=whole_len={frames},atrim=end_sample={frames}")
        },
        slices,
        clock_cells: 2 + (points.len() - 1) * 48,
        source_loop,
    })
}
