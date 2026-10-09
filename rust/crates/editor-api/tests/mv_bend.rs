use editor_api::{
    mv_recipe_catalog_json, resolve_programmatic_frame_json, validate_clip_editing_json,
};
use serde_json::{Value, json};
use std::f64::consts::{FRAC_PI_2, PI};

fn source() -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"","width":192,"height":108,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":60,"seed":7,
        "recipe":{"version":1,"root":"mix","songStartSeconds":0,"outputRoles":["foreground"],"nodes":[
            {"id":"a","scene":{"kind":"solid","role":"foreground","color":[1,0,0,0.7]}},
            {"id":"b","scene":{"kind":"solid","role":"foreground","color":[0,0,1,0.4]}},
            {"id":"mix","scene":{"kind":"transition","from":"a","to":"b",
                "span":{"startFrame":6,"durationFrames":32},"easing":"linear",
                "style":{"kind":"bend","direction":"left","hinge":0.5,
                    "angle":PI,"perspective":0.5,"shading":0.6}}}]}})
}

fn style(s: &mut Value) -> &mut Value {
    &mut s["recipe"]["nodes"][2]["scene"]["style"]
}
fn frame(s: &Value, index: u64) -> Value {
    let step = 120000 * s["frameRate"]["denominator"].as_u64().unwrap()
        / s["frameRate"]["numerator"].as_u64().unwrap();
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":s,"clipStart":12000,
        "clipDuration":60*step,"trimStart":0,"timelineTime":12000+index*step})
        .to_string(),
    ))
    .unwrap()
}
fn root(v: &Value) -> &Value {
    &v["frame"]["recipePlan"]["root"]
}
fn commands(v: &Value) -> &[Value] {
    root(v)["commands"].as_array().unwrap()
}
fn mesh(v: &Value) -> &Value {
    commands(v).iter().find(|c| c["kind"] == "mesh").unwrap()
}
fn vertices(v: &Value) -> &[Value] {
    mesh(v)["vertices"].as_array().unwrap()
}
fn number(v: &Value) -> f64 {
    v.as_f64().unwrap()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-9, "{a} != {b}");
}
fn pair(v: &Value) -> [f64; 2] {
    [number(&v[0]), number(&v[1])]
}

