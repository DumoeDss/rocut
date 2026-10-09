use editor_api::{
    mix_programmatic_audio_pcm, resolve_native_audio_decode_json,
    resolve_programmatic_audio_schedule_json,
};
use serde_json::{Value, json};

fn asset(time: f64, volume: f64) -> Value {
    json!({"id":"native", "resourceId":"a".repeat(64), "type":"audio", "sourceTime":time,
        "playbackRate":2, "toneFrequency":1, "volume":volume, "audioStreamIndex":0})
}
fn plan(frames: Value) -> Value {
    serde_json::from_str(&resolve_programmatic_audio_schedule_json(
        json!({
            "version":1,"frameRate":{"numerator":30,"denominator":1},"sampleRate":48000,
            "firstFrame":5,"frames":frames
        })
        .to_string(),
    ))
    .unwrap()
}
#[test]
fn groups_continuous_audio_but_splits_loop_seeks_and_mute_gaps() {
    let p = plan(json!([
        {"frameIndex":5,"assets":[asset(0.2,0.25)]},
        {"frameIndex":6,"assets":[asset(8.0/30.0,0.5)]},
        {"frameIndex":7,"assets":[asset(10.0/30.0,0.5)]},
        {"frameIndex":8,"assets":[asset(0.2,0.5)]},
        {"frameIndex":9,"assets":[]},
        {"frameIndex":10,"assets":[asset(0.2,0.75)]}
    ]));
    assert!(p.get("error").is_none(), "{p}");
    let segments = p["plan"]["segments"].as_array().unwrap();
    assert_eq!(p["plan"]["outputFrames"], 9600);
    assert_eq!(segments.len(), 3);
    assert_eq!(segments[0]["sourceSample"], 4800); // .2s / 2x * 48k
    assert_eq!(segments[0]["frames"], 4800);
    assert_eq!(
        segments[0]["gains"],
        json!([
            {"offset":0,"frames":1600,"value":0.25},{"offset":1600,"frames":3200,"value":0.5}
        ])
    );
    assert_eq!(segments[1]["outputStart"], 4800);
    assert_eq!(segments[2]["outputStart"], 8000);
}

#[test]
fn rational_frame_sample_boundaries_do_not_drift_and_partial_ranges_keep_phase() {
    let frames: Vec<Value> = (1..=30).map(|f| json!({"frameIndex":f,"assets":[asset(f as f64 * 2002.0/30000.0, f as f64 / 100.0)]})).collect();
    let r = json!({"version":1,"frameRate":{"numerator":30000,"denominator":1001},
        "sampleRate":44100,"firstFrame":1,"frames":frames});
    let p: Value =
        serde_json::from_str(&resolve_programmatic_audio_schedule_json(r.to_string())).unwrap();
    assert_eq!(p["plan"]["outputFrames"], 44144); // floor(31*1471.47)-floor(1471.47)
    let gains = p["plan"]["segments"][0]["gains"].as_array().unwrap();
    assert_eq!(gains[0]["frames"], 1471);
    assert_eq!(gains[1]["frames"], 1472);
    let sum: u64 = gains.iter().map(|g| g["frames"].as_u64().unwrap()).sum();
    assert_eq!(sum, 44144);
}

#[test]
fn partial_rational_ranges_decode_the_same_source_samples_as_the_full_range() {
    for (onset, trim) in [(0, 0), (2, 0), (2, 6)] {
        let request = |first: u32, count: u32| {
            let frames: Vec<Value> = (first..first + count)
                .map(|f| {
                    let mut a = asset((f - onset + trim) as f64 * 1001.0 / 30000.0, 1.0);
                    a["playbackRate"] = json!(1);
                    json!({"frameIndex":f,"assets":[a]})
                })
                .collect();
            serde_json::from_str::<Value>(&resolve_programmatic_audio_schedule_json(
                json!({
                    "version":1,"frameRate":{"numerator":30000,"denominator":1001},
                    "sampleRate":44100,"firstFrame":first,"frames":frames
                })
                .to_string(),
            ))
            .unwrap()
        };
        let full = request(onset, 6);
        let origin = full["plan"]["segments"][0]["sourceSample"]
            .as_u64()
            .unwrap();
        for first in onset + 1..onset + 6 {
            let partial = request(first, 1);
            let source = partial["plan"]["segments"][0]["sourceSample"]
                .as_u64()
                .unwrap();
            let sample_at = |f: u32| f as u64 * 44100 * 1001 / 30000;
            assert_eq!(
                source,
                origin + sample_at(first) - sample_at(onset),
                "partial sample phase at frame {first}, onset {onset}, trim {trim}"
            );
        }
    }
}

