use super::{MAX_ANALYSIS_FRAMES, MAX_PCM_BYTES};
use bridge::export;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Rate {
    pub numerator: u32,
    pub denominator: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: u32,
    frame_rate: Rate,
    sample_rate: u32,
    first_frame: u32,
    frame_count: u32,
    duration_frames: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Range {
    first_frame: u32,
    frame_count: u32,
    ticks_per_frame: u64,
    sample_rate: u32,
    channels: u32,
    pub output_frames: u64,
    pub sample_origin: u64,
}

impl Range {
    pub fn sample_at(&self, frame: u64) -> u64 {
        frame * self.ticks_per_frame * self.sample_rate as u64 / 120_000
    }

    pub fn source_sample(&self, frame: u64, source_samples: f64) -> u64 {
        // Place the inferred native source origin on the same absolute sample
        // grid as the output. Rounding source time alone shifts partial ranges
        // by one sample at fractional FPS or after a Sequence boundary.
        let phase =
            (frame * self.ticks_per_frame * self.sample_rate as u64 % 120_000) as f64 / 120_000.0;
        // Suppress only sub-micro-sample floating error from native timestamps.
        (source_samples - phase - 1e-6).ceil().max(0.0) as u64
    }
}

pub(super) fn resolve_range(
    version: u32,
    rate: &Rate,
    sample_rate: u32,
    first_frame: u32,
    frame_count: u32,
) -> Result<Range, String> {
    if version != 1
        || frame_count == 0
        || frame_count > MAX_ANALYSIS_FRAMES
        || first_frame as u64 + frame_count as u64 > 1_000_000
        || !matches!(sample_rate, 44100 | 48000)
        || rate.numerator == 0
        || rate.numerator > 120_000
        || rate.denominator == 0
        || rate.denominator > 1001
        || (120_000u64 * rate.denominator as u64) % rate.numerator as u64 != 0
    {
        return Err("Invalid programmatic audio frame range/rate".into());
    }
    let mut range = Range {
        first_frame,
        frame_count,
        ticks_per_frame: 120_000u64 * rate.denominator as u64 / rate.numerator as u64,
        sample_rate,
        channels: 2,
        output_frames: 0,
        sample_origin: 0,
    };
    range.sample_origin = range.sample_at(first_frame as u64);
    range.output_frames =
        range.sample_at(first_frame as u64 + frame_count as u64) - range.sample_origin;
    if range.output_frames == 0 || range.output_frames > MAX_PCM_BYTES / 8 {
        return Err("Programmatic audio range exceeds the PCM budget".into());
    }
    Ok(range)
}

/// Admission before any browser work. The scheduler uses the same clock/budget.
#[export]
pub fn resolve_programmatic_audio_range_json(input: String) -> String {
    let result = (|| -> Result<Range, String> {
        if input.len() > 4096 {
            return Err("Audio range payload exceeds the limit".into());
        }
        let r: Request = serde_json::from_str(&input).map_err(|e| e.to_string())?;
        if r.duration_frames == 0
            || r.duration_frames > 1_000_000
            || r.first_frame as u64 + r.frame_count as u64 > r.duration_frames as u64
        {
            return Err("Audio range exceeds the source duration".into());
        }
        resolve_range(
            r.version,
            &r.frame_rate,
            r.sample_rate,
            r.first_frame,
            r.frame_count,
        )
    })();
    match result {
        Ok(plan) => serde_json::json!({"plan":plan}).to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}
