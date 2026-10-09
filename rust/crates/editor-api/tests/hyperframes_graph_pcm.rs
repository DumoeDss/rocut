#[path = "support/hyperframes_execution.rs"]
mod support;
use editor_api::{apply_hyperframes_audio_track_gain_pcm, prepare_hyperframes_audio_dry_track_pcm};
use serde_json::json;
use support::*;

#[test]
fn dry_pcm_preserves_unscaled_stereo_headroom_trim_and_native_trimmed_loop_origin() {
    let mut input = request();
    let native = &mut input["graph"]["snapshot"]["tracks"][0]["native"];
    native["sourceDuration"] = json!(4.0 / 48000.0);
    native["mediaStart"] = json!(1.0 / 48000.0);
    native["loop"] = json!(true);
    let pcm = [1.0, -1.0, 2.0, -2.0, 3.0, -3.0, 4.0, -4.0];
    let output =
        samples(prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &pcm)).unwrap());
    assert_eq!(output.len(), 9600);
    assert_eq!(
        &output[..14],
        &[
            2., -2., 3., -3., 4., -4., 2., -2., 3., -3., 4., -4., 2., -2.
        ]
    );
    assert_eq!(&output[9598..], &[4., -4.]);
    input["graph"]["snapshot"]["tracks"][0]["native"]["loop"] = json!(false);
    let output =
        samples(prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &pcm)).unwrap());
    assert_eq!(&output[..8], &[2., -2., 3., -3., 4., -4., 0., 0.]);
    assert!(output[6..].iter().all(|v| *v == 0.));
}

#[test]
fn post_fx_gain_owns_fades_mute_and_headroom_without_mastering() {
    let mut input = request();
    let pcm = vec![3.0; 9600];
    let output =
        samples(apply_hyperframes_audio_track_gain_pcm(envelope(&input, "track#1", &pcm)).unwrap());
    assert!(output.iter().all(|v| *v == 6.0));
    for pointer in [
        "/graph/snapshot/tracks/0/native/fades",
        "/graph/snapshot/tracks/0/resolvedAuthorGain/fades",
    ] {
        *input.pointer_mut(pointer).unwrap() = json!({"fadeIn":0.02,"fadeOut":0.02});
    }
    let output =
        samples(apply_hyperframes_audio_track_gain_pcm(envelope(&input, "track#1", &pcm)).unwrap());
    assert_eq!(&output[..2], &[0., 0.]);
    assert_eq!(output[480 * 2], 3.0);
    assert_eq!(output[2400 * 2], 6.0);
    assert!((output[4799 * 2] - 0.00625).abs() < 1e-6);
    input["graph"]["snapshot"]["tracks"][0]["authoredMuted"] = json!(true);
    let output =
        samples(apply_hyperframes_audio_track_gain_pcm(envelope(&input, "track#1", &pcm)).unwrap());
    assert!(output.iter().all(|v| *v == 0.));
}

#[test]
fn post_fx_tail_gain_is_applied_after_the_complete_native_stage() {
    let mut input = request();
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["fxChain"] = json!(
        r#"{"version":1,"nodes":[{"type":"delay","params":{"time":100,"feedback":0,"mix":0.5}}]}"#
    );
    let mut pcm = vec![0.0; 14400 * 2];
    pcm[6000 * 2] = 0.25;
    let output =
        samples(apply_hyperframes_audio_track_gain_pcm(envelope(&input, "track#1", &pcm)).unwrap());
    assert_eq!(output[6000 * 2], 0.5);
    assert!(
        apply_hyperframes_audio_track_gain_pcm(envelope(&input, "track#1", &vec![0.0; 4800 * 2]))
            .is_err()
    );
}

#[test]
fn kernels_revalidate_graph_identity_byte_counts_and_finite_samples() {
    let input = request();
    for (id, pcm) in [
        ("dry#1", vec![0.0; 960]),
        ("dry#0", vec![0.0; 958]),
        ("dry#0", vec![f32::NAN; 960]),
    ] {
        assert!(prepare_hyperframes_audio_dry_track_pcm(envelope(&input, id, &pcm)).is_err());
    }
    let mut invalid = envelope(&input, "dry#0", &vec![0.0; 960]);
    invalid.push(0);
    assert!(prepare_hyperframes_audio_dry_track_pcm(invalid).is_err());
    let mut input = input;
    input["graph"]["snapshot"]["tracks"][0]["resolvedAuthorGain"]["gainBeforeFades"] = json!(1);
    assert!(
        prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &vec![0.0; 960]))
            .is_err()
    );
}

#[test]
fn full_and_partial_kernels_keep_identical_history_and_rational_crop_grid() {
    let mut input = request();
    input["graph"]["frameRate"] = json!({"numerator":30000,"denominator":1001});
    let pcm = vec![0.25; 960];
    let full = prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &pcm)).unwrap();
    input["graph"]["firstFrame"] = json!(1);
    input["graph"]["frameCount"] = json!(1);
    let plan = prepared(&input);
    assert_eq!(plan["renderFrames"], 4804);
    assert_eq!(plan["cropStartSample"], 1601);
    assert_eq!(plan["outputFrames"], 1602);
    let partial = prepare_hyperframes_audio_dry_track_pcm(envelope(&input, "dry#0", &pcm)).unwrap();
    assert_eq!(partial, full);
}
