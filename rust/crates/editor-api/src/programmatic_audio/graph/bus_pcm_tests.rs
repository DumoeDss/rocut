use super::add;
use crate::programmatic_audio::graph::bus_schedule::prepare;
use serde_json::{Value, json};

fn render(points: Value, sample_rate: u32, timing: (f64, f64, f64)) -> Vec<f32> {
    let raw = json!({"version":1,"lanes":[{"target":"volume","points":points}]}).to_string();
    let schedule = prepare(Some("0.37suffix"), Some(&raw), timing.0, timing.1, timing.2).unwrap();
    let bytes: Vec<u8> = (0..7680)
        .flat_map(|_| [1.0f32, -0.37f32])
        .flat_map(f32::to_le_bytes)
        .collect();
    let mut output = vec![0.0f32; 7680 * 2];
    add(&mut output, &bytes, &schedule, sample_rate).unwrap();
    output
}

fn native_samples(output: &[f32], samples: &[(usize, u32)]) {
    for (frame, bits) in samples {
        let expected = f32::from_bits(*bits);
        assert!(
            (output[frame * 2] - expected).abs() <= 2e-6,
            "native frame {frame}: {} != {expected}",
            output[frame * 2]
        );
        assert_eq!(output[frame * 2 + 1], output[frame * 2] * -0.37f32);
    }
}

#[test]
fn native_audio_param_seed_starts_linear_ramp_before_late_first_point() {
    let output = render(
        json!([{"t":0.020013,"v":0.2},{"t":0.100017,"v":1.7}]),
        48000,
        (0.0, 0.0, 1.0),
    );
    // Fixed literals from Chrome 151 OfflineAudioContext; the late first
    // authored point is NOT an initial hold as a mathematical lane would be.
    native_samples(
        &output,
        &[
            (0, 1045220557),
            (1, 1045241525),
            (127, 1047883493),
            (128, 1047904455),
            (129, 1047925423),
            (1920, 1061996062),
            (5760, 1071225242),
        ],
    );
}

#[test]
fn native_float32_curve_table_is_interpolated_instead_of_ideal_exponent() {
    let output = render(
        json!([{"t":0,"v":0,"curve":0.5},{"t":0.100017,"v":1}]),
        48000,
        (0.0, 0.0, 1.0),
    );
    native_samples(
        &output,
        &[
            (1, 934198180),
            (127, 992828973),
            (128, 992918436),
            (129, 993007899),
            (1920, 1042533008),
            (5760, 1065353216),
        ],
    );
    assert!(output[2] > 0.00002); // The ideal exponent is only about 4.3e-8.
}

#[test]
fn native_negative_and_overshooting_bus_curves_keep_their_sign_and_headroom() {
    let negative = render(
        json!([{"t":0,"v":0,"viaX":0.5,"viaY":0.001},{"t":0.100017,"v":1}]),
        48000,
        (0.0, 0.0, 1.0),
    );
    native_samples(
        &negative,
        &[
            (1, 3106796121),
            (127, 3165427317),
            (128, 3165516377),
            (1920, 3181506054),
        ],
    );
    let overshoot = render(
        json!([{"t":0,"v":3.9810717055349722,"viaX":0.5,"viaY":0.001},{"t":0.100017,"v":0}]),
        48000,
        (0.0, 0.0, 1.0),
    );
    native_samples(
        &overshoot,
        &[
            (0, 1082051041),
            (127, 1082266630),
            (128, 1082268015),
            (1920, 1082750863),
        ],
    );
}

#[test]
fn native_fractional_event_start_does_not_snap_to_a_video_frame_or_render_quantum() {
    let output = render(
        json!([{"t":0,"v":0.1,"curve":-0.5},{"t":0.2,"v":1.7}]),
        48000,
        (0.020013, 0.05, 2.0),
    );
    native_samples(
        &output,
        &[
            (127, 1052602532),
            (128, 1052602532),
            (960, 1052602532),
            (961, 1063677410),
            (1920, 1066797587),
            (5760, 1071225242),
        ],
    );
    let output = render(
        json!([{"t":0,"v":0.1,"curve":-0.5},{"t":0.2,"v":1.7}]),
        44100,
        (0.020013, 0.05, 2.0),
    );
    native_samples(
        &output,
        &[
            (881, 1052602532),
            (882, 1052602532),
            (883, 1063677860),
            (884, 1063683406),
        ],
    );
}

// Explicit opt-in independent oracle. Source is produced by the pinned native
// scheduler and real Chrome OfflineAudioContext, never by the Rust kernel.
#[test]
#[ignore = "requires ROCUT_HYPERFRAMES_BUS_ORACLE pointing to native verification.json"]
fn complete_native_chromium_oracle_pcm() {
    let path = std::path::PathBuf::from(std::env::var("ROCUT_HYPERFRAMES_BUS_ORACLE").unwrap());
    let evidence: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let cases = evidence["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 36);
    let mut worst = 0.0f64;
    let mut checked = 0usize;
    for case in cases {
        let request = &case["request"];
        let sr = request["sampleRate"].as_u64().unwrap() as u32;
        let schedule = prepare(
            request["rawVolume"].as_str(),
            request["automation"].as_str(),
            request["scheduledAt"].as_f64().unwrap(),
            request["elapsed"].as_f64().unwrap(),
            request["rate"].as_f64().unwrap(),
        )
        .unwrap();
        let frames = request["frames"].as_u64().unwrap() as usize;
        let bytes: Vec<u8> = (0..frames)
            .flat_map(|_| [1.0f32, -0.37f32])
            .flat_map(f32::to_le_bytes)
            .collect();
        let mut actual = vec![0.0f32; frames * 2];
        add(&mut actual, &bytes, &schedule, sr).unwrap();
        let native =
            std::fs::read(path.parent().unwrap().join(case["file"].as_str().unwrap())).unwrap();
        assert_eq!(native.len(), actual.len() * 4);
        let mut case_worst = 0.0f64;
        for (sample, bytes) in actual.iter().zip(native.chunks_exact(4)) {
            let expected = f32::from_le_bytes(bytes.try_into().unwrap());
            let error = (f64::from(*sample) - f64::from(expected)).abs();
            case_worst = case_worst.max(error);
            assert!(
                error <= 2e-6,
                "{} sr={sr}: sample {checked}: {sample} != {expected}; error={error}",
                request["name"]
            );
            checked += 1;
        }
        worst = worst.max(case_worst);
        println!(
            "native case {} sr={sr} maximum_abs_error={case_worst}",
            request["name"]
        );
    }
    println!(
        "Native bus PCM oracle: {} cases, {checked} stereo values, max_abs_error={worst}",
        cases.len()
    );
}
