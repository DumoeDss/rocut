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
                "font":{"family":"ScrollFixture","weight":500,"style":"normal"}}
        ],"recipe":{"version":1,"root":"g","songStartSeconds":0,"outputRoles":["subject"],
            "nodes":[{"id":"g","scene":{"kind":"particleScroll","role":"subject",
                "span":{"startFrame":4,"durationFrames":12},"easing":"linear",
                "settings":{"image":"image.png","columns":4,"rows":2,
                    "rect":[0.125,0.2,0.75,0.5],"fit":"contain","band":0.5,
                    "scatter":0.8,"spin":1,"opacity":0.75,"direction":"left-to-right"}}}]}})
}

fn settings(source: &mut Value) -> &mut Value {
    &mut source["recipe"]["nodes"][0]["scene"]["settings"]
}

fn resolve_trimmed(source: &Value, index: u64, trim: u64) -> Value {
    let step = 120000 * source["frameRate"]["denominator"].as_u64().unwrap()
        / source["frameRate"]["numerator"].as_u64().unwrap();
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":source,"clipStart":12000,"clipDuration":(30-trim)*step,
            "trimStart":trim*step,"timelineTime":12000+index*step})
        .to_string(),
    ))
    .unwrap()
}

fn resolve(source: &Value, index: u64) -> Value {
    resolve_trimmed(source, index, 0)
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
        "duration":120000,"trimStart":0,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}
    }).to_string())).unwrap().is_empty()
}

fn reject(source: &Value) {
    assert!(!valid(source));
    assert!(resolve(source, 0)["error"].is_string());
}

fn close(actual: &Value, expected: f64) {
    let actual = actual.as_f64().unwrap();
    assert!((actual - expected).abs() < 1e-10, "{actual} != {expected}");
}

#[test]
fn exact_endpoints_preserve_fit_nonzero_rect_and_opacity() {
    for fit in ["contain", "cover", "stretch"] {
        let mut source = source();
        settings(&mut source)["fit"] = json!(fit);
        assert!(valid(&source));
        for frame in [0, 4] {
            let result = resolve(&source, frame);
            let data = data(&result);
            assert_eq!(data["fullImage"], true);
            assert_eq!(data["rect"], json!([40.0, 36.0, 240.0, 90.0]));
            assert_eq!(data["fit"], fit);
            assert_eq!(data["image"], "image.png");
            assert_eq!(data["opacity"], 0.75);
            assert!(data["intactUv"].is_null() && data["particleClipUv"].is_null());
            assert_eq!(data["particles"], json!([]));
        }
        for frame in [16, 29] {
            let result = resolve(&source, frame);
            let data = data(&result);
            assert_eq!(data["fullImage"], false);
            assert!(data["intactUv"].is_null() && data["particleClipUv"].is_null());
            assert_eq!(data["particles"], json!([]));
        }
    }
}

#[test]
fn fixed_midpoint_has_an_intact_side_and_only_real_image_cells_in_the_band() {
    let mut source = source();
    settings(&mut source)["scatter"] = json!(0);
    settings(&mut source)["spin"] = json!(0);
    let result = resolve(&source, 10);
    let data = data(&result);
    assert_eq!(data["fullImage"], false);
    assert_eq!(data["frontier"], 0.75);
    assert_eq!(data["intactUv"], json!([0.75, 0.0, 0.25, 1.0]));
    assert_eq!(data["particleClipUv"], json!([0.0, 0.0, 0.75, 1.0]));
    let particles = data["particles"].as_array().unwrap();
    assert_eq!(particles.len(), 4);
    for (index, particle) in particles.iter().enumerate() {
        let column = index % 2 + 1;
        let row = index / 2;
        assert_eq!(particle["cell"], json!([column, row]));
        assert_eq!(
            particle["uv"],
            json!([column as f64 * 0.25, row as f64 * 0.5, 0.25, 0.5])
        );
        assert_eq!(particle["offset"], json!([0.0, 0.0]));
        close(&particle["rotation"], 0.0);
        let (scale, alpha) = if column == 1 {
            (0.55, 0.046875)
        } else {
            (0.85, 0.421875)
        };
        close(&particle["scale"], scale);
        close(&particle["opacity"], alpha);
    }
}

