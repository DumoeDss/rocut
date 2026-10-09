use super::{bounds_test_support::*, *};
use serde_json::json;

#[test]
fn nonfinite_and_out_of_range_keys_are_rejected_on_both_sides() {
    let r = request();
    for size in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -1.0,
        -0.0,
        0.0,
        4096.01,
    ] {
        let mut input: Vec<Request> = serde_json::from_value(r.clone()).unwrap();
        let mut facts: Vec<Measurement> = serde_json::from_value(measurements(&r)).unwrap();
        input[0].bounds[1].font_size_px = size;
        assert!(Context::new(&input, &facts).is_err());
        input[0].bounds[1].font_size_px = 1000.0;
        facts[0].bounds[1].font_size_px = size;
        assert!(Context::new(&input, &facts).is_err());
    }
    for tracking in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -4096.01,
        4096.01,
    ] {
        let mut input: Vec<Request> = serde_json::from_value(r.clone()).unwrap();
        let mut facts: Vec<Measurement> = serde_json::from_value(measurements(&r)).unwrap();
        input[0].bounds[1].letter_spacing_px = tracking;
        assert!(Context::new(&input, &facts).is_err());
        input[0].bounds[1].letter_spacing_px = 0.0;
        facts[0].bounds[1].letter_spacing_px = tracking;
        assert!(Context::new(&input, &facts).is_err());
    }
    for version in [0, 2, 255] {
        let mut input = r.clone();
        input[0]["bounds"][1]["version"] = json!(version);
        assert!(context(input.clone(), measurements(&input)).is_err());
    }
}

#[test]
fn extents_are_finite_bounded_signed_ink_and_empty_strings_have_no_ink() {
    let r = request();
    for field in ["left", "right", "ascent", "descent"] {
        for value in [
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            -16777216.01,
            16777216.01,
        ] {
            let input: Vec<Request> = serde_json::from_value(r.clone()).unwrap();
            let mut facts: Vec<Measurement> = serde_json::from_value(measurements(&r)).unwrap();
            let a = &mut facts[0].bounds[1];
            match field {
                "left" => a.left = value,
                "right" => a.right = value,
                "ascent" => a.ascent = value,
                _ => a.descent = value,
            }
            assert!(Context::new(&input, &facts).is_err(), "{field}");
        }
        for value in [f64::EPSILON, -f64::EPSILON, 1.0, -1.0] {
            let mut facts = measurements(&r);
            facts[0]["bounds"][0][field] = json!(value);
            assert!(context(r.clone(), facts).is_err(), "{field}");
        }
    }
    for (field, value) in [
        ("left", -53.0),
        ("right", 1.0),
        ("ascent", 2.0),
        ("descent", -81.0),
    ] {
        let mut facts = measurements(&r);
        facts[0]["bounds"][1][field] = json!(value);
        assert!(context(r.clone(), facts).is_err(), "{field}");
    }
    let mut r = r;
    r[0]["bounds"] = json!([
        item("AV", 4096.0, 4096.0, "right", "bottom"),
        item("AV", 4096.0, -4096.0, "left", "top")
    ]);
    let mut facts = measurements(&r);
    for a in facts[0]["bounds"].as_array_mut().unwrap() {
        a["left"] = json!(-16777216.0);
        a["right"] = json!(16777216.0);
        a["ascent"] = json!(16777216.0);
        a["descent"] = json!(-16777216.0);
    }
    let c = context(r.clone(), facts).unwrap();
    assert_eq!(
        lookup(&c, "font", r[0]["bounds"][0].clone()).unwrap().left,
        -16777216.0
    );
}

