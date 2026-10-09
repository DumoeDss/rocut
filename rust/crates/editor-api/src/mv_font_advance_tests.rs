use super::*;
use serde_json::{Value, json};

fn resource(id: &str) -> Value {
    json!({"id":id,"kind":"font","attachmentKey":"fonts/advance.ttf",
        "mimeType":"font/ttf","byteLength":123,"sha256":"a".repeat(64),
        "font":{"family":"Advance","style":"italic","weight":400,"axes":{"TEST":550.0}}})
}

fn item(text: &str, size: f64, spacing: f64) -> Value {
    json!({"text":text,"fontSizePx":size,"letterSpacingPx":spacing})
}

fn request_value() -> Value {
    json!([{"resource":resource("font"),"glyphs":["A"],"advances":[
        item("",22.0,0.0), item("A",22.0,0.0), item("AV",22.0,0.0),
        item("😀a\u{0301}",18.0,1.25), item("AV",18.0,-1.0)
    ]}])
}

fn measurements(r: &Value) -> Value {
    Value::Array(
        r.as_array()
            .unwrap()
            .iter()
            .map(|font| {
                let glyphs: Vec<_> = font["glyphs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|text| json!({"text":text,"left":2,"right":3,"ascent":4,"descent":1}))
                    .collect();
                let advances: Vec<_> = font["advances"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|a| {
                        let mut a = a.clone();
                        a["width"] = if a["text"] == "" {
                            json!(0)
                        } else {
                            json!(13.125)
                        };
                        a
                    })
                    .collect();
                json!({"resource":font["resource"],"glyphs":glyphs,"advances":advances})
            })
            .collect(),
    )
}

fn context(r: Value, m: Value) -> Result<Context, String> {
    let requests = serde_json::from_value::<Vec<Request>>(r).map_err(|e| e.to_string())?;
    let measured = serde_json::from_value::<Vec<Measurement>>(m).map_err(|e| e.to_string())?;
    Context::new(&requests, &measured)
}

#[test]
fn preserves_legacy_shape_and_supports_mixed_and_advance_only_facts() {
    let legacy = json!({"resource":resource("font"),"glyphs":["A"]});
    let r: Request = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(serde_json::to_value(r).unwrap(), legacy);
    let mut r = request_value();
    let c = context(r.clone(), measurements(&r)).unwrap();
    assert_eq!(c.glyph("font", "A").unwrap().right, 3.0);
    assert_eq!(c.advance("font", "", 22.0, 0.0).unwrap(), 0.0);
    assert_eq!(c.advance("font", "AV", 22.0, 0.0).unwrap(), 13.125);
    assert_eq!(
        c.advance("font", "😀a\u{0301}", 18.0, 1.25).unwrap(),
        13.125
    );
    for (text, size, spacing) in [("AV", 23.0, 0.0), ("AV", 22.0, 1.0), ("V", 22.0, 0.0)] {
        assert!(c.advance("font", text, size, spacing).is_err());
    }
    assert!(c.advance("other", "AV", 22.0, 0.0).is_err());
    r[0]["glyphs"] = json!([]);
    assert!(context(r.clone(), measurements(&r)).is_ok());
    r[0]["advances"] = json!([]);
    assert!(context(r.clone(), measurements(&r)).is_err());
}

#[test]
fn rejects_missing_extra_duplicate_and_changed_advance_keys() {
    let r = request_value();
    for (field, value) in [
        ("text", json!("VA")),
        ("fontSizePx", json!(23)),
        ("letterSpacingPx", json!(1)),
    ] {
        let mut m = measurements(&r);
        m[0]["advances"][2][field] = value;
        assert!(context(r.clone(), m).is_err(), "{field}");
    }
    let base = measurements(&r);
    let mut cases = vec![base.clone(); 4];
    cases[0][0]["advances"].as_array_mut().unwrap().pop();
    cases[1][0]["advances"]
        .as_array_mut()
        .unwrap()
        .push(base[0]["advances"][0].clone());
    cases[2][0]["advances"][1] = base[0]["advances"][0].clone();
    cases[3][0].as_object_mut().unwrap().remove("advances");
    for m in cases {
        assert!(context(r.clone(), m).is_err());
    }
    let mut reordered = base;
    reordered[0]["advances"].as_array_mut().unwrap().reverse();
    assert!(context(r.clone(), reordered).is_ok());
    let mut duplicated = r.clone();
    duplicated[0]["advances"][1] = duplicated[0]["advances"][0].clone();
    assert!(context(duplicated.clone(), measurements(&duplicated)).is_err());
}

#[test]
fn binds_all_font_identity_fields_for_advance_only_measurements() {
    let mut r = request_value();
    r[0]["glyphs"] = json!([]);
    for (path, value) in [
        ("/resource/id", json!("other")),
        ("/resource/kind", json!("image")),
        ("/resource/attachmentKey", json!("other.ttf")),
        ("/resource/mimeType", json!("font/otf")),
        ("/resource/byteLength", json!(124)),
        ("/resource/sha256", json!("b".repeat(64))),
        ("/resource/font/family", json!("Other")),
        ("/resource/font/style", json!("normal")),
        ("/resource/font/weight", json!(500)),
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
fn rejects_null_unknown_malformed_and_incomplete_unicode() {
    let r = request_value();
    for path in [
        "/advances",
        "/advances/0",
        "/advances/0/text",
        "/advances/0/fontSizePx",
        "/advances/0/letterSpacingPx",
    ] {
        let mut input = r.clone();
        *input[0].pointer_mut(path).unwrap() = Value::Null;
        assert!(
            serde_json::from_value::<Vec<Request>>(input).is_err(),
            "{path}"
        );
    }
    for path in [
        "/advances",
        "/advances/0",
        "/advances/0/text",
        "/advances/0/fontSizePx",
        "/advances/0/letterSpacingPx",
        "/advances/0/width",
    ] {
        let mut m = measurements(&r);
        *m[0].pointer_mut(path).unwrap() = Value::Null;
        assert!(
            serde_json::from_value::<Vec<Measurement>>(m).is_err(),
            "{path}"
        );
    }
    let mut unknown = r.clone();
    unknown[0]["advances"][0]["prefixLength"] = json!(1);
    assert!(serde_json::from_value::<Vec<Request>>(unknown).is_err());
    let mut unknown = measurements(&r);
    unknown[0]["advances"][0]["ink"] = json!(1);
    assert!(serde_json::from_value::<Vec<Measurement>>(unknown).is_err());
    let invalid = r.to_string().replacen("😀", "\\ud800", 1);
    assert!(serde_json::from_str::<Vec<Request>>(&invalid).is_err());
}

#[test]
fn rejects_nonfinite_or_out_of_range_inputs_and_nonzero_empty_advance() {
    let r = request_value();
    for value in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -1.0,
        0.0,
        4096.01,
    ] {
        let mut requests: Vec<Request> = serde_json::from_value(r.clone()).unwrap();
        requests[0].advances[0].font_size_px = value;
        let m: Vec<Measurement> = serde_json::from_value(measurements(&r)).unwrap();
        assert!(Context::new(&requests, &m).is_err());
    }
    for value in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -4096.01,
        4096.01,
    ] {
        let mut requests: Vec<Request> = serde_json::from_value(r.clone()).unwrap();
        requests[0].advances[0].letter_spacing_px = value;
        let m: Vec<Measurement> = serde_json::from_value(measurements(&r)).unwrap();
        assert!(Context::new(&requests, &m).is_err());
    }
    for value in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        16777216.01,
        -16777216.01,
    ] {
        let requests: Vec<Request> = serde_json::from_value(r.clone()).unwrap();
        let mut m: Vec<Measurement> = serde_json::from_value(measurements(&r)).unwrap();
        m[0].advances[1].width = value;
        assert!(Context::new(&requests, &m).is_err());
    }
    for value in [1.0, -1.0, f64::EPSILON] {
        let mut m = measurements(&r);
        m[0]["advances"][0]["width"] = json!(value);
        assert!(context(r.clone(), m).is_err());
    }
    let mut m = measurements(&r);
    m[0]["advances"][4]["width"] = json!(-2.5);
    assert_eq!(
        context(r, m)
            .unwrap()
            .advance("font", "AV", 18.0, -1.0)
            .unwrap(),
        -2.5
    );
}

