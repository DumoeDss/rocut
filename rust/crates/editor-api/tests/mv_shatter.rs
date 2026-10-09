use editor_api::{
    mv_recipe_catalog_json, resolve_programmatic_frame_json, validate_clip_editing_json,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn source() -> Value {
    let hash = "a".repeat(64);
    json!({"version":1,"runtime":"canvas-worker","code":"","width":320,"height":180,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":30,"seed":27,
        "resources":[{"id":"image.png","kind":"image","mimeType":"image/png","byteLength":1,
            "sha256":hash,"attachmentKey":format!("programmatic-sha256-{hash}")}],
        "recipe":{"version":1,"root":"s","songStartSeconds":0,"outputRoles":["subject"],
        "nodes":[{"id":"s","scene":{"kind":"shatter","role":"subject",
            "span":{"startFrame":4,"durationFrames":12},"easing":"linear",
            "settings":{"image":"image.png","rect":[0.1,0.2,0.75,0.6],"fit":"contain",
                "fragments":31,"center":[0.35,0.65],"spread":0.75,"spin":2.4,"gravity":0.4,
                "depth":0.35,"perspective":0.7,"refraction":0.025,"shading":0.45,
                "shadow":0,"opacity":0.75}}}]}})
}
fn settings(source: &mut Value) -> &mut Value {
    &mut source["recipe"]["nodes"][0]["scene"]["settings"]
}
fn resolve(source: &Value, frame: u64) -> Value {
    let step = 120000 * source["frameRate"]["denominator"].as_u64().unwrap()
        / source["frameRate"]["numerator"].as_u64().unwrap();
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":source,
        "clipStart":12000,"clipDuration":30*step,"trimStart":0,"timelineTime":12000+frame*step})
        .to_string(),
    ))
    .unwrap()
}
fn root(value: &Value) -> &Value {
    &value["frame"]["recipePlan"]["root"]
}
fn data(value: &Value) -> &Value {
    &root(value)["data"]
}
fn faces(value: &Value) -> &[Value] {
    data(value)["faces"].as_array().unwrap()
}
fn num(value: &Value) -> f64 {
    value.as_f64().unwrap()
}
fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-7, "{actual} != {expected}");
}
fn valid(source: &Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":source},
        "duration":120000,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap().is_empty()
}
fn reject(source: &Value) {
    assert!(!valid(source));
    assert!(resolve(source, 0)["error"].is_string());
}
fn neutral(source: &mut Value) {
    for key in [
        "spread",
        "spin",
        "gravity",
        "depth",
        "refraction",
        "shading",
        "shadow",
    ] {
        settings(source)[key] = json!(0);
    }
}
fn polygons(value: &Value) -> Vec<Vec<[f64; 2]>> {
    faces(value)
        .iter()
        .map(|face| {
            face["vertices"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| [num(&v["position"][0]), num(&v["position"][1])])
                .collect()
        })
        .collect()
}
fn cross(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}
fn topology(polygons: &[Vec<[f64; 2]>]) {
    let mut area = 0.0;
    let mut edges = BTreeMap::new();
    let bits = |p: [f64; 2]| (p[0].to_bits(), p[1].to_bits());
    for polygon in polygons {
        assert!(polygon.len() >= 3);
        for i in 0..polygon.len() {
            let a = polygon[i];
            let b = polygon[(i + 1) % polygon.len()];
            assert_ne!(a, b);
            assert!(cross(a, b, polygon[(i + 2) % polygon.len()]) >= -1e-8);
            area += (a[0] * b[1] - b[0] * a[1]) * 0.5;
            let (a, b) = (bits(a), bits(b));
            let key = if a < b { (a, b) } else { (b, a) };
            edges.entry(key).or_insert_with(Vec::new).push(a < b);
        }
    }
    near(area, 240.0 * 108.0);
    for ((a, b), directions) in edges {
        let (a, b) = (
            [f64::from_bits(a.0), f64::from_bits(a.1)],
            [f64::from_bits(b.0), f64::from_bits(b.1)],
        );
        let boundary = [(0, 32.0), (0, 272.0), (1, 36.0), (1, 144.0)]
            .iter()
            .any(|&(axis, edge)| (a[axis] - edge).abs() < 1e-9 && (b[axis] - edge).abs() < 1e-9);
        if boundary {
            assert_eq!(directions.len(), 1);
        } else {
            assert_eq!(directions.len(), 2, "unshared edge {a:?} -> {b:?}");
            assert_ne!(directions[0], directions[1]);
        }
    }
    for y in 0..13 {
        for x in 0..19 {
            let point = [
                32.0 + (x as f64 + 0.317) * 240.0 / 19.0,
                36.0 + (y as f64 + 0.691) * 108.0 / 13.0,
            ];
            let covered = polygons
                .iter()
                .filter(|p| (0..p.len()).all(|i| cross(p[i], p[(i + 1) % p.len()], point) >= 0.0))
                .count();
            assert_eq!(covered, 1, "single coverage at {point:?}");
        }
    }
}

