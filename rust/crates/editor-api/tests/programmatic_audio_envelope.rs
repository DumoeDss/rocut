use editor_api::{mix_programmatic_audio_pcm, resolve_programmatic_audio_schedule_json};
use serde_json::{Value, json};

fn envelope(points: Value) -> Value {
    json!({"version":1,"start":0.0,"duration":1.0,"baseGain":3.0,
        "fadeIn":0.0,"fadeOut":0.0,"points":points})
}

fn packet(manifest: Value, samples: &[f32]) -> Vec<u8> {
    let header = manifest.to_string().into_bytes();
    let mut bytes = (header.len() as u32).to_le_bytes().to_vec();
    bytes.extend(header);
    bytes.extend(samples.iter().flat_map(|s| s.to_le_bytes()));
    bytes
}

fn decode(bytes: Vec<u8>) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect()
}

fn mix_envelope(env: Value, origin: u64, output_start: u64, frames: u64) -> Vec<f32> {
    let manifest = json!({"version":1,"sampleRate":48000,"sampleOrigin":origin,"channels":2,
    "outputFrames":output_start+frames,"pcmBytes":[frames*8],"clips":[{
        "pcmIndex":0,"outputStart":output_start,"frames":frames,"gains":[{
            "offset":0,"frames":frames,"value":17,"envelope":env
        }]
    }]});
    let samples: Vec<f32> = (0..frames).flat_map(|_| [1.0, -0.5]).collect();
    decode(mix_programmatic_audio_pcm(packet(manifest, &samples)).unwrap())
}

fn close(actual: f32, expected: f64) {
    assert!(
        (actual as f64 - expected).abs() <= 2e-7,
        "actual {actual}, expected {expected}"
    );
}

#[test]
fn linear_and_exponent_lanes_evaluate_every_pcm_sample_and_replace_static_gain() {
    for curve in [None, Some(-1.0_f64), Some(0.5), Some(1.0)] {
        let mut point = json!({"t":0,"v":0.2});
        if let Some(curve) = curve {
            point["curve"] = json!(curve);
        }
        let samples = mix_envelope(envelope(json!([point,{"t":1,"v":1.2}])), 0, 0, 48001);
        let exponent = curve.map_or(1.0, |c| 2.0_f64.powf(2.0 * c));
        for i in 0..=48000 {
            let expected = 0.2 + (i as f64 / 48000.0).powf(exponent);
            close(samples[i * 2], expected);
            close(samples[i * 2 + 1], -0.5 * expected);
        }
        // Adjacent samples inside a video frame must not share a held gain.
        assert_ne!(samples[24000], samples[24002]);
    }
}

#[test]
fn rational_via_curves_match_fixed_native_reference_samples() {
    // Independent fixtures sampled from the pinned @hyperframes/core
    // audioAutomation.js sampleAutomationLane, at x = 0, 1/8, ..., 1.
    // Each point also carries curve=.5 to establish native via precedence.
    let cases = [
        (
            0.25,
            0.75,
            [
                0.0,
                0.5819953759456422,
                0.75,
                0.8497055761545989,
                0.9141127585053355,
                0.9559970231840258,
                0.9819069322908281,
                0.9957305927199525,
                1.0,
            ],
        ),
        (
            0.75,
            0.25,
            [
                0.0,
                0.004269407280047458,
                0.01809306770917186,
                0.04400297681597425,
                0.08588724149466456,
                0.15029442384540107,
                0.25,
                0.41800462405435784,
                1.0,
            ],
        ),
        (
            0.001,
            0.999,
            [
                0.0,
                0.9991245616219221,
                0.9992496242481193,
                0.9993746868736155,
                0.999499749498981,
                0.9996248121243828,
                0.9997498747496226,
                0.9998749373748427,
                1.0,
            ],
        ),
        (
            0.999,
            0.001,
            [
                0.0,
                0.000125062625272847,
                0.00025012525047405287,
                0.0003751878757272559,
                0.000500250500988622,
                0.0006253131263571952,
                0.000750375751875832,
                0.0008754383780747601,
                1.0,
            ],
        ),
        (
            0.4,
            0.4,
            [
                0.0, 0.015625, 0.0625, 0.140625, 0.25, 0.390625, 0.5625, 0.765625, 1.0,
            ],
        ),
    ];
    for (x, y, expected) in cases {
        let samples = mix_envelope(
            envelope(json!([
                {"t":0,"v":0,"curve":0.5,"viaX":x,"viaY":y},{"t":1,"v":1}
            ])),
            0,
            0,
            48001,
        );
        for (i, expected) in expected.into_iter().enumerate() {
            close(samples[i * 6000 * 2], expected);
            close(samples[i * 6000 * 2 + 1], -0.5 * expected);
        }
    }
}