#[test]
fn frontier_intersections_are_per_cell_and_preserve_direction_for_every_scan_axis() {
    for direction in [
        "left-to-right",
        "right-to-left",
        "top-to-bottom",
        "bottom-to-top",
    ] {
        let mut source = source();
        settings(&mut source)["direction"] = json!(direction);
        let horizontal = direction.ends_with("right") || direction.ends_with("left");
        let reverse = direction == "right-to-left" || direction == "bottom-to-top";
        let axis = usize::from(!horizontal);
        for frame in [5, 7, 10, 13, 15] {
            let result = resolve(&source, frame);
            let data = data(&result);
            let frontier = 1.5 * (frame - 4) as f64 / 12.0;
            close(&data["frontier"], frontier);
            let mut expected_count = 0;
            for row in 0..2 {
                for column in 0..4 {
                    let cell_start = if horizontal {
                        column as f64 / 4.0
                    } else {
                        row as f64 / 2.0
                    };
                    let cell_size = if horizontal { 0.25 } else { 0.5 };
                    let (start, end) = if reverse {
                        (1.0 - cell_start - cell_size, 1.0 - cell_start)
                    } else {
                        (cell_start, cell_start + cell_size)
                    };
                    let low = start.max(frontier - 0.5).max(0.0);
                    let high = end.min(frontier).min(1.0);
                    if high <= low {
                        continue;
                    }
                    let particle = &data["particles"][expected_count];
                    expected_count += 1;
                    assert_eq!(particle["cell"], json!([column, row]));
                    close(
                        &particle["uv"][axis],
                        if reverse { 1.0 - high } else { low },
                    );
                    close(&particle["uv"][axis + 2], high - low);
                    close(
                        &particle["uv"][1 - axis],
                        if horizontal {
                            row as f64 / 2.0
                        } else {
                            column as f64 / 4.0
                        },
                    );
                    close(
                        &particle["uv"][3 - axis],
                        if horizontal { 0.5 } else { 0.25 },
                    );
                    let age = (frontier - (low + high) * 0.5) / 0.5;
                    close(&particle["scale"], 1.0 - 0.6 * age);
                    close(&particle["opacity"], 0.75 * (1.0 - age).powi(2));
                    let offset = particle["offset"][axis].as_f64().unwrap();
                    assert!(if reverse { offset > 0.0 } else { offset < 0.0 });
                }
            }
            assert_eq!(data["particles"].as_array().unwrap().len(), expected_count);
            assert!(expected_count > 0 && expected_count <= 8);
            let limit = frontier.min(1.0);
            close(
                &data["particleClipUv"][axis],
                if reverse { 1.0 - limit } else { 0.0 },
            );
            close(&data["particleClipUv"][axis + 2], limit);
            if frontier >= 1.0 {
                assert!(data["intactUv"].is_null());
            } else {
                close(
                    &data["intactUv"][axis],
                    if reverse { 0.0 } else { frontier },
                );
                close(&data["intactUv"][axis + 2], 1.0 - frontier);
            }
        }
    }
}

#[test]
fn seed_changes_motion_without_changing_image_boundaries_and_replay_has_no_state() {
    let mut source = source();
    let middle = resolve(&source, 10);
    for frame in [29, 7, 0, 16, 5] {
        assert!(!resolve(&source, frame)["frame"].is_null());
    }
    assert_eq!(middle, resolve(&source, 10));
    source["seed"] = json!(28);
    let other = resolve(&source, 10);
    assert_ne!(data(&middle)["particles"], data(&other)["particles"]);
    for key in ["frontier", "rect", "intactUv", "particleClipUv"] {
        assert_eq!(data(&middle)[key], data(&other)[key]);
    }
    for (before, after) in data(&middle)["particles"]
        .as_array()
        .unwrap()
        .iter()
        .zip(data(&other)["particles"].as_array().unwrap())
    {
        for key in ["cell", "uv", "scale", "opacity"] {
            assert_eq!(before[key], after[key]);
        }
        assert_ne!(before["offset"], after["offset"]);
        assert_ne!(before["rotation"], after["rotation"]);
    }
}