#[test]
fn zero_tracking_has_one_identity_and_unicode_is_not_normalized() {
    let mut r = request_value();
    r[0]["advances"][0]["letterSpacingPx"] = json!(-0.0);
    let c = context(r.clone(), measurements(&r)).unwrap();
    assert_eq!(c.advance("font", "", 22.0, 0.0).unwrap(), 0.0);
    let mut duplicate = r[0]["advances"][0].clone();
    duplicate["letterSpacingPx"] = json!(0.0);
    r[0]["advances"].as_array_mut().unwrap().push(duplicate);
    assert!(context(r.clone(), measurements(&r)).is_err());
    r[0]["advances"] = json!([item("á", 22.0, 0.0), item("a\u{0301}", 22.0, 0.0)]);
    assert!(context(r.clone(), measurements(&r)).is_ok());
}

#[test]
fn rejects_missing_fields_and_nonfinite_measured_keys_and_accepts_exact_bounds() {
    let r = request_value();
    for field in ["text", "fontSizePx", "letterSpacingPx"] {
        let mut missing = r.clone();
        missing[0]["advances"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(serde_json::from_value::<Vec<Request>>(missing).is_err());
    }
    for field in ["text", "fontSizePx", "letterSpacingPx", "width"] {
        let mut missing = measurements(&r);
        missing[0]["advances"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(serde_json::from_value::<Vec<Measurement>>(missing).is_err());
    }
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let requests: Vec<Request> = serde_json::from_value(r.clone()).unwrap();
        let mut m: Vec<Measurement> = serde_json::from_value(measurements(&r)).unwrap();
        m[0].advances[0].font_size_px = value;
        assert!(Context::new(&requests, &m).is_err());
        m[0].advances[0].font_size_px = 22.0;
        m[0].advances[0].letter_spacing_px = value;
        assert!(Context::new(&requests, &m).is_err());
    }
    let mut r = r;
    r[0]["advances"] = json!([item("A", 4096.0, 4096.0), item("A", 4096.0, -4096.0)]);
    let mut m = measurements(&r);
    m[0]["advances"][0]["width"] = json!(16777216.0);
    m[0]["advances"][1]["width"] = json!(-16777216.0);
    let c = context(r, m).unwrap();
    assert_eq!(c.advance("font", "A", 4096.0, 4096.0).unwrap(), 16777216.0);
    assert_eq!(
        c.advance("font", "A", 4096.0, -4096.0).unwrap(),
        -16777216.0
    );
}

#[test]
fn applies_item_and_unicode_budgets_globally_not_per_font() {
    let advances: Vec<_> = (1..=1024).map(|n| item("A", n as f64, 0.0)).collect();
    let glyphs: Vec<_> = (0..1024)
        .map(|n| char::from_u32(0x4e00 + n).unwrap().to_string())
        .collect();
    let mut r = json!([{"resource":resource("font"),"glyphs":glyphs,"advances":advances}]);
    assert!(context(r.clone(), measurements(&r)).is_ok());
    r.as_array_mut()
        .unwrap()
        .push(json!({"resource":resource("other"),"glyphs":[],"advances":[item("B",22.0,0.0)]}));
    assert!(context(r.clone(), measurements(&r)).is_err());
    r[1]["advances"] = json!([]);
    r[1]["glyphs"] = json!(["B"]);
    assert!(context(r.clone(), measurements(&r)).is_err());
    let advances: Vec<_> = (0..64)
        .map(|n| item(&"😀".repeat(1024), 22.0, n as f64))
        .collect();
    r = json!([{"resource":resource("font"),"glyphs":[],"advances":advances}]);
    assert!(context(r.clone(), measurements(&r)).is_ok());
    r.as_array_mut()
        .unwrap()
        .push(json!({"resource":resource("other"),"glyphs":[],"advances":[item("A",22.0,0.0)]}));
    assert!(context(r.clone(), measurements(&r)).is_err());
    r = request_value();
    r[0]["advances"][0]["text"] = json!("😀".repeat(1025));
    assert!(context(r.clone(), measurements(&r)).is_err());
    let fonts: Vec<_> = (0..64).map(|n|json!({"resource":resource(&format!("font{n}")),"glyphs":[],"advances":[item("",22.0,0.0)]})).collect();
    r = json!(fonts);
    assert!(context(r.clone(), measurements(&r)).is_ok());
    r.as_array_mut()
        .unwrap()
        .push(json!({"resource":resource("overflow"),"glyphs":[],"advances":[item("",22.0,0.0)]}));
    assert!(context(r.clone(), measurements(&r)).is_err());
}
