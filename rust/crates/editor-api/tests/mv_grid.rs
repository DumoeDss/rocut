use editor_api::{
    mv_recipe_catalog_json, resolve_programmatic_frame_json, validate_clip_editing_json,
};
use serde_json::{Value, json};

fn source() -> Value {
    let hash = "a".repeat(64);
    json!({"version":1,"runtime":"canvas-worker","code":"","width":320,"height":180,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":30,"seed":27,
        "resources":[
            {"id":"image.png","kind":"image","mimeType":"image/png","byteLength":1,"sha256":hash,
                "attachmentKey":format!("programmatic-sha256-{hash}")},
            {"id":"font.ttf","kind":"font","mimeType":"font/ttf","byteLength":1,"sha256":hash,
                "attachmentKey":format!("programmatic-sha256-{hash}"),
                "font":{"family":"GridFixture","weight":500,"style":"normal"}}
        ],"recipe":{"version":1,"root":"g","songStartSeconds":0,"outputRoles":["subject"],
            "nodes":[{"id":"g","scene":{"kind":"grid","role":"subject",
                "span":{"startFrame":4,"durationFrames":12},"easing":"linear",
                "settings":{"image":"image.png","rect":[0.1,0.2,0.75,0.6],"fit":"contain",
                    "columns":3,"rows":2,"center":[0.35,0.65],"wavelength":0.7,"cycles":1.25,
                    "lift":0.22,"tilt":30,"gap":0.15,"perspective":0.7,"shading":0.6,"opacity":0.75}}}]}})
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

fn root(result: &Value) -> &Value {
    &result["frame"]["recipePlan"]["root"]
}
fn data(result: &Value) -> &Value {
    &root(result)["data"]
}
fn close(actual: &Value, expected: f64) {
    let actual = actual.as_f64().unwrap();
    assert!((actual - expected).abs() < 1e-8, "{actual} != {expected}");
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

#[test]
fn exact_full_image_endpoints_preserve_nonzero_rect_fit_and_alpha() {
    for fit in ["contain", "cover", "stretch"] {
        let mut source = source();
        settings(&mut source)["fit"] = json!(fit);
        assert!(valid(&source));
        for frame in [0, 4, 16, 29] {
            let result = resolve(&source, frame);
            let data = data(&result);
            assert_eq!(data["fullImage"], true);
            assert_eq!(data["faces"], json!([]));
            assert_eq!(data["rect"], json!([32.0, 36.0, 240.0, 108.0]));
            assert_eq!(data["fit"], fit);
            assert_eq!(data["image"], "image.png");
            close(&data["opacity"], 0.75);
        }
        let result = resolve(&source, 10);
        assert_eq!(data(&result)["fullImage"], false);
        assert_eq!(data(&result)["faces"].as_array().unwrap().len(), 6);
        for face in data(&result)["faces"].as_array().unwrap() {
            close(&face["opacity"], 0.75);
        }
    }
}

#[test]
fn zero_deformation_reconstructs_the_source_with_ordered_quads_and_full_frame_uvs() {
    let mut source = source();
    for key in ["lift", "tilt", "gap"] {
        settings(&mut source)[key] = json!(0);
    }
    settings(&mut source)["perspective"] = json!(1);
    settings(&mut source)["shading"] = json!(1);
    let result = resolve(&source, 10);
    for (index, face) in data(&result)["faces"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        close(&face["depth"], 0.0);
        close(&face["brightness"], 1.0);
        let (column, row) = (index % 3, index / 3);
        let vertices = face["vertices"].as_array().unwrap();
        assert_eq!(vertices.len(), 4);
        for (vertex, corner) in
            vertices
                .iter()
                .zip([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])
        {
            let x = 32.0 + (column as f64 + corner[0]) * 80.0;
            let y = 36.0 + (row as f64 + corner[1]) * 54.0;
            close(&vertex["position"][0], x);
            close(&vertex["position"][1], y);
            close(&vertex["uv"][0], x / 320.0);
            close(&vertex["uv"][1], y / 180.0);
            close(&vertex["w"], 1.0);
        }
    }
}

#[test]
fn projected_tile_matches_independent_y_then_x_matrix_oracle() {
    // Fixed seed 27 has phase fraction 0.9763794906903058. The constants below
    // use independent 3x3 matrix multiplication for cell (1,0), not plan output.
    let result = resolve(&source(), 10);
    let face = data(&result)["faces"]
        .as_array()
        .unwrap()
        .iter()
        .find(|face| {
            (face["vertices"][0]["uv"][0].as_f64().unwrap() - 0.35).abs() < 1e-10
                && (face["vertices"][0]["uv"][1].as_f64().unwrap() - 0.2).abs() < 1e-10
        })
        .unwrap();
    close(&face["depth"], 13.381363451133579);
    close(&face["brightness"], 0.94554291403762);
    let expected = [
        [
            118.70940798222213,
            37.34465700097711,
            0.35,
            0.2,
            0.9823815983682906,
        ],
        [
            186.18252733028763,
            42.27567763626647,
            0.6,
            0.2,
            0.9567480099130548,
        ],
        [
            185.4195978057077,
            87.677923014319,
            0.6,
            0.5,
            0.9785894248992365,
        ],
        [
            119.43346391972462,
            81.69522163588871,
            0.35,
            0.5,
            1.0042230133544723,
        ],
    ];
    for (vertex, expected) in face["vertices"].as_array().unwrap().iter().zip(expected) {
        for axis in 0..2 {
            close(&vertex["position"][axis], expected[axis]);
            close(&vertex["uv"][axis], expected[axis + 2]);
        }
        close(&vertex["w"], expected[4]);
    }
}

#[test]
fn gap_shrinks_geometry_without_cropping_uvs_and_opacity_is_not_premultiplied_twice() {
    let mut source = source();
    for key in ["lift", "tilt"] {
        settings(&mut source)[key] = json!(0);
    }
    settings(&mut source)["gap"] = json!(0.6);
    let result = resolve(&source, 10);
    let face = &data(&result)["faces"][0];
    close(&face["vertices"][0]["position"][0], 56.0);
    close(&face["vertices"][1]["position"][0], 88.0);
    close(&face["vertices"][0]["uv"][0], 0.1);
    close(&face["vertices"][1]["uv"][0], 0.35);
    close(&face["opacity"], 0.75);
    settings(&mut source)["opacity"] = json!(0);
    assert!(valid(&source));
    assert_eq!(data(&resolve(&source, 10))["faces"], json!([]));
}

#[test]
fn wave_geometry_has_seeded_time_dependence_and_stable_far_to_near_order() {
    let mut source = source();
    let middle = resolve(&source, 10);
    let faces = data(&middle)["faces"].as_array().unwrap();
    assert!(
        faces
            .windows(2)
            .all(|pair| pair[0]["depth"].as_f64() <= pair[1]["depth"].as_f64())
    );
    assert!(
        faces
            .windows(2)
            .any(|pair| pair[0]["depth"] != pair[1]["depth"])
    );
    assert_ne!(data(&middle), data(&resolve(&source, 7)));
    let _ = resolve(&source, 29);
    assert_eq!(middle, resolve(&source, 10));
    source["seed"] = json!(28);
    let other = resolve(&source, 10);
    assert_ne!(data(&middle)["faces"], data(&other)["faces"]);
    let uv_set = |result: &Value| {
        let mut uvs = data(result)["faces"]
            .as_array()
            .unwrap()
            .iter()
            .map(|face| {
                face["vertices"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v["uv"].clone())
                    .collect::<Vec<_>>()
            })
            .map(|uv| serde_json::to_string(&uv).unwrap())
            .collect::<Vec<_>>();
        uvs.sort();
        uvs
    };
    assert_eq!(uv_set(&middle), uv_set(&other));
    source["seed"] = json!(27);
    source["recipe"]["nodes"][0]["scene"]["easing"] = json!("inQuad");
    assert_eq!(
        data(&resolve(&source, 10)),
        data(&resolve(&self::source(), 7))
    );
}

#[test]
fn joint_lift_tilt_perspective_extremes_keep_every_vertex_finite_with_positive_clip_w() {
    for rect in [[0.0, 0.0, 0.5625, 1.0], [-1.0, 1.0, 2.0, 0.01]] {
        for center in [[0.0, 0.0], [0.5, 0.5], [1.0, 1.0]] {
            let mut source = source();
            for key in ["lift", "perspective", "shading"] {
                settings(&mut source)[key] = json!(1);
            }
            settings(&mut source)["tilt"] = json!(60);
            settings(&mut source)["columns"] = json!(1);
            settings(&mut source)["rows"] = json!(2);
            settings(&mut source)["gap"] = json!(0);
            settings(&mut source)["wavelength"] = json!(0.05);
            settings(&mut source)["cycles"] = json!(8);
            settings(&mut source)["rect"] = json!(rect);
            settings(&mut source)["center"] = json!(center);
            assert!(valid(&source));
            for frame in 5..16 {
                let result = resolve(&source, frame);
                for face in data(&result)["faces"].as_array().unwrap() {
                    assert!(face["depth"].as_f64().unwrap().is_finite());
                    assert!((0.0..=1.0).contains(&face["brightness"].as_f64().unwrap()));
                    for vertex in face["vertices"].as_array().unwrap() {
                        assert!(vertex["w"].as_f64().unwrap() > 0.14);
                        for key in ["position", "uv"] {
                            assert!(
                                vertex[key]
                                    .as_array()
                                    .unwrap()
                                    .iter()
                                    .all(|v| v.as_f64().unwrap().is_finite())
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn rational_fps_and_reversed_ref_reproduce_identical_source_frame_meshes() {
    let reference = source();
    for (numerator, denominator) in [(30, 1), (24000, 1001), (30000, 1001)] {
        let mut source = source();
        source["frameRate"] = json!({"numerator":numerator,"denominator":denominator});
        source["recipe"]["songStartSeconds"] = json!(7.25);
        for frame in [0, 4, 7, 10, 16, 29] {
            assert_eq!(
                root(&resolve(&source, frame)),
                root(&resolve(&reference, frame))
            );
        }
        let direct = source.clone();
        source["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse","scene":{
            "kind":"ref","input":"g","timeMap":[{"atFrame":0,"sourceFrame":16},{"atFrame":12,"sourceFrame":4}]}}));
        source["recipe"]["root"] = json!("reverse");
        assert!(valid(&source));
        for frame in 0..=12 {
            assert_eq!(
                root(&resolve(&source, frame))["input"],
                *root(&resolve(&direct, 16 - frame))
            );
        }
    }
}

#[test]
fn rejects_resource_role_span_schema_and_numeric_errors_at_both_boundaries() {
    for (key, value) in [
        ("image", json!("missing.png")),
        ("image", json!("font.ttf")),
        ("columns", json!(0)),
        ("columns", json!(65)),
        ("rows", json!(2.5)),
        ("center", json!([-0.01, 0.5])),
        ("center", json!([0.5, 1.01])),
        ("center", json!([0.5])),
        ("wavelength", json!(0.049)),
        ("wavelength", json!(2.01)),
        ("cycles", json!(-0.01)),
        ("cycles", json!(8.01)),
        ("lift", json!(1.01)),
        ("tilt", json!(-0.01)),
        ("tilt", json!(60.01)),
        ("gap", json!(0.601)),
        ("perspective", json!(1.01)),
        ("shading", json!(-0.01)),
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
}

#[test]
fn two_triangles_per_tile_count_every_expanded_input_at_the_4096_boundary() {
    let mut source = source();
    settings(&mut source)["columns"] = json!(64);
    settings(&mut source)["rows"] = json!(32);
    assert!(valid(&source));
    settings(&mut source)["rows"] = json!(33);
    reject(&source);
    settings(&mut source)["columns"] = json!(32);
    settings(&mut source)["rows"] = json!(32);
    source["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"twice","scene":{
        "kind":"transition","from":"g","to":"g","span":{"startFrame":0,"durationFrames":20},"easing":"linear","style":{"kind":"xfade"}}}));
    source["recipe"]["root"] = json!("twice");
    assert!(valid(&source));
    settings(&mut source)["columns"] = json!(33);
    reject(&source);
    assert!(
        resolve(&source, 0)["error"]
            .as_str()
            .unwrap()
            .contains("4096")
    );
}

#[test]
fn catalog_matches_required_controls_units_and_resource_costs() {
    let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    let entry = &catalog["generators"]["grid"];
    for key in settings(&mut source()).as_object().unwrap().keys() {
        assert!(!entry["parameters"][key].is_null());
    }
    assert_eq!(entry["parameters"]["tilt"]["unit"], "degrees");
    close(&entry["parameters"]["tilt"]["max"], 60.0);
    assert_eq!(
        entry["parameters"]["cycles"]["unit"],
        "wave-cycles-per-span"
    );
    assert_eq!(entry["parameters"]["image"]["kind"], "image");
    assert!(
        entry["constraints"][0]
            .as_str()
            .unwrap()
            .contains("columns * rows * 2")
    );
    assert!(
        entry["constraints"][1]
            .as_str()
            .unwrap()
            .contains("four additional raster surfaces")
    );
}
