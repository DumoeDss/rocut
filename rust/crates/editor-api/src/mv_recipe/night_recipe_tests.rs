use super::*;
use std::cell::Cell;
fn author() -> Value {
    json!({"binding":{"scene":"wetFloor","settings":{"mode":"fall","bg":"bg","fonts":{"mincho800":"m","noto800":"n8","dot400":"d","noto400":"n4"},"beats":{"kind":"manual","songTicks":[0,60000,120000]},"bpm":120,"downbeatIndex0":0}},"fontInstances":[
        {"id":"m","resourceId":"source/m","weight":800,"axes":{}},
        {"id":"d","resourceId":"source/d","weight":400,"axes":{}},
        {"id":"n8","resourceId":"source/n","weight":800,"axes":{"wght":800}},
        {"id":"n4","resourceId":"source/n","weight":400,"axes":{"wght":400}}]})
}
fn resources() -> Vec<Resource> {
    let mut values = Vec::new();
    for (id, family, weight, axes, digit) in [
        ("source/m", "Shippori Mincho B1", 800, json!({}), "1"),
        ("source/d", "DotGothic16", 400, json!({}), "2"),
        ("source/n", "Noto Serif JP", 200, json!({"wght":200}), "3"),
    ] {
        let sha = digit.repeat(64);
        values.push(json!({"id":id,"kind":"font","mimeType":"font/ttf","byteLength":1,"sha256":sha,"attachmentKey":format!("programmatic-sha256-{sha}"),"font":{"family":family,"style":"normal","weight":weight,"axes":axes}}));
    }
    let sha = "4".repeat(64);
    values.push(json!({"id":"bg","kind":"image","mimeType":"image/png","byteLength":1,"sha256":sha,"attachmentKey":format!("programmatic-sha256-{sha}")}));
    serde_json::from_value(json!(values)).unwrap()
}
#[test]
fn public_request_contains_only_physical_sources_and_owner_instance_metadata() {
    let settings: Night = serde_json::from_value(author()).unwrap();
    let request = settings
        .request("wet", 1920, 1080, &resources(), None)
        .unwrap();
    assert_eq!(request.physical_resources.len(), 4);
    assert_eq!(request.font_instances.len(), 4);
    assert_eq!(request.physical_encoded_bytes, 4);
    assert!(request.requires_reflection && !request.requires_original_p4_post);
    let metadata: Value = serde_json::from_str(&request.metadata).unwrap();
    assert_eq!(metadata["beats"], json!([0.0, 0.5, 1.0]));
    assert_eq!(metadata["resources"].as_array().unwrap().len(), 4);
    assert!(settings
        .request("wet", 1280, 720, &resources(), None)
        .is_err());
}
#[test]
fn role_loss_duplicate_role_family_override_and_unknown_author_fields_fail_closed() {
    for key in ["family", "style", "mimeType", "sha256"] {
        let mut bad = author();
        bad["fontInstances"][0][key] = json!("override");
        assert!(serde_json::from_value::<Night>(bad).is_err());
    }
    let mut bad = author();
    bad["fontInstances"].as_array_mut().unwrap().pop();
    assert!(serde_json::from_value::<Night>(bad).is_err());
    let mut bad = author();
    bad["binding"]["settings"]["fonts"]["noto400"] = json!("n8");
    assert!(serde_json::from_value::<Night>(bad).is_err());
    let mut bad = author();
    bad["binding"]["settings"]["width"] = json!(1920);
    assert!(serde_json::from_value::<Night>(bad).is_err());
    let mut bad = author();
    bad["fontInstances"][0]["resourceId"] = json!("bg");
    let settings: Night = serde_json::from_value(bad).unwrap();
    assert!(settings
        .request("wet", 1920, 1080, &resources(), None)
        .is_err());
}
#[test]
fn native_context_never_admits_fake_sfnt_or_copies_a_wrong_packet_length() {
    let settings: Night = serde_json::from_value(author()).unwrap();
    let request = settings
        .request("wet", 1920, 1080, &resources(), None)
        .unwrap();
    let request = Traversal::default()
        .issue(request, 60000, 0, 120000)
        .unwrap();
    let mut context = Context::new().unwrap();
    let copied = Cell::new(false);
    assert!(context
        .inspect(&request, 5, || {
            copied.set(true);
            Ok(vec![0; 5])
        })
        .is_err());
    assert!(!copied.get());
    assert!(context.inspect(&request, 4, || Ok(vec![0; 4])).is_err());
    assert!(context.frame(&request, 60000, 0, 120000).is_err());
    assert_eq!(context.diagnostic()["sessions"], 0);
    assert_eq!(context.diagnostic()["reservedBytes"], 0);
    context.clear().unwrap();
}
#[test]
fn same_source_node_has_distinct_mapped_occurrences() {
    let settings: Night = serde_json::from_value(author()).unwrap();
    let mut traversal = Traversal::default();
    let a = traversal
        .issue(
            settings
                .request("wet", 1920, 1080, &resources(), None)
                .unwrap(),
            0,
            0,
            120000,
        )
        .unwrap();
    let b = traversal
        .issue(
            settings
                .request("wet", 1920, 1080, &resources(), None)
                .unwrap(),
            60000,
            0,
            120000,
        )
        .unwrap();
    assert_eq!(a.node_id, b.node_id);
    assert_ne!(a.occurrence_id, b.occurrence_id);
    assert_ne!(a.song_ticks, b.song_ticks);
    assert_eq!(a.metadata, b.metadata);
    assert!(traversal
        .issue(
            settings
                .request("wet", 1920, 1080, &resources(), None)
                .unwrap(),
            0,
            120000,
            0
        )
        .is_err());
}
#[test]
fn train_requests_all_six_instances_one_variable_source_and_mandatory_p4() {
    let mut value = author();
    value["binding"] = json!({"scene":"train","settings":{"bg":"bg","chars":["bg"],
        "fonts":{"mincho800":"m","noto800":"n8","mincho700":"m7","noto700":"n7","dot400":"d","noto400":"n4"},
        "beats":{"kind":"manual","songTicks":[0,60000,120000]},"bpm":120,"downbeatIndex0":0}});
    value["fontInstances"].as_array_mut().unwrap().extend([
        json!({"id":"m7","resourceId":"source/m7","weight":700,"axes":{}}),
        json!({"id":"n7","resourceId":"source/n","weight":700,"axes":{"wght":700}}),
    ]);
    value["lutAtlas"] =
        json!({"paletteResource":"pal","images":[{"path":"lut.png","resourceId":"bg"}]});
    let mut physical = serde_json::to_value(resources()).unwrap();
    let sha = "6".repeat(64);
    physical.as_array_mut().unwrap().push(json!({"id":"pal","kind":"analysis","mimeType":"application/json","byteLength":1,"sha256":sha,"attachmentKey":format!("programmatic-sha256-{sha}")}));
    let mut mincho = physical[0].clone();
    mincho["id"] = json!("source/m7");
    mincho["font"]["weight"] = json!(700);
    mincho["sha256"] = json!("5".repeat(64));
    mincho["attachmentKey"] = json!(format!("programmatic-sha256-{}", "5".repeat(64)));
    physical.as_array_mut().unwrap().push(mincho);
    let physical: Vec<Resource> = serde_json::from_value(physical).unwrap();
    let settings: Night = serde_json::from_value(value).unwrap();
    let request = settings
        .request("train", 1920, 1080, &physical, None)
        .unwrap();
    assert_eq!(request.font_instances.len(), 6);
    assert_eq!(
        request
            .physical_resources
            .iter()
            .filter(|r| r.kind == "font")
            .count(),
        4
    );
    assert_eq!(
        request
            .font_instances
            .iter()
            .filter(|i| i.resource_id == "source/n")
            .count(),
        3
    );
    assert!(request.requires_original_p4_post && !request.requires_reflection);
}
