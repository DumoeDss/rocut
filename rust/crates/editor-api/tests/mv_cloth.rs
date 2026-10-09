use editor_api::mv_recipe_catalog_json;
use serde_json::{Value, json};

#[path = "support/cloth.rs"]
mod cloth;
use cloth::*;

#[test]
fn initial_fit_and_zero_force_mesh_preserve_the_complete_image() {
    for fit in ["contain", "cover", "stretch"] {
        let mut source = source();
        settings(&mut source)["fit"] = json!(fit);
        valid(&source);
        for frame in [0, 3, 4] {
            let result = resolve(&source, frame);
            assert_eq!(root(&result)["kind"], "cloth");
            assert_eq!(data(&result)["fullImage"], true);
            assert_eq!(data(&result)["image"], "cloth.png");
            assert_eq!(data(&result)["fit"], fit);
            assert_rest(data(&result));
        }
        neutral(&mut source);
        for frame in [5, 28, 52, 59] {
            let result = resolve(&source, frame);
            assert_rest(data(&result));
        }
    }
}

#[test]
fn material_uvs_cover_once_and_all_pin_modes_remain_exact() {
    for pins in ["topEdge", "topCorners", "leftEdge"] {
        let mut source = source();
        settings(&mut source)["pins"] = json!(pins);
        let result = resolve(&source, 28);
        let plan = data(&result);
        let points = vertices(plan);
        assert_eq!(points.len(), 13 * 9);
        assert_eq!(plan["faces"].as_array().unwrap().len(), 12 * 8 * 2);
        let mut pinned = 0;
        let mut pin_coordinates = Vec::new();
        for [u, v, x, y, w] in points {
            let column = ((u - 0.1) / 0.75 * 12.0).round();
            let row = ((v - 0.2) / 0.6 * 8.0).round();
            near(u, 0.1 + column / 12.0 * 0.75);
            near(v, 0.2 + row / 8.0 * 0.6);
            let is_pin = match pins {
                "topEdge" => row == 0.0,
                "topCorners" => row == 0.0 && (column == 0.0 || column == 12.0),
                _ => column == 0.0,
            };
            if is_pin {
                pinned += 1;
                near(x, u * 320.0);
                near(y, v * 180.0);
                assert_eq!(w, 1.0);
                pin_coordinates.push([u, v, x, y, w]);
            }
        }
        assert_eq!(
            pinned,
            match pins {
                "topEdge" => 13,
                "topCorners" => 2,
                _ => 9,
            }
        );
        let later = vertices(data(&resolve(&source, 52)));
        for pin in pin_coordinates {
            assert_eq!(later.iter().find(|v| v[..2] == pin[..2]), Some(&pin));
        }
        let mut area = 0.0;
        for face in plan["faces"].as_array().unwrap() {
            let vertices = face["vertices"].as_array().unwrap();
            assert_eq!(vertices.len(), 3);
            for i in 0..3 {
                let a = &vertices[i]["uv"];
                let b = &vertices[(i + 1) % 3]["uv"];
                area += (num(&a[0]) * num(&b[1]) - num(&b[0]) * num(&a[1])) / 2.0;
            }
        }
        near(area.abs(), 0.75 * 0.6);
    }
}

#[test]
fn gravity_wind_and_damping_change_physical_geometry_in_the_expected_direction() {
    let mut gravity = source();
    neutral(&mut gravity);
    settings(&mut gravity)["gravity"] = json!(2);
    let falling = resolve(&gravity, 20);
    let displacement: f64 = vertices(data(&falling))
        .iter()
        .map(|p| p[3] - p[1] * 180.0)
        .sum();
    assert!(
        displacement > 1e-6,
        "gravity did not pull free particles downward"
    );
    let mut wind = source();
    neutral(&mut wind);
    settings(&mut wind)["wind"] = json!([0, 0, 1]);
    settings(&mut wind)["damping"] = json!(0);
    let undamped = resolve(&wind, 28);
    assert!(
        z_motion(data(&undamped)) > 1e-7,
        "positive Z wind did not move toward camera"
    );
    settings(&mut wind)["damping"] = json!(10);
    let damped = resolve(&wind, 28);
    assert!(z_motion(data(&damped)) > 0.0);
    assert!(
        z_motion(data(&damped)) < z_motion(data(&undamped)),
        "damping failed to reduce motion"
    );
}

#[test]
fn solver_compliances_and_seeded_gust_are_not_cosmetic_controls() {
    let base = source();
    let reference = vertices(data(&resolve(&base, 32)));
    for (key, value) in [
        ("stretchCompliance", json!(0.001)),
        ("bendCompliance", json!(0.1)),
        ("solverIterations", json!(2)),
        ("gust", json!(0)),
        ("gustFrequency", json!(4)),
    ] {
        let mut changed = base.clone();
        settings(&mut changed)[key] = value;
        assert_ne!(
            vertices(data(&resolve(&changed, 32))),
            reference,
            "{key} did not affect geometry"
        );
    }
    let mut changed_seed = base.clone();
    changed_seed["seed"] = json!(28);
    assert_ne!(vertices(data(&resolve(&changed_seed, 32))), reference);
}

