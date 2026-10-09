//! Native duration is not a decoded buffer size. Admit complete capacities
//! before IO; only bounded, source/recipe-bound observations finalize FX input.
use super::execution_model::{DecodedSource, ExecutionPlan, PreparedTrack};
use super::snapshot::Track;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Observation {
    decoded_source_id: String,
    preparation_key: String,
    native_frames: u64,
    frames: u64,
}

pub(super) fn key(id: &str, track: &Track, sample_rate: u32) -> String {
    // resourceId is the admitted SHA-256(mime + NUL + immutable encoded bytes),
    // checked by Host before IO. Bind exact semantic facts, not a rounded grid
    // or an opaque caller-supplied plan. This key is evidence, not a secret MAC.
    serde_json::json!({
        "profile":"hyperframes-observed-duration-v1",
        "decodedSourceId":id,"instanceId":track.instance_id,
        "resourceId":track.resource_id,"sampleRate":sample_rate,
        "native":track.native
    })
    .to_string()
}

pub(super) fn observation_json_capacity(plan: &ExecutionPlan) -> usize {
    let facts: Vec<_> = plan
        .decoded_sources
        .iter()
        .filter(|source| source.required && source.preparation_key.is_some())
        .map(|source| {
            serde_json::json!({
                "decodedSourceId":source.id,"preparationKey":source.preparation_key,
                "nativeFrames":source.rate_preparation.as_ref().unwrap().native_max_frames,
                "frames":source.max_frames
            })
        })
        .collect();
    // Account for JSON string escaping, field name and surrounding punctuation
    // before decoder IO, not after an otherwise admitted large render has run.
    serde_json::to_string(&facts).unwrap().len() + 64
}

pub(super) fn finalize(
    sources: &mut [DecodedSource],
    tracks: &mut [PreparedTrack],
    observations: Option<&[Observation]>,
) -> Result<bool, String> {
    let mut facts = HashMap::new();
    if let Some(observations) = observations {
        if observations.len() > sources.len() {
            return Err("Excessive HyperFrames decoded-source observations".into());
        }
        for fact in observations {
            if facts
                .insert(fact.decoded_source_id.as_str(), fact)
                .is_some()
            {
                return Err("Duplicate HyperFrames decoded-source observation".into());
            }
        }
    }
    let mut ready = true;
    for source in sources.iter_mut() {
        let Some(recipe) = source.rate_preparation.as_ref().filter(|r| r.observed_pcm) else {
            continue;
        };
        let measured = if source.required {
            match facts.remove(source.id.as_str()) {
                Some(fact) => {
                    if Some(&fact.preparation_key) != source.preparation_key.as_ref()
                        || fact.native_frames > recipe.native_max_frames
                        || fact.frames > source.max_frames
                        || (fact.native_frames == 0 && fact.frames != 0)
                        || (source.sample_rate == 48000 && fact.frames != fact.native_frames)
                        || fact.frames
                            > (fact.native_frames * u64::from(source.sample_rate)).div_ceil(48000)
                                + 1
                    {
                        return Err("HyperFrames decoded-source observation disagrees with admitted preparation".into());
                    }
                    Some(fact.frames)
                }
                None if observations.is_some() => {
                    return Err("Missing HyperFrames decoded-source observation".into());
                }
                None => {
                    ready = false;
                    None
                }
            }
        } else {
            None
        };
        source.frames = measured;
        source.pcm_bytes = measured.map(|frames| frames * 8);
        for track in tracks
            .iter_mut()
            .filter(|track| track.decoded_source_id == source.id)
        {
            if let Some(frames) = measured {
                let stage = track
                    .fx_stage
                    .as_mut()
                    .ok_or("Missing HyperFrames FX capacity stage")?;
                let tail = if frames == 0 {
                    0
                } else {
                    (stage.native_tail_seconds * f64::from(stage.sample_rate)).ceil() as u64
                };
                let output = frames
                    .checked_add(tail)
                    .filter(|frames| *frames <= stage.max_output_bytes / 8)
                    .ok_or("HyperFrames measured FX output exceeds its admitted capacity")?;
                stage.input_frames = frames;
                stage.expected_output_frames = output;
                // Preserve the pre-IO capacity independently of actual geometry.
            } else {
                track.fx_stage = None;
            }
        }
    }
    if !facts.is_empty() {
        return Err("Unexpected or nonparticipating HyperFrames decoded-source observation".into());
    }
    Ok(ready)
}