#[test]
fn fitted_initial_image_and_persistent_scattered_end_are_distinct() {
    for fit in ["contain", "cover", "stretch"] {
        let mut source = source();
        settings(&mut source)["fit"] = json!(fit);
        assert!(valid(&source));
        for frame in [0, 4] {
            let result = resolve(&source, frame);
            assert_eq!(data(&result)["fullImage"], true);
            assert_eq!(faces(&result).len(), 0);
            assert_eq!(data(&result)["rect"], json!([32.0, 36.0, 240.0, 108.0]));
            assert_eq!(data(&result)["fit"], fit);
            near(num(&data(&result)["opacity"]), 0.75);
        }
        let final_frame = resolve(&source, 16);
        assert_eq!(data(&final_frame)["fullImage"], false);
        assert_eq!(faces(&final_frame).len(), 31);
        assert_eq!(data(&final_frame), data(&resolve(&source, 29)));
        assert_ne!(data(&final_frame), data(&resolve(&source, 10)));
    }
}

#[test]
fn voronoi_partition_is_convex_nonrectangular_shared_and_single_coverage() {
    for fragments in [4, 31, 128, 512] {
        for seed in [0, u32::MAX] {
            let mut source = source();
            neutral(&mut source);
            settings(&mut source)["fragments"] = json!(fragments);
            source["seed"] = json!(seed);
            let result = resolve(&source, 10);
            assert_eq!(data(&result)["fullImage"], false);
            let polygons = polygons(&result);
            assert_eq!(polygons.len(), fragments);
            topology(&polygons);
            assert!(polygons.iter().map(|p| p.len() - 2).sum::<usize>() <= 4 * fragments - 2);
            if fragments > 4 {
                assert!(polygons.iter().any(|p| p.len() >= 5));
            }
            for face in faces(&result) {
                near(num(&face["opacity"]), 0.75);
                near(num(&face["brightness"]), 1.0);
                assert!(face["colorOffset"].is_null());
                for v in face["vertices"].as_array().unwrap() {
                    near(num(&v["w"]), 1.0);
                    near(num(&v["uv"][0]), num(&v["position"][0]) / 320.0);
                    near(num(&v["uv"][1]), num(&v["position"][1]) / 180.0);
                }
            }
        }
    }
}

