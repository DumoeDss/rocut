use crate::MediaTime;
use bridge::export;
use serde::{Deserialize, Serialize};

const TICKS: u128 = 120_000;
const SAFE: u64 = 9_007_199_254_740_991;

fn rate_valid(rate: u32) -> bool {
    (1..=384_000).contains(&rate)
}

fn ticks(time: MediaTime) -> Option<u128> {
    (0..=SAFE as i64)
        .contains(&time.as_ticks())
        .then_some(time.as_ticks() as u128)
}

fn sample(value: f64) -> Option<u64> {
    (value.is_finite() && value >= 0.0 && value <= SAFE as f64 && value.fract() == 0.0)
        .then_some(value as u64)
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioSampleWindowOptions {
    pub start_time: MediaTime,
    pub duration: MediaTime,
    pub sample_rate: u32,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioSampleWindow {
    pub sample_origin: f64,
    pub output_length: u32,
}

/// Frame/range boundaries use the absolute floor grid, as native programmatic
/// audio does. Adjacent ranges partition the full PCM without gaps or overlaps.
#[export]
pub fn plan_audio_sample_window(options: AudioSampleWindowOptions) -> Option<AudioSampleWindow> {
    if !rate_valid(options.sample_rate) {
        return None;
    }
    let start = ticks(options.start_time)?;
    let end = start + ticks(options.duration)?;
    if end > SAFE as u128 {
        return None;
    }
    let origin = start * options.sample_rate as u128 / TICKS;
    let limit = end * options.sample_rate as u128 / TICKS;
    if limit > SAFE as u128 {
        return None;
    }
    Some(AudioSampleWindow {
        sample_origin: origin as f64,
        output_length: (limit - origin).try_into().ok()?,
    })
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioMixWindowOptions {
    pub clip_start: MediaTime,
    pub clip_duration: MediaTime,
    pub sample_origin: f64,
    pub output_length: u32,
    pub sample_rate: u32,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioMixWindow {
    pub start: u32,
    pub end: u32,
}

/// Clip membership is half-open on the absolute grid. Ceil each boundary
/// before subtracting the integer range origin, never ceil a float difference.
#[export]
pub fn plan_audio_mix_window(options: AudioMixWindowOptions) -> Option<AudioMixWindow> {
    if !rate_valid(options.sample_rate) {
        return None;
    }
    let origin = sample(options.sample_origin)? as u128;
    let start = ticks(options.clip_start)?;
    let end = start + ticks(options.clip_duration)?;
    if end > SAFE as u128 || origin + options.output_length as u128 > SAFE as u128 {
        return None;
    }
    let index = |time: u128| {
        (time * options.sample_rate as u128)
            .div_ceil(TICKS)
            .saturating_sub(origin)
            .min(options.output_length as u128) as u32
    };
    Some(AudioMixWindow {
        start: index(start),
        end: index(end),
    })
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioClipSampleTimesOptions {
    pub clip_start: MediaTime,
    pub sample_origin: f64,
    pub sample_count: u32,
    pub sample_rate: u32,
}

/// Bounded batches avoid a WASM crossing per PCM sample or a whole-track
/// temporary allocation. Integer subtraction preserves sub-sample clip phase
/// and yields bit-identical times for full, partial and chunked rendering.
#[export]
pub fn audio_clip_sample_times(options: AudioClipSampleTimesOptions) -> Vec<f64> {
    let Some(start) = ticks(options.clip_start) else {
        return vec![];
    };
    let Some(origin) = sample(options.sample_origin) else {
        return vec![];
    };
    if !rate_valid(options.sample_rate)
        || options.sample_count > 4096
        || origin + options.sample_count as u64 > SAFE
    {
        return vec![];
    }
    let source = start as i128 * options.sample_rate as i128;
    let denominator = TICKS as f64 * options.sample_rate as f64;
    (0..options.sample_count)
        .map(|offset| {
            let position = (origin as i128 + offset as i128) * TICKS as i128;
            (position - source) as f64 / denominator
        })
        .collect()
}
