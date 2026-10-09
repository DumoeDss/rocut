use editor_api::{
    mv_recipe_catalog_json, resolve_programmatic_frame_json, validate_clip_editing_json,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn source() -> Value {
    let hash = "a".repeat(64);
    json!({"version":1,"runtime":"canvas-worker","code":"","width":320,"height":180,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":40,"seed":27,
        "resources":[
            {"id":"image.png","kind":"image","mimeType":"image/png","byteLength":1,
                "sha256":hash,"attachmentKey":format!("programmatic-sha256-{hash}")},
            {"id":"font.ttf","kind":"font","mimeType":"font/ttf","byteLength":1,
                "sha256":hash,"attachmentKey":format!("programmatic-sha256-{hash}"),
                "font":{"family":"HexFixture","weight":500,"style":"normal"}}
        ],"recipe":{"version":1,"root":"g","songStartSeconds":0,"outputRoles":["subject"],
            "nodes":[{"id":"g","scene":{"kind":"hexFloat","role":"subject",
                "span":{"startFrame":4,"durationFrames":16},"easing":"linear",
                "settings":{"image":"image.png","rect":[0.125,0.2,0.75,0.5],"fit":"contain",
                    "size":0.2,"lift":0.4,"tilt":0.6,"gap":0.15,"cycles":1.5,
                    "perspective":0.6,"shading":0.8,"opacity":0.65}}}]}})
}
fn settings(source: &mut Value) -> &mut Value {
    &mut source["recipe"]["nodes"][0]["scene"]["settings"]
}
fn resolve_trimmed(source: &Value, frame: u64, trim: u64) -> Value {
    let step = 120000 * source["frameRate"]["denominator"].as_u64().unwrap()
        / source["frameRate"]["numerator"].as_u64().unwrap();
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":source,
        "clipStart":12000,"clipDuration":(40-trim)*step,"trimStart":trim*step,
        "timelineTime":12000+frame*step})
        .to_string(),
    ))
    .unwrap()
}
fn resolve(source: &Value, frame: u64) -> Value {
    resolve_trimmed(source, frame, 0)
}
fn root(result: &Value) -> &Value {
    &result["frame"]["recipePlan"]["root"]
}
fn data(result: &Value) -> &Value {
    &root(result)["data"]
}
fn valid(source: &Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":source},
        "duration":160000,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap().is_empty()
}
fn reject(source: &Value) {
    assert!(!valid(source), "invalid authoring accepted");
    assert!(
        resolve(source, 0)["error"].is_string(),
        "invalid render source accepted"
    );
}
fn n(value: &Value) -> f64 {
    value.as_f64().unwrap()
}
fn close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-9, "{actual} != {expected}");
}
fn vertices(face: &Value) -> Vec<[f64; 2]> {
    face["vertices"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| [n(&v["position"][0]), n(&v["position"][1])])
        .collect()
}
fn canonical_faces(result: &Value) -> Vec<Value> {
    let mut faces = data(result)["faces"].as_array().unwrap().clone();
    faces.sort_by(|a, b| {
        n(&a["vertices"][0]["uv"][1])
            .total_cmp(&n(&b["vertices"][0]["uv"][1]))
            .then_with(|| n(&a["vertices"][0]["uv"][0]).total_cmp(&n(&b["vertices"][0]["uv"][0])))
    });
    faces
}

#[test]
fn endpoints_preserve_the_complete_fitted_image_and_alpha_without_mesh() {
    for fit in ["contain", "cover", "stretch"] {
        let mut s = source();
        settings(&mut s)["fit"] = json!(fit);
        assert!(valid(&s));
        for frame in [0, 4, 20, 39] {
            let output = resolve(&s, frame);
            assert_eq!(root(&output)["kind"], "hexFloat");
            let plan = data(&output);
            assert_eq!(plan["fullImage"], true);
            assert_eq!(plan["image"], "image.png");
            assert_eq!(plan["rect"], json!([40.0, 36.0, 240.0, 90.0]));
            assert_eq!(plan["fit"], fit);
            assert_eq!(plan["opacity"], 0.65);
            assert_eq!(plan["faces"], json!([]));
        }
    }
}