#[test]
fn perspective_plan_preserves_rigid_edges_and_normal_driven_shading_refraction() {
    let result = resolve(&source(), 10);
    for face in faces(&result) {
        let vertices = face["vertices"].as_array().unwrap();
        let points: Vec<_> = vertices
            .iter()
            .map(|v| {
                let w = num(&v["w"]);
                [
                    152.0 + (num(&v["position"][0]) - 152.0) * w,
                    90.0 + (num(&v["position"][1]) - 90.0) * w,
                    (1.0 - w) * 960.0 / 0.7,
                ]
            })
            .collect();
        for i in 0..vertices.len() {
            let j = (i + 1) % vertices.len();
            let distance = (0..3)
                .map(|a| (points[i][a] - points[j][a]).powi(2))
                .sum::<f64>()
                .sqrt();
            let dx = (num(&vertices[i]["uv"][0]) - num(&vertices[j]["uv"][0])) * 320.0;
            let dy = (num(&vertices[i]["uv"][1]) - num(&vertices[j]["uv"][1])) * 180.0;
            near(distance, dx.hypot(dy));
        }
        let a: [f64; 3] = std::array::from_fn(|i| points[1][i] - points[0][i]);
        let b: [f64; 3] = std::array::from_fn(|i| points[2][i] - points[0][i]);
        let normal = [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ];
        let length = normal.iter().map(|n| n * n).sum::<f64>().sqrt();
        near(
            num(&face["brightness"]),
            1.0 - 0.45 * (1.0 - (normal[2] / length).abs()),
        );
        near(
            num(&face["colorOffset"][0]),
            normal[0] / length * 0.025 * 108.0 * 0.5 / 320.0,
        );
        near(
            num(&face["colorOffset"][1]),
            normal[1] / length * 0.025 * 108.0 * 0.5 / 180.0,
        );
    }
}

#[test]
fn black_source_alpha_shadows_precede_colors_without_changing_color_uv_or_opacity() {
    let mut source = source();
    let baseline = resolve(&source, 10);
    settings(&mut source)["shadow"] = json!(0.65);
    let result = resolve(&source, 10);
    let output = faces(&result);
    assert_eq!(output.len(), 62);
    assert_eq!(&output[31..], faces(&baseline));
    for shadow in &output[..31] {
        near(num(&shadow["brightness"]), 0.0);
        near(num(&shadow["opacity"]), 0.65 * 0.75 * 0.5);
        near(num(&shadow["depth"]), 0.0);
        assert!(shadow["colorOffset"].is_null());
        let uvs = |f: &Value| {
            f["vertices"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v["uv"].clone())
                .collect::<Vec<_>>()
        };
        let color = output[31..]
            .iter()
            .find(|face| uvs(face) == uvs(shadow))
            .unwrap();
        assert_ne!(shadow["vertices"], color["vertices"]);
        assert!(
            shadow["vertices"]
                .as_array()
                .unwrap()
                .iter()
                .all(|v| v["w"] == 1.0)
        );
    }
    settings(&mut source)["opacity"] = json!(0);
    assert!(valid(&source));
    assert!(faces(&resolve(&source, 10)).is_empty());
}

#[test]
fn independent_controls_affect_only_their_declared_mesh_channels() {
    let base = source();
    let original = resolve(&base, 10);
    for (key, value) in [
        ("center", json!([0.8, 0.2])),
        ("spread", json!(0)),
        ("spin", json!(0)),
        ("gravity", json!(0)),
        ("depth", json!(0)),
        ("perspective", json!(0)),
        ("refraction", json!(0)),
        ("shading", json!(0)),
    ] {
        let mut source = base.clone();
        settings(&mut source)[key] = value;
        let changed = resolve(&source, 10);
        assert_ne!(faces(&changed), faces(&original), "{key}");
        if key == "refraction" || key == "shading" {
            for (a, b) in faces(&changed).iter().zip(faces(&original)) {
                assert_eq!(a["vertices"], b["vertices"]);
                assert_eq!(a["opacity"], b["opacity"]);
                if key == "refraction" {
                    assert!(a["colorOffset"].is_null());
                    assert_eq!(a["brightness"], b["brightness"]);
                } else {
                    near(num(&a["brightness"]), 1.0);
                    assert_eq!(a["colorOffset"], b["colorOffset"]);
                }
            }
        }
    }
    let mut changed_seed = base.clone();
    changed_seed["seed"] = json!(28);
    assert_ne!(faces(&original), faces(&resolve(&changed_seed, 10)));
}

