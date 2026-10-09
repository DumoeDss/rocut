//! Final track filter from pinned engine 0.8.139: full prepared/FX/gain history,
//! atrim=0:format6(end-start+tail), then adelay=Math.round(start*1000).
//! This is NOT the distinct WebAudio fractional-phase scheduling algorithm.
use super::model::NativeClip;
use super::participation::sample_aligned;
use crate::programmatic_audio::MAX_SECONDS;
use crate::programmatic_audio::timing::AudioTiming;

pub(super) fn start_sample(
    timing: AudioTiming,
    start: f64,
    sample_rate: u32,
) -> Result<u64, String> {
    if !timing.native_exporter() {
        return sample_aligned(start * f64::from(sample_rate), "clip start");
    }
    if !start.is_finite()
        || !(0.0..=MAX_SECONDS).contains(&start)
        || !matches!(sample_rate, 44100 | 48000)
    {
        return Err("Invalid HyperFrames native exporter placement".into());
    }
    // For admitted nonnegative numbers Rust round has the JS Math.round tie
    // rule. Do not use floor(x + .5): the addition changes nextDown(.5).
    let milliseconds = (start * 1000.0).round();
    // FFmpeg 6 af_adelay parses %f and computes float multiplication/division
    // before truncating to int64. f64/rational arithmetic is not equivalent.
    let product = milliseconds as f32 * sample_rate as f32;
    let frames = product / 1000.0f32;
    if !frames.is_finite() || frames < 0.0 || f64::from(frames) > i64::MAX as f64 {
        return Err("HyperFrames native exporter delay exceeds its safety bound".into());
    }
    Ok(frames as u64)
}

pub(super) fn trim_frames(
    timing: AudioTiming,
    native: &NativeClip,
    tail_seconds: f64,
    sample_rate: u32,
) -> Result<Option<u64>, String> {
    if !timing.native_exporter() {
        return Ok(None);
    }
    let duration = native.end - native.start + tail_seconds;
    if !duration.is_finite()
        || duration < 0.0
        || duration > MAX_SECONDS + 5.0
        || !matches!(sample_rate, 44100 | 48000)
    {
        return Err("Invalid HyperFrames native exporter trim".into());
    }
    // Original Number(value.toFixed(6)).toString(), then FFmpeg's duration
    // parser in integer microseconds and av_rescale_q(..., 1/sample_rate).
    // Parse the decimal exactly, not another multiply/round in binary64.
    let formatted = super::rate_prepare::filter_number(duration);
    let (whole, fraction) = formatted.split_once('.').unwrap_or((&formatted, ""));
    let whole: u64 = whole.parse().map_err(|_| "Invalid exporter trim seconds")?;
    let fractional: u64 = if fraction.is_empty() {
        0
    } else {
        fraction
            .parse::<u64>()
            .map_err(|_| "Invalid exporter trim fraction")?
            * 10u64.pow(6 - fraction.len() as u32)
    };
    let microseconds = whole * 1_000_000 + fractional;
    let scaled = microseconds
        .checked_mul(u64::from(sample_rate))
        .and_then(|value| value.checked_add(500_000))
        .ok_or("HyperFrames native exporter trim exceeds its safety bound")?;
    Ok(Some(scaled / 1_000_000))
}