#[test]
fn schedule_rejects_missing_duplicate_unordered_and_unbounded_observations() {
    for frames in [
        json!([]),
        json!([{"frameIndex":6,"assets":[]}]),
        json!([{"frameIndex":5,"assets":[asset(0.0,1.0),asset(0.0,1.0)]}]),
        json!([{"frameIndex":5,"assets":[asset(-1.0,1.0)]}]),
        json!([{"frameIndex":5,"assets":[asset(0.0,65.0)]}]),
    ] {
        assert!(plan(frames).get("error").is_some());
    }
}

fn packet(manifest: Value, samples: &[f32]) -> Vec<u8> {
    let json = manifest.to_string().into_bytes();
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend(json);
    bytes.extend(samples.iter().flat_map(|s| s.to_le_bytes()));
    bytes
}
fn manifest() -> Value {
    json!({"version":1,"sampleRate":48000,"channels":2,"outputFrames":5,"pcmBytes":[24],
        "clips":[{"pcmIndex":0,"outputStart":1,"frames":3,"gains":[
            {"offset":0,"frames":1,"value":0.5},{"offset":1,"frames":2,"value":2}
        ]},{"pcmIndex":0,"outputStart":2,"frames":1,"gains":[{"offset":0,"frames":1,"value":1}]}]})
}
#[test]
fn stereo_mix_has_exact_offsets_gains_gaps_and_no_premature_mastering() {
    let result =
        mix_programmatic_audio_pcm(packet(manifest(), &[1.0, -1.0, 0.5, -0.5, 0.25, -0.25]))
            .unwrap();
    let samples: Vec<f32> = result
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    assert_eq!(
        samples,
        vec![0.0, 0.0, 0.5, -0.5, 2.0, -2.0, 0.5, -0.5, 0.0, 0.0]
    );
}

#[test]
fn malformed_mix_packets_fail_without_partial_output() {
    for sample in [f32::NAN, f32::INFINITY] {
        assert!(mix_programmatic_audio_pcm(packet(manifest(), &[sample; 6])).is_err());
    }
    for (key, value) in [
        ("channels", json!(1)),
        ("outputFrames", json!(0)),
        ("pcmBytes", json!([20])),
    ] {
        let mut m = manifest();
        m[key] = value;
        assert!(mix_programmatic_audio_pcm(packet(m, &[1.0; 6])).is_err());
    }
    for (key, value) in [
        ("outputStart", json!(4)),
        ("frames", json!(4)),
        ("pcmIndex", json!(1)),
    ] {
        let mut m = manifest();
        m["clips"][0][key] = value;
        assert!(mix_programmatic_audio_pcm(packet(m, &[1.0; 6])).is_err());
    }
    let mut m = manifest();
    m["clips"][0]["gains"][1]["offset"] = json!(2);
    assert!(mix_programmatic_audio_pcm(packet(m, &[1.0; 6])).is_err());
    assert!(mix_programmatic_audio_pcm(vec![255; 10]).is_err());
}

#[test]
fn decode_policy_bounds_decoded_pcm_as_well_as_input_metadata() {
    let r = json!({"version":1,"mimeType":"audio/wav","byteLength":1024,"audioStreamIndex":0,
        "sampleRate":48000,"sourceSample":4800,"frames":1600,"playbackRate":2,"toneFrequency":1,
        "metadata":{"channels":2,"sampleRate":48000,"originSeconds":0}});
    let resolve = |value: Value| {
        serde_json::from_str::<Value>(&resolve_native_audio_decode_json(value.to_string())).unwrap()
    };
    assert_eq!(resolve(r.clone())["outputBytes"], 12800);
    for (key, value) in [
        ("frames", json!(u64::MAX)),
        ("sourceSample", json!(u64::MAX)),
        ("mimeType", json!("application/vnd.apple.mpegurl")),
        ("sampleRate", json!(0)),
        ("audioStreamIndex", json!(32)),
    ] {
        let mut bad = r.clone();
        bad[key] = value;
        assert!(resolve(bad).get("error").is_some());
    }
    let mut bad = r.clone();
    bad["metadata"]["channels"] = json!(128);
    assert!(resolve(bad).get("error").is_some());
}
