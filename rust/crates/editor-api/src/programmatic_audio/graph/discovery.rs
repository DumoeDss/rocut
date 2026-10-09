//! Native gain-envelope discovery, not a dynamic gain-history reconstruction.
//! Video-frame sampling can miss clips wholly between two picture frames.
use super::model::{GraphRequest, NATIVE_VERSION, SEMANTICS_PROFILE};
use super::plan::plan;
use super::validation::MAX_GRAPH_BYTES;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Seek {
    time: f64,
    instance_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryPlan {
    version: u32,
    native_version: &'static str,
    semantics_profile: &'static str,
    stage: &'static str,
    execution_ready: bool,
    history_complete: bool,
    composition_seconds: f64,
    seeks: Vec<Seek>,
    no_active_interval_instance_ids: Vec<String>,
    boundary_limited_instance_ids: Vec<String>,
}

fn discover(request: GraphRequest) -> Result<DiscoveryPlan, String> {
    let duration = f64::from(request.duration_frames) * f64::from(request.frame_rate.denominator)
        / f64::from(request.frame_rate.numerator);
    // Reuse complete admission (including topology, FX and canonical budgets),
    // rather than accepting a more permissive discovery-only snapshot schema.
    let admitted = plan(request)?;
    let mut candidates = Vec::new();
    let mut no_active_interval_instance_ids = Vec::new();
    // Retained for descriptor compatibility; exhaustive representable-start
    // discovery no longer leaves the old two-candidate boundary ambiguity.
    let boundary_limited_instance_ids = Vec::new();
    for track in admitted.tracks {
        let start = track.timing.start;
        let Some(time) = super::native_window::discovery_time(start, track.timing.end, duration)
        else {
            no_active_interval_instance_ids.push(track.instance_id);
            continue;
        };
        candidates.push((time, track.instance_id));
    }
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    let mut seeks: Vec<Seek> = Vec::new();
    for (time, instance_id) in candidates {
        if let Some(previous) = seeks.last_mut().filter(|seek| seek.time == time) {
            previous.instance_ids.push(instance_id);
        } else {
            seeks.push(Seek {
                time,
                instance_ids: vec![instance_id],
            });
        }
    }
    no_active_interval_instance_ids.sort();
    Ok(DiscoveryPlan {
        version: 1,
        native_version: NATIVE_VERSION,
        semantics_profile: SEMANTICS_PROFILE,
        stage: "gain-discovery-only",
        execution_ready: false,
        history_complete: false,
        composition_seconds: duration,
        seeks,
        no_active_interval_instance_ids,
        boundary_limited_instance_ids,
    })
}

/// Plan bounded native seeks at which the pinned runtime can expose complete
/// normalized envelopes. Retains muted/hidden tracks and uses the complete
/// composition, not the requested output crop. One observation cannot prove a
/// fallback fader's history. Missing gain observations must remain errors, not
/// become implicit silence. A native active instant may precede its declared
/// start by the upstream tolerance. Host IO must not round these seek times.
#[bridge::export]
pub fn resolve_hyperframes_audio_discovery_json(input: String) -> String {
    let result = (|| {
        if input.len() > MAX_GRAPH_BYTES {
            return Err("HyperFrames graph payload exceeds the byte safety limit".into());
        }
        let request: GraphRequest = serde_json::from_str(&input)
            .map_err(|error| format!("Invalid or unsupported HyperFrames graph JSON: {error}"))?;
        discover(request)
    })();
    match result {
        Ok(plan) => serde_json::json!({"plan":plan}).to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}
