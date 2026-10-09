//! Joint admission covers the unchanged all-declared-image raster residency.
use super::support::*;
use serde_json::{Value, json};

fn ordinary(id: &str) -> Value {
    json!({"id":id,"scene":{"kind":"illust","motion":{"startFrame":0,"durationFrames":240},"easing":"linear",
        "background":{"image":"ordinary","from":{"x":0,"y":0,"zoom":1},"to":{"x":0,"y":0,"zoom":1}}}})
}
fn mixed(extra: Vec<Value>, encoded_bytes: u64) -> Value {
    let mut r = request(recipe("kanji", extra), 48);
    let sha = "8".repeat(64);
    r["source"]["resources"].as_array_mut().unwrap().push(
        json!({"id":"ordinary","kind":"image","attachmentKey":format!("programmatic-sha256-{sha}"),
        "sha256":sha,"mimeType":"image/png","byteLength":encoded_bytes}),
    );
    r
}
fn resize(request: &mut Value, width: u32, height: u32) {
    let image = request["imageDimensions"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["resource"]["id"] == "ordinary")
        .unwrap();
    image["width"] = json!(width);
    image["height"] = json!(height);
}
fn assert_joint_budget_error(request: &Value) {
    let result = resolve(request);
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("temporary raster surface budget"),
        "{result}"
    );
    assert!(result.get("frame").is_none());
}

#[test]
fn resident_ordinary_and_unreferenced_images_require_verified_facts_before_plan() {
    for nodes in [vec![], vec![ordinary("illust")]] {
        let source = mixed(nodes, 100);
        let pending = resolve(&source);
        assert!(pending.get("error").is_none(), "{pending}");
        let ids: Vec<_> = pending["frame"]["imageDimensionRequests"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["resource"]["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["character", "ordinary", "sky"]);
        let small = measured(source);
        let result = resolve(&small);
        assert!(result.get("error").is_none(), "{result}");
        assert_eq!(result["frame"]["recipePlan"]["root"]["kind"], "kanjiSlam");
        let mut missing = small.clone();
        missing["imageDimensions"]
            .as_array_mut()
            .unwrap()
            .retain(|d| d["resource"]["id"] != "ordinary");
        assert!(
            resolve(&missing)["error"]
                .as_str()
                .unwrap()
                .contains("missing/extra")
        );
        let mut large = small;
        resize(&mut large, 4096, 4096);
        // ~64.5MiB decoded is below the independent128MiB decode cap, but
        // together with the native leaf/frame scratch exceeds the joint cap.
        assert_joint_budget_error(&large);
    }
}

#[test]
fn repeated_scene_references_share_one_resident_image_and_one_encoded_charge() {
    let one = mixed(vec![ordinary("illust")], 100);
    let twice = mixed(vec![ordinary("illust"), ordinary("again")], 100);
    assert_eq!(
        resolve(&one)["frame"]["imageDimensionRequests"],
        resolve(&twice)["frame"]["imageDimensionRequests"]
    );
    let mut single = measured(one);
    let mut repeated = measured(twice);
    // Eight MiPixels fits once but not twice alongside the40Mi leaf envelope.
    resize(&mut single, 4096, 2048);
    resize(&mut repeated, 4096, 2048);
    for ready in [&single, &repeated] {
        let result = resolve(ready);
        assert!(result.get("error").is_none(), "{result}");
    }
}

#[test]
fn ordinary_image_encoded_transport_copies_remain_in_the_joint_budget() {
    let mut compact = measured(mixed(vec![ordinary("illust")], 100));
    resize(&mut compact, 4096, 1024);
    let result = resolve(&compact);
    assert!(result.get("error").is_none(), "{result}");
    // This source passes provisional discovery. The identical decoded size
    // with8MiB encoded bytes must include its three retained transport copies.
    let mut larger_encoded = measured(mixed(vec![ordinary("illust")], 8 * 1024 * 1024));
    resize(&mut larger_encoded, 4096, 1024);
    assert_joint_budget_error(&larger_encoded);
}
