use super::{bounds_test_support::*, *};
use serde_json::{Value, json};

#[test]
fn legacy_and_mixed_metrics_stay_unchanged_without_scaling_or_fallback() {
    let legacy = json!({"resource":resource("font"),"glyphs":["A"]});
    let r: Request = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(serde_json::to_value(r).unwrap(), legacy);
    let mut r = request();
    let c = context(r.clone(), measurements(&r)).unwrap();
    assert_eq!(c.glyph("font", "A").unwrap().right, 3.0);
    assert_eq!(c.advance("font", "AV", 22.0, 0.0).unwrap(), 13.125);
    let exact = lookup(&c, "font", r[0]["bounds"][1].clone()).unwrap();
    let native_request = BoundsRequest {
        version: 1,
        text: "残".into(),
        font_size_px: 1000.0,
        letter_spacing_px: 0.0,
        align: TextAlign::Left,
        baseline: TextBaseline::Alphabetic,
    };
    assert_eq!(c.bounds("font", &native_request).unwrap().right, exact.right);
    assert_eq!(
        (exact.left, exact.right, exact.ascent, exact.descent),
        (-2.0, 52.0, 80.0, -3.0)
    );
    assert!(lookup(&c, "font", item("残", 100.0, 0.0, "left", "alphabetic")).is_err());
    assert!(lookup(&c, "font", item("A", 100.0, 0.0, "center", "middle")).is_err());
    assert!(c.glyph("font", "残").is_err());
    r[0]["bounds"]
        .as_array_mut()
        .unwrap()
        .push(item("残", 100.0, 0.0, "left", "alphabetic"));
    let mut m = measurements(&r);
    m[0]["bounds"][3]["right"] = json!(5.25);
    let c = context(r.clone(), m).unwrap();
    assert_eq!(
        lookup(&c, "font", r[0]["bounds"][3].clone()).unwrap().right,
        5.25
    );
    assert_eq!(
        lookup(&c, "font", r[0]["bounds"][1].clone()).unwrap().right,
        52.0
    );
    r[0]["glyphs"] = json!([]);
    r[0]["advances"] = json!([]);
    assert!(context(r.clone(), measurements(&r)).is_ok());
    r[0]["bounds"] = json!([]);
    assert!(context(r.clone(), measurements(&r)).is_err());
}

#[test]
fn every_key_field_is_exact_and_all_physical_alignments_and_baselines_are_distinct() {
    let r = request();
    for (field, value) in [
        ("version", json!(2)),
        ("text", json!("光")),
        ("fontSizePx", json!(999)),
        ("letterSpacingPx", json!(0.25)),
        ("align", json!("right")),
        ("baseline", json!("top")),
    ] {
        let mut m = measurements(&r);
        m[0]["bounds"][1][field] = value;
        assert!(context(r.clone(), m).is_err(), "{field}");
    }
    let mut r = r;
    let mut all = Vec::new();
    for align in ["left", "center", "right"] {
        for baseline in [
            "top",
            "hanging",
            "middle",
            "alphabetic",
            "ideographic",
            "bottom",
        ] {
            all.push(item("AV", 22.0, 0.0, align, baseline));
        }
    }
    r[0]["bounds"] = json!(all);
    let c = context(r.clone(), measurements(&r)).unwrap();
    for a in r[0]["bounds"].as_array().unwrap() {
        assert!(lookup(&c, "font", a.clone()).is_ok());
    }
    assert!(lookup(&c, "other", r[0]["bounds"][0].clone()).is_err());
}

#[test]
fn rejects_missing_extra_duplicate_and_unrequested_facts_but_not_reordering() {
    let r = request();
    let base = measurements(&r);
    let mut cases = vec![base.clone(); 5];
    cases[0][0]["bounds"].as_array_mut().unwrap().pop();
    cases[1][0]["bounds"]
        .as_array_mut()
        .unwrap()
        .push(base[0]["bounds"][0].clone());
    cases[2][0]["bounds"][1] = base[0]["bounds"][0].clone();
    cases[3][0].as_object_mut().unwrap().remove("bounds");
    cases[4][0]["bounds"][1]["text"] = json!("not requested");
    for m in cases {
        assert!(context(r.clone(), m).is_err());
    }
    let mut m = base;
    m[0]["bounds"].as_array_mut().unwrap().reverse();
    assert!(context(r.clone(), m).is_ok());
    let mut duplicate = r.clone();
    duplicate[0]["bounds"][1] = duplicate[0]["bounds"][0].clone();
    assert!(context(duplicate.clone(), measurements(&duplicate)).is_err());
    let mut unrequested = r.clone();
    unrequested[0].as_object_mut().unwrap().remove("bounds");
    assert!(context(unrequested, measurements(&r)).is_err());
}

