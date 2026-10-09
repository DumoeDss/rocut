use editor_api::{inspect_programmatic_image_bytes, resolve_programmatic_frame_json};
use serde_json::{Value, json};

// Actual static 2x2 PNG, not a geometry-only synthetic header.
const PNG: &str = "89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a7300000009704859730000000100000001004f25c4d60000001049444154789c63f8cbc000440c100a001fae03f5f6182a590000000049454e44ae426082";
fn png() -> Vec<u8> {
    PNG.as_bytes()
        .chunks_exact(2)
        .map(|part| u8::from_str_radix(std::str::from_utf8(part).unwrap(), 16).unwrap())
        .collect()
}
fn inspect(header: Value, body: &[u8]) -> Value {
    let json = header.to_string();
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend(json.as_bytes());
    bytes.extend(body);
    serde_json::from_str(&inspect_programmatic_image_bytes(bytes)).unwrap()
}
#[test]
fn public_admission_discovers_encoded_geometry_without_authored_sizes() {
    let admitted = inspect(json!({"mimeType":"image/png"}), &png());
    assert_eq!(admitted["width"], 2);
    assert_eq!(admitted["height"], 2);
    assert_eq!(admitted["decodedBytes"], 16);
    assert_eq!(admitted["limits"]["maxDecodedBytes"], 128 * 1024 * 1024);
    assert!(
        inspect(json!({"mimeType":"image/png","width":2,"height":2}), &png())["error"].is_string()
    );
    assert!(inspect(json!({"mimeType":"image/jpeg"}), &png())["error"].is_string());
    let bytes = png();
    for n in [0, 1, 8, bytes.len() - 1] {
        assert!(inspect(json!({"mimeType":"image/png"}), &bytes[..n])["error"].is_string());
    }
}

#[test]
fn public_frame_rejects_null_or_author_injected_image_facts() {
    let source = json!({"version":1,"runtime":"canvas-worker","code":"void 0",
        "width":32,"height":32,"frameRate":{"numerator":30,"denominator":1},
        "durationFrames":30,"seed":0});
    let base =
        json!({"source":source,"clipStart":0,"clipDuration":1,"trimStart":17,"timelineTime":0});
    let resolve = |v: Value| -> Value {
        serde_json::from_str(&resolve_programmatic_frame_json(v.to_string())).unwrap()
    };
    let old = resolve(base.clone());
    assert!(old["frame"].is_object(), "{old}");
    assert!(old["frame"].get("imageDimensionRequests").is_none());
    for facts in [Value::Null, json!([]), json!([{"width":2,"height":2}])] {
        let mut input = base.clone();
        input["imageDimensions"] = facts;
        assert!(resolve(input)["error"].is_string());
    }
    let mut authored = base;
    authored["source"]["imageDimensions"] = json!([]);
    assert!(resolve(authored)["error"].is_string());
}

fn illust_request(width: u32) -> Value {
    let resources: Vec<_> = ["cover.png", "unused.png"]
        .into_iter()
        .enumerate()
        .map(|(index, id)| {
            let sha = format!("{:064x}", index + 1);
            json!({"id":id,"kind":"image","mimeType":"image/png","byteLength":png().len(),
            "sha256":sha,"attachmentKey":format!("programmatic-sha256-{sha}")})
        })
        .collect();
    json!({"source":{"version":1,"runtime":"canvas-worker","code":"","width":width,"height":width,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":30,"seed":9,"resources":resources,
        "recipe":{"version":1,"songStartSeconds":2,"root":"illust","outputRoles":["background"],"nodes":[
            {"id":"illust","scene":{"kind":"illust","motion":{"startFrame":0,"durationFrames":30},"easing":"linear",
                "background":{"image":"cover.png","from":{"x":0,"y":0,"zoom":1},"to":{"x":1,"y":0,"zoom":2}}}}
        ]}},"clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":4000})
}

#[test]
fn ordinary_illust_completes_all_resident_image_facts_without_native_font_requests() {
    let mut request = illust_request(32);
    let resolve = |r: &Value| -> Value {
        serde_json::from_str(&resolve_programmatic_frame_json(r.to_string())).unwrap()
    };
    let pending = resolve(&request);
    assert!(pending.get("error").is_none(), "{pending}");
    assert!(pending["frame"].get("recipePlan").is_none());
    assert!(pending["frame"].get("fontMetricRequests").is_none());
    let images = pending["frame"]["imageDimensionRequests"]
        .as_array()
        .unwrap();
    assert_eq!(images.len(), 2);
    assert_eq!(images[1]["resource"]["id"], "unused.png");
    // Only the transient platform response carries dimensions; authored source
    // remains the same. Browser decode is covered by the resource-worker suite.
    let authored = request["source"].clone();
    request["imageDimensions"] = images
        .iter()
        .map(|r| json!({"resource":r["resource"],"width":2,"height":2}))
        .collect();
    let ready = resolve(&request);
    assert!(ready.get("error").is_none(), "{ready}");
    assert_eq!(ready["frame"]["recipePlan"]["root"]["kind"], "illust");
    assert_eq!(ready["frame"]["index"], 1);
    assert_eq!(ready["frame"]["sampleTime"], 4000);
    assert_eq!(request["source"], authored);
    request["imageDimensions"].as_array_mut().unwrap().pop();
    assert!(
        resolve(&request)["error"]
            .as_str()
            .unwrap()
            .contains("missing/extra")
    );
}

#[test]
fn large_canvas_provisional_discovery_preserves_small_images_but_never_skips_final_budget() {
    let mut request = illust_request(2800);
    let resolve = |r: &Value| -> Value {
        serde_json::from_str(&resolve_programmatic_frame_json(r.to_string())).unwrap()
    };
    let pending = resolve(&request);
    assert!(pending.get("error").is_none(), "{pending}");
    assert!(pending["frame"].get("recipePlan").is_none());
    let images = pending["frame"]["imageDimensionRequests"]
        .as_array()
        .unwrap();
    assert_eq!(images.len(), 2);
    request["imageDimensions"] = images
        .iter()
        .map(|r| json!({"resource":r["resource"],"width":2,"height":2}))
        .collect();
    let small = resolve(&request);
    assert!(small.get("error").is_none(), "{small}");
    assert_eq!(small["frame"]["recipePlan"]["root"]["kind"], "illust");
    let mut missing = request.clone();
    missing["imageDimensions"].as_array_mut().unwrap().pop();
    let incomplete = resolve(&missing);
    assert!(
        incomplete["error"]
            .as_str()
            .unwrap()
            .contains("missing/extra")
    );
    assert!(incomplete.get("frame").is_none());
    // Both sizes pass the128MiB independent decoder cap; together with this
    // canvas's known scratch they exceed the unchanged67,108,864pixel cap.
    for (index, side) in [(0, 4096), (1, 2048)] {
        request["imageDimensions"][index]["width"] = json!(side);
        request["imageDimensions"][index]["height"] = json!(side);
    }
    let large = resolve(&request);
    assert!(
        large["error"]
            .as_str()
            .unwrap()
            .contains("temporary raster surface budget"),
        "{large}"
    );
    assert!(large.get("frame").is_none());
}
