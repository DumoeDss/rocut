use editor_api::{validate_image_sequence_manifest_json, validate_programmatic_resources_json};
use serde_json::{Value, json};

fn resource(id: &str, kind: &str, hash: u64, bytes: u64) -> Value {
    let digest = format!("{hash:064x}");
    json!({"id":id,"kind":kind,"attachmentKey":format!("{}{}",
        if kind == "source" {"programmatic-source-sha256-"} else {"programmatic-sha256-"},digest),
        "sha256":digest,"byteLength":bytes,"mimeType":if kind == "source" {"application/octet-stream"} else {"image/png"}})
}
fn manifest() -> Value {
    json!({"version":1,"shotId":"shot-a","renderId":"render-a",
        "frameRate":{"numerator":24000,"denominator":1001},"width":1920,"height":1080,
        "firstFileFrame":1001,"alpha":"straight","colorSpace":"srgb",
        "frames":(0..222).map(|i|resource(&format!("frames/{i:06}.png"),"image",i+1,10)).collect::<Vec<_>>(),
        "provenance":{"engine":"blender","version":"5.0.0","entryFile":"scene.blend",
            "parameters":{"camera":"Main","samples":64,"nested":[true,null,0.5]},
            "originalManifest":resource("original/render.json","source",80000,10),
            "sourceFiles":[{"path":"scene.blend","byteLength":1,"sha256":format!("{:064x}",80001),
                "parts":[resource("archive/scene.blend.part000","source",80001,1)]}]}})
}
fn validate(value: &Value) -> Value {
    serde_json::from_str(&validate_image_sequence_manifest_json(value.to_string())).unwrap()
}
fn rejects(value: &Value) {
    let result = validate(value);
    assert!(
        result["error"].is_string(),
        "accepted invalid manifest: {result}"
    );
}

#[test]
fn validates_222_frames_and_retains_complete_provenance_without_relaxing_old_resource_limits() {
    let m = manifest();
    let result = validate(&m);
    assert!(result["error"].is_null(), "{result}");
    assert_eq!(result["manifest"], m);
    assert_eq!(result["dependencies"].as_array().unwrap().len(), 224);
    for (key, expected) in [
        ("maxFrames", 36000u64),
        ("maxManifests", 8),
        ("maxResourceBytes", 16777216),
        ("maxManifestBytes", 16777216),
        ("maxClosureBytes", 8589934592),
        ("maxSourceBytes", 2147483648),
        ("maxDimension", 8192),
        ("maxDecodedBytes", 134217728),
        ("maxSourceFiles", 4096),
        ("maxSourceParts", 8192),
        ("maxParameterDepth", 16),
        ("maxParameterElements", 4096),
        ("maxParameterStringBytes", 16384),
        ("maxParameterBytes", 262144),
    ] {
        assert_eq!(result["limits"][key], expected, "{key}");
    }
    let old: Value = serde_json::from_str(&validate_programmatic_resources_json(
        m["frames"].to_string(),
    ))
    .unwrap();
    assert!(!old.as_array().unwrap().is_empty());
}

#[test]
fn dependencies_deduplicate_by_attachment_key_without_discarding_original_paths_or_frames() {
    let mut m = manifest();
    m["frames"][1] = m["frames"][0].clone();
    m["frames"][1]["id"] = json!("alternate/000.png");
    let result = validate(&m);
    assert!(result["error"].is_null(), "{result}");
    assert_eq!(result["dependencies"].as_array().unwrap().len(), 223);
    assert_eq!(result["manifest"], m);
    m["frames"][1]["byteLength"] = json!(11);
    rejects(&m);
    let mut duplicate_id = manifest();
    duplicate_id["frames"][1]["id"] = duplicate_id["frames"][0]["id"].clone();
    rejects(&duplicate_id);
}

