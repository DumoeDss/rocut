use editor_api::{
    mv_recipe_catalog_json, resolve_programmatic_frame_json, validate_clip_editing_json,
};
use serde_json::{Value, json};

fn source() -> Value {
    let hash = "a".repeat(64);
    json!({"version":1,"runtime":"canvas-worker","code":"","width":192,"height":108,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":40,"seed":27,
        "resources":[{"id":"font.ttf","kind":"font","mimeType":"font/ttf","byteLength":1,
            "sha256":hash,"attachmentKey":format!("programmatic-sha256-{hash}"),
            "font":{"family":"SweepFixture","weight":500,"style":"normal"}}],
        "recipe":{"version":1,"root":"g","songStartSeconds":0,"outputRoles":["graphics"],
            "nodes":[{"id":"g","scene":{"kind":"asciiSweep","role":"graphics",
                "span":{"startFrame":4,"durationFrames":24},"easing":"linear",
                "settings":{"font":"font.ttf","textA":"ABCDEFGHIJKL\n0123456789+-",
                    "textB":"abcdefghijkl\n9876543210-+","glyphs":"#",
                    "rect":[0.0625,0.1,0.875,0.8],"fontSize":20,"bandWidth":0.2,
                    "color":[0.7,0.8,1,0.6],"activeColor":[0.2,1,0.6,0.8],
                    "opacity":0.75,"direction":"leftToRight"}}}]}})
}

fn settings(source: &mut Value) -> &mut Value {
    &mut source["recipe"]["nodes"][0]["scene"]["settings"]
}

fn step(source: &Value) -> u64 {
    120000 * source["frameRate"]["denominator"].as_u64().unwrap()
        / source["frameRate"]["numerator"].as_u64().unwrap()
}

fn resolve(source: &Value, frame: u64) -> Value {
    resolve_trimmed(source, frame, 0)
}

fn resolve_trimmed(source: &Value, frame: u64, trim: u64) -> Value {
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":source,
        "clipStart":12000,"clipDuration":(40-trim)*step(source),"trimStart":trim*step(source),
        "timelineTime":12000+frame*step(source)})
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