#[test]
fn neutral_midpoint_is_a_seamless_regular_hex_tessellation_with_continuous_source_uvs() {
    let mut s = source();
    for key in ["lift", "tilt", "gap", "shading"] {
        settings(&mut s)[key] = json!(0);
    }
    let output = resolve(&s, 12);
    assert_eq!(
        data(&output)["fullImage"],
        false,
        "must exercise mesh rather than endpoint bypass"
    );
    let faces = data(&output)["faces"].as_array().unwrap();
    assert_eq!(faces.len(), 45); // r=18; five rows of nine cells, each four triangles.
    let mut shared_edges = BTreeMap::new();
    let mut outside_rect = false;
    for face in faces {
        let polygon = vertices(face);
        assert_eq!(polygon.len(), 6);
        assert_eq!(face["brightness"], 1.0);
        assert_eq!(face["opacity"], 0.65);
        assert_eq!(face["depth"], 0.0);
        let center = [
            polygon.iter().map(|p| p[0]).sum::<f64>() / 6.0,
            polygon.iter().map(|p| p[1]).sum::<f64>() / 6.0,
        ];
        let mut twice_area = 0.0;
        for i in 0..6 {
            let a = polygon[i];
            let b = polygon[(i + 1) % 6];
            close((a[0] - b[0]).hypot(a[1] - b[1]), 18.0);
            close((a[0] - center[0]).hypot(a[1] - center[1]), 18.0);
            twice_area += a[0] * b[1] - a[1] * b[0];
            let vertex = &face["vertices"][i];
            assert_eq!(vertex["w"], 1.0);
            close(n(&vertex["uv"][0]), a[0] / 320.0);
            close(n(&vertex["uv"][1]), a[1] / 180.0);
            outside_rect |= a[0] < 40.0 || a[0] > 280.0 || a[1] < 36.0 || a[1] > 126.0;
            let mut edge = [
                [a[0].to_bits(), a[1].to_bits()],
                [b[0].to_bits(), b[1].to_bits()],
            ];
            edge.sort();
            *shared_edges.entry(edge).or_insert(0_u32) += 1;
        }
        close(twice_area * 0.5, 3.0 * 3.0_f64.sqrt() * 18.0 * 18.0 * 0.5);
    }
    assert!(
        outside_rect,
        "perimeter hexagons must keep their real uncut shape"
    );
    assert!(shared_edges.values().all(|count| *count <= 2));
    assert!(
        shared_edges.values().filter(|count| **count == 2).count() > 80,
        "adjacent edges must have bit-identical positions and UVs"
    );
    // Non-boundary samples cover the authored rectangle exactly once, including its edges.
    for iy in 0..19 {
        for ix in 0..47 {
            let point = [
                40.0 + (ix as f64 + 0.137) * 240.0 / 47.0,
                36.0 + (iy as f64 + 0.319) * 90.0 / 19.0,
            ];
            let coverage = faces
                .iter()
                .filter(|face| {
                    let p = vertices(face);
                    (0..6).all(|i| {
                        let a = p[i];
                        let b = p[(i + 1) % 6];
                        (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])
                            >= -1e-9
                    })
                })
                .count();
            assert_eq!(
                coverage, 1,
                "hole or overlapping source tessellation at {point:?}"
            );
        }
    }
}

#[test]
fn motion_is_seeded_per_hex_sorted_far_to_near_and_keeps_texture_coordinates() {
    let mut s = source();
    let middle = resolve(&s, 12);
    let faces = data(&middle)["faces"].as_array().unwrap();
    assert!(
        faces
            .windows(2)
            .all(|pair| n(&pair[0]["depth"]) <= n(&pair[1]["depth"]))
    );
    assert!(
        faces
            .windows(2)
            .any(|pair| pair[0]["brightness"] != pair[1]["brightness"])
    );
    assert!(faces.iter().all(|face| face["opacity"] == 0.65));
    s["seed"] = json!(97);
    let other = resolve(&s, 12);
    let before = canonical_faces(&middle);
    let after = canonical_faces(&other);
    assert_eq!(before.len(), after.len());
    for (a, b) in before.iter().zip(after.iter()) {
        assert_ne!(a["depth"], b["depth"]);
        for (va, vb) in a["vertices"]
            .as_array()
            .unwrap()
            .iter()
            .zip(b["vertices"].as_array().unwrap())
        {
            assert_eq!(va["uv"], vb["uv"]);
            assert_ne!(va["position"], vb["position"]);
        }
    }
    assert_eq!(data(&resolve(&source(), 4)), data(&resolve(&s, 4)));
    assert_eq!(data(&resolve(&source(), 20)), data(&resolve(&s, 20)));
    for (key, value) in [
        ("size", 0.3),
        ("lift", 0.0),
        ("tilt", 0.0),
        ("gap", 0.0),
        ("cycles", 0.0),
        ("perspective", 0.0),
        ("shading", 0.0),
    ] {
        let mut changed = source();
        settings(&mut changed)[key] = json!(value);
        assert_ne!(
            data(&middle),
            data(&resolve(&changed, 12)),
            "{key} must affect the plan"
        );
    }
}