#[test]
fn analytic_motion_has_no_seek_state_and_reverse_ref_exactly_assembles() {
    let reference = source();
    let expected = resolve(&reference, 10);
    let _ = resolve(&reference, 29);
    assert_eq!(expected, resolve(&reference, 10));
    let output = faces(&expected);
    assert!(
        output
            .windows(2)
            .all(|p| num(&p[0]["depth"]) <= num(&p[1]["depth"]))
    );
    for (numerator, denominator) in [(30, 1), (30000, 1001)] {
        let mut source = reference.clone();
        source["frameRate"] = json!({"numerator":numerator,"denominator":denominator});
        assert_eq!(data(&resolve(&source, 10)), data(&expected));
        source["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse","scene":{
            "kind":"ref","input":"s","timeMap":[{"atFrame":0,"sourceFrame":16},{"atFrame":12,"sourceFrame":4}]}}));
        source["recipe"]["root"] = json!("reverse");
        for frame in [0, 3, 6, 9, 12] {
            assert_eq!(
                root(&resolve(&source, frame))["input"],
                *root(&resolve(&reference, 16 - frame))
            );
        }
    }
    let mut eased = reference.clone();
    eased["recipe"]["nodes"][0]["scene"]["easing"] = json!("inQuad");
    assert_eq!(data(&resolve(&eased, 10)), data(&resolve(&reference, 7)));
}

#[test]
fn extreme_controls_have_proven_positive_w_and_bounded_fan_work() {
    for (width, height, rect) in [
        (320, 180, [0.0, 0.0, 1.0, 1.0]),
        (4096, 1, [-1.0, 1.0, 2.0, 0.01]),
        (1, 4096, [1.0, -1.0, 0.01, 2.0]),
    ] {
        let mut source = source();
        source["width"] = json!(width);
        source["height"] = json!(height);
        settings(&mut source)["rect"] = json!(rect);
        settings(&mut source)["fragments"] = json!(512);
        for (key, value) in [
            ("spread", 2.0),
            ("spin", std::f64::consts::TAU),
            ("gravity", 2.0),
            ("depth", 1.0),
            ("perspective", 0.8),
            ("refraction", 0.08),
            ("shading", 1.0),
            ("shadow", 1.0),
        ] {
            settings(&mut source)[key] = json!(value);
        }
        assert!(valid(&source));
        for frame in [7, 10, 16] {
            let result = resolve(&source, frame);
            let triangles = faces(&result)
                .iter()
                .map(|f| f["vertices"].as_array().unwrap().len() - 2)
                .sum::<usize>();
            assert!(triangles <= 4096);
            for face in faces(&result) {
                assert!((0.0..=1.0).contains(&num(&face["brightness"])));
                for v in face["vertices"].as_array().unwrap() {
                    assert!(num(&v["w"]) > 0.517);
                    assert!(
                        v["position"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .all(|n| num(n).is_finite())
                    );
                }
            }
        }
    }
}

#[test]
fn required_fields_resources_schema_and_numeric_ranges_are_enforced() {
    for (key, value) in [
        ("image", json!("missing.png")),
        ("fragments", json!(3)),
        ("fragments", json!(513)),
        ("fragments", json!(4.5)),
        ("center", json!([-0.01, 0.5])),
        ("center", json!([0.5, 1.01])),
        ("center", json!([0.5])),
        ("spread", json!(-0.01)),
        ("spread", json!(2.01)),
        ("spin", json!(-0.01)),
        ("spin", json!(std::f64::consts::TAU + 0.01)),
        ("gravity", json!(-0.01)),
        ("gravity", json!(2.01)),
        ("depth", json!(-0.01)),
        ("depth", json!(1.01)),
        ("perspective", json!(-0.01)),
        ("perspective", json!(0.801)),
        ("refraction", json!(-0.001)),
        ("refraction", json!(0.081)),
        ("shading", json!(-0.01)),
        ("shading", json!(1.01)),
        ("shadow", json!(-0.01)),
        ("shadow", json!(1.01)),
        ("opacity", json!(-0.01)),
        ("opacity", json!(1.01)),
        ("rect", json!([0, 0, 0, 1])),
        ("fit", json!("invalid")),
        ("unknown", json!(0)),
    ] {
        let mut source = source();
        settings(&mut source)[key] = value;
        reject(&source);
    }
    let keys: Vec<_> = settings(&mut source())
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    for key in keys {
        let mut source = source();
        settings(&mut source).as_object_mut().unwrap().remove(&key);
        reject(&source);
    }
    for (key, value) in [
        ("role", json!("invalid")),
        ("easing", json!("invalid")),
        ("span", json!({"startFrame":29,"durationFrames":2})),
        ("unknown", json!(0)),
    ] {
        let mut source = source();
        source["recipe"]["nodes"][0]["scene"][key] = value;
        reject(&source);
    }
    let mut source = source();
    source["resources"][0]["kind"] = json!("font");
    reject(&source);
}

#[test]
fn conservative_dual_layer_budget_charges_every_expanded_occurrence() {
    let mut source = source();
    settings(&mut source)["fragments"] = json!(512);
    assert!(valid(&source));
    settings(&mut source)["fragments"] = json!(256);
    source["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"twice","scene":{
        "kind":"transition","from":"s","to":"s","span":{"startFrame":0,"durationFrames":20},"easing":"linear","style":{"kind":"xfade"}}}));
    source["recipe"]["root"] = json!("twice");
    assert!(valid(&source));
    settings(&mut source)["fragments"] = json!(257);
    reject(&source);
    assert!(
        resolve(&source, 0)["error"]
            .as_str()
            .unwrap()
            .contains("4096")
    );
}

