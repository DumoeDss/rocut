//! Admit fresh native snapshots before extracting envelope facts. A gain-only
//! observation must never hide a changed clip, resource, route or FX declaration.
use super::execution::MAX_EXECUTION_JSON;
use super::fader::observed_envelope;
use super::model::GraphRequest;
use super::participation::{Participation, participation};
use super::plan::plan;
use super::snapshot::Snapshot;
use crate::programmatic_audio::envelope::GainEnvelope;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u32,
    graph: Value,
    observations: Vec<Value>,
    #[serde(default, rename = "fallbackHistories")]
    fallback_histories: Vec<Value>,
}

fn admit(graph: &Value, snapshot: &Value) -> Result<(Snapshot, Vec<Participation>), String> {
    if !graph.is_object() {
        return Err("HyperFrames observation graph must be an object".into());
    }
    let mut observed = graph.clone();
    observed["snapshot"] = snapshot.clone();
    let request: GraphRequest = serde_json::from_value(observed)
        .map_err(|error| format!("Invalid HyperFrames observation graph: {error}"))?;
    // Complete source, clock, track, topology, FX and canonical-buffer admission.
    let sample_rate = request.sample_rate;
    let timing = request.timing;
    let plan = plan(request)?;
    let snapshot: Snapshot = serde_json::from_value(snapshot.clone())
        .map_err(|error| format!("Invalid HyperFrames observation snapshot: {error}"))?;
    let participation = snapshot
        .tracks
        .iter()
        .zip(&plan.tracks)
        .map(|(track, admitted)| {
            participation(
                track,
                &snapshot.buses,
                admitted.resolved_bus_instance_id.as_deref(),
                sample_rate,
                plan.render_frames,
                timing,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((snapshot, participation))
}

fn declarations(snapshot: &Value) -> Value {
    // Admission has already rejected unknown fields and duplicate identities.
    // Preserve every remaining raw native/attribute fact, even inert ones.
    let mut result = snapshot.clone();
    result.as_object_mut().unwrap().remove("time");
    for kind in ["tracks", "buses"] {
        let entries = result[kind].as_array_mut().unwrap();
        for entry in entries.iter_mut() {
            if kind == "tracks" {
                entry.as_object_mut().unwrap().remove("observedAt");
                entry.as_object_mut().unwrap().remove("resolvedAuthorGain");
            }
        }
        // Keep declaration order: native routing/member order also determines
        // the floating-point mix accumulation order, even with the same IDs.
    }
    result
}

#[derive(Default)]
struct Envelopes {
    facts: BTreeMap<String, (GainEnvelope, Option<Value>)>,
    points: usize,
}

impl Envelopes {
    fn observe(
        &mut self,
        snapshot: &Snapshot,
        raw: &Value,
        participation: &[Participation],
        history_ids: &std::collections::BTreeSet<String>,
    ) -> Result<(), String> {
        for ((track, raw_track), participation) in snapshot
            .tracks
            .iter()
            .zip(raw["tracks"].as_array().unwrap())
            .zip(participation)
        {
            // Validates active native time, fades, native-normalized lane/GSAP
            // evidence and instantaneous native fallback branches for ALL tracks.
            // Only participating tracks require a complete envelope/history.
            let Some(envelope) = observed_envelope(
                track,
                &track.resolved_author_gain,
                participation.requires_pcm && !history_ids.contains(&track.instance_id),
            )?
            else {
                continue;
            };
            self.points += envelope.points.len();
            if self.points > 32768 {
                return Err(
                    "HyperFrames observation history exceeds the point safety limit".into(),
                );
            }
            if let Some((previous, _)) = self.facts.get(&track.instance_id) {
                if previous != &envelope {
                    return Err("HyperFrames normalized envelope changed across snapshots".into());
                }
            } else {
                self.facts.insert(
                    track.instance_id.clone(),
                    (
                        envelope,
                        participation.requires_pcm.then(|| {
                            json!({"instanceId":track.instance_id,
                            "resolvedAuthorGain":raw_track["resolvedAuthorGain"]})
                        }),
                    ),
                );
            }
        }
        Ok(())
    }
}

fn collect(request: Request) -> Result<Value, String> {
    if request.version != 1 || request.observations.len() > 64 {
        return Err("Invalid or excessive HyperFrames observation request".into());
    }
    let baseline = &request.graph["snapshot"];
    let (snapshot, participation) = admit(&request.graph, baseline)?;
    let expected = declarations(baseline);
    let graph: GraphRequest = serde_json::from_value(request.graph.clone())
        .map_err(|error| format!("Invalid HyperFrames observation graph: {error}"))?;
    let duration = f64::from(graph.duration_frames) * f64::from(graph.frame_rate.denominator)
        / f64::from(graph.frame_rate.numerator);
    let mut history_ids = std::collections::BTreeSet::new();
    let mut events = 0usize;
    if request.fallback_histories.len() > 256 {
        return Err("Excessive HyperFrames native fallback histories".into());
    }
    for raw in &request.fallback_histories {
        let history: super::fader::history::NativeFallbackHistory =
            serde_json::from_value(raw.clone())
                .map_err(|error| format!("Invalid native fallback history: {error}"))?;
        let track = snapshot
            .tracks
            .iter()
            .find(|track| track.instance_id == history.instance_id)
            .ok_or("Unknown native fallback history instance")?;
        if !history_ids.insert(history.instance_id.clone()) {
            return Err("Duplicate native fallback history instance".into());
        }
        events += history.events.len();
        if events > 32768 {
            return Err("Native fallback history exceeds its write budget".into());
        }
        super::fader::history::resolve(track, &history, duration)?;
    }
    let mut envelopes = Envelopes::default();
    envelopes.observe(&snapshot, baseline, &participation, &history_ids)?;
    for raw in request.observations {
        let (snapshot, participation) = admit(&request.graph, &raw)?;
        if declarations(&raw) != expected {
            return Err("HyperFrames static declarations changed across native snapshots".into());
        }
        envelopes.observe(&snapshot, &raw, &participation, &history_ids)?;
    }
    let facts: Vec<Value> = envelopes
        .facts
        .into_values()
        .filter_map(|(_, fact)| fact)
        .collect();
    // Unobserved and inert tracks stay absent. This does not assert complete history or
    // executable capability; the existing execution preparation decides that.
    Ok(
        json!({"version":1,"stage":"stable-native-observations","executionReady":false,
        "faderObservations":facts,"fallbackHistories":request.fallback_histories}),
    )
}

/// Validate full fresh snapshots against the baseline before returning bounded,
/// per-instance fader observations. Preserve declaration/mix order, identities,
/// and every static native, mute/visibility, routing and FX fact.
#[bridge::export]
pub fn resolve_hyperframes_audio_observations_json(input: String) -> String {
    let result = (|| {
        if input.len() > MAX_EXECUTION_JSON {
            return Err("HyperFrames observation payload exceeds the byte safety limit".into());
        }
        let request: Request = serde_json::from_str(&input)
            .map_err(|error| format!("Invalid HyperFrames observations JSON: {error}"))?;
        collect(request)
    })();
    match result {
        Ok(value) => value.to_string(),
        Err(error) => json!({"error":error}).to_string(),
    }
}
