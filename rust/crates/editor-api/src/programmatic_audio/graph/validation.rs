use super::facts::{automation, bounded_text, seconds, validate_track};
use super::fx::parse_chain_json;
use super::fx_model::FxChain;
use super::model::{GraphRequest, NATIVE_VERSION, SEMANTICS_PROFILE};
use super::plan_model::Budget;
use crate::programmatic_audio::range::{Range, resolve_range};
use crate::programmatic_audio::{MAX_PCM_BYTES, Media, Request, observations};
use std::collections::HashMap;

pub(super) const MAX_GRAPH_BYTES: usize = 2 * 1024 * 1024;
const MAX_TRACKS: usize = 64;
const MAX_BUSES: usize = 32;
const MAX_TOTAL_FX_NODES: usize = 256;
const MAX_TOTAL_VOLUME_POINTS: usize = 32768;

pub(super) struct Admission {
    pub canonical: Range,
    pub crop: Range,
    pub budget: Budget,
}

pub(super) fn admit(request: &GraphRequest) -> Result<Admission, String> {
    let snapshot = &request.snapshot;
    if request.version != 1
        || request.semantics_profile != SEMANTICS_PROFILE
        || snapshot.version != 1
        || snapshot.native_version != NATIVE_VERSION
        || !seconds(snapshot.time)
        || snapshot.tracks.len() > MAX_TRACKS
        || snapshot.buses.len() > MAX_BUSES
        || u64::from(request.first_frame) + u64::from(request.frame_count)
            > u64::from(request.duration_frames)
    {
        return Err("Unsupported or excessive HyperFrames graph version/profile/clock".into());
    }
    // Reuse the existing absolute rational grid and PCM limits. A tiny crop
    // must not admit a canonical history that exceeds the full-render budget.
    let canonical = resolve_range(
        1,
        &request.frame_rate,
        request.sample_rate,
        0,
        request.duration_frames,
    )?;
    let crop = resolve_range(
        1,
        &request.frame_rate,
        request.sample_rate,
        request.first_frame,
        request.frame_count,
    )?;
    let composition_seconds = f64::from(request.duration_frames)
        * f64::from(request.frame_rate.denominator)
        / f64::from(request.frame_rate.numerator);
    if snapshot.time > composition_seconds + 1e-7 {
        return Err("HyperFrames graph snapshot clock exceeds the composition duration".into());
    }
    // The common source admission owns hashes, MIME types and encoded budgets.
    observations(Request {
        version: 1,
        frame_index: 0,
        frames_per_second: 1.0,
        sources: request
            .sources
            .iter()
            .map(|source| Media {
                id: source.id.clone(),
                mime_type: source.mime_type.clone(),
                byte_length: source.byte_length,
            })
            .collect(),
        assets: Vec::new(),
    })?;
    let sources: HashMap<&str, &str> = request
        .sources
        .iter()
        .map(|source| (source.id.as_str(), source.mime_type.as_str()))
        .collect();
    let mut durations: HashMap<&str, f64> = HashMap::new();
    let mut points = 0usize;
    let mut automation_points = 0usize;
    let mut automation_curves = 0usize;
    for track in &snapshot.tracks {
        points += validate_track(track, snapshot.time)?;
        let parsed = automation(
            track.attributes.automation.as_deref(),
            track.attributes.fx_chain.as_deref(),
        )?;
        automation_points += parsed.point_count;
        automation_curves += parsed.expanded_curve_values;
        let mime = sources
            .get(track.resource_id.as_str())
            .ok_or("HyperFrames graph references an unadmitted source")?;
        if track.kind == "video" && !mime.starts_with("video/") {
            return Err("HyperFrames video track requires a video source".into());
        }
        durations
            .entry(track.resource_id.as_str())
            .and_modify(|duration| *duration = duration.max(track.native.source_duration))
            .or_insert(track.native.source_duration);
    }
    if points > MAX_TOTAL_VOLUME_POINTS {
        return Err("HyperFrames graph exceeds the global volume-keyframe safety limit".into());
    }
    for bus in &snapshot.buses {
        let parsed = automation(
            bus.attributes.automation.as_deref(),
            bus.attributes.fx_chain.as_deref(),
        )?;
        if parsed.rate_points.is_some() {
            return Err(
                "HyperFrames bus rate automation has no admitted native source clock".into(),
            );
        }
        automation_points += parsed.point_count;
        automation_curves += parsed.expanded_curve_values;
        bounded_text(
            bus.attributes.volume.as_deref(),
            4096,
            "bus volume attribute",
        )?;
    }
    if automation_points > 32768 || automation_curves > 1048576 {
        return Err(
            "HyperFrames graph exceeds the global automation point/curve safety limit".into(),
        );
    }
    // Conservative full source buffers, shared only by content identity. Muted
    // or currently inactive tracks still count; no partial-range state reset.
    let dry_bytes = durations.values().try_fold(0u64, |total, duration| {
        let frames = (duration * f64::from(request.sample_rate)).ceil() as u64;
        total
            .checked_add(frames * 8)
            .filter(|bytes| *bytes <= MAX_PCM_BYTES)
            .ok_or("HyperFrames graph exceeds the complete dry-PCM safety budget")
    })?;
    Ok(Admission {
        budget: Budget {
            encoded_source_bytes: request
                .sources
                .iter()
                .map(|source| source.byte_length)
                .sum(),
            estimated_dry_pcm_bytes: dry_bytes,
            canonical_pcm_bytes: canonical.output_frames * 8,
            output_pcm_bytes: crop.output_frames * 8,
            fx_node_count: 0,
            volume_keyframe_count: points,
            automation_point_count: automation_points,
            automation_curve_values: automation_curves,
        },
        canonical,
        crop,
    })
}

pub(super) fn chain(raw: Option<&str>, total: &mut usize) -> Result<FxChain, String> {
    let chain = match raw.filter(|raw| !raw.is_empty()) {
        Some(raw) => parse_chain_json(raw)?,
        None => FxChain {
            version: 1,
            nodes: Vec::new(),
        },
    };
    *total += chain.nodes.len();
    if *total > MAX_TOTAL_FX_NODES {
        return Err("HyperFrames graph exceeds the global FX-node safety limit".into());
    }
    Ok(chain)
}
