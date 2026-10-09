//! Executable kernel preparation, deliberately not a graph-render capability.
//! Stateful stages render from their canonical zero; cropping happens only last.
use super::bus_schedule;
use super::execution_model::{
    DecodedSource, ExecutionPlan, ExecutionRequest, FxStage, PreparedBus, PreparedTrack,
};
use super::fader::resolve_fader;
use super::fader_model::ResolvedAuthorGain;
use super::fx_automation::{FxAutomationAdmission, admit_fx_automation};
use super::fx_model::FxChain;
use super::model::SEMANTICS_PROFILE;
use super::participation::{participation, sample_aligned};
use super::topology::resolve_membership;
use super::validation::{admit, chain};
use super::working_set;
use crate::programmatic_audio::MAX_PCM_BYTES;
use std::collections::{HashMap, HashSet};

pub(super) const MAX_EXECUTION_JSON: usize = 4 * 1024 * 1024;

fn stage(
    chain: FxChain,
    automation: FxAutomationAdmission,
    frames: u64,
    sample_rate: u32,
) -> Result<FxStage, String> {
    // The native root has no offset: time zero is local track zero or absolute
    // composition zero for a bus. Empty input returns unchanged, including tail.
    let tail = if frames == 0 {
        0
    } else {
        (automation.tail_seconds * f64::from(sample_rate)).ceil() as u64
    };
    let output = frames
        .checked_add(tail)
        .filter(|n| *n <= MAX_PCM_BYTES / 8)
        .ok_or("HyperFrames FX output exceeds the PCM safety budget")?;
    Ok(FxStage {
        sample_rate,
        input_frames: frames,
        expected_output_frames: output,
        max_output_bytes: output * 8,
        normalized_fx_chain: chain,
        native_fx_automation: automation.fx_automation,
        native_tail_seconds: automation.tail_seconds,
        automation_points: automation.point_count,
        automation_curve_values: automation.expanded_curve_values,
        automation_scheduled_events: automation.scheduled_events,
        automation_diagnostics: automation.diagnostics,
    })
}