#[test]
fn face_opacity_is_applied_once_and_shading_does_not_change_particles() {
    let source = source();
    let before = resolve(&source, 20);
    let mut changed = source.clone();
    settings(&mut changed)["opacity"] = json!(0.37);
    settings(&mut changed)["shading"] = json!(0);
    let after = resolve(&changed, 20);
    assert_eq!(vertices(data(&before)), vertices(data(&after)));
    near(num(&data(&after)["opacity"]), 0.37);
    for face in data(&after)["faces"].as_array().unwrap() {
        near(num(&face["opacity"]), 0.37);
        near(num(&face["brightness"]), 1.0);
        assert!(face["colorOffset"].is_null());
    }
    settings(&mut changed)["opacity"] = json!(0);
    assert!(
        data(&resolve(&changed, 20))["faces"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn tick_events_obey_half_open_steps_and_equal_opposite_impulses_cancel() {
    let mut source = source();
    neutral(&mut source);
    scene(&mut source)["span"]["startFrame"] = json!(0);
    settings(&mut source)["events"] = json!([event(1_000, [0.0, 0.0, 1.0])]);
    for frame in [0, 1] {
        assert_rest(data(&resolve(&source, frame)));
    }
    assert!(z_motion(data(&resolve(&source, 2))) > 1e-7);
    settings(&mut source)["events"] = json!([event(0, [0.0, 0.0, 1.0])]);
    assert_rest(data(&resolve(&source, 0)));
    let first = resolve(&source, 1);
    assert!(z_motion(data(&first)) > 1e-7);
    settings(&mut source)["events"] = json!([event(999, [0.0, 0.0, 1.0])]);
    assert_eq!(vertices(data(&resolve(&source, 1))), vertices(data(&first)));
    settings(&mut source)["events"] =
        json!([event(0, [0.0, 0.0, 1.0]), event(0, [0.0, 0.0, -1.0]),]);
    for frame in [1, 12, 48] {
        assert_rest(data(&resolve(&source, frame)));
    }
}

#[test]
fn an_impulse_radius_is_circular_in_short_side_units_not_uv_units() {
    let mut source = source();
    neutral(&mut source);
    for (key, value) in [
        ("damping", json!(0)),
        ("solverIterations", json!(2)),
        ("stretchCompliance", json!(0.001)),
        ("bendCompliance", json!(0.1)),
    ] {
        settings(&mut source)[key] = value;
    }
    settings(&mut source)["events"] = json!([
        {"atTicks":0,"center":[0.5,0.5],"radius":0.3,"velocity":[0,0,1]}
    ]);
    let points = vertices(data(&resolve(&source, 5)));
    let displacement = |u: f64, v: f64| {
        let point = points
            .iter()
            .find(|p| {
                (p[0] - (0.1 + u * 0.75)).abs() < 1e-10 && (p[1] - (0.2 + v * 0.6)).abs() < 1e-10
            })
            .unwrap();
        (1.0 - point[4]).abs()
    };
    // The rect is 240x108: equal .25 UV offsets are .556 and .25 short sides.
    // Soft constraints allow only tiny secondary motion at the outside sample.
    let inside = displacement(0.5, 0.75);
    let outside = displacement(0.75, 0.5);
    assert!(
        inside > 1e-7 && inside > outside * 20.0,
        "{inside} vs {outside}"
    );
}

#[test]
fn fixed_step_floor_and_rational_frames_do_not_change_the_simulation_clock() {
    let mut fast = source();
    fast["frameRate"] = json!({"numerator":480,"denominator":1});
    scene(&mut fast)["span"]["startFrame"] = json!(0);
    for frame in [0, 1, 2, 3] {
        assert_rest(data(&resolve(&fast, frame)));
    }
    let first = resolve(&fast, 4);
    for frame in [5, 6, 7] {
        assert_eq!(data(&resolve(&fast, frame)), data(&first));
    }
    assert_ne!(vertices(data(&resolve(&fast, 8))), vertices(data(&first)));
    let mut rational = source();
    settings(&mut rational)["columns"] = json!(2);
    settings(&mut rational)["rows"] = json!(2);
    settings(&mut rational)["solverIterations"] = json!(2);
    rational["frameRate"] = json!({"numerator":30000,"denominator":1001});
    rational["durationFrames"] = json!(305);
    scene(&mut rational)["span"]["durationFrames"] = json!(300);
    let mut integer = rational.clone();
    integer["frameRate"] = json!({"numerator":120,"denominator":1});
    integer["durationFrames"] = json!(1_210);
    scene(&mut integer)["span"]["durationFrames"] = json!(1_205);
    for (rational_frame, integer_frame) in [(5, 8), (254, 1_005), (255, 1_009)] {
        assert_eq!(
            data(&resolve(&rational, rational_frame)),
            data(&resolve(&integer, integer_frame))
        );
    }
}

#[test]
fn seeking_trim_reverse_ref_and_json_restore_keep_source_local_state() {
    let source = source();
    let middle = resolve(&source, 28);
    for frame in [59, 4, 20, 52] {
        let _ = root(&resolve(&source, frame));
    }
    assert_eq!(data(&resolve(&source, 28)), data(&middle));
    assert_eq!(data(&resolve_trim(&source, 20, 8_000)), data(&middle));
    assert_eq!(data(&resolve(&source, 59)), data(&resolve(&source, 52)));
    let restored: Value = serde_json::from_str(&source.to_string()).unwrap();
    assert_eq!(data(&resolve(&restored, 28)), data(&middle));
    let mut moved_song = source.clone();
    moved_song["recipe"]["songStartSeconds"] = json!(123.25);
    assert_eq!(data(&resolve(&moved_song, 28)), data(&middle));
    let mut reverse = source.clone();
    reverse["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"r","scene":{
        "kind":"ref","input":"c","timeMap":[{"atFrame":0,"sourceFrame":52},{"atFrame":48,"sourceFrame":4}]}}));
    reverse["recipe"]["root"] = json!("r");
    assert_eq!(
        root(&resolve(&reverse, 24))["input"]["data"],
        *data(&middle)
    );
    assert_eq!(
        root(&resolve(&reverse, 48))["input"]["data"],
        *data(&resolve(&source, 4))
    );
}