fn texts(result: &Value) -> Vec<&str> {
    data(result)["glyphs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["text"].as_str().unwrap())
        .collect()
}

#[test]
fn ascii_sweep_preserves_unicode_scalars_newlines_spaces_and_exact_endpoints() {
    let mut s = source();
    settings(&mut s)["textA"] = json!("\nA\u{754c}\u{1f642}e\u{301}\n x");
    settings(&mut s)["textB"] = json!("\u{7d42}\u{1f643}\nY\n");
    assert!(valid(&s));
    let a = resolve(&s, 0);
    let b = resolve(&s, 28);
    assert_eq!(root(&a), root(&resolve(&s, 4)));
    assert_eq!(root(&b), root(&resolve(&s, 39)));
    assert_eq!(
        texts(&a),
        vec![
            "",
            "",
            "",
            "",
            "",
            "A",
            "\u{754c}",
            "\u{1f642}",
            "e",
            "\u{301}",
            " ",
            "x",
            "",
            "",
            ""
        ]
    );
    assert_eq!(
        texts(&b),
        vec![
            "\u{7d42}",
            "\u{1f643}",
            "",
            "",
            "",
            "Y",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            ""
        ]
    );
    for endpoint in [&a, &b] {
        assert!(
            data(endpoint)["glyphs"]
                .as_array()
                .unwrap()
                .iter()
                .all(|g| g["active"] == false && g["opacity"] == 0.75)
        );
    }
}

#[test]
fn middle_contains_real_a_and_b_text_on_opposite_sides_of_the_scan_band() {
    let mut s = source();
    assert!(valid(&s));
    let middle = resolve(&s, 16);
    assert_eq!(root(&middle)["kind"], "asciiSweep");
    let plan = data(&middle);
    assert_eq!(plan["font"], "font.ttf");
    assert_eq!(plan["fontSize"], 20.0);
    assert_eq!(plan["cellWidth"], 12.0);
    assert_eq!(plan["lineHeight"], 24.0);
    assert_eq!(plan["color"], json!([0.7, 0.8, 1.0, 0.6]));
    assert_eq!(plan["activeColor"], json!([0.2, 1.0, 0.6, 0.8]));
    let a = ["ABCDEFGHIJKL", "0123456789+-"];
    let b = ["abcdefghijkl", "9876543210-+"];
    for direction in ["leftToRight", "rightToLeft"] {
        settings(&mut s)["direction"] = json!(direction);
        let output = resolve(&s, 16);
        for (index, cell) in data(&output)["glyphs"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let (row, col) = (index / 12, index % 12);
            let u = (col as f64 + 0.5) * 12.0 / 168.0;
            let u = if direction == "rightToLeft" {
                1.0 - u
            } else {
                u
            };
            let expected = if u < 0.4 {
                b[row].chars().nth(col).unwrap()
            } else if u > 0.6 {
                a[row].chars().nth(col).unwrap()
            } else {
                '#'
            };
            assert_eq!(cell["text"], expected.to_string());
            assert_eq!(cell["active"], (0.4..=0.6).contains(&u));
            assert_eq!(cell["opacity"], 0.75, "scan is not a whole-text fade");
            assert_eq!(
                cell["x"].as_f64().unwrap(),
                12.0 + (col as f64 + 0.5) * 12.0
            );
            assert!(
                (cell["y"].as_f64().unwrap() - (10.8 + (row as f64 + 0.5) * 24.0)).abs() < 1e-9
            );
        }
        assert_eq!(texts(&resolve(&s, 4)).concat(), a.concat());
        assert_eq!(texts(&resolve(&s, 28)).concat(), b.concat());
    }
}

#[test]
fn seeded_band_is_stateless_while_text_endpoints_do_not_depend_on_seed() {
    let mut s = source();
    settings(&mut s)["glyphs"] = json!("01#+ABCxyz\u{754c}\u{1f642}");
    let before = resolve(&s, 4);
    let middle = resolve(&s, 16);
    let end = resolve(&s, 28);
    for frame in [26, 7, 39, 1, 16] {
        let _ = resolve(&s, frame);
    }
    assert_eq!(middle, resolve(&s, 16));
    s["seed"] = json!(28);
    assert_ne!(data(&middle), data(&resolve(&s, 16)));
    assert_eq!(data(&before), data(&resolve(&s, 4)));
    assert_eq!(data(&end), data(&resolve(&s, 28)));
    settings(&mut s)["glyphs"] = json!("\u{1f642}");
    let unicode = resolve(&s, 16);
    for cell in data(&unicode)["glyphs"].as_array().unwrap() {
        if cell["active"] == true {
            assert_eq!(cell["text"], "\u{1f642}");
        }
    }
}

#[test]
fn rational_fps_trim_song_offset_and_reference_use_source_frame_progress() {
    let mut s = source();
    let direct = resolve(&s, 16);
    s["frameRate"] = json!({"numerator":24000,"denominator":1001});
    s["recipe"]["songStartSeconds"] = json!(91.25);
    assert_eq!(root(&direct), root(&resolve(&s, 16)));
    assert_eq!(root(&direct), root(&resolve_trimmed(&s, 10, 6)));
    s["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"reverse","scene":{
        "kind":"ref","input":"g","timeMap":[{"atFrame":0,"sourceFrame":28},
            {"atFrame":24,"sourceFrame":4}]}}));
    s["recipe"]["root"] = json!("reverse");
    assert!(valid(&s));
    assert_eq!(&root(&resolve(&s, 12))["input"], root(&direct));
    assert_eq!(root(&resolve(&s, 0))["sampledFrame"], 28);
    assert_eq!(root(&resolve(&s, 24))["sampledFrame"], 4);
}