fn valid(s: &Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_clip_editing_json(json!({
        "editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":s},
        "duration":240000,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap().is_empty()
}
fn reject(s: &Value) {
    assert!(!valid(s));
    assert!(frame(s, 14)["error"].is_string());
}
fn directed(direction: &str, u: f64, v: f64, width: f64, height: f64) -> [f64; 2] {
    match direction {
        "left" => [u * width, v * height],
        "right" => [(1.0 - u) * width, v * height],
        "up" => [v * width, u * height],
        "down" => [v * width, (1.0 - u) * height],
        _ => unreachable!(),
    }
}
fn area(points: &[Value]) -> f64 {
    (0..points.len())
        .map(|i| {
            let a = pair(&points[i]["position"]);
            let b = pair(&points[(i + 1) % points.len()]["position"]);
            a[0] * b[1] - a[1] * b[0]
        })
        .sum()
}

#[test]
fn four_directions_keep_exact_ab_endpoints_with_original_alpha() {
    for direction in ["left", "right", "up", "down"] {
        let mut s = source();
        style(&mut s)["direction"] = json!(direction);
        assert!(valid(&s));
        for index in [0, 5, 6] {
            assert_eq!(
                root(&frame(&s, index))["color"],
                json!([1.0, 0.0, 0.0, 0.7])
            );
        }
        for index in [38, 39, 59] {
            assert_eq!(
                root(&frame(&s, index))["color"],
                json!([0.0, 0.0, 1.0, 0.4])
            );
        }
        let result = frame(&s, 14);
        assert_eq!(root(&result)["from"]["color"], json!([1.0, 0.0, 0.0, 0.7]));
        assert_eq!(root(&result)["to"]["color"], json!([0.0, 0.0, 1.0, 0.4]));
        assert_eq!(commands(&result).len(), 3);
        assert!(commands(&result).iter().all(|c| c["opacity"] == 1.0));
        assert_eq!(commands(&result)[0]["input"], "to");
        assert_eq!(commands(&result)[1]["input"], "from");
        // B is clipped to the swept side, never drawn under still-flat A.
        for (command, domain) in [(0, [0.75, 1.0]), (1, [0.0, 0.75])] {
            let polygon = &commands(&result)[command]["clip"]["points"][0];
            for (i, (u, v)) in [
                (domain[0], 0.0),
                (domain[1], 0.0),
                (domain[1], 1.0),
                (domain[0], 1.0),
            ]
            .into_iter()
            .enumerate()
            {
                let expected = directed(direction, u, v, 192.0, 108.0);
                assert_eq!(pair(&polygon[i]), expected);
            }
        }
    }
}

#[test]
fn rigid_quad_has_true_source_uvs_and_a_straight_stationary_hinge() {
    for direction in ["left", "right", "up", "down"] {
        let mut s = source();
        style(&mut s)["direction"] = json!(direction);
        let result = frame(&s, 14); // p=1/4; f=3/4; theta=pi/4.
        let points = vertices(&result);
        assert_eq!(points.len(), 4);
        for (i, (u, v)) in [(0.75, 0.0), (1.0, 0.0), (1.0, 1.0), (0.75, 1.0)]
            .into_iter()
            .enumerate()
        {
            assert_eq!(pair(&points[i]["uv"]), directed(direction, u, v, 1.0, 1.0));
            let distance = u - 0.75;
            let z = distance / std::f64::consts::SQRT_2;
            let d = 1.0 - 0.5 * z;
            let x = 0.75 + distance / std::f64::consts::SQRT_2;
            let expected = directed(
                direction,
                0.5 + (x - 0.5) / d,
                0.5 + (v - 0.5) / d,
                192.0,
                108.0,
            );
            near(number(&points[i]["w"]), d);
            let actual = pair(&points[i]["position"]);
            near(actual[0], expected[0]);
            near(actual[1], expected[1]);
            // A rigid rotation preserves distance from the hinge in 3D.
            near((x - 0.75).powi(2) + z * z, distance * distance);
        }
        assert_eq!(
            pair(&points[0]["position"]),
            directed(direction, 0.75, 0.0, 192.0, 108.0)
        );
        assert_eq!(
            pair(&points[3]["position"]),
            directed(direction, 0.75, 1.0, 192.0, 108.0)
        );
        near(
            number(&mesh(&result)["brightness"]),
            1.0 - 0.6 * (1.0 - 1.0 / std::f64::consts::SQRT_2) / 2.0,
        );
        // The backside is not culled; the same four source corners reverse winding.
        assert!(area(points) * area(vertices(&frame(&s, 30))) < 0.0);
    }
}

#[test]
fn homogeneous_w_preserves_projective_uvs_and_straight_edges() {
    let s = source();
    let result = frame(&s, 14);
    let points = vertices(&result);
    let a = pair(&points[0]["position"]);
    let b = pair(&points[1]["position"]);
    let da = number(&points[0]["w"]);
    let db = number(&points[1]["w"]);
    let t = db / (da + db);
    let projected = [a[0] * (1.0 - t) + b[0] * t, a[1] * (1.0 - t) + b[1] * t];
    let z = 0.125 / std::f64::consts::SQRT_2;
    let d = 1.0 - 0.5 * z;
    let expected = [
        (0.5 + (0.75 + z - 0.5) / d) * 192.0,
        (0.5 - 0.5 / d) * 108.0,
    ];
    near(projected[0], expected[0]);
    near(projected[1], expected[1]);
    let uv_a = pair(&points[0]["uv"]);
    let uv_b = pair(&points[1]["uv"]);
    let interpolated = ((1.0 - t) * uv_a[0] / da + t * uv_b[0] / db) / ((1.0 - t) / da + t / db);
    near(interpolated, 0.875);
    assert!(
        ((1.0 - t) * uv_a[0] + t * uv_b[0] - 0.875).abs() > 0.001,
        "affine UV interpolation would visibly distort the source"
    );
}

#[test]
fn hinge_angle_perspective_and_shading_are_independent_and_edge_on_is_bounded() {
    let original = source();
    let expected = frame(&original, 14);
    for (key, value) in [
        ("hinge", json!(0.3)),
        ("angle", json!(FRAC_PI_2)),
        ("perspective", json!(0.0)),
        ("shading", json!(0.0)),
    ] {
        let mut s = source();
        style(&mut s)[key] = value;
        assert!(valid(&s));
        assert_ne!(commands(&frame(&s, 14)), commands(&expected));
    }
    // At the centered pi/2 pose the whole rigid face is edge-on, not a curl.
    let edge = frame(&original, 22);
    assert_eq!(commands(&edge).len(), 2);
    assert!(commands(&edge).iter().all(|c| c["kind"] == "image"));
    for hinge in [0.0, 0.25, 1.0] {
        let mut s = source();
        style(&mut s)["hinge"] = json!(hinge);
        style(&mut s)["angle"] = json!(FRAC_PI_2);
        style(&mut s)["perspective"] = json!(0.8);
        assert!(valid(&s));
        let middle = frame(&s, 22);
        assert!(commands(&middle).len() <= 3);
        if hinge < 1.0 {
            near(number(&vertices(&middle)[0]["position"][0]), hinge * 192.0);
            for point in vertices(&middle) {
                assert!((0.2..=1.0).contains(&number(&point["w"])));
                assert!(pair(&point["position"]).iter().all(|v| v.is_finite()));
            }
        }
    }
    let mut flat = source();
    style(&mut flat)["perspective"] = json!(0.0);
    style(&mut flat)["shading"] = json!(0.0);
    assert!(vertices(&frame(&flat, 14)).iter().all(|v| v["w"] == 1.0));
    assert_eq!(mesh(&frame(&flat, 14))["brightness"], 1.0);
}

#[test]
fn reverse_seek_rational_fps_seed_and_ref_do_not_change_the_same_pose() {
    let mut s = source();
    let expected = frame(&s, 14);
    for index in [37, 6, 30, 14, 59, 14] {
        assert!(frame(&s, index)["error"].is_null());
    }
    assert_eq!(expected, frame(&s, 14));
    s["frameRate"] = json!({"numerator":24000,"denominator":1001});
    s["seed"] = json!(999);
    assert_eq!(commands(&expected), commands(&frame(&s, 14)));
    s["recipe"]["songStartSeconds"] = json!(500.25);
    s["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse","scene":{
        "kind":"ref","input":"mix","timeMap":[{"atFrame":0,"sourceFrame":38},{"atFrame":32,"sourceFrame":6}]}}));
    s["recipe"]["root"] = json!("reverse");
    assert!(valid(&s));
    assert_eq!(root(&frame(&s, 24))["input"], *root(&expected));
}

