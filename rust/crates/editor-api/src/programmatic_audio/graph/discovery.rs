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
    native_history_scan: NativeHistoryScan,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeHistoryScan {
    profile: &'static str,
    canonical_start: f64,
    canonical_end: f64,
    times: Vec<f64>,
}

fn discover(request: GraphRequest) -> Result<DiscoveryPlan, String> {
    let duration = f64::from(request.duration_frames) * f64::from(request.frame_rate.denominator)
        / f64::from(request.frame_rate.numerator);
    if request.duration_frames > 32766 {
        return Err("HyperFrames native history scan exceeds its frame budget".into());
    }
    let frame_seconds =
        f64::from(request.frame_rate.denominator) / f64::from(request.frame_rate.numerator);
    let mut times: Vec<f64> = (0..request.duration_frames)
        .map(|frame| f64::from(frame) * frame_seconds)
        .collect();
    times.push(duration);
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
        // Full fallback history must observe the first native write at the
        // actual clip start, not merely a later picture frame or discovery
        // midpoint. Keep the original discovery seek and all existing bounds.
        if (0.0..=duration).contains(&start) {
            times.push(start);
        }
        candidates.push((time, track.instance_id));
        times.push(time);
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
    times.sort_by(f64::total_cmp);
    times.dedup();
    if times.len() > 32768 {
        return Err("HyperFrames native history scan exceeds its time budget".into());
    }
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
        native_history_scan: NativeHistoryScan {
            profile: "hyperframes-native-sync-all-author-writes-v1",
            canonical_start: 0.0,
            canonical_end: duration,
            times,
        },
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn track(id: &str, start: f64, end: f64) -> Value {
        json!({"instanceId":id,"authorId":id,"resourceId":"a".repeat(64),
            "type":"audio","authoredMuted":false,"ancestorHidden":false,"observedAt":0,
            "native":{"start":start,"end":end,"duration":end-start,"mediaStart":0,
                "sourceDuration":1,"playbackRate":1,"rate":1,"loop":false,"volume":0.35,
                "fades":{"fadeIn":0,"fadeOut":0}},
            "attributes":{"groupRenderId":null,"groupAuthorId":null,"fxChain":null,
                "automation":null,"muted":false,"hasAudio":null}})
    }
    fn request(tracks: Vec<Value>, frames: u32) -> Value {
        json!({"version":1,"semanticsProfile":"rocut-hyperframes-0.8.139-audio-graph-v1",
            "frameRate":{"numerator":25,"denominator":1},"sampleRate":48000,
            "firstFrame":0,"frameCount":1,"durationFrames":frames,
            "sources":[{"id":"a".repeat(64),"mimeType":"audio/wav","byteLength":4096}],
            "snapshot":{"version":1,"nativeVersion":"0.8.139","time":0,"tracks":tracks,"buses":[]}})
    }
    fn resolve(input: Value) -> Value {
        serde_json::from_str(&resolve_hyperframes_audio_discovery_json(input.to_string())).unwrap()
    }
    #[test]
    fn native_history_includes_actual_non_grid_start_without_replacing_midpoint() {
        // Minimal geometry from the real txFoPl history: first observed write
        // was .12, later than .1. A grid+midpoint scan cannot fulfill coverage.
        let start = 0.1;
        let end = 0.1999965277777778;
        let result = resolve(request(vec![track("scalar-fractional", start, end)], 20));
        assert!(result.get("error").is_none(), "{result}");
        let times = result["plan"]["nativeHistoryScan"]["times"]
            .as_array()
            .unwrap();
        assert!(times.iter().any(|time| time.as_f64() == Some(start)));
        let midpoint = (start + end) / 2.0;
        assert_eq!(result["plan"]["seeks"][0]["time"], midpoint);
        assert!(times.iter().any(|time| time.as_f64() == Some(midpoint)));
        assert!(!times.iter().any(|time| time.as_f64() == Some(end)));
        assert!(
            times
                .windows(2)
                .all(|pair| pair[0].as_f64() < pair[1].as_f64())
        );
    }
    #[test]
    fn native_history_coalesces_duplicate_starts_and_retains_domain_boundaries() {
        let result = resolve(request(
            vec![
                track("a", 0.1, 0.3),
                track("b", 0.1, 0.3),
                track("start", 0.0, 0.4),
                track("end", 1.0, 1.1),
                track("outside", 2.0, 3.0),
                track("empty", 0.5, 0.5),
            ],
            25,
        ));
        assert!(result.get("error").is_none(), "{result}");
        let times = result["plan"]["nativeHistoryScan"]["times"]
            .as_array()
            .unwrap();
        assert_eq!(
            times
                .iter()
                .filter(|time| time.as_f64() == Some(0.1))
                .count(),
            1
        );
        assert_eq!(times.first().unwrap().as_f64(), Some(0.0));
        assert_eq!(times.last().unwrap().as_f64(), Some(1.0));
        assert!(
            times
                .iter()
                .all(|time| (0.0..=1.0).contains(&time.as_f64().unwrap()))
        );
        assert_eq!(
            result["plan"]["noActiveIntervalInstanceIds"],
            json!(["empty", "outside"])
        );
    }
    #[test]
    fn native_history_actual_starts_share_existing_time_budget_after_dedup() {
        // 32767 canonical grid/end times plus two distinct required instants
        // must fail the unchanged 32768 cap (the old midpoint-only scan passed).
        // 30000/1 fps is an admitted 4-tick clock and keeps the complete
        // composition near 1s, below the unrelated canonical PCM budget.
        let mut overflow_input = request(vec![track("fractional", 0.100005, 0.200009)], 32766);
        overflow_input["frameRate"] = json!({"numerator":30000,"denominator":1});
        let overflow = resolve(overflow_input);
        assert!(
            overflow["error"]
                .as_str()
                .is_some_and(|error| error.contains("time budget")),
            "{overflow}"
        );
        let mut duplicate_input = request(vec![track("a", 0.0, 0.4), track("b", 0.0, 0.4)], 32766);
        duplicate_input["frameRate"] = json!({"numerator":30000,"denominator":1});
        let duplicate = resolve(duplicate_input);
        assert!(duplicate.get("error").is_none(), "{duplicate}");
        assert!(
            duplicate["plan"]["nativeHistoryScan"]["times"]
                .as_array()
                .unwrap()
                .len()
                <= 32768
        );
        let frame_overflow = resolve(request(vec![], 32767));
        assert!(
            frame_overflow["error"]
                .as_str()
                .is_some_and(|error| error.contains("frame budget")),
            "{frame_overflow}"
        );
    }
}
