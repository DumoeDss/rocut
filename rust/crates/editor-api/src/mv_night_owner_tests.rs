use super::*;
use std::cell::Cell;
#[test]
fn malformed_and_oversized_requests_never_invoke_binary_copy() {
    let mut owner = Owner::new().unwrap();
    let called = Cell::new(false);
    for (metadata, length) in [("{}", 1), ("{}", transport::MAX_ENCODED_BYTES + 1), ("", 1)] {
        assert!(
            owner
                .inspect_with(metadata, length, || {
                    called.set(true);
                    Ok(Vec::<u8>::new())
                })
                .is_err()
        );
    }
    assert!(!called.get());
    assert_eq!(owner.diagnostic()["reservedBytes"], 0);
    assert_eq!(owner.diagnostic()["sessions"], 0);
}
#[test]
fn closed_scope_and_ranges_fail_before_copy() {
    let mut owner = Owner::new().unwrap();
    let binding = json!({"scene":"wetFloor","settings":{"mode":"fall","bg":"bg","fonts":{"mincho800":"m","noto800":"n8","dot400":"d","noto400":"n4"},"beats":{"kind":"manual","songTicks":[]},"bpm":120,"downbeatIndex0":0}});
    let metadata =
        json!({"binding":binding,"resources":[],"fontInstances":[],"byteLayout":[],"decodedImages":[],"beats":[]})
            .to_string();
    let called = Cell::new(false);
    assert!(
        owner
            .inspect_with(&metadata, 1, || {
                called.set(true);
                Ok(vec![0])
            })
            .is_err()
    );
    assert!(!called.get());
    assert_eq!(owner.diagnostic()["reservedBytes"], 0);
}
#[test]
fn exact_physical_scope_layout_and_roles_are_checked_before_copy() {
    let mut resources = Vec::new();
    for (id, family, weight, axes, digit) in [
        ("source/m", "Shippori Mincho B1", 800, json!({}), "1"),
        ("source/d", "DotGothic16", 400, json!({}), "2"),
        ("source/n", "Noto Serif JP", 200, json!({"wght":200}), "3"),
    ] {
        let sha = digit.repeat(64);
        resources.push(json!({"id":id,"kind":"font","mimeType":"font/ttf","byteLength":1,"sha256":sha,"attachmentKey":format!("programmatic-sha256-{sha}"),"font":{"family":family,"style":"normal","weight":weight,"axes":axes}}));
    }
    let sha = "4".repeat(64);
    resources.push(json!({"id":"bg","kind":"image","mimeType":"image/png","byteLength":1,"sha256":sha,"attachmentKey":format!("programmatic-sha256-{sha}")}));
    let layout: Vec<_> = resources
        .iter()
        .enumerate()
        .map(|(n, r)| json!({"resourceId":r["id"],"offset":n,"length":1}))
        .collect();
    let valid = json!({"binding":{"scene":"wetFloor","settings":{"mode":"fall","bg":"bg","fonts":{"mincho800":"m","noto800":"n8","dot400":"d","noto400":"n4"},"beats":{"kind":"manual","songTicks":[]},"bpm":120,"downbeatIndex0":0}},"resources":resources,"fontInstances":[
        {"id":"m","resourceId":"source/m","weight":800,"axes":{}},
        {"id":"d","resourceId":"source/d","weight":400,"axes":{}},
        {"id":"n8","resourceId":"source/n","weight":800,"axes":{"wght":800}},
        {"id":"n4","resourceId":"source/n","weight":400,"axes":{"wght":400}}
    ],"byteLayout":layout,"decodedImages":[],"beats":[]});
    let mut owner = Owner::new().unwrap();
    owner.preflight(&valid.to_string(), 4).unwrap();
    let mut negatives = Vec::new();
    let mut v = valid.clone();
    v["byteLayout"][1]["offset"] = json!(0);
    negatives.push(v);
    let mut v = valid.clone();
    v["byteLayout"][1]["resourceId"] = json!("source/m");
    negatives.push(v);
    let mut v = valid.clone();
    v["byteLayout"].as_array_mut().unwrap().pop();
    negatives.push(v);
    let mut v = valid.clone();
    v["binding"]["settings"]["fonts"]["noto400"] = json!("n8");
    negatives.push(v);
    let mut v = valid.clone();
    v["fontInstances"][0]["family"] = json!("override");
    negatives.push(v);
    let mut v = valid.clone();
    let mut unused = v["resources"][0].clone();
    unused["id"] = json!("source/unused");
    unused["sha256"] = json!("5".repeat(64));
    unused["attachmentKey"] = json!(format!("programmatic-sha256-{}", "5".repeat(64)));
    v["resources"].as_array_mut().unwrap().push(unused);
    v["byteLayout"]
        .as_array_mut()
        .unwrap()
        .push(json!({"resourceId":"source/unused","offset":4,"length":1}));
    negatives.push(v);
    for value in negatives {
        let called = Cell::new(false);
        assert!(
            owner
                .inspect_with(&value.to_string(), 4, || {
                    called.set(true);
                    Ok(vec![0; 4])
                })
                .is_err()
        );
        assert!(!called.get());
        assert_eq!(owner.diagnostic()["reservedBytes"], 0);
    }
}
#[test]
fn stale_ids_and_missing_original_p4_cannot_produce_a_frame() {
    let mut owner = Owner::new().unwrap();
    assert!(owner.bind_decoded(1, "[]").is_err());
    assert!(
        owner
            .bind_reflection(1, &vec![0; transport::REFLECTION_BYTES])
            .is_err()
    );
    assert!(owner.bind_lut_row(&[0; 1024]).is_err());
    assert!(
        owner
            .evaluate(
                1,
                r#"{"songTicks":1,"shotStartTicks":0,"shotEndTicks":120000}"#
            )
            .is_err()
    );
    assert!(owner.release_frame(1).is_err());
    assert!(owner.dispose(1).is_err());
    owner.clear().unwrap();
    assert_eq!(owner.diagnostic()["reservedBytes"], 0);
}