#[test]
fn empty_bounds_keep_real_signed_baseline_offsets_without_inventing_ink() {
    let mut r = request();
    r[0]["bounds"] = json!([item("", 20.0, 0.0, "left", "alphabetic")]);
    let mut facts = measurements(&r);
    // Chromium 151 DotGothic16, also measured independently in the browser gate.
    facts[0]["bounds"][0]["ascent"] = json!(0.55999755859375);
    facts[0]["bounds"][0]["descent"] = json!(-0.55999755859375);
    let c = context(r.clone(), facts.clone()).unwrap();
    let ink = lookup(&c, "font", r[0]["bounds"][0].clone()).unwrap();
    assert_eq!(ink.ascent, 0.55999755859375);
    assert_eq!(ink.descent, -0.55999755859375);
    assert_eq!(ink.ascent + ink.descent, 0.0);
    facts[0]["bounds"][0]["descent"] = json!(0.0);
    assert!(
        context(r, facts).is_err(),
        "an empty string still cannot have ink"
    );
}

#[test]
fn measurement_count_and_scalar_budgets_are_global_across_fonts() {
    let all: Vec<_> = (1..=1024)
        .map(|n| item("A", n as f64, 0.0, "left", "alphabetic"))
        .collect();
    let mut r = json!([{"resource":resource("font"),"glyphs":[],"advances":[],"bounds":all}]);
    assert!(context(r.clone(), measurements(&r)).is_ok());
    r.as_array_mut().unwrap().push(json!({"resource":resource("other"),"glyphs":[],"advances":[],"bounds":[item("B",22.0,0.0,"left","alphabetic")]}));
    assert!(context(r.clone(), measurements(&r)).is_err());
    let all: Vec<_> = (0..64)
        .map(|n| item(&"😀".repeat(1024), 22.0, n as f64, "left", "alphabetic"))
        .collect();
    r = json!([{"resource":resource("font"),"glyphs":[],"advances":[],"bounds":all}]);
    assert!(context(r.clone(), measurements(&r)).is_ok());
    r.as_array_mut().unwrap().push(json!({"resource":resource("other"),"glyphs":[],"advances":[],"bounds":[item("A",22.0,0.0,"left","alphabetic")]}));
    assert!(context(r.clone(), measurements(&r)).is_err());
    r = request();
    r[0]["bounds"][1]["text"] = json!("😀".repeat(1025));
    assert!(context(r.clone(), measurements(&r)).is_err());
}

#[test]
fn bounds_do_not_consume_legacy_glyph_or_advance_budgets() {
    let bounds: Vec<_> = (1..=1024)
        .map(|n| item("A", n as f64, 0.0, "left", "alphabetic"))
        .collect();
    let advances: Vec<_> = (1..=1024)
        .map(|n| json!({"text":"A","fontSizePx":n,"letterSpacingPx":0}))
        .collect();
    let glyphs: Vec<_> = (0..1024)
        .map(|n| char::from_u32(0x4e00 + n).unwrap().to_string())
        .collect();
    let mut r =
        json!([{"resource":resource("font"),"glyphs":glyphs,"advances":advances,"bounds":bounds}]);
    assert!(context(r.clone(), measurements(&r)).is_ok());
    let bounds: Vec<_> = (0..64)
        .map(|n| item(&"😀".repeat(1024), 22.0, n as f64, "left", "alphabetic"))
        .collect();
    let advances: Vec<_> = (0..64)
        .map(|n| json!({"text":"😀".repeat(1024),"fontSizePx":22,"letterSpacingPx":n}))
        .collect();
    r[0]["bounds"] = json!(bounds);
    r[0]["advances"] = json!(advances);
    assert!(context(r.clone(), measurements(&r)).is_ok());
}

#[test]
fn bounds_only_fonts_keep_the_existing_global_font_limit() {
    let all: Vec<_> = (0..64)
        .map(|n| {
            json!({"resource":resource(&format!("font{n}")),"glyphs":[],"advances":[],
        "bounds":[item("",22.0,0.0,"left","alphabetic")]})
        })
        .collect();
    let mut r = json!(all);
    assert!(context(r.clone(), measurements(&r)).is_ok());
    r.as_array_mut().unwrap().push(json!({"resource":resource("overflow"),"glyphs":[],"advances":[],"bounds":[item("",22.0,0.0,"left","alphabetic")]}));
    assert!(context(r.clone(), measurements(&r)).is_err());
}
