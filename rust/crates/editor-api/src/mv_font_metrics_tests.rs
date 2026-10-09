use super::*;
use serde_json::{Value, json};

fn resource() -> Value {
    json!({"id":"font", "kind":"font", "attachmentKey":"fonts/example.ttf",
        "mimeType":"font/ttf", "byteLength":123, "sha256":"a".repeat(64),
        "font":{"family":"Fixture","style":"italic","weight":500,"axes":{"wght":550}}})
}
fn request() -> Vec<Request> {
    serde_json::from_value(json!([{"resource":resource(), "glyphs":["A"," "]}])).unwrap()
}
fn measured() -> Value {
    json!([{"resource":resource(), "glyphs":[
        {"text":"A","left":-2.0,"right":62.0,"ascent":55.0,"descent":-3.0},
        {"text":" ","left":0,"right":0,"ascent":0,"descent":0}
    ]}])
}
fn parse(value: Value) -> Vec<Measurement> {
    serde_json::from_value(value).unwrap()
}

#[test]
fn accepts_signed_extents_and_zero_ink_without_normalizing() {
    let context = Context::new(&request(), &parse(measured())).unwrap();
    let a = context.glyph("font", "A").unwrap();
    assert_eq!(
        (a.left, a.right, a.ascent, a.descent),
        (-2.0, 62.0, 55.0, -3.0)
    );
    assert_eq!(context.glyph("font", " ").unwrap().right, 0.0);
    assert!(context.glyph("font", "B").is_err());
    assert!(Context::new(&[], &[]).is_ok());
}

#[test]
fn binds_every_font_identity_field_and_rejects_missing_extra_duplicates() {
    for (key, value) in [
        ("sha256", json!("b".repeat(64))),
        ("id", json!("other")),
        ("attachmentKey", json!("other.ttf")),
        ("mimeType", json!("font/otf")),
        ("byteLength", json!(124)),
        ("kind", json!("image")),
    ] {
        let mut m = measured();
        m[0]["resource"][key] = value;
        assert!(Context::new(&request(), &parse(m)).is_err(), "{key}");
    }
    for (key, value) in [
        ("family", json!("Other")),
        ("style", json!("normal")),
        ("weight", json!(400)),
        ("axes", json!({"wght":551})),
    ] {
        let mut m = measured();
        m[0]["resource"]["font"][key] = value;
        assert!(Context::new(&request(), &parse(m)).is_err(), "{key}");
    }
    assert!(Context::new(&request(), &[]).is_err());
    let mut m = parse(measured());
    m.extend(parse(measured()));
    assert!(Context::new(&request(), &m).is_err());
    for text in ["A", "B", "AA", ""] {
        let mut m = measured();
        m[0]["glyphs"][1]["text"] = json!(text);
        assert!(Context::new(&request(), &parse(m)).is_err(), "{text}");
    }
    let mut m = measured();
    m[0]["glyphs"].as_array_mut().unwrap().pop();
    assert!(Context::new(&request(), &parse(m)).is_err());
}

#[test]
fn rejects_nonfinite_unbounded_and_negative_total_ink() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 4096.01, -63.0] {
        let mut m = parse(measured());
        m[0].glyphs[0].left = value;
        assert!(Context::new(&request(), &m).is_err());
    }
    let mut m = parse(measured());
    m[0].glyphs[0].descent = -56.0;
    assert!(Context::new(&request(), &m).is_err());
}

#[test]
fn rejects_ambiguous_requests_and_unknown_fields() {
    let mut r = request();
    r[0].glyphs[1] = "A".into();
    assert!(Context::new(&r, &parse(measured())).is_err());
    for invalid in ["", "AB", "a\u{0301}"] {
        let mut r = request();
        r[0].glyphs[0] = invalid.into();
        assert!(Context::new(&r, &parse(measured())).is_err());
    }
    let mut r = request();
    r[0].glyphs = vec!["A".into(); MAX_GLYPHS + 1];
    assert!(Context::new(&r, &parse(measured())).is_err());
    let mut m = measured();
    m[0]["glyphs"][0]["advance"] = json!(123);
    assert!(serde_json::from_value::<Vec<Measurement>>(m).is_err());
}