#[test]
fn rational_frame_rates_trim_and_reverse_ref_reproduce_the_identical_source_frame() {
    let reference = source();
    for (numerator, denominator) in [(30, 1), (24000, 1001), (30000, 1001)] {
        let mut source = source();
        source["frameRate"] = json!({"numerator":numerator,"denominator":denominator});
        source["recipe"]["songStartSeconds"] = json!(7.25);
        for frame in [0, 4, 7, 10, 16, 29] {
            assert_eq!(
                root(&resolve(&reference, frame)),
                root(&resolve(&source, frame))
            );
        }
        assert_eq!(
            root(&resolve(&source, 10)),
            root(&resolve_trimmed(&source, 6, 4))
        );
        let direct = source.clone();
        source["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse","scene":{
            "kind":"ref","input":"g","timeMap":[{"atFrame":0,"sourceFrame":16},{"atFrame":12,"sourceFrame":4}]}}));
        source["recipe"]["root"] = json!("reverse");
        assert!(valid(&source));
        for frame in 0..=12 {
            let reversed = resolve(&source, frame);
            assert_eq!(root(&reversed)["sampledFrame"], 16 - frame);
            assert_eq!(
                root(&reversed)["input"],
                *root(&resolve(&direct, 16 - frame))
            );
        }
    }
}

#[test]
fn easing_moves_the_frontier_and_transparent_inputs_do_not_create_particles() {
    let mut source = source();
    source["recipe"]["nodes"][0]["scene"]["easing"] = json!("inQuad");
    close(&data(&resolve(&source, 10))["frontier"], 0.375);
    settings(&mut source)["opacity"] = json!(0);
    for frame in [0, 7, 10, 16] {
        let result = resolve(&source, frame);
        close(&data(&result)["opacity"], 0.0);
        assert_eq!(data(&result)["particles"], json!([]));
    }
}

#[test]
fn rejects_resources_roles_spans_missing_fields_and_parameter_bounds_at_both_boundaries() {
    for (key, value) in [
        ("image", json!("missing.png")),
        ("image", json!("font.ttf")),
        ("columns", json!(0)),
        ("columns", json!(65)),
        ("columns", json!(2.5)),
        ("rows", json!(0)),
        ("rows", json!(65)),
        ("band", json!(0)),
        ("band", json!(1.001)),
        ("band", Value::Null),
        ("scatter", json!(-0.001)),
        ("scatter", json!(2.001)),
        ("spin", json!(-4.001)),
        ("spin", json!(4.001)),
        ("opacity", json!(-0.001)),
        ("opacity", json!(1.001)),
        ("fit", json!("invalid")),
        ("direction", json!("in")),
        ("rect", json!([0, 0, 0, 1])),
        ("rect", json!([0, 0, 1, 2.001])),
        ("rect", json!([-1.001, 0, 1, 1])),
        ("rect", json!([0, 0, 1])),
        ("unknown", json!(0)),
    ] {
        let mut source = source();
        settings(&mut source)[key] = value;
        reject(&source);
    }
    for key in [
        "image",
        "columns",
        "rows",
        "rect",
        "fit",
        "band",
        "scatter",
        "spin",
        "opacity",
        "direction",
    ] {
        let mut source = source();
        settings(&mut source).as_object_mut().unwrap().remove(key);
        reject(&source);
    }
    for (key, value) in [
        ("role", json!("invalid")),
        ("easing", json!("invalid")),
        ("span", json!({"startFrame":4,"durationFrames":0})),
        ("span", json!({"startFrame":29,"durationFrames":2})),
        ("unknown", json!(0)),
    ] {
        let mut source = source();
        source["recipe"]["nodes"][0]["scene"][key] = value;
        reject(&source);
    }
}