#[test]
fn invalid_parameters_missing_fields_and_bad_ab_resources_are_rejected() {
    for (key, value) in [
        ("hinge", json!(-0.01)),
        ("hinge", json!(1.01)),
        ("angle", json!(FRAC_PI_2 - 0.01)),
        ("angle", json!(PI + 0.01)),
        ("perspective", json!(-0.01)),
        ("perspective", json!(0.81)),
        ("shading", json!(-0.01)),
        ("shading", json!(1.01)),
        ("direction", json!("diagonal")),
        ("segments", json!(24)),
    ] {
        let mut s = source();
        style(&mut s)[key] = value;
        reject(&s);
    }
    for key in ["direction", "hinge", "angle", "perspective", "shading"] {
        let mut s = source();
        style(&mut s).as_object_mut().unwrap().remove(key);
        reject(&s);
    }
    let mut s = source();
    s["recipe"]["nodes"][2]["scene"]["from"] = json!("missing");
    reject(&s);
    s = source();
    s["recipe"]["nodes"][0]["scene"] = json!({"kind":"illust","easing":"linear",
        "motion":{"startFrame":0,"durationFrames":59},"sprites":[],"background":{"image":"picture.png",
            "from":{"x":0.5,"y":0.5,"zoom":1},"to":{"x":0.5,"y":0.5,"zoom":1}}});
    reject(&s);
    let hash = "a".repeat(64);
    s["resources"] = json!([{"id":"picture.png","kind":"image","mimeType":"image/png",
        "byteLength":1,"sha256":hash,"attachmentKey":format!("programmatic-sha256-{hash}")}]);
    assert!(valid(&s));
    s["resources"][0]["kind"] = json!("font");
    s["resources"][0]["mimeType"] = json!("font/ttf");
    s["resources"][0]["font"] = json!({"family":"Fixture","weight":400,"style":"normal"});
    reject(&s);
}

#[test]
fn mesh_operations_and_gpu_surfaces_are_charged_to_existing_budgets() {
    let mut s = source();
    s["width"] = json!(3200);
    s["height"] = json!(2000);
    reject(&s);
    assert!(
        frame(&s, 14)["error"]
            .as_str()
            .unwrap()
            .contains("surface budget")
    );
    s = source();
    for index in 1..=5 {
        let mut outer = s["recipe"]["nodes"][2].clone();
        let previous = s["recipe"]["root"].clone();
        outer["id"] = json!(format!("layer{index}"));
        outer["scene"]["from"] = previous.clone();
        outer["scene"]["to"] = previous;
        s["recipe"]["root"] = outer["id"].clone();
        s["recipe"]["nodes"].as_array_mut().unwrap().push(outer);
        if index < 5 {
            assert!(valid(&s));
        }
    }
    reject(&s);
    assert!(frame(&s, 14)["error"].as_str().unwrap().contains("256"));
}

#[test]
fn catalog_exposes_the_same_required_radian_and_hinge_bounds() {
    let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    let entry = &catalog["transitionParameters"]["bend"];
    assert_eq!(entry["requires"], json!(["worker-webgl2"]));
    let p = &entry["parameters"];
    near(number(&p["hinge"]["min"]), 0.0);
    near(number(&p["hinge"]["max"]), 1.0);
    near(number(&p["angle"]["min"]), FRAC_PI_2);
    near(number(&p["angle"]["max"]), PI);
    near(number(&p["perspective"]["max"]), 0.8);
    near(number(&p["shading"]["max"]), 1.0);
    assert_eq!(
        p["direction"]["options"],
        json!(["left", "right", "up", "down"])
    );
}