pub(super) fn prepare(request: &ExecutionRequest) -> Result<ExecutionPlan, String> {
    if request.version != 1 || request.fader_observations.len() > 256 {
        return Err("Invalid or excessive HyperFrames execution request".into());
    }
    let graph = &request.graph;
    let admitted = admit(graph)?;
    let membership = resolve_membership(&graph.snapshot.tracks, &graph.snapshot.buses)?;
    let ids: HashSet<&str> = graph
        .snapshot
        .tracks
        .iter()
        .map(|track| track.instance_id.as_str())
        .collect();
    if request
        .fader_observations
        .iter()
        .any(|fact| !ids.contains(fact.instance_id.as_str()))
    {
        return Err("HyperFrames fader observation references an unknown track instance".into());
    }
    let composition_duration = f64::from(graph.duration_frames)
        * f64::from(graph.frame_rate.denominator)
        / f64::from(graph.frame_rate.numerator);
    let mut fader_points = 0usize;
    for fact in graph
        .snapshot
        .tracks
        .iter()
        .map(|track| &track.resolved_author_gain)
        .chain(
            request
                .fader_observations
                .iter()
                .map(|fact| &fact.resolved_author_gain),
        )
    {
        if let ResolvedAuthorGain::Observed {
            observed_at,
            points,
            ..
        } = fact
        {
            if !observed_at.is_finite() || !(0.0..=composition_duration).contains(observed_at) {
                return Err("HyperFrames fader observation is outside canonical history".into());
            }
            fader_points += points.as_ref().map_or(0, Vec::len);
        }
    }
    if fader_points > 32768 {
        return Err("HyperFrames resolved fader history exceeds the point safety limit".into());
    }
    let sr = f64::from(graph.sample_rate);
    let mut decoded_sources: Vec<DecodedSource> = Vec::new();
    let mut decoded_ids: HashMap<(&str, u64), usize> = HashMap::new();
    let mut tracks = Vec::new();
    let mut fx_nodes = 0;
    for (track, bus) in graph.snapshot.tracks.iter().zip(membership) {
        let native = &track.native;
        let participation = participation(
            track,
            &graph.snapshot.buses,
            bus.as_deref(),
            graph.sample_rate,
            admitted.canonical.output_frames,
        )?;
        let (index, source_start, source_period) = if let Some(points) =
            super::rate_lane::admit(track)?
        {
            let rate_preparation =
                super::rate_prepare::prepare(native, &points, graph.sample_rate)?;
            let frames = rate_preparation.graph_max_frames;
            let index = decoded_sources.len();
            let id = format!("dry#{index}");
            let preparation_key = rate_preparation
                .observed_pcm
                .then(|| super::rate_geometry::key(&id, track, graph.sample_rate));
            // Per-clip canonical preparation: source hash or mean rate cannot
            // identify the native slice grid, trim, curve or atempo history.
            decoded_sources.push(DecodedSource {
                id,
                resource_id: track.resource_id.clone(),
                playback_rate: 1.0,
                sample_rate: graph.sample_rate,
                channels: 2,
                source_sample: 0,
                frames: Some(frames),
                pcm_bytes: Some(frames * 8),
                max_frames: frames,
                max_pcm_bytes: frames * 8,
                preparation_key,
                gain_applied: false,
                required: false,
                rate_preparation: Some(rate_preparation),
            });
            (index, 0, 0)
        } else {
            let source_start = sample_aligned(
                native.media_start / native.playback_rate * sr,
                "tempo-adjusted media trim",
            )?;
            let source_frames_f = native.source_duration / native.playback_rate * sr;
            // A loop's period is not rounded: doing so introduces a phase drift on
            // every repeat. Nonloop decoded duration is a padded decoder buffer bound.
            let decoded_frames = source_frames_f.ceil() as u64;
            // Native loops restart at mediaStart, not source zero.
            let source_period = if native.r#loop {
                sample_aligned(
                    (native.source_duration - native.media_start) / native.playback_rate * sr,
                    "trimmed loop period",
                )?
            } else {
                0
            };
            if decoded_frames == 0
                || decoded_frames > MAX_PCM_BYTES / 8
                || (native.r#loop && source_period == 0)
            {
                return Err(
                    "HyperFrames tempo-adjusted source exceeds the dry-PCM safety budget".into(),
                );
            }
            let key = (track.resource_id.as_str(), native.playback_rate.to_bits());
            let index = if let Some(index) = decoded_ids.get(&key) {
                *index
            } else {
                let index = decoded_sources.len();
                decoded_ids.insert(key, index);
                decoded_sources.push(DecodedSource {
                    id: format!("dry#{index}"),
                    resource_id: track.resource_id.clone(),
                    playback_rate: native.playback_rate,
                    sample_rate: graph.sample_rate,
                    channels: 2,
                    source_sample: 0,
                    frames: Some(decoded_frames),
                    pcm_bytes: Some(decoded_frames * 8),
                    max_frames: decoded_frames,
                    max_pcm_bytes: decoded_frames * 8,
                    preparation_key: None,
                    gain_applied: false,
                    required: false,
                    rate_preparation: None,
                });
                index
            };
            if decoded_sources[index].frames != Some(decoded_frames) {
                return Err(
                    "HyperFrames tracks disagree on the same decoded source duration".into(),
                );
            }
            (index, source_start, source_period)
        };
        let requires_pcm = participation.requires_pcm;
        decoded_sources[index].required |= requires_pcm;
        // Inert tracks need no complete history, but every supplied gain fact
        // still needs native clock, fades, normalization and branch validation.
        let fader = resolve_fader(
            track,
            request
                .fader_observations
                .iter()
                .filter(|fact| fact.instance_id == track.instance_id)
                .map(|fact| &fact.resolved_author_gain),
            requires_pcm,
        )?;
        let fx_chain = chain(track.attributes.fx_chain.as_deref(), &mut fx_nodes)?;
        let automation = admit_fx_automation(track.attributes.automation.as_deref(), &fx_chain)?;
        let stage_frames = if decoded_sources[index].preparation_key.is_some() {
            // Full native history precedes FX, even when canonical output ends
            // mid-clip. Final mixing alone clips it to the composition/crop.
            decoded_sources[index].max_frames
        } else {
            participation.input_frames
        };
        tracks.push(PreparedTrack {
            instance_id: track.instance_id.clone(),
            resolved_bus_instance_id: bus,
            decoded_source_id: decoded_sources[index].id.clone(),
            start_sample: participation.start_sample,
            source_start_sample: source_start,
            source_period_frames: source_period,
            // A variable-rate loop is already materialized across the full
            // clip, before FX. Do not modulo it a second time in the dry kernel.
            r#loop: native.r#loop && decoded_sources[index].rate_preparation.is_none(),
            muted: participation.muted,
            audible_media: participation.audible_media,
            requires_pcm,
            fader,
            fx_stage: Some(stage(
                fx_chain,
                automation,
                stage_frames,
                graph.sample_rate,
            )?),
        });
    }
    let mut buses = Vec::new();
    let mut bus_curve_values = admitted.budget.automation_curve_values;
    for bus in &graph.snapshot.buses {
        let fx_chain = chain(bus.attributes.fx_chain.as_deref(), &mut fx_nodes)?;
        let automation = admit_fx_automation(bus.attributes.automation.as_deref(), &fx_chain)?;
        let fader = bus_schedule::prepare(
            bus.attributes.volume.as_deref(),
            automation.volume_automation.as_deref(),
            0.0,
            0.0,
            1.0,
        )?;
        bus_curve_values += fader
            .events
            .iter()
            .map(|event| match event {
                bus_schedule::Event::Curve { values, .. } => values.len(),
                _ => 0,
            })
            .sum::<usize>();
        if bus_curve_values > 1048576 {
            return Err(
                "HyperFrames graph exceeds the global expanded bus-curve safety limit".into(),
            );
        }
        buses.push(PreparedBus {
            instance_id: bus.instance_id.clone(),
            member_instance_ids: tracks
                .iter()
                .filter(|track| track.resolved_bus_instance_id.as_deref() == Some(&bus.instance_id))
                .map(|track| track.instance_id.clone())
                .collect(),
            muted: bus.hidden,
            requires_pcm: !bus.hidden
                && tracks.iter().any(|track| {
                    track.requires_pcm
                        && track.resolved_bus_instance_id.as_deref() == Some(&bus.instance_id)
                }),
            fader,
            fx_stage: stage(
                fx_chain,
                automation,
                admitted.canonical.output_frames,
                graph.sample_rate,
            )?,
        });
    }
    let working_set = working_set::estimate(
        &decoded_sources,
        &tracks,
        &buses,
        admitted.canonical.output_frames,
        admitted.crop.output_frames,
        admitted.budget.encoded_source_bytes,
    )?;
    // Never let small/empty observations reduce pre-IO admission or budgets.
    let pcm_geometry_ready = super::rate_geometry::finalize(
        &mut decoded_sources,
        &mut tracks,
        request.decoded_source_observations.as_deref(),
    )?;
    Ok(ExecutionPlan {
        version: 1,
        semantics_profile: SEMANTICS_PROFILE,
        stage: "dry-and-fader-kernels-prepared",
        execution_ready: false,
        pcm_geometry_ready,
        state_policy: "canonical-composition-from-zero",
        sample_phase_policy: if decoded_sources
            .iter()
            .any(|source| source.preparation_key.is_some())
        {
            "sample-aligned-placement-measured-nonloop-duration-v1"
        } else {
            "sample-aligned-clip-local-strict-v1"
        },
        sample_rate: graph.sample_rate,
        channels: 2,
        render_frames: admitted.canonical.output_frames,
        crop_start_sample: admitted.crop.sample_origin,
        output_frames: admitted.crop.output_frames,
        sources: graph.sources.clone(),
        decoded_sources,
        tracks,
        buses,
        working_set,
    })
}

#[bridge::export]
pub fn resolve_hyperframes_audio_execution_plan_json(input: String) -> String {
    let result: Result<ExecutionPlan, String> = (|| {
        if input.len() > MAX_EXECUTION_JSON {
            return Err("HyperFrames execution payload exceeds its limit".into());
        }
        let request: ExecutionRequest = serde_json::from_str(&input)
            .map_err(|error| format!("Invalid HyperFrames execution JSON: {error}"))?;
        let plan = prepare(&request)?;
        if !plan.pcm_geometry_ready
            && input.len() + super::rate_geometry::observation_json_capacity(&plan)
                > MAX_EXECUTION_JSON
        {
            return Err("HyperFrames finalized observation payload would exceed its limit".into());
        }
        Ok(plan)
    })();
    match result {
        Ok(plan) => serde_json::json!({"plan":plan}).to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}