#[test]
fn roles_and_inclusive_parameter_boundaries_are_supported() {
    for role in ["background", "subject", "graphics", "foreground"] {
        let mut source = source();
        source["recipe"]["nodes"][0]["scene"]["role"] = json!(role);
        source["recipe"]["outputRoles"] = json!([role]);
        for (band, scatter, spin, opacity, rect) in [
            (0.01, 0.0, -4.0, 0.0, [-1.0, -1.0, 0.01, 0.01]),
            (1.0, 2.0, 4.0, 1.0, [1.0, 1.0, 2.0, 2.0]),
        ] {
            settings(&mut source)["band"] = json!(band);
            settings(&mut source)["scatter"] = json!(scatter);
            settings(&mut source)["spin"] = json!(spin);
            settings(&mut source)["opacity"] = json!(opacity);
            settings(&mut source)["rect"] = json!(rect);
            assert!(valid(&source));
            assert_eq!(root(&resolve(&source, 10))["role"], role);
        }
    }
}

#[test]
fn primitive_budget_counts_the_intact_draw_and_every_expanded_occurrence() {
    let mut source = source();
    settings(&mut source)["columns"] = json!(63);
    settings(&mut source)["rows"] = json!(64);
    assert!(valid(&source));
    settings(&mut source)["columns"] = json!(64);
    reject(&source);
    settings(&mut source)["columns"] = json!(63);
    let mut second = source["recipe"]["nodes"][0].clone();
    second["id"] = json!("second");
    second["scene"]["settings"]["columns"] = json!(62);
    second["scene"]["settings"]["rows"] = json!(1);
    source["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(second);
    source["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"mix","scene":{
        "kind":"transition","from":"g","to":"second","span":{"startFrame":0,"durationFrames":20},
        "easing":"linear","style":{"kind":"xfade"}}}));
    source["recipe"]["root"] = json!("mix");
    assert!(valid(&source)); // 63*64+1 + 62*1+1 = 4096.
    source["recipe"]["nodes"][1]["scene"]["settings"]["columns"] = json!(63);
    reject(&source);
    assert!(
        resolve(&source, 0)["error"]
            .as_str()
            .unwrap()
            .contains("4096")
    );
    source["recipe"]["nodes"][2]["scene"]["to"] = json!("g");
    reject(&source);
    assert!(
        resolve(&source, 0)["error"]
            .as_str()
            .unwrap()
            .contains("4096")
    );
}

#[test]
fn catalog_exposes_the_same_required_schema_endpoints_and_budget() {
    let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    let entry = &catalog["generators"]["particleScroll"];
    assert_eq!(catalog["generatorPrimitiveBudget"], 4096);
    assert_eq!(entry["parameters"]["image"]["kind"], "image");
    assert_eq!(entry["parameters"]["columns"]["max"], 64);
    assert_eq!(entry["parameters"]["band"]["min"], 0.01);
    assert_eq!(entry["parameters"]["band"]["max"], 1.0);
    assert_eq!(
        entry["parameters"]["direction"]["options"],
        json!([
            "left-to-right",
            "right-to-left",
            "top-to-bottom",
            "bottom-to-top"
        ])
    );
    for key in source()["recipe"]["nodes"][0]["scene"]["settings"]
        .as_object()
        .unwrap()
        .keys()
    {
        assert!(
            !entry["parameters"][key].is_null(),
            "{key} missing from catalog"
        );
    }
    assert!(
        entry["constraints"][0]
            .as_str()
            .unwrap()
            .contains("columns * rows + 1")
    );
    assert!(
        entry["endpoints"]
            .as_str()
            .unwrap()
            .contains("progress 1 is transparent")
    );
}
