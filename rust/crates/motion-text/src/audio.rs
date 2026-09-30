use bridge::export;
use serde::{Deserialize, Serialize};
use time::TICKS_PER_SECOND;

pub const MOTION_TEXT_AUDIO_ANALYSIS_VERSION: u32 = 1;

const ENERGY_RATE_HZ: f64 = 50.0;
const MIN_SAMPLE_RATE: u32 = 8_000;
const MAX_SAMPLE_RATE: u32 = 384_000;
const MAX_PCM_SAMPLES: usize = 100_000_000;
const MIN_TEMPO_BPM: f64 = 70.0;
const MAX_TEMPO_BPM: f64 = 180.0;
const TEMPO_PRIOR_BPM: f64 = 125.0;

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeMotionTextAudioOptions {
    #[serde(with = "serde_bytes")]
    #[cfg_attr(feature = "wasm", tsify(type = "Uint8Array"))]
    pub pcm_f32le: Vec<u8>,
    pub sample_rate: u32,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MotionTextAudioDiagnosticSeverity {
    Warning,
    Error,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextAudioDiagnostic {
    pub severity: MotionTextAudioDiagnosticSeverity,
    pub code: String,
    pub message: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextAudioAnalysis {
    pub version: u32,
    pub sample_rate: u32,
    pub sample_count: u32,
    pub duration: i64,
    pub energy_hop_samples: u32,
    pub energy: Vec<f32>,
    pub bpm: Option<f64>,
    pub first_beat: Option<i64>,
    pub beats: Vec<i64>,
    pub confidence: f64,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextAudioAnalysisResult {
    pub analysis: Option<MotionTextAudioAnalysis>,
    pub diagnostics: Vec<MotionTextAudioDiagnostic>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveMotionTextBeatGridOptions {
    pub duration: i64,
    pub detected_bpm: Option<f64>,
    pub detected_first_beat: Option<i64>,
    #[serde(default)]
    pub source_offset: Option<i64>,
    pub bpm_override: Option<f64>,
    pub first_beat_override: Option<i64>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum MotionTextBeatValueSource {
    Detected,
    Manual,
    Default,
    Unavailable,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextBeatGrid {
    pub bpm: Option<f64>,
    pub first_beat: Option<i64>,
    pub bpm_source: MotionTextBeatValueSource,
    pub first_beat_source: MotionTextBeatValueSource,
    pub beats: Vec<i64>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextBeatGridResult {
    pub grid: Option<MotionTextBeatGrid>,
    pub diagnostics: Vec<MotionTextAudioDiagnostic>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapMotionTextTimeToBeatOptions {
    pub time: i64,
    pub bpm: f64,
    pub first_beat: i64,
    pub max_distance: Option<i64>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextBeatSnapResult {
    pub time: i64,
    pub snapped: bool,
    pub beat_index: Option<i64>,
    pub error: Option<String>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveMotionTextAudioClipBindingOptions {
    pub sequence_duration: i64,
    pub sequence_clip_start: i64,
    pub sequence_trim_start: i64,
    pub sequence_clip_duration: i64,
    pub audio_clip_start: i64,
    pub audio_clip_duration: i64,
    pub audio_trim_start: i64,
    pub audio_source_duration: i64,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextAudioClipBindingResult {
    pub source_offset: Option<i64>,
    pub duration: Option<i64>,
    pub error_code: Option<String>,
    pub error: Option<String>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessMotionTextAudioSyncOptions {
    pub bound_asset_id: String,
    pub bound_clip_id: Option<String>,
    pub bound_source_offset: i64,
    pub bound_duration: Option<i64>,
    pub bound_content_digest: Option<String>,
    pub current_asset_id: Option<String>,
    pub current_clip_id: Option<String>,
    pub current_source_offset: Option<i64>,
    pub current_duration: Option<i64>,
    pub current_content_digest: Option<String>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum MotionTextAudioSyncStatus {
    Synchronized,
    Unchecked,
    MissingAsset,
    MissingClip,
    AssetChanged,
    ContentChanged,
    TimingChanged,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextAudioSyncAssessment {
    pub status: MotionTextAudioSyncStatus,
    pub requires_sync: bool,
    pub analysis_reusable: bool,
}

#[export]
pub fn analyze_motion_text_audio(
    AnalyzeMotionTextAudioOptions {
        pcm_f32le,
        sample_rate,
    }: AnalyzeMotionTextAudioOptions,
) -> MotionTextAudioAnalysisResult {
    let mut diagnostics = Vec::new();
    if !(MIN_SAMPLE_RATE..=MAX_SAMPLE_RATE).contains(&sample_rate) {
        return failed_analysis(
            "unsupported-sample-rate",
            format!(
                "Motion-text audio sample rate must be between {MIN_SAMPLE_RATE} and {MAX_SAMPLE_RATE} Hz."
            ),
        );
    }
    if pcm_f32le.is_empty() {
        return failed_analysis("empty-audio", "Motion-text audio PCM is empty.");
    }
    if pcm_f32le.len() % size_of::<f32>() != 0 {
        return failed_analysis(
            "invalid-pcm",
            "Motion-text audio PCM must contain little-endian f32 samples.",
        );
    }
    let sample_count = pcm_f32le.len() / size_of::<f32>();
    if sample_count > MAX_PCM_SAMPLES {
        return failed_analysis(
            "audio-sample-limit",
            format!("Motion-text audio exceeds the {MAX_PCM_SAMPLES} sample analysis limit."),
        );
    }

    let samples: Vec<f32> = pcm_f32le
        .chunks_exact(size_of::<f32>())
        .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .collect();
    if samples.iter().any(|sample| !sample.is_finite()) {
        return failed_analysis(
            "non-finite-pcm",
            "Motion-text audio PCM contains a non-finite sample.",
        );
    }

    let hop = ((f64::from(sample_rate) / ENERGY_RATE_HZ).round() as usize).max(1);
    let frame_count = sample_count.div_ceil(hop);
    let mut energy = Vec::with_capacity(frame_count);
    let mut high_pass_energy = Vec::with_capacity(frame_count);
    let mut previous_high_pass = 0.0_f64;
    let mut previous_sample = 0.0_f64;
    for frame in 0..frame_count {
        let start = frame * hop;
        let end = (start + hop).min(sample_count);
        let count = (end - start).max(1) as f64;
        let mut square_sum = 0.0_f64;
        let mut high_pass_square_sum = 0.0_f64;
        for sample in &samples[start..end] {
            let sample = f64::from(*sample);
            square_sum += sample * sample;
            let high_pass = 0.92 * (previous_high_pass + sample - previous_sample);
            previous_high_pass = high_pass;
            previous_sample = sample;
            high_pass_square_sum += high_pass * high_pass;
        }
        energy.push((square_sum / count).sqrt() as f32);
        high_pass_energy.push((high_pass_square_sum / count).sqrt());
    }

    let mut onset = vec![0.0_f64; frame_count];
    for frame in 1..frame_count {
        let current = (1e-4 + high_pass_energy[frame]).ln();
        let history_start = frame.saturating_sub(4);
        let history = &high_pass_energy[history_start..frame];
        let local_mean = history.iter().map(|value| (1e-4 + value).ln()).sum::<f64>()
            / history.len().max(1) as f64;
        onset[frame] = (current - local_mean).max(0.0);
    }

    normalize_energy(&mut energy);
    let duration = samples_to_ticks(sample_count, sample_rate);
    let effective_rate = f64::from(sample_rate) / hop as f64;
    let tempo = estimate_tempo(&onset, effective_rate, duration);
    let (bpm, first_beat, beats, confidence) = match tempo {
        Some(tempo) => (
            Some(tempo.bpm),
            Some(tempo.first_beat),
            tempo.beats,
            tempo.confidence,
        ),
        None => {
            diagnostics.push(warning(
                "tempo-unavailable",
                "No reliable fixed tempo was detected; energy analysis is still available.",
            ));
            (None, None, Vec::new(), 0.0)
        }
    };

    MotionTextAudioAnalysisResult {
        analysis: Some(MotionTextAudioAnalysis {
            version: MOTION_TEXT_AUDIO_ANALYSIS_VERSION,
            sample_rate,
            sample_count: u32::try_from(sample_count).expect("sample limit fits u32"),
            duration,
            energy_hop_samples: u32::try_from(hop).expect("sample rate limit fits u32"),
            energy,
            bpm,
            first_beat,
            beats,
            confidence,
        }),
        diagnostics,
    }
}

#[export]
pub fn resolve_motion_text_beat_grid(
    ResolveMotionTextBeatGridOptions {
        duration,
        detected_bpm,
        detected_first_beat,
        source_offset,
        bpm_override,
        first_beat_override,
    }: ResolveMotionTextBeatGridOptions,
) -> MotionTextBeatGridResult {
    let mut diagnostics = Vec::new();
    if duration <= 0 {
        return failed_grid(
            "invalid-duration",
            "Motion-text beat-grid duration must be positive.",
        );
    }
    if source_offset.is_some_and(|value| value < 0) {
        return failed_grid(
            "invalid-source-offset",
            "Motion-text beat-grid source offset must be non-negative.",
        );
    }
    for (name, bpm) in [("detected", detected_bpm), ("manual", bpm_override)] {
        if bpm.is_some_and(|value| !valid_bpm(value)) {
            return failed_grid(
                "invalid-bpm",
                format!("The {name} BPM must be finite and between 20 and 400."),
            );
        }
    }
    for (name, first_beat) in [
        ("detected", detected_first_beat),
        ("manual", first_beat_override),
    ] {
        if first_beat.is_some_and(|value| value < 0) {
            return failed_grid(
                "invalid-first-beat",
                format!("The {name} first beat must be non-negative."),
            );
        }
    }

    let (bpm, bpm_source) = if let Some(value) = bpm_override {
        (Some(value), MotionTextBeatValueSource::Manual)
    } else if let Some(value) = detected_bpm {
        (Some(value), MotionTextBeatValueSource::Detected)
    } else {
        (None, MotionTextBeatValueSource::Unavailable)
    };
    let (first_beat, first_beat_source) = if let Some(value) = first_beat_override {
        (Some(value), MotionTextBeatValueSource::Manual)
    } else if let Some(value) = detected_first_beat {
        let sequence_value = match (source_offset, bpm) {
            (Some(offset), Some(bpm)) => beat_phase_in_sequence(value, offset, bpm),
            _ => value,
        };
        (Some(sequence_value), MotionTextBeatValueSource::Detected)
    } else if bpm.is_some() {
        (Some(0), MotionTextBeatValueSource::Default)
    } else {
        (None, MotionTextBeatValueSource::Unavailable)
    };

    let beats = match (bpm, first_beat) {
        (Some(bpm), Some(first_beat)) => beat_ticks(bpm, first_beat, duration),
        _ => {
            diagnostics.push(warning(
                "beat-grid-unavailable",
                "A BPM is required before a motion-text beat grid can be generated.",
            ));
            Vec::new()
        }
    };
    MotionTextBeatGridResult {
        grid: Some(MotionTextBeatGrid {
            bpm,
            first_beat,
            bpm_source,
            first_beat_source,
            beats,
        }),
        diagnostics,
    }
}

fn beat_phase_in_sequence(source_first_beat: i64, source_offset: i64, bpm: f64) -> i64 {
    let period = 60.0 * TICKS_PER_SECOND as f64 / bpm;
    let phase = (source_first_beat - source_offset) as f64;
    let rounded = phase.rem_euclid(period).round();
    if rounded >= period { 0 } else { rounded as i64 }
}

#[export]
pub fn snap_motion_text_time_to_beat(
    SnapMotionTextTimeToBeatOptions {
        time,
        bpm,
        first_beat,
        max_distance,
    }: SnapMotionTextTimeToBeatOptions,
) -> MotionTextBeatSnapResult {
    if time < 0 || first_beat < 0 || max_distance.is_some_and(|distance| distance < 0) {
        return failed_snap(
            time,
            "Motion-text beat snapping requires non-negative times.",
        );
    }
    if !valid_bpm(bpm) {
        return failed_snap(
            time,
            "Motion-text beat snapping requires a finite BPM between 20 and 400.",
        );
    }
    let period = 60.0 * TICKS_PER_SECOND as f64 / bpm;
    let relative = (time - first_beat) as f64 / period;
    let beat_index = relative.round().max(0.0) as i64;
    let candidate = (first_beat as f64 + beat_index as f64 * period).round() as i64;
    let distance = candidate.abs_diff(time);
    if max_distance.is_some_and(|maximum| distance > maximum as u64) {
        return MotionTextBeatSnapResult {
            time,
            snapped: false,
            beat_index: None,
            error: None,
        };
    }
    MotionTextBeatSnapResult {
        time: candidate,
        snapped: candidate != time,
        beat_index: Some(beat_index),
        error: None,
    }
}

#[export]
pub fn resolve_motion_text_audio_clip_binding(
    ResolveMotionTextAudioClipBindingOptions {
        sequence_duration,
        sequence_clip_start,
        sequence_trim_start,
        sequence_clip_duration,
        audio_clip_start,
        audio_clip_duration,
        audio_trim_start,
        audio_source_duration,
    }: ResolveMotionTextAudioClipBindingOptions,
) -> MotionTextAudioClipBindingResult {
    if sequence_duration <= 0
        || sequence_clip_start < 0
        || sequence_trim_start < 0
        || sequence_clip_duration <= 0
        || audio_clip_start < 0
        || audio_clip_duration <= 0
        || audio_trim_start < 0
        || audio_source_duration <= 0
    {
        return failed_clip_binding(
            "invalid-clip-range",
            "Motion-text audio binding requires positive durations and non-negative timeline values.",
        );
    }
    if sequence_trim_start
        .checked_add(sequence_clip_duration)
        .is_none_or(|end| end > sequence_duration)
        || audio_trim_start
            .checked_add(audio_clip_duration)
            .is_none_or(|end| end > audio_source_duration)
    {
        return failed_clip_binding(
            "clip-range-out-of-bounds",
            "The visible motion-text or audio clip range exceeds its source duration.",
        );
    }
    let Some(sequence_clip_end) = sequence_clip_start.checked_add(sequence_clip_duration) else {
        return failed_clip_binding(
            "clip-range-overflow",
            "The motion-text clip range overflowed.",
        );
    };
    let Some(audio_clip_end) = audio_clip_start.checked_add(audio_clip_duration) else {
        return failed_clip_binding("clip-range-overflow", "The audio clip range overflowed.");
    };
    if sequence_clip_start < audio_clip_start || sequence_clip_end > audio_clip_end {
        return failed_clip_binding(
            "clip-range-mismatch",
            "The selected audio clip must cover the full visible motion-text clip.",
        );
    }

    let source_offset = i128::from(audio_trim_start)
        + i128::from(sequence_clip_start - audio_clip_start)
        - i128::from(sequence_trim_start);
    let Ok(source_offset) = i64::try_from(source_offset) else {
        return failed_clip_binding(
            "source-offset-overflow",
            "The calculated motion-text audio source offset overflowed.",
        );
    };
    if source_offset < 0
        || source_offset
            .checked_add(sequence_duration)
            .is_none_or(|end| end > audio_source_duration)
    {
        return failed_clip_binding(
            "source-range-mismatch",
            "The selected audio source does not cover the full motion-text sequence at this alignment.",
        );
    }
    MotionTextAudioClipBindingResult {
        source_offset: Some(source_offset),
        duration: Some(sequence_duration),
        error_code: None,
        error: None,
    }
}

#[export]
pub fn assess_motion_text_audio_sync(
    AssessMotionTextAudioSyncOptions {
        bound_asset_id,
        bound_clip_id,
        bound_source_offset,
        bound_duration,
        bound_content_digest,
        current_asset_id,
        current_clip_id,
        current_source_offset,
        current_duration,
        current_content_digest,
    }: AssessMotionTextAudioSyncOptions,
) -> MotionTextAudioSyncAssessment {
    let (status, analysis_reusable) = if current_asset_id.is_none() {
        (MotionTextAudioSyncStatus::MissingAsset, false)
    } else if current_asset_id.as_deref() != Some(bound_asset_id.as_str()) {
        (MotionTextAudioSyncStatus::AssetChanged, false)
    } else if bound_clip_id.is_some() && current_clip_id != bound_clip_id {
        (MotionTextAudioSyncStatus::MissingClip, false)
    } else if let (Some(bound_digest), Some(current_digest)) =
        (&bound_content_digest, &current_content_digest)
    {
        if bound_digest != current_digest {
            (MotionTextAudioSyncStatus::ContentChanged, false)
        } else if current_source_offset != Some(bound_source_offset)
            || current_duration != bound_duration
        {
            (MotionTextAudioSyncStatus::TimingChanged, true)
        } else {
            (MotionTextAudioSyncStatus::Synchronized, true)
        }
    } else if current_source_offset != Some(bound_source_offset)
        || current_duration != bound_duration
    {
        (MotionTextAudioSyncStatus::TimingChanged, false)
    } else {
        (MotionTextAudioSyncStatus::Unchecked, false)
    };
    MotionTextAudioSyncAssessment {
        status,
        requires_sync: !matches!(
            status,
            MotionTextAudioSyncStatus::Synchronized | MotionTextAudioSyncStatus::Unchecked
        ),
        analysis_reusable,
    }
}

#[derive(Clone, Debug)]
struct TempoEstimate {
    bpm: f64,
    first_beat: i64,
    beats: Vec<i64>,
    confidence: f64,
}

fn estimate_tempo(onset: &[f64], rate: f64, duration: i64) -> Option<TempoEstimate> {
    if onset.len() < 4 || onset.iter().sum::<f64>() <= 1e-6 {
        return None;
    }
    let min_lag = (rate * 60.0 / MAX_TEMPO_BPM).round().max(1.0) as usize;
    let max_lag = (rate * 60.0 / MIN_TEMPO_BPM).round().max(min_lag as f64) as usize;
    if onset.len() <= min_lag * 2 {
        return None;
    }

    let upper_lag = max_lag.min(onset.len().saturating_sub(2));
    let mut scores = vec![None; upper_lag + 2];
    let mut correlations = vec![None; upper_lag + 2];
    let mut best_lag = min_lag;
    let mut best_score = f64::NEG_INFINITY;
    for lag in min_lag..=upper_lag {
        let mut cross = 0.0;
        let mut lhs_square = 0.0;
        let mut rhs_square = 0.0;
        for frame in lag..onset.len() {
            let lhs = onset[frame];
            let rhs = onset[frame - lag];
            cross += lhs * rhs;
            lhs_square += lhs * lhs;
            rhs_square += rhs * rhs;
        }
        let denominator = (lhs_square * rhs_square).sqrt();
        let correlation = if denominator > 1e-12 {
            cross / denominator
        } else {
            0.0
        };
        let bpm = 60.0 * rate / lag as f64;
        let prior = (-0.5 * (f64::log2(bpm / TEMPO_PRIOR_BPM) / 0.7).powi(2)).exp();
        let score = correlation * prior;
        scores[lag] = Some(score);
        correlations[lag] = Some(correlation);
        if score > best_score {
            best_score = score;
            best_lag = lag;
        }
    }
    let confidence = correlations[best_lag].unwrap_or(0.0).clamp(0.0, 1.0);
    if best_score <= 0.02 || confidence < 0.08 {
        return None;
    }

    let mut refined_lag = best_lag as f64;
    if best_lag > min_lag && best_lag < upper_lag {
        if let (Some(left), Some(center), Some(right)) =
            (scores[best_lag - 1], scores[best_lag], scores[best_lag + 1])
        {
            let denominator = left - 2.0 * center + right;
            if denominator.abs() > 1e-12 {
                refined_lag += 0.5 * (left - right) / denominator;
            }
        }
    }
    if !refined_lag.is_finite() || refined_lag <= 0.0 {
        return None;
    }

    let mut best_phase = 0.0;
    let mut best_phase_score = f64::NEG_INFINITY;
    let mut phase = 0.0;
    while phase < refined_lag {
        let mut phase_score = 0.0;
        let mut frame = phase;
        while frame < onset.len() as f64 {
            phase_score += onset.get(frame.round() as usize).copied().unwrap_or(0.0);
            frame += refined_lag;
        }
        if phase_score > best_phase_score {
            best_phase_score = phase_score;
            best_phase = phase;
        }
        phase += 0.5;
    }
    if best_phase_score <= 0.0 {
        return None;
    }

    let bpm = 60.0 * rate / refined_lag;
    let first_beat = (best_phase / rate * TICKS_PER_SECOND as f64).round() as i64;
    Some(TempoEstimate {
        bpm,
        first_beat,
        beats: beat_ticks(bpm, first_beat, duration),
        confidence,
    })
}

fn normalize_energy(energy: &mut [f32]) {
    let mut sorted: Vec<_> = energy
        .iter()
        .copied()
        .filter(|value| *value > 1e-12)
        .collect();
    sorted.sort_by(f32::total_cmp);
    let percentile_index = sorted.len().saturating_sub(1) * 95 / 100;
    let percentile = sorted.get(percentile_index).copied().unwrap_or(0.0);
    if percentile <= 1e-12 {
        energy.fill(0.0);
        return;
    }
    for value in energy {
        *value = (*value / percentile).clamp(0.0, 1.0);
    }
}

fn beat_ticks(bpm: f64, first_beat: i64, duration: i64) -> Vec<i64> {
    if !valid_bpm(bpm) || first_beat < 0 || duration <= 0 || first_beat >= duration {
        return Vec::new();
    }
    let period = 60.0 * TICKS_PER_SECOND as f64 / bpm;
    let beat_count = (((duration - first_beat) as f64 / period).ceil() as usize).min(100_000);
    (0..beat_count)
        .map(|index| (first_beat as f64 + index as f64 * period).round() as i64)
        .take_while(|tick| *tick < duration)
        .collect()
}

fn samples_to_ticks(sample_count: usize, sample_rate: u32) -> i64 {
    (sample_count as f64 * TICKS_PER_SECOND as f64 / f64::from(sample_rate)).round() as i64
}

fn valid_bpm(bpm: f64) -> bool {
    bpm.is_finite() && (20.0..=400.0).contains(&bpm)
}

fn warning(code: &str, message: impl Into<String>) -> MotionTextAudioDiagnostic {
    MotionTextAudioDiagnostic {
        severity: MotionTextAudioDiagnosticSeverity::Warning,
        code: code.to_owned(),
        message: message.into(),
    }
}

fn error(code: &str, message: impl Into<String>) -> MotionTextAudioDiagnostic {
    MotionTextAudioDiagnostic {
        severity: MotionTextAudioDiagnosticSeverity::Error,
        code: code.to_owned(),
        message: message.into(),
    }
}

fn failed_analysis(code: &str, message: impl Into<String>) -> MotionTextAudioAnalysisResult {
    MotionTextAudioAnalysisResult {
        analysis: None,
        diagnostics: vec![error(code, message)],
    }
}

fn failed_grid(code: &str, message: impl Into<String>) -> MotionTextBeatGridResult {
    MotionTextBeatGridResult {
        grid: None,
        diagnostics: vec![error(code, message)],
    }
}

fn failed_snap(time: i64, message: impl Into<String>) -> MotionTextBeatSnapResult {
    MotionTextBeatSnapResult {
        time,
        snapped: false,
        beat_index: None,
        error: Some(message.into()),
    }
}

fn failed_clip_binding(code: &str, message: impl Into<String>) -> MotionTextAudioClipBindingResult {
    MotionTextAudioClipBindingResult {
        source_offset: None,
        duration: None,
        error_code: Some(code.to_owned()),
        error: Some(message.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pcm_bytes(samples: &[f32]) -> Vec<u8> {
        samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect()
    }

    fn analyze(samples: &[f32], sample_rate: u32) -> MotionTextAudioAnalysisResult {
        analyze_motion_text_audio(AnalyzeMotionTextAudioOptions {
            pcm_f32le: pcm_bytes(samples),
            sample_rate,
        })
    }

    #[test]
    fn silence_has_energy_but_no_invented_tempo() {
        let result = analyze(&vec![0.0; 48_000 * 3], 48_000);
        let analysis = result.analysis.expect("silence still produces energy data");

        assert!(analysis.energy.iter().all(|value| *value == 0.0));
        assert_eq!(analysis.bpm, None);
        assert_eq!(analysis.first_beat, None);
        assert!(analysis.beats.is_empty());
        assert_eq!(result.diagnostics[0].code, "tempo-unavailable");
    }

    #[test]
    fn detects_a_fixed_click_track_and_normalizes_energy() {
        let sample_rate = 8_000_u32;
        let duration_seconds = 12;
        let mut samples = vec![0.0_f32; sample_rate as usize * duration_seconds];
        let first_beat_sample = sample_rate as usize / 5;
        let beat_period = sample_rate as usize / 2;
        for beat in (first_beat_sample..samples.len()).step_by(beat_period) {
            for offset in 0..32 {
                if let Some(sample) = samples.get_mut(beat + offset) {
                    *sample = 1.0 - offset as f32 / 32.0;
                }
            }
        }

        let result = analyze(&samples, sample_rate);
        let analysis = result.analysis.expect("click track is analyzable");
        let bpm = analysis.bpm.expect("click track has a tempo");

        assert!((bpm - 120.0).abs() < 1.0, "detected {bpm}");
        assert!(analysis.confidence > 0.5);
        assert!(
            analysis
                .energy
                .iter()
                .all(|value| (0.0..=1.0).contains(value))
        );
        assert!(analysis.energy.iter().any(|value| *value > 0.9));
        assert!(analysis.first_beat.is_some());
        assert!(analysis.beats.len() >= 20);
    }

    #[test]
    fn rejects_malformed_and_non_finite_pcm() {
        let malformed = analyze_motion_text_audio(AnalyzeMotionTextAudioOptions {
            pcm_f32le: vec![0, 1, 2],
            sample_rate: 48_000,
        });
        assert!(malformed.analysis.is_none());
        assert_eq!(malformed.diagnostics[0].code, "invalid-pcm");

        let non_finite = analyze(&[f32::NAN], 48_000);
        assert!(non_finite.analysis.is_none());
        assert_eq!(non_finite.diagnostics[0].code, "non-finite-pcm");
    }

    #[test]
    fn manual_grid_overrides_detection_without_accumulated_drift() {
        let duration = 8 * 60 * TICKS_PER_SECOND;
        let result = resolve_motion_text_beat_grid(ResolveMotionTextBeatGridOptions {
            duration,
            detected_bpm: Some(119.7),
            detected_first_beat: Some(12_000),
            source_offset: None,
            bpm_override: Some(120.0),
            first_beat_override: Some(24_000),
        });
        let grid = result.grid.expect("valid grid");

        assert_eq!(grid.bpm, Some(120.0));
        assert_eq!(grid.first_beat, Some(24_000));
        assert_eq!(grid.bpm_source, MotionTextBeatValueSource::Manual);
        assert_eq!(grid.first_beat_source, MotionTextBeatValueSource::Manual);
        assert_eq!(grid.beats[900], 24_000 + 900 * 60_000);
        assert_eq!(grid.beats.last().copied(), Some(57_564_000));
    }

    #[test]
    fn grid_uses_detected_values_and_defaults_a_missing_phase() {
        let result = resolve_motion_text_beat_grid(ResolveMotionTextBeatGridOptions {
            duration: 10 * TICKS_PER_SECOND,
            detected_bpm: Some(100.0),
            detected_first_beat: None,
            source_offset: None,
            bpm_override: None,
            first_beat_override: None,
        });
        let grid = result.grid.expect("valid grid");

        assert_eq!(grid.bpm_source, MotionTextBeatValueSource::Detected);
        assert_eq!(grid.first_beat_source, MotionTextBeatValueSource::Default);
        assert_eq!(grid.beats[0], 0);
        assert_eq!(grid.beats[1], 72_000);
    }

    #[test]
    fn maps_detected_audio_source_phase_into_sequence_time() {
        let result = resolve_motion_text_beat_grid(ResolveMotionTextBeatGridOptions {
            duration: 10 * TICKS_PER_SECOND,
            detected_bpm: Some(120.0),
            detected_first_beat: Some(12_000),
            source_offset: Some(84_000),
            bpm_override: None,
            first_beat_override: None,
        });
        let grid = result.grid.expect("valid grid");

        assert_eq!(grid.first_beat, Some(48_000));
        assert_eq!(grid.first_beat_source, MotionTextBeatValueSource::Detected);
        assert_eq!(grid.beats[0], 48_000);
        assert_eq!(grid.beats[1], 108_000);
    }

    #[test]
    fn snaps_only_inside_the_requested_distance() {
        let snapped = snap_motion_text_time_to_beat(SnapMotionTextTimeToBeatOptions {
            time: 83_000,
            bpm: 120.0,
            first_beat: 24_000,
            max_distance: Some(2_000),
        });
        assert_eq!(snapped.time, 84_000);
        assert!(snapped.snapped);
        assert_eq!(snapped.beat_index, Some(1));

        let unchanged = snap_motion_text_time_to_beat(SnapMotionTextTimeToBeatOptions {
            time: 80_000,
            bpm: 120.0,
            first_beat: 24_000,
            max_distance: Some(2_000),
        });
        assert_eq!(unchanged.time, 80_000);
        assert!(!unchanged.snapped);
        assert_eq!(unchanged.beat_index, None);
    }

    #[test]
    fn resolves_clip_geometry_to_a_sequence_source_offset() {
        let result =
            resolve_motion_text_audio_clip_binding(ResolveMotionTextAudioClipBindingOptions {
                sequence_duration: 1_200_000,
                sequence_clip_start: 480_000,
                sequence_trim_start: 120_000,
                sequence_clip_duration: 600_000,
                audio_clip_start: 240_000,
                audio_clip_duration: 1_200_000,
                audio_trim_start: 60_000,
                audio_source_duration: 2_400_000,
            });

        assert_eq!(result.source_offset, Some(180_000));
        assert_eq!(result.duration, Some(1_200_000));
        assert_eq!(result.error, None);
    }

    #[test]
    fn rejects_audio_clips_that_do_not_cover_the_visible_motion_text() {
        let result =
            resolve_motion_text_audio_clip_binding(ResolveMotionTextAudioClipBindingOptions {
                sequence_duration: 1_200_000,
                sequence_clip_start: 480_000,
                sequence_trim_start: 0,
                sequence_clip_duration: 600_000,
                audio_clip_start: 600_000,
                audio_clip_duration: 600_000,
                audio_trim_start: 0,
                audio_source_duration: 1_200_000,
            });

        assert_eq!(result.source_offset, None);
        assert_eq!(result.error_code.as_deref(), Some("clip-range-mismatch"));
    }

    #[test]
    fn distinguishes_timing_drift_from_content_replacement() {
        let timing = assess_motion_text_audio_sync(AssessMotionTextAudioSyncOptions {
            bound_asset_id: "asset:a".to_owned(),
            bound_clip_id: Some("clip:a".to_owned()),
            bound_source_offset: 0,
            bound_duration: Some(1_200_000),
            bound_content_digest: Some("sha256:a".to_owned()),
            current_asset_id: Some("asset:a".to_owned()),
            current_clip_id: Some("clip:a".to_owned()),
            current_source_offset: Some(120_000),
            current_duration: Some(1_200_000),
            current_content_digest: Some("sha256:a".to_owned()),
        });
        assert_eq!(timing.status, MotionTextAudioSyncStatus::TimingChanged);
        assert!(timing.requires_sync);
        assert!(timing.analysis_reusable);

        let content = assess_motion_text_audio_sync(AssessMotionTextAudioSyncOptions {
            bound_asset_id: "asset:a".to_owned(),
            bound_clip_id: Some("clip:a".to_owned()),
            bound_source_offset: 0,
            bound_duration: Some(1_200_000),
            bound_content_digest: Some("sha256:a".to_owned()),
            current_asset_id: Some("asset:a".to_owned()),
            current_clip_id: Some("clip:a".to_owned()),
            current_source_offset: Some(0),
            current_duration: Some(1_200_000),
            current_content_digest: Some("sha256:b".to_owned()),
        });
        assert_eq!(content.status, MotionTextAudioSyncStatus::ContentChanged);
        assert!(content.requires_sync);
        assert!(!content.analysis_reusable);
    }
}