#[test]
fn exact_bounds_bind_every_resource_identity_field() {
    let mut r = request();
    r[0]["glyphs"] = json!([]);
    r[0]["advances"] = json!([]);
    for (path, value) in [
        ("/resource/id", json!("other")),
        ("/resource/kind", json!("image")),
        ("/resource/attachmentKey", json!("other.ttf")),
        ("/resource/mimeType", json!("font/otf")),
        ("/resource/byteLength", json!(124)),
        ("/resource/sha256", json!("b".repeat(64))),
        ("/resource/font/family", json!("Other")),
        ("/resource/font/style", json!("normal")),
        ("/resource/font/weight", json!(400)),
        ("/resource/font/axes/TEST", json!(551)),
    ] {
        let mut m = measurements(&r);
        *m[0].pointer_mut(path).unwrap() = value;
        assert!(context(r.clone(), m).is_err(), "{path}");
    }
    let m = measurements(&r);
    assert!(context(r.clone(), json!([])).is_err());
    assert!(context(r.clone(), json!([m[0], m[0]])).is_err());
    assert!(context(json!([r[0], r[0]]), json!([m[0], m[0]])).is_err());
}

#[test]
fn zero_tracking_has_one_key_while_unicode_and_whole_strings_remain_exact() {
    let mut r = request();
    r[0]["bounds"][1]["letterSpacingPx"] = json!(-0.0);
    let c = context(r.clone(), measurements(&r)).unwrap();
    assert!(lookup(&c, "font", item("残", 1000.0, 0.0, "left", "alphabetic")).is_ok());
    let mut duplicate = r[0]["bounds"][1].clone();
    duplicate["letterSpacingPx"] = json!(0.0);
    r[0]["bounds"].as_array_mut().unwrap().push(duplicate);
    assert!(context(r.clone(), measurements(&r)).is_err());
    r[0]["bounds"] = json!([
        item("á", 22.0, 0.0, "left", "alphabetic"),
        item("a\u{0301}", 22.0, 0.0, "left", "alphabetic"),
        item("AV", 22.0, 0.0, "left", "alphabetic"),
        item("😀a\u{0301}", 22.0, 0.0, "left", "alphabetic")
    ]);
    assert!(context(r.clone(), measurements(&r)).is_ok());
}

#[test]
fn null_unknown_missing_and_invalid_shape_fields_are_not_defaults() {
    let r = request();
    let m = measurements(&r);
    for field in [
        "version",
        "text",
        "fontSizePx",
        "letterSpacingPx",
        "align",
        "baseline",
    ] {
        let mut missing = r.clone();
        missing[0]["bounds"][1]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(
            serde_json::from_value::<Vec<Request>>(missing).is_err(),
            "{field}"
        );
        let mut null = r.clone();
        null[0]["bounds"][1][field] = Value::Null;
        assert!(
            serde_json::from_value::<Vec<Request>>(null).is_err(),
            "{field}"
        );
    }
    for field in [
        "version",
        "text",
        "fontSizePx",
        "letterSpacingPx",
        "align",
        "baseline",
        "left",
        "right",
        "ascent",
        "descent",
    ] {
        let mut missing = m.clone();
        missing[0]["bounds"][1]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(
            serde_json::from_value::<Vec<Measurement>>(missing).is_err(),
            "{field}"
        );
        let mut null = m.clone();
        null[0]["bounds"][1][field] = Value::Null;
        assert!(
            serde_json::from_value::<Vec<Measurement>>(null).is_err(),
            "{field}"
        );
    }
    for (field, value) in [
        ("align", json!("start")),
        ("align", json!("end")),
        ("baseline", json!("auto")),
        ("version", json!(1.5)),
        ("version", json!(256)),
        ("extra", json!(true)),
    ] {
        let mut input = r.clone();
        input[0]["bounds"][1][field] = value.clone();
        assert!(
            serde_json::from_value::<Vec<Request>>(input).is_err(),
            "{field}"
        );
        let mut input = m.clone();
        input[0]["bounds"][1][field] = value;
        assert!(
            serde_json::from_value::<Vec<Measurement>>(input).is_err(),
            "{field}"
        );
    }
    let mut input = r.clone();
    input[0]["bounds"] = Value::Null;
    assert!(serde_json::from_value::<Vec<Request>>(input).is_err());
    let mut input = m.clone();
    input[0]["bounds"] = Value::Null;
    assert!(serde_json::from_value::<Vec<Measurement>>(input).is_err());
    let malformed = r.to_string().replacen("😀", "\\ud800", 1);
    assert!(serde_json::from_str::<Vec<Request>>(&malformed).is_err());
    let malformed = m.to_string().replacen("😀", "\\ud800", 1);
    assert!(serde_json::from_str::<Vec<Measurement>>(&malformed).is_err());
}