#[test]
fn required_schema_and_numeric_event_boundaries_are_rejected() {
    assert_schema_contract();
}

#[test]
fn full_duration_and_expanded_graph_charge_simulation_work_before_rendering() {
    let mut source = source();
    source["durationFrames"] = json!(3_601);
    scene(&mut source)["span"] = json!({"startFrame":0,"durationFrames":3600});
    for key in ["columns", "rows"] {
        settings(&mut source)[key] = json!(4);
    }
    settings(&mut source)["solverIterations"] = json!(12);
    valid(&source);
    assert!(data(&resolve(&source, 0))["fullImage"] == true);
    let mut too_long = source.clone();
    too_long["durationFrames"] = json!(3_602);
    scene(&mut too_long)["span"]["durationFrames"] = json!(3_601);
    reject(&too_long);
    too_long["frameRate"] = json!({"numerator":30,"denominator":1});
    too_long["durationFrames"] = json!(902);
    scene(&mut too_long)["span"]["durationFrames"] = json!(901);
    reject(&too_long);
    let mut input = "c".to_string();
    for depth in 0..5 {
        let id = format!("mix{depth}");
        source["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":id,"scene":{
            "kind":"transition","from":input,"to":input,"span":{"startFrame":0,"durationFrames":3600},
            "easing":"linear","style":{"kind":"xfade"}}}));
        input = id;
    }
    source["recipe"]["root"] = json!(input);
    // 32 occurrences cost only 2048 charged primitives, below the 4096 cap.
    // The graph must fail specifically on accumulated simulation work.
    reject(&source);
    assert!(
        resolve(&source, 0)["error"]
            .as_str()
            .unwrap()
            .contains("simulation")
    );
}

#[test]
fn expanded_cloth_meshes_still_obey_the_shared_primitive_budget() {
    let mut source = source();
    settings(&mut source)["columns"] = json!(24);
    settings(&mut source)["rows"] = json!(24);
    scene(&mut source)["span"]["durationFrames"] = json!(1);
    valid(&source);
    source["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"twice","scene":{
        "kind":"transition","from":"c","to":"c","span":{"startFrame":4,"durationFrames":1},
        "easing":"linear","style":{"kind":"xfade"}}}));
    source["recipe"]["root"] = json!("twice");
    reject(&source);
    assert!(
        resolve(&source, 0)["error"]
            .as_str()
            .unwrap()
            .contains("4096")
    );
}

#[test]
fn cloth_catalog_and_legacy_solid_remain_independently_resolvable() {
    let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    let base = source();
    for key in settings(&mut base.clone()).as_object().unwrap().keys() {
        assert!(
            !catalog["generators"]["cloth"]["parameters"][key].is_null(),
            "missing {key}"
        );
    }
    let mut legacy = base;
    *scene(&mut legacy) = json!({"kind":"solid","role":"subject","color":[0.2,0.4,0.6,0.5]});
    valid(&legacy);
    let result = resolve(&legacy, 20);
    assert_eq!(root(&result)["kind"], "solid");
    assert_eq!(root(&result)["color"], json!([0.2, 0.4, 0.6, 0.5]));
}