#[test]
fn catalog_exposes_scene_controls_separately_from_transition_shatter() {
    let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    let entry = &catalog["generators"]["shatter"];
    for key in settings(&mut source()).as_object().unwrap().keys() {
        assert!(!entry["parameters"][key].is_null());
    }
    assert_eq!(entry["parameters"]["spin"]["unit"], "radians");
    near(num(&entry["parameters"]["refraction"]["max"]), 0.08);
    assert_eq!(entry["parameters"]["fragments"]["max"], 512);
    assert!(
        entry["constraints"][0]
            .as_str()
            .unwrap()
            .contains("8 * fragments")
    );
    assert!(
        entry["endpoints"]
            .as_str()
            .unwrap()
            .contains("never an automatic return")
    );
    let single = source();
    let mut mixed = single.clone();
    mixed["recipe"]["nodes"].as_array_mut().unwrap().extend([
        json!({"id":"b","scene":{"kind":"solid","role":"subject","color":[0,0,1,0.25]}}),
        json!({"id":"mix","scene":{"kind":"transition","from":"s","to":"b",
            "span":{"startFrame":4,"durationFrames":12},"easing":"linear",
            "style":{"kind":"shatter","seed":11,"center":[0.5,0.5],"columns":3,"rows":2}}}),
    ]);
    mixed["recipe"]["root"] = json!("mix");
    assert!(valid(&mixed));
    assert_eq!(root(&resolve(&mixed, 4)), root(&resolve(&single, 4)));
    assert_eq!(root(&resolve(&mixed, 16))["kind"], "solid");
    assert_eq!(
        root(&resolve(&mixed, 16))["color"],
        json!([0.0, 0.0, 1.0, 0.25])
    );
    let result = resolve(&mixed, 10);
    let transition = root(&result);
    assert_eq!(transition["kind"], "transition");
    assert_eq!(transition["style"]["kind"], "shatter");
    assert_eq!(transition["from"], *root(&resolve(&single, 10)));
    assert_eq!(transition["from"]["kind"], "shatter");
    let commands = transition["commands"].as_array().unwrap();
    assert_eq!(commands[0]["kind"], "image");
    assert_eq!(commands[0]["input"], "to");
    assert!(commands.iter().skip(1).any(|command| {
        command["kind"] == "image"
            && command["input"] == "from"
            && command["clip"]["kind"] == "polygons"
            && command["clip"]["points"][0]
                .as_array()
                .is_some_and(|points| points.len() == 3)
    }));
    let _ = resolve(&mixed, 29);
    assert_eq!(result, resolve(&mixed, 10));
}