#[test]
fn rational_fps_trim_easing_and_reverse_seek_use_the_same_explicit_source_frame() {
    let original = source();
    let middle = resolve(&original, 12);
    for frame in [39, 7, 0, 20, 5] {
        let _ = resolve(&original, frame);
    }
    assert_eq!(middle, resolve(&original, 12));
    for (numerator, denominator) in [(30, 1), (24000, 1001), (30000, 1001)] {
        let mut s = source();
        s["frameRate"] = json!({"numerator":numerator,"denominator":denominator});
        s["recipe"]["songStartSeconds"] = json!(71.25);
        assert_eq!(root(&middle), root(&resolve(&s, 12)));
        assert_eq!(root(&middle), root(&resolve_trimmed(&s, 8, 4)));
        s["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse","scene":{
            "kind":"ref","input":"g","timeMap":[{"atFrame":0,"sourceFrame":20},{"atFrame":16,"sourceFrame":4}]}}));
        s["recipe"]["root"] = json!("reverse");
        assert!(valid(&s));
        for frame in 0..=16 {
            assert_eq!(
                &root(&resolve(&s, frame))["input"],
                root(&resolve(&original, 20 - frame))
            );
        }
    }
    let mut eased = source();
    eased["recipe"]["nodes"][0]["scene"]["easing"] = json!("inQuad");
    assert_eq!(data(&resolve(&eased, 12)), data(&resolve(&original, 8)));
}

