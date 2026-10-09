use super::envelope::GainEnvelope;
use super::range::{Rate, resolve_range};
use super::{MAX_ASSETS, MAX_OBSERVATION_BYTES, MAX_SECONDS, Observation};
use bridge::export;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    frame_index: u32,
    assets: Vec<Observation>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: u32,
    frame_rate: Rate,
    sample_rate: u32,
    first_frame: u32,
    frames: Vec<Frame>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Gain {
    pub offset: u64,
    pub frames: u64,
    pub value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub envelope: Option<GainEnvelope>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    resource_id: String,
    audio_stream_index: u32,
    playback_rate: f64,
    tone_frequency: f64,
    source_sample: u64,
    output_start: u64,
    frames: u64,
    gains: Vec<Gain>,
    #[serde(skip)]
    next_time: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Plan {
    sample_rate: u32,
    sample_origin: u64,
    channels: u32,
    output_frames: u64,
    segments: Vec<Segment>,
}

fn schedule(r: Request) -> Result<Plan, String> {
    let rate = &r.frame_rate;
    let range = resolve_range(
        r.version,
        rate,
        r.sample_rate,
        r.first_frame,
        u32::try_from(r.frames.len()).map_err(|_| "Audio frame count exceeds the limit")?,
    )?;
    let at = |frame| range.sample_at(frame);
    let origin = range.sample_origin;
    let output_frames = range.output_frames;
    let fps = rate.numerator as f64 / rate.denominator as f64;
    let mut segments: Vec<Segment> = Vec::new();
    let mut active: HashMap<String, usize> = HashMap::new();
    for (index, frame) in r.frames.into_iter().enumerate() {
        if frame.frame_index as usize != r.first_frame as usize + index
            || frame.assets.len() > MAX_ASSETS
        {
            return Err("Audio observations must be bounded, contiguous, ordered frames".into());
        }
        let start = at(frame.frame_index as u64) - origin;
        let end = at(frame.frame_index as u64 + 1) - origin;
        let mut seen = HashSet::new();
        for a in frame.assets {
            if a.id.is_empty()
                || a.id.len() > 256
                || a.id.chars().any(char::is_control)
                || !seen.insert(a.id.clone())
                || a.resource_id.len() != 64
                || !a
                    .resource_id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                || !matches!(a.kind.as_str(), "audio" | "video")
                || !a.source_time.is_finite()
                || !(0.0..=MAX_SECONDS).contains(&a.source_time)
                || !a.playback_rate.is_finite()
                || !(0.01..=16.0).contains(&a.playback_rate)
                || !a.tone_frequency.is_finite()
                || !(0.01..=2.0).contains(&a.tone_frequency)
                || !a.volume.is_finite()
                || !(0.0..=64.0).contains(&a.volume)
                || a.audio_stream_index > 31
            {
                return Err("Invalid programmatic audio observation".into());
            }
            if let Some(envelope) = &a.gain_envelope {
                envelope.validate()?;
            }
            let previous = active.get(&a.id).copied().filter(|i| {
                let s = &segments[*i];
                s.resource_id == a.resource_id
                    && s.audio_stream_index == a.audio_stream_index
                    && s.playback_rate == a.playback_rate
                    && s.tone_frequency == a.tone_frequency
                    && s.output_start + s.frames == start
                    && (s.next_time - a.source_time).abs() < 1e-8
            });
            let i = previous.unwrap_or_else(|| {
                segments.push(Segment {
                    resource_id: a.resource_id,
                    audio_stream_index: a.audio_stream_index,
                    playback_rate: a.playback_rate,
                    tone_frequency: a.tone_frequency,
                    source_sample: range.source_sample(
                        frame.frame_index as u64,
                        a.source_time / a.playback_rate * r.sample_rate as f64,
                    ),
                    output_start: start,
                    frames: 0,
                    gains: Vec::new(),
                    next_time: 0.0,
                });
                segments.len() - 1
            });
            let s = &mut segments[i];
            if end > start {
                let value = a.gain_envelope.as_ref().map_or(a.volume, |e| e.base_gain);
                if let Some(gain) = s
                    .gains
                    .last_mut()
                    .filter(|g| g.value == value && g.envelope == a.gain_envelope)
                {
                    gain.frames += end - start;
                } else {
                    s.gains.push(Gain {
                        offset: s.frames,
                        frames: end - start,
                        value,
                        envelope: a.gain_envelope,
                    });
                }
            }
            s.frames += end - start;
            s.next_time = a.source_time + a.playback_rate / fps;
            active.insert(a.id, i);
        }
        active.retain(|id, _| seen.contains(id));
        if segments.len() > 4096 {
            return Err("Programmatic audio segment budget exceeded".into());
        }
    }
    segments.retain(|s| s.frames > 0);
    Ok(Plan {
        sample_rate: r.sample_rate,
        sample_origin: origin,
        channels: 2,
        output_frames,
        segments,
    })
}

#[export]
pub fn resolve_programmatic_audio_schedule_json(input: String) -> String {
    let result = (|| {
        if input.len() > MAX_OBSERVATION_BYTES {
            return Err("Audio observation payload exceeds the limit".into());
        }
        schedule(serde_json::from_str(&input).map_err(|e| e.to_string())?)
    })();
    match result {
        Ok(plan) => serde_json::json!({"plan":plan}).to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}
