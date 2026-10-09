#[path = "support/hyperframes_execution.rs"]
mod support;
use editor_api::{mix_hyperframes_audio_bus_pcm, mix_hyperframes_audio_master_pcm};
use serde_json::{Value, json};
use support::*;

fn routed() -> Value {
    let mut input = request();
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["groupRenderId"] = json!("bus#1");
    let mut second = input["graph"]["snapshot"]["tracks"][0].clone();
    second["instanceId"] = json!("track#2");
    let mut third = second.clone();
    third["instanceId"] = json!("track#3");
    third["attributes"]["groupRenderId"] = json!(null);
    input["graph"]["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .extend([second, third]);
    input["graph"]["snapshot"]["buses"] = json!([{"instanceId":"bus#1","authorId":null,"hidden":false,
        "attributes":{"volume":"0.5suffix","fxChain":null,"automation":null}}]);
    input
}

#[test]
fn grouped_tracks_gain_once_then_bus_post_fx_fader_then_ungrouped_master() {
    let input = routed();
    let bus = samples(
        mix_hyperframes_audio_bus_pcm(assembly(
            &input,
            Some("bus#1"),
            None,
            &[
                ("track-post-fx", "track#2", vec![3.; 9600]),
                ("track-post-fx", "track#1", vec![1.; 9600]),
            ],
        ))
        .unwrap(),
    );
    assert!(bus.iter().all(|sample| *sample == 8.0));
    // Independent supplied post-bus-FX signal, not the pre-FX sum above.
    let master = samples(
        mix_hyperframes_audio_master_pcm(assembly(
            &input,
            None,
            Some("canonical"),
            &[
                ("bus-post-fx", "bus#1", vec![4.; 9600]),
                ("track-post-fx", "track#3", vec![2.; 9600]),
            ],
        ))
        .unwrap(),
    );
    assert!(master.iter().all(|sample| *sample == 6.0));
    let plan = prepared(&input);
    assert_eq!(plan["workingSet"]["retainedTrackFxBytes"], 3 * 4800 * 8);
    assert_eq!(plan["workingSet"]["retainedBusFxBytes"], 4800 * 8);
    assert_eq!(
        plan["workingSet"]["largestAssemblyInputBytes"],
        2 * 4800 * 8
    );
    assert_eq!(plan["sources"], input["graph"]["sources"]);
}

#[test]
fn canonical_track_and_bus_order_is_independent_of_packet_order() {
    let mut input = routed();
    input["graph"]["snapshot"]["buses"] = json!([]);
    for track in input["graph"]["snapshot"]["tracks"].as_array_mut().unwrap() {
        track["attributes"]["groupRenderId"] = json!(null);
    }
    let buffers = [
        ("track-post-fx", "track#3", vec![1.; 9600]),
        ("track-post-fx", "track#1", vec![1e20; 9600]),
        ("track-post-fx", "track#2", vec![-1e20; 9600]),
    ];
    let master = samples(
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("crop"), &buffers)).unwrap(),
    );
    assert!(master.iter().all(|sample| *sample == 2.0));
}

#[test]
fn complete_tail_history_is_placed_by_clip_start_before_final_crop() {
    let mut input = request();
    input["graph"]["snapshot"]["time"] = json!(0.03);
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["observedAt"] = json!(0.03);
    track["resolvedAuthorGain"]["observedAt"] = json!(0.03);
    track["native"]["start"] = json!(0.02);
    track["native"]["duration"] = json!(0.02);
    track["native"]["end"] = json!(0.04);
    track["attributes"]["fxChain"] = json!(
        r#"{"version":1,"nodes":[{"type":"delay","params":{"time":100,"feedback":0,"mix":0.5}}]}"#
    );
    let mut post_fx = vec![0.0; 10560 * 2];
    post_fx[1500 * 2] = 1.0;
    let buffers = [("track-post-fx", "track#1", post_fx)];
    let full =
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("canonical"), &buffers))
            .unwrap();
    assert_eq!(samples(full.clone())[2460 * 2], 2.0);
    input["graph"]["firstFrame"] = json!(1);
    input["graph"]["frameCount"] = json!(1);
    let partial =
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("crop"), &buffers)).unwrap();
    assert_eq!(partial, full[1600 * 8..3200 * 8]);
}

#[test]
fn missing_duplicates_wrong_stage_and_grouped_track_double_count_are_rejected() {
    let input = routed();
    let one = ("track-post-fx", "track#1", vec![1.; 9600]);
    assert!(
        mix_hyperframes_audio_bus_pcm(assembly(&input, Some("bus#1"), None, &[]))
            .unwrap_err()
            .contains("Missing")
    );
    assert!(
        mix_hyperframes_audio_bus_pcm(assembly(
            &input,
            Some("bus#1"),
            None,
            &[one.clone(), one.clone()]
        ))
        .unwrap_err()
        .contains("Duplicate")
    );
    assert!(
        mix_hyperframes_audio_bus_pcm(assembly(
            &input,
            Some("bus#1"),
            None,
            &[("bus-post-fx", "track#1", vec![1.; 9600])]
        ))
        .unwrap_err()
        .contains("Missing")
    );
    let extra = [
        one,
        ("bus-post-fx", "bus#1", vec![1.; 9600]),
        ("track-post-fx", "track#3", vec![1.; 9600]),
    ];
    assert!(
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("crop"), &extra))
            .unwrap_err()
            .contains("Unexpected")
    );
    assert!(
        mix_hyperframes_audio_bus_pcm(assembly(&input, Some("bus#1"), Some("crop"), &[])).is_err()
    );
}

