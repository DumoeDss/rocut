//! Admission and state-history planning only. Native DSP, bus parsing and
//! scheduling remain disconnected; this API does not expand render support.
use super::fx_automation::admit_fx_automation;
use super::model::{GraphRequest, NATIVE_VERSION, SEMANTICS_PROFILE};
use super::plan_model::{AdmittedBus, AdmittedTrack, BusFader, GraphPlan, TrackFader, TrackTiming};
use super::topology::{audible_media, resolve_membership};
use super::validation::{MAX_GRAPH_BYTES, admit, chain};
use std::collections::HashMap;

pub(super) fn plan(request: GraphRequest) -> Result<GraphPlan, String> {
    let mut admitted = admit(&request)?;
    let membership = resolve_membership(&request.snapshot.tracks, &request.snapshot.buses)?;
    let mut member_ids: HashMap<String, Vec<String>> = HashMap::new();
    let mut tracks = Vec::with_capacity(request.snapshot.tracks.len());
    for (track, bus) in request.snapshot.tracks.into_iter().zip(membership) {
        let audible_media = audible_media(&track);
        if let Some(bus) = &bus {
            member_ids
                .entry(bus.clone())
                .or_default()
                .push(track.instance_id.clone());
        }
        let fx_chain = chain(
            track.attributes.fx_chain.as_deref(),
            &mut admitted.budget.fx_node_count,
        )?;
        let native = track.native;
        let automation = admit_fx_automation(track.attributes.automation.as_deref(), &fx_chain)?;
        tracks.push(AdmittedTrack {
            instance_id: track.instance_id,
            author_id: track.author_id,
            resource_id: track.resource_id,
            kind: track.kind,
            authored_muted: track.authored_muted,
            ancestor_hidden: track.ancestor_hidden,
            observed_at: track.observed_at,
            audible_media,
            resolved_bus_instance_id: bus,
            timing: TrackTiming {
                start: native.start,
                end: native.end,
                duration: native.duration,
                media_start: native.media_start,
                source_duration: native.source_duration,
                playback_rate: native.playback_rate,
                rate: native.rate,
                r#loop: native.r#loop,
            },
            fader: TrackFader {
                kind: "native-track-fader",
                evaluated: false,
                authored_volume: native.volume,
                fades: native.fades,
                volume_keyframes: native.volume_keyframes,
                normalized_volume_lane: automation.volume_points,
            },
            fx_chain,
            fx_automation: automation.fx_automation,
            automation_diagnostics: automation.diagnostics,
        });
    }
    let mut buses = Vec::with_capacity(request.snapshot.buses.len());
    for bus in request.snapshot.buses {
        let fx_chain = chain(
            bus.attributes.fx_chain.as_deref(),
            &mut admitted.budget.fx_node_count,
        )?;
        let automation = admit_fx_automation(bus.attributes.automation.as_deref(), &fx_chain)?;
        buses.push(AdmittedBus {
            member_instance_ids: member_ids.remove(&bus.instance_id).unwrap_or_default(),
            instance_id: bus.instance_id,
            author_id: bus.author_id,
            hidden: bus.hidden,
            fader: BusFader {
                kind: "native-bus-fader",
                evaluated: false,
                raw_volume: bus.attributes.volume,
                normalized_volume_lane: automation.volume_points,
            },
            fx_chain,
            fx_automation: automation.fx_automation,
            automation_diagnostics: automation.diagnostics,
        });
    }
    Ok(GraphPlan {
        version: 1,
        native_version: NATIVE_VERSION,
        semantics_profile: SEMANTICS_PROFILE,
        stage: "admission-only",
        execution_ready: false,
        state_policy: "canonical-composition-from-zero",
        sample_rate: request.sample_rate,
        channels: 2,
        render_start_sample: 0,
        render_frames: admitted.canonical.output_frames,
        crop_start_sample: admitted.crop.sample_origin,
        sample_origin: admitted.crop.sample_origin,
        output_frames: admitted.crop.output_frames,
        sources: request.sources,
        tracks,
        buses,
        budget: admitted.budget,
    })
}

/// Prepare a complete native snapshot, never a window-filtered or gain-only
/// observation list. Render history is the entire fixed composition from zero;
/// output is then cropped on the existing absolute sample grid. FX tails may
/// continue inside that composition but never extend its public duration.
/// The result is NOT executable yet: track/bus faders remain unevaluated and DSP
/// is disconnected. Track authored volume alone is not the native authorGain,
/// and admission buffer estimates are not a complete executor working-set cap.
#[bridge::export]
pub fn resolve_hyperframes_audio_graph_json(input: String) -> String {
    let result = (|| {
        if input.len() > MAX_GRAPH_BYTES {
            return Err("HyperFrames graph payload exceeds the byte safety limit".into());
        }
        let request: GraphRequest = serde_json::from_str(&input)
            .map_err(|error| format!("Invalid or unsupported HyperFrames graph JSON: {error}"))?;
        plan(request)
    })();
    match result {
        Ok(plan) => serde_json::json!({"plan":plan}).to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}