#[test]
fn alpha_zero_stays_empty_and_extreme_valid_geometry_has_positive_finite_projection() {
    let mut transparent = source();
    settings(&mut transparent)["opacity"] = json!(0);
    for frame in [0, 4, 7, 12, 20, 39] {
        let output = resolve(&transparent, frame);
        assert_eq!(data(&output)["opacity"], 0.0);
        assert_eq!(data(&output)["faces"], json!([]));
    }
    for (width, height, rect, size) in [
        (1, 1, [-1.0, -1.0, 0.01, 0.01], 0.5),
        (320, 180, [1.0, 1.0, 2.0, 2.0], 0.5),
        (368, 320, [0.0, 0.0, 1.0, 1.0], 0.0215),
    ] {
        let mut s = source();
        s["width"] = json!(width);
        s["height"] = json!(height);
        settings(&mut s)["rect"] = json!(rect);
        settings(&mut s)["size"] = json!(size);
        for (key, value) in [
            ("lift", 1.0),
            ("tilt", 1.2),
            ("gap", 0.0),
            ("cycles", 8.0),
            ("perspective", 0.8),
            ("shading", 1.0),
        ] {
            settings(&mut s)[key] = json!(value);
        }
        assert!(valid(&s));
        for frame in [5, 8, 12, 17, 19] {
            let output = resolve(&s, frame);
            for face in data(&output)["faces"].as_array().unwrap() {
                assert!((0.25..=1.0).contains(&n(&face["brightness"])));
                assert!(n(&face["depth"]).is_finite());
                for vertex in face["vertices"].as_array().unwrap() {
                    assert!((0.7 - 1e-12..=1.1 + 1e-12).contains(&n(&vertex["w"])));
                    for key in ["position", "uv"] {
                        for coordinate in vertex[key].as_array().unwrap() {
                            assert!(n(coordinate).is_finite());
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn dimension_aware_triangle_budget_is_exact_and_repeated_dag_inputs_are_charged() {
    let mut s = source();
    s["width"] = json!(368);
    s["height"] = json!(320);
    settings(&mut s)["rect"] = json!([0, 0, 1, 1]);
    settings(&mut s)["size"] = json!(0.0215);
    assert!(valid(&s));
    assert_eq!(
        data(&resolve(&s, 12))["faces"].as_array().unwrap().len() * 4,
        4096
    );
    settings(&mut s)["size"] = json!(0.0214);
    reject(&s);
    settings(&mut s)["size"] = json!(0.0215);
    s["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"twice","scene":{
        "kind":"transition","from":"g","to":"g","span":{"startFrame":0,"durationFrames":24},
        "easing":"linear","style":{"kind":"xfade"}}}));
    s["recipe"]["root"] = json!("twice");
    reject(&s);
    assert!(resolve(&s, 0)["error"].as_str().unwrap().contains("4096"));
    for (width, height, rect) in [
        (4096, 1, [0.0, 0.0, 1.0, 1.0]),
        (1, 4096, [0.0, 0.0, 1.0, 1.0]),
        (320, 180, [0.0, 0.0, 2.0, 0.01]),
        (320, 180, [0.0, 0.0, 0.01, 2.0]),
    ] {
        let mut s = source();
        s["width"] = json!(width);
        s["height"] = json!(height);
        settings(&mut s)["rect"] = json!(rect);
        settings(&mut s)["size"] = json!(0.02);
        reject(&s); // Must fail before per-cell vector construction, even at progress zero.
    }
}

#[test]
fn retained_right_branch_surfaces_are_counted_in_nested_mesh_transitions() {
    let mut s = source();
    s["width"] = json!(1920);
    s["height"] = json!(1920);
    s["recipe"]["nodes"].as_array_mut().unwrap().push(json!({
        "id":"solid","scene":{"kind":"solid","role":"subject","color":[0.1,0.2,0.3,1]}
    }));
    let mut input = "g".to_string();
    for index in 0..7 {
        let id = format!("nested_{index}");
        s["recipe"]["nodes"].as_array_mut().unwrap().push(json!({
            "id":id,"scene":{"kind":"transition","from":"solid","to":input,
                "span":{"startFrame":0,"durationFrames":24},"easing":"linear","style":{"kind":"xfade"}}
        }));
        input = id;
    }
    s["recipe"]["root"] = json!(input);
    reject(&s);
    assert!(
        resolve(&s, 12)["error"]
            .as_str()
            .unwrap()
            .contains("raster surface budget")
    );
    s["width"] = json!(1280);
    s["height"] = json!(720);
    assert!(
        valid(&s),
        "bounded depth-eight composition must remain available"
    );
    assert!(!resolve(&s, 12)["frame"].is_null());
}

#[test]
fn resources_required_fields_roles_and_out_of_range_parameters_reject_at_both_boundaries() {
    for (key, value) in [
        ("image", json!("missing.png")),
        ("image", json!("font.ttf")),
        ("size", json!(0.0199)),
        ("size", json!(0.5001)),
        ("lift", json!(-0.001)),
        ("lift", json!(1.001)),
        ("tilt", json!(-0.001)),
        ("tilt", json!(1.201)),
        ("gap", json!(-0.001)),
        ("gap", json!(0.751)),
        ("cycles", json!(-0.001)),
        ("cycles", json!(8.001)),
        ("perspective", json!(-0.001)),
        ("perspective", json!(0.801)),
        ("shading", json!(-0.001)),
        ("shading", json!(1.001)),
        ("opacity", json!(-0.001)),
        ("opacity", json!(1.001)),
        ("rect", json!([0, 0, 0, 1])),
        ("rect", json!([0, 0, 1, 2.001])),
        ("rect", json!([-1.001, 0, 1, 1])),
        ("rect", json!([0, 0, 1])),
        ("fit", json!("invalid")),
        ("size", Value::Null),
        ("seed", json!(0)),
    ] {
        let mut s = source();
        settings(&mut s)[key] = value;
        reject(&s);
    }
    for key in settings(&mut source()).as_object().unwrap().keys() {
        let mut s = source();
        settings(&mut s).as_object_mut().unwrap().remove(key);
        reject(&s);
    }
    let mut s = source();
    s["resources"] = json!([]);
    reject(&s);
    for (key, value) in [
        ("role", json!("invalid")),
        ("easing", json!("invalid")),
        ("span", json!({"startFrame":4,"durationFrames":0})),
        ("span", json!({"startFrame":39,"durationFrames":2})),
        ("unknown", json!(0)),
    ] {
        let mut s = source();
        s["recipe"]["nodes"][0]["scene"][key] = value;
        reject(&s);
    }
    for role in ["background", "subject", "graphics", "foreground"] {
        let mut s = source();
        s["recipe"]["nodes"][0]["scene"]["role"] = json!(role);
        s["recipe"]["outputRoles"] = json!([role]);
        assert!(valid(&s));
        assert_eq!(root(&resolve(&s, 12))["role"], role);
    }
}

#[test]
fn catalog_matches_hex_geometry_projection_resource_and_triangle_contract() {
    let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    let entry = &catalog["generators"]["hexFloat"];
    assert_eq!(entry["parameters"]["image"]["kind"], "image");
    assert_eq!(entry["parameters"]["size"]["min"], 0.02);
    assert_eq!(entry["parameters"]["size"]["max"], 0.5);
    assert_eq!(entry["parameters"]["tilt"]["unit"], "radians");
    assert_eq!(entry["layout"]["polygon"], "regular pointy-top hexagon");
    assert!(
        entry["constraints"][0]
            .as_str()
            .unwrap()
            .contains("4 triangles per hex")
    );
    assert!(
        entry["constraints"][1]
            .as_str()
            .unwrap()
            .contains("four extra surfaces")
    );
    for key in settings(&mut source()).as_object().unwrap().keys() {
        assert!(!entry["parameters"][key].is_null(), "missing {key}");
    }
}