#[test]
fn inactive_muted_and_declared_inaudible_tracks_need_no_buffer_but_cannot_accept_one() {
    let mut input = request();
    input["graph"]["snapshot"]["tracks"][0]["authoredMuted"] = json!(true);
    input["graph"]["snapshot"]["tracks"][0]["resolvedAuthorGain"] = json!({"state":"unobserved"});
    let plan = prepared(&input);
    assert_eq!(plan["tracks"][0]["requiresPcm"], false);
    assert_eq!(plan["decodedSources"][0]["required"], false);
    let output = samples(
        mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("crop"), &[])).unwrap(),
    );
    assert!(output.iter().all(|sample| *sample == 0.0));
    assert!(
        mix_hyperframes_audio_master_pcm(assembly(
            &input,
            None,
            Some("crop"),
            &[("track-post-fx", "track#1", vec![0.; 9600])]
        ))
        .unwrap_err()
        .contains("nonparticipating")
    );
    input["graph"]["snapshot"]["tracks"][0]["authoredMuted"] = json!(false);
    input["graph"]["snapshot"]["tracks"][0]["type"] = json!("video");
    input["graph"]["sources"][0]["mimeType"] = json!("video/mp4");
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["hasAudio"] = json!("false");
    let plan = prepared(&input);
    assert_eq!(plan["tracks"][0]["audibleMedia"], false);
    assert_eq!(plan["tracks"][0]["requiresPcm"], false);
}

#[test]
fn physical_no_audio_video_must_still_supply_host_verified_silent_pcm_when_admitted() {
    let mut input = request();
    input["graph"]["snapshot"]["tracks"][0]["type"] = json!("video");
    input["graph"]["sources"][0]["mimeType"] = json!("video/mp4");
    // Missing data-has-audio is native-admissible, not proof ffprobe found audio.
    assert_eq!(prepared(&input)["tracks"][0]["requiresPcm"], true);
    assert!(mix_hyperframes_audio_master_pcm(assembly(&input, None, Some("crop"), &[])).is_err());
    let output = samples(
        mix_hyperframes_audio_master_pcm(assembly(
            &input,
            None,
            Some("crop"),
            &[("track-post-fx", "track#1", vec![0.; 9600])],
        ))
        .unwrap(),
    );
    assert!(output.iter().all(|sample| *sample == 0.0));
}

#[test]
fn bus_automation_is_post_fx_and_preserves_negative_via_and_headroom() {
    let mut input = routed();
    input["graph"]["snapshot"]["buses"][0]["attributes"]["automation"] = json!(
        r#"{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0,"viaX":0.5,"viaY":0.001},{"t":0.1,"v":1}]}]}"#
    );
    let output = samples(
        mix_hyperframes_audio_master_pcm(assembly(
            &input,
            None,
            Some("canonical"),
            &[
                ("bus-post-fx", "bus#1", vec![2.; 9600]),
                ("track-post-fx", "track#3", vec![0.; 9600]),
            ],
        ))
        .unwrap(),
    );
    assert!(output.iter().any(|sample| *sample < -0.2));
    assert!(output.last().unwrap() > &1.0);
}

#[test]
fn nonfinite_overflow_trailing_and_mismatched_lengths_fail_closed() {
    let input = request();
    for pcm in [vec![f32::NAN; 9600], vec![f32::MAX; 9600], vec![1.; 9598]] {
        assert!(
            mix_hyperframes_audio_master_pcm(assembly(
                &input,
                None,
                Some("canonical"),
                &[("track-post-fx", "track#1", pcm)]
            ))
            .is_err()
        );
    }
    let mut packet = assembly(
        &input,
        None,
        Some("canonical"),
        &[("track-post-fx", "track#1", vec![1.; 9600])],
    );
    packet.push(0);
    assert!(
        mix_hyperframes_audio_master_pcm(packet)
            .unwrap_err()
            .contains("trailing")
    );
}

#[test]
fn muting_and_hiding_never_hide_retained_buffer_cost_from_admission() {
    let mut input = routed();
    let active = prepared(&input)["workingSet"].clone();
    for track in input["graph"]["snapshot"]["tracks"].as_array_mut().unwrap() {
        track["authoredMuted"] = json!(true);
    }
    input["graph"]["snapshot"]["buses"][0]["hidden"] = json!(true);
    let muted = prepared(&input);
    assert_eq!(muted["workingSet"], active);
    assert_eq!(muted["buses"][0]["requiresPcm"], false);
    assert!(
        muted["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|track| track["requiresPcm"] == false)
    );
}