#[test]
fn native_extreme_via_overshoot_is_clamped_before_fades() {
    // Actual pinned sampleAutomationLane + clampAudioGain + fadeGain output.
    // viaY=.001 is legal native-normalized input but its conic undershoots zero.
    // A descending lane therefore overshoots +12 dB. Native media.js clamps
    // the interpolated level BEFORE multiplying the normalized .5s/.5s fades.
    let cases = [
        (
            0.0,
            1.0,
            [
                0.0,
                0.0,
                0.0,
                0.0,
                0.0010000000000000009,
                0.11789062499999999,
                0.18787500000000001,
                0.164171875,
                0.0,
            ],
        ),
        (
            3.9810717055349722,
            0.0,
            [
                0.0,
                0.9952679263837431,
                1.9905358527674861,
                2.985803779151229,
                3.9770906338294374,
                2.5164727476158952,
                1.2425920060901032,
                0.34168791997661885,
                0.0,
            ],
        ),
    ];
    for (start, end, expected) in cases {
        let mut env = envelope(json!([
            {"t":0,"v":start,"viaX":0.5,"viaY":0.001},{"t":1,"v":end}
        ]));
        env["fadeIn"] = json!(0.75);
        env["fadeOut"] = json!(0.75);
        let samples = mix_envelope(env, 0, 0, 48001);
        assert!(samples.chunks_exact(2).all(|s| s[0] >= 0.0 && s[1] <= 0.0));
        for (i, expected) in expected.into_iter().enumerate() {
            close(samples[i * 6000 * 2], expected);
            close(samples[i * 6000 * 2 + 1], -expected / 2.0);
        }
    }
}

#[test]
fn empty_lane_uses_base_gain_and_oversized_fades_scale_to_clip_duration() {
    let mut env = envelope(json!([]));
    env["start"] = json!(0.25);
    env["baseGain"] = json!(2);
    env["fadeIn"] = json!(3);
    env["fadeOut"] = json!(1);
    let samples = mix_envelope(env, 0, 0, 72001);
    for i in 0..=72000 {
        let elapsed = i as f64 / 48000.0 - 0.25;
        // Authored 3s + 1s fades become .75s + .25s inside the 1s clip.
        let expected =
            2.0 * (elapsed / 0.75).clamp(0.0, 1.0) * ((1.0 - elapsed) / 0.25).clamp(0.0, 1.0);
        close(samples[i * 2], expected);
        close(samples[i * 2 + 1], -expected / 2.0);
    }
    close(samples[48000 * 2], 2.0);
    close(samples[60000 * 2], 0.0);
}

#[test]
fn point_edges_hold_and_fades_multiply_the_resolved_lane_last() {
    let mut env = envelope(json!([{"t":0.25,"v":0.4},{"t":0.75,"v":1.6}]));
    env["start"] = json!(0.25);
    let samples = mix_envelope(env.clone(), 0, 0, 72001);
    for (sample, expected) in [
        (0, 0.4),
        (24000, 0.4),
        (36000, 1.0),
        (48000, 1.6),
        (72000, 1.6),
    ] {
        close(samples[sample * 2], expected);
    }
    env["fadeIn"] = json!(0.5);
    env["fadeOut"] = json!(0.5);
    let samples = mix_envelope(env, 0, 0, 72001);
    for (sample, expected) in [
        (12000, 0.0),
        (24000, 0.2),
        (36000, 1.0),
        (48000, 0.8),
        (60000, 0.0),
    ] {
        close(samples[sample * 2], expected);
    }
}

