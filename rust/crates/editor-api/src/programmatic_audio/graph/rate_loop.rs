//! Source-domain loop extension preserves native author/preview loop intent.
//! The pinned exporter omits loop. Canonical Float32 source materialization must
//! precede its unchanged full-clip ramp preparation; an inline graph is NOT PCM
//! equivalent (real mono oracle). Never repeat already tempo-adjusted samples.
use super::model::NativeClip;
use super::participation::sample_aligned;
use crate::programmatic_audio::MAX_PCM_BYTES;
use crate::programmatic_audio::timing::AudioTiming;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SourceLoop {
    pub media_start_seconds: String,
    pub source_duration_seconds: String,
    pub period_frames: u64,
    pub source_frames: u64,
    pub repeat_count: u32,
    pub max_wav_bytes: u64,
    pub working_set_bytes: u64,
    pub stereo_filter: String,
    pub mono_filter: String,
}

fn filter(period: u64, source: u64, repeats: u32, mono: bool) -> String {
    format!(
        "aresample=48000,{}aformat=sample_fmts=flt:channel_layouts=stereo,apad=whole_len={period},atrim=end_sample={period},aloop=loop={repeats}:size={period},atrim=end_sample={source},asetpts=N/SR/TB",
        if mono {
            "pan=stereo|FL=FL+FC|FR=FR+FC,"
        } else {
            ""
        }
    )
}

#[cfg(test)]
pub(super) fn prepare(
    native: &NativeClip,
    consumed_seconds: f64,
    graph_rate: u32,
) -> Result<SourceLoop, String> {
    prepare_with_timing(
        native,
        consumed_seconds,
        graph_rate,
        AudioTiming::SampleAligned,
    )
}

pub(super) fn prepare_with_timing(
    native: &NativeClip,
    consumed_seconds: f64,
    graph_rate: u32,
    timing: AudioTiming,
) -> Result<SourceLoop, String> {
    let period = native.source_duration - native.media_start;
    if !period.is_finite() || period <= 0.0 {
        return Err(
            "HyperFrames variable-rate loop requires a positive trimmed source period".into(),
        );
    }
    for rate in [graph_rate, 48000] {
        sample_aligned(period * f64::from(rate), "variable-rate loop period")?;
        if !timing.native_exporter() {
            sample_aligned(
                native.start * f64::from(rate),
                "variable-rate loop clip start",
            )?;
        }
    }
    let period_frames = sample_aligned(period * 48000.0, "native variable-rate loop period")?;
    // FFmpeg's input -t at a 48k canonical source rounds to the nearest frame.
    // The continuous rate clock itself is not quantized at each wrap/slice.
    let source_frames = (consumed_seconds * 48000.0).round();
    if !source_frames.is_finite()
        || source_frames < 1.0
        || source_frames > (MAX_PCM_BYTES / 8) as f64
        || period_frames == 0
        || period_frames > MAX_PCM_BYTES / 8
    {
        return Err(
            "HyperFrames variable-rate loop source/tile exceeds its PCM safety budget".into(),
        );
    }
    let source_frames = source_frames as u64;
    let repeats = source_frames.div_ceil(period_frames).saturating_sub(1);
    // Bounds are Rust-owned even when a one-sample period is supplied. FFmpeg's
    // finite loop parameter is signed; no -1/infinite materialization is used.
    if repeats > i32::MAX as u64 {
        return Err("HyperFrames variable-rate loop repetition budget exceeded".into());
    }
    let repeat_count = repeats as u32;
    let source_bytes = source_frames * 8;
    let max_wav_bytes = source_bytes + 65536;
    // Host stdout chunks+joined WAV and conservative native source/tile copies.
    // Fixed reserve covers opaque FFmpeg queues; not a process-RSS guarantee.
    let working_set_bytes =
        2 * max_wav_bytes + 2 * source_bytes + 2 * period_frames * 8 + 32 * 1024 * 1024;
    Ok(SourceLoop {
        media_start_seconds: native.media_start.to_string(),
        source_duration_seconds: period.to_string(),
        period_frames,
        source_frames,
        repeat_count,
        max_wav_bytes,
        working_set_bytes,
        stereo_filter: filter(period_frames, source_frames, repeat_count, false),
        mono_filter: filter(period_frames, source_frames, repeat_count, true),
    })
}
