use super::*;
use serde_json::{Value, json};
fn resource(id: &str) -> Resource {
    serde_json::from_value(
        json!({"id":id,"kind":"image","mimeType":"image/png","byteLength":1,
        "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","a".repeat(64))}),
    )
    .unwrap()
}
fn scene(kind: &str) -> Value {
    let settings = match kind {
        "heartGather" => json!({"heart":"heart","char":"character","bg":"background"}),
        "sunBloom" => json!({"heart":"heart","char":"character"}),
        "skyShatter" => json!({"bg":"background","char":"character"}),
        _ => json!({"heart":"heart"}),
    };
    json!({"kind":kind,"role":"subject","bpm":120,"span":{"startFrame":0,"durationFrames":60},"settings":settings})
}
#[test]
fn public_five_modes_require_distinct_declared_roles_and_forbid_native_facts() {
    let resources = [
        resource("heart"),
        resource("background"),
        resource("character"),
    ];
    for kind in [
        "heartShatter",
        "heartShatterBurn",
        "heartGather",
        "sunBloom",
        "skyShatter",
    ] {
        let value = scene(kind);
        let parsed: Scene = serde_json::from_value(value.clone()).unwrap();
        assert!(valid(&parsed, &resources, 0, 4000));
        assert!(!valid(&parsed, &[], 0, 4000));
        let mut authored = value.clone();
        authored["binding"] = json!({"decodedWidth":1});
        assert!(serde_json::from_value::<Scene>(authored).is_err());
        let mut authored = value.clone();
        authored["settings"]["decodedWidth"] = json!(1);
        assert!(serde_json::from_value::<Scene>(authored).is_err());
        let mut bad = value.clone();
        bad["bpm"] = json!(0);
        assert!(!valid(
            &serde_json::from_value(bad).unwrap(),
            &resources,
            0,
            4000
        ));
        if kind == "heartGather" || kind == "sunBloom" {
            let mut same = value;
            same["settings"]["char"] = json!("heart");
            assert!(!valid(
                &serde_json::from_value(same).unwrap(),
                &resources,
                0,
                4000
            ));
        }
    }
}
#[test]
fn public_request_is_pending_and_requires_reviewed_song_evidence() {
    let scene: Scene = serde_json::from_value(scene("skyShatter")).unwrap();
    let sample = super::super::ember::Sample {
        shot_start_ticks: 0,
        shot_end_ticks: 240000,
        song_ticks: 120000,
        width: 1920.0,
        height: 1080.0,
        analysis: None,
        fonts: None,
        images: None,
    };
    assert!(
        request(
            &scene,
            &sample,
            &[resource("background"), resource("character")]
        )
        .err()
        .unwrap()
        .contains("reviewed")
    );
}