#[test]
fn mixer_uses_sample_origin_and_clip_output_start_before_subtracting_clip_start() {
    let mut env = envelope(json!([{"t":0,"v":0},{"t":1,"v":1}]));
    env["start"] = json!(0.125);
    let samples = mix_envelope(env, 24000, 12000, 3);
    assert!(samples[..24000].iter().all(|s| *s == 0.0));
    for i in 0..3 {
        close(samples[24000 + i * 2], 0.625 + i as f64 / 48000.0);
    }
}

fn schedule(first: u32, count: u32, env: &Value) -> Value {
    let frames: Vec<Value> = (first..first + count)
        .map(|f| {
            let assets = if f == 0 {
                json!([])
            } else {
                // A native loop at frame 5 starts a new decode segment, while the
                // authored gain remains on the original absolute clip clock.
                let source_frame = if f >= 5 { f - 5 } else { f - 1 };
                json!([{"id":"native", "resourceId":"a".repeat(64), "type":"audio",
                "sourceTime":source_frame as f64*1001.0/30000.0,"playbackRate":1,
                "toneFrequency":1,"volume":f as f64/10.0,"audioStreamIndex":0,
                "gainEnvelope":env}])
            };
            json!({"frameIndex":f,"assets":assets})
        })
        .collect();
    serde_json::from_str(&resolve_programmatic_audio_schedule_json(
        json!({
            "version":1,"frameRate":{"numerator":30000,"denominator":1001},
            "sampleRate":44100,"firstFrame":first,"frames":frames
        })
        .to_string(),
    ))
    .unwrap()
}

fn mix_plan(plan: &Value) -> Vec<f32> {
    let segments = plan["segments"].as_array().unwrap();
    let mut samples = Vec::new();
    let mut sizes = Vec::new();
    let mut clips = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        let start = segment["sourceSample"].as_u64().unwrap();
        let frames = segment["frames"].as_u64().unwrap();
        samples.extend((start..start + frames).flat_map(|i| {
            let value = (i % 97) as f32 / 97.0;
            [value, -value / 2.0]
        }));
        sizes.push(frames * 8);
        clips.push(
            json!({"pcmIndex":index,"outputStart":segment["outputStart"],
            "frames":frames,"gains":segment["gains"]}),
        );
    }
    decode(
        mix_programmatic_audio_pcm(packet(
            json!({"version":1,"sampleRate":plan["sampleRate"],
        "sampleOrigin":plan["sampleOrigin"],"channels":2,"outputFrames":plan["outputFrames"],
        "pcmBytes":sizes,"clips":clips}),
            &samples,
        ))
        .unwrap(),
    )
}

#[test]
fn fractional_frame_partial_renders_are_identical_to_full_samples_through_loop_seeks() {
    let mut env = envelope(json!([
        {"t":0.0,"v":0.2,"curve":0.5},{"t":0.08,"v":0.9,"viaX":0.25,"viaY":0.75},
        {"t":0.16,"v":0.3},{"t":0.3,"v":1.1}
    ]));
    env["start"] = json!(1001.0 / 30000.0);
    env["duration"] = json!(0.3);
    env["fadeIn"] = json!(0.02);
    env["fadeOut"] = json!(0.1);
    let full = schedule(0, 10, &env);
    assert!(full.get("error").is_none(), "{full}");
    let full_plan = &full["plan"];
    assert_eq!(full_plan["sampleOrigin"], 0);
    assert_eq!(full_plan["segments"].as_array().unwrap().len(), 2);
    for segment in full_plan["segments"].as_array().unwrap() {
        let gains = segment["gains"].as_array().unwrap();
        assert_eq!(
            gains.len(),
            1,
            "Identical envelopes must merge despite frame volume changes"
        );
        assert_eq!(gains[0]["envelope"], env);
        assert_eq!(gains[0]["value"], 3.0);
    }
    let full_samples = mix_plan(full_plan);
    for (first, count) in [(1, 1), (2, 4), (4, 4), (6, 4)] {
        let partial = schedule(first, count, &env);
        assert!(partial.get("error").is_none(), "{partial}");
        let plan = &partial["plan"];
        assert_eq!(plan["sampleOrigin"], first as u64 * 44100 * 1001 / 30000);
        let partial_samples = mix_plan(plan);
        let begin = plan["sampleOrigin"].as_u64().unwrap() as usize * 2;
        assert_eq!(
            partial_samples,
            full_samples[begin..begin + partial_samples.len()]
        );
    }
}