#[test]
fn rejects_nested_sequences_tampered_descriptors_unsafe_paths_and_missing_source_provenance() {
    for (path, value) in [
        ("/frames/0/kind", json!("imageSequence")),
        ("/frames/0/mimeType", json!("text/html")),
        (
            "/frames/0/attachmentKey",
            json!("programmatic-sha256-wrong"),
        ),
        ("/frames/0/sha256", json!("A".repeat(64))),
        ("/frames/0/byteLength", json!(16777217)),
        ("/frames/0/id", json!("../escape.png")),
        ("/frames/0/id", json!("C:/escape.png")),
        ("/frames/0/id", json!("frames\\escape.png")),
        ("/frames/0/id", json!("frames/%2e%2e/escape.png")),
        ("/frames/0/id", json!("frames/CON.png")),
        ("/frames/0/id", json!("LPT1/frame.png")),
        ("/frames/0/id", json!("frames./frame.png")),
        ("/provenance/originalManifest/kind", json!("image")),
        ("/provenance/sourceFiles/0/parts/0/kind", json!("image")),
        ("/provenance/sourceFiles/0/path", json!("../scene.blend")),
        ("/provenance/sourceFiles/0/byteLength", json!(2)),
        ("/provenance/sourceFiles/0/byteLength", json!(u64::MAX)),
        ("/provenance/sourceFiles/0/sha256", json!("not-a-digest")),
        ("/provenance/entryFile", json!("missing.blend")),
        ("/provenance/sourceFiles", json!([])),
        ("/provenance/parameters", json!([1, 2])),
        ("/colorSpace", json!("display-p3")),
        ("/alpha", json!("premultiplied")),
        ("/firstFileFrame", json!(9007199254740991u64)),
        ("/firstFileFrame", json!(-1)),
        ("/firstFileFrame", json!(0.5)),
        ("/frameRate/numerator", json!(0)),
        ("/frameRate/denominator", json!(1002)),
    ] {
        let mut bad = manifest();
        *bad.pointer_mut(path).unwrap() = value;
        rejects(&bad);
    }
    let mut duplicate_path = manifest();
    let mut file = duplicate_path["provenance"]["sourceFiles"][0].clone();
    file["path"] = json!("SCENE.BLEND");
    duplicate_path["provenance"]["sourceFiles"]
        .as_array_mut()
        .unwrap()
        .push(file);
    rejects(&duplicate_path);
    for path in ["CON.blend", "archive./scene.blend", "LPT1/scene.blend"] {
        let mut bad = manifest();
        bad["provenance"]["entryFile"] = json!(path);
        bad["provenance"]["sourceFiles"][0]["path"] = json!(path);
        rejects(&bad);
    }
    let mut prefix = manifest();
    let mut child = prefix["provenance"]["sourceFiles"][0].clone();
    child["path"] = json!("scene.blend/nested.blend");
    prefix["provenance"]["sourceFiles"]
        .as_array_mut()
        .unwrap()
        .push(child);
    rejects(&prefix);
    let mut aliases = manifest();
    aliases["frames"][1] = aliases["frames"][0].clone();
    aliases["frames"][1]["id"] = json!("FRAMES/000000.PNG");
    rejects(&aliases);
    aliases["frames"][1]["id"] = json!("frames/000000.png/child.png");
    rejects(&aliases);
}

#[test]
fn rejects_manifest_decode_closure_archive_and_parameter_budget_overflows() {
    let mut huge = manifest();
    huge["width"] = json!(8192);
    huge["height"] = json!(8192);
    rejects(&huge); // dimension cap alone must not bypass the RGBA budget.
    let mut closure = manifest();
    closure["frames"] = json!(
        (0..513)
            .map(|i| resource(&format!("frame/{i}.png"), "image", i + 1, 16777216))
            .collect::<Vec<_>>()
    );
    rejects(&closure);
    let mut archive = manifest();
    archive["provenance"]["sourceFiles"][0]["byteLength"] = json!(2147483649u64);
    rejects(&archive);
    let mut many = manifest();
    let frame = many["frames"][0].clone();
    many["frames"] = json!(vec![frame; 36001]);
    rejects(&many);
    let mut depth = json!(0);
    for _ in 0..17 {
        depth = json!({"next":depth});
    }
    for parameter in [
        depth,
        json!(vec![0; 4097]),
        json!("x".repeat(16385)),
        json!(9007199254740992u64),
        json!(vec!["x".repeat(16384); 17]),
    ] {
        let mut bad = manifest();
        bad["provenance"]["parameters"] = json!({"value":parameter});
        rejects(&bad);
    }
}