#[test]
fn invalid_text_geometry_resources_and_unknown_fields_reject_at_both_boundaries() {
    for (key, value) in [
        ("font", json!("missing.ttf")),
        ("textA", json!("")),
        ("textB", json!("x".repeat(129))),
        ("textA", json!("\u{1f642}".repeat(129))),
        ("textA", json!("x\n".repeat(32))),
        ("textA", json!("a\r\nb")),
        ("textB", json!("a\tb")),
        ("textA", json!("a\0b")),
        ("glyphs", json!("")),
        ("glyphs", json!("\u{1f642}".repeat(65))),
        ("glyphs", json!("a\nb")),
        ("fontSize", json!(3.99)),
        ("fontSize", json!(257)),
        ("fontSize", json!(40)),
        ("bandWidth", json!(0)),
        ("bandWidth", json!(1.01)),
        ("rect", json!([0, 0, 0.1, 1])),
        ("rect", json!([0, 0, 1, 0.1])),
        ("rect", json!([-0.01, 0, 1, 1])),
        ("rect", json!([0.5, 0, 0.6, 1])),
        ("rect", json!([0, 0.5, 1, 0.6])),
        ("rect", json!([0, 0, 0, 1])),
        ("color", json!([0, 1, 2, 1])),
        ("activeColor", json!([0, 1, 1, -0.1])),
        ("opacity", json!(1.01)),
        ("direction", json!("up")),
        ("seed", json!(1)),
    ] {
        let mut s = source();
        settings(&mut s)[key] = value;
        reject(&s);
    }
    let base = source();
    for key in base["recipe"]["nodes"][0]["scene"]["settings"]
        .as_object()
        .unwrap()
        .keys()
    {
        let mut s = base.clone();
        settings(&mut s).as_object_mut().unwrap().remove(key);
        reject(&s);
    }
    let mut s = source();
    s["resources"][0]["kind"] = json!("image");
    s["resources"][0]["mimeType"] = json!("image/png");
    s["resources"][0].as_object_mut().unwrap().remove("font");
    reject(&s);
    s = source();
    s["resources"] = json!([]);
    reject(&s);
    s = source();
    s["recipe"]["nodes"][0]["scene"]["span"]["durationFrames"] = json!(40);
    reject(&s);
}

#[test]
fn maximum_multiline_unicode_and_expanded_primitive_budget_are_not_truncated() {
    let mut s = source();
    s["width"] = json!(320);
    s["height"] = json!(180);
    settings(&mut s)["fontSize"] = json!(4);
    settings(&mut s)["rect"] = json!([0, 0, 1, 1]);
    let text = vec!["\u{1f642}".repeat(128); 32].join("\n");
    settings(&mut s)["textA"] = json!(text);
    settings(&mut s)["textB"] = json!("B");
    assert!(valid(&s));
    let plan = resolve(&s, 4);
    assert_eq!(texts(&plan).len(), 4096);
    assert!(texts(&plan).iter().all(|s| *s == "\u{1f642}"));
    s["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"twice","scene":{
        "kind":"transition","from":"g","to":"g","span":{"startFrame":0,"durationFrames":24},
        "easing":"linear","style":{"kind":"xfade"}}}));
    s["recipe"]["root"] = json!("twice");
    reject(&s);
    assert!(resolve(&s, 0)["error"].as_str().unwrap().contains("4096"));
}

#[test]
fn catalog_exposes_text_font_band_and_fixed_cell_semantics() {
    let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    let entry = &catalog["generators"]["asciiSweep"];
    assert_eq!(entry["parameters"]["font"]["kind"], "font");
    assert_eq!(entry["parameters"]["textA"]["maxColumns"], 128);
    assert_eq!(entry["parameters"]["textA"]["maxLines"], 32);
    assert_eq!(entry["parameters"]["textA"]["maxLength"], 4127);
    assert_eq!(entry["parameters"]["glyphs"]["maxLength"], 64);
    assert_eq!(
        entry["parameters"]["direction"]["options"],
        json!(["leftToRight", "rightToLeft"])
    );
    assert_eq!(entry["layout"]["cellWidthFontRatio"], 0.6);
    assert_eq!(entry["layout"]["lineHeightFontRatio"], 1.2);
    assert_eq!(entry["parameters"]["fontSize"]["unit"], "pixels");
}