#[test]
fn invalid_envelopes_are_rejected_by_schedule_and_mixer() {
    let valid = envelope(json!([{"t":0,"v":0},{"t":1,"v":1}]));
    let mut invalid = Vec::new();
    for (key, value) in [
        ("version", json!(2)),
        ("start", json!(-1)),
        ("duration", json!(0)),
        ("duration", json!(86401)),
        ("start", json!(86400)),
        ("baseGain", json!(65)),
        ("fadeIn", json!(-1)),
        ("fadeOut", json!(86401)),
    ] {
        let mut env = valid.clone();
        env[key] = value;
        invalid.push(env);
    }
    for (key, value) in [
        ("t", json!(-1)),
        ("v", json!(65)),
        ("curve", json!(1.1)),
        ("curve", json!(-1.1)),
        ("viaX", json!(0.4)),
        ("viaY", json!(0.6)),
        ("curve", json!("NaN")),
        ("v", Value::Null),
    ] {
        let mut env = valid.clone();
        env["points"][0][key] = value;
        invalid.push(env);
    }
    for points in [
        json!([{"t":1,"v":1},{"t":0,"v":0}]),
        json!([{"t":0,"v":0},{"t":0,"v":1}]),
        json!([{"t":0,"v":1,"viaX":0,"viaY":1}]),
        json!([{"t":0,"v":1,"curve":null,"extra":1}]),
        json!((0..4097).map(|i| json!({"t":i,"v":1})).collect::<Vec<_>>()),
    ] {
        let mut env = valid.clone();
        env["points"] = points;
        invalid.push(env);
    }
    for env in invalid {
        assert!(
            schedule(1, 1, &env).get("error").is_some(),
            "accepted {env}"
        );
        let manifest = json!({"version":1,"sampleRate":48000,"channels":2,"outputFrames":1,
            "pcmBytes":[8],"clips":[{"pcmIndex":0,"outputStart":0,"frames":1,
                "gains":[{"offset":0,"frames":1,"value":1,"envelope":env}]}]});
        assert!(mix_programmatic_audio_pcm(packet(manifest, &[1.0, 1.0])).is_err());
    }
}

#[test]
fn legacy_constant_manifest_defaults_origin_to_zero_and_retains_exact_gain() {
    let manifest = json!({"version":1,"sampleRate":48000,"channels":2,"outputFrames":3,
        "pcmBytes":[24],"clips":[{"pcmIndex":0,"outputStart":0,"frames":3,
            "gains":[{"offset":0,"frames":1,"value":0.5},{"offset":1,"frames":2,"value":2}]}]});
    let source = [1.0, -1.0, 0.5, -0.5, 0.25, -0.25];
    assert_eq!(
        decode(mix_programmatic_audio_pcm(packet(manifest.clone(), &source)).unwrap()),
        [0.5, -0.5, 1.0, -1.0, 0.5, -0.5]
    );
    for origin in [u64::MAX, 9_007_199_254_740_991] {
        let mut bad = manifest.clone();
        bad["sampleOrigin"] = json!(origin);
        assert!(mix_programmatic_audio_pcm(packet(bad, &source)).is_err());
    }
}
