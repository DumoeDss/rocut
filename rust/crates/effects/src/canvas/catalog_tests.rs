use super::*;
use std::collections::{BTreeMap, BTreeSet};
use time::FrameRate;

fn defaults() -> BTreeMap<String, f64> {
    definition()
        .fields
        .into_iter()
        .filter(|field| field.required == Some(true))
        .map(|field| (field.key.into(), field.default))
        .collect()
}
fn with_stroke() -> BTreeMap<String, f64> {
    let mut p = defaults();
    p.insert("strokeCount".into(), 1.0);
    for field in definition()
        .fields
        .into_iter()
        .filter(|field| field.key.starts_with("stroke0"))
    {
        p.insert(field.key.into(), field.default);
    }
    p.insert("stroke0StartTicks".into(), 12001.0);
    p.insert("stroke0EndTicks".into(), 60000.0);
    p
}
#[test]
fn catalog_exact_static_fields_and_defaults_are_admissible() {
    let d = definition();
    assert_eq!(d.id, "canvas");
    assert_eq!(d.version, 1);
    assert!(d.animated);
    assert_eq!(d.fields.len(), 190);
    assert_eq!(
        d.fields
            .iter()
            .map(|f| f.key)
            .collect::<BTreeSet<_>>()
            .len(),
        190
    );
    assert!(d.fields.iter().all(|f| !f.keyframable));
    assert_eq!(
        d.fields.iter().filter(|f| f.required == Some(true)).count(),
        14
    );
    assert_eq!(
        d.fields
            .iter()
            .filter(|f| f.required == Some(false))
            .count(),
        176
    );
    for f in &d.fields {
        assert!(f.default.is_finite() && f.default >= f.min && f.default <= f.max);
    }
    let (c, s) = parse(&defaults()).unwrap();
    assert_eq!((c.columns, c.rows, c.duration_ticks), (32, 32, 120000));
    assert!(s.is_empty());
    let wire = serde_json::to_value(d).unwrap();
    assert_eq!(wire["fields"][0]["keyframable"], false);
    assert_eq!(wire["fields"][0]["required"], true);
}
#[test]
fn resolver_retains_every_original_field_and_exact_sampled_time() {
    let mut p = with_stroke();
    p.insert("strokeCount".into(), 2.0);
    for suffix in [
        "StartTicks",
        "EndTicks",
        "FromX",
        "FromY",
        "ToX",
        "ToY",
        "Radius",
        "Bristles",
        "Opacity",
        "Wetness",
        "Thickness",
    ] {
        p.insert(format!("stroke1{suffix}"), p[&format!("stroke0{suffix}")]);
    }
    let original = p.clone();
    let v = resolve(&p, 16000, FrameRate::FPS_30).unwrap();
    assert_eq!(v["version"], 1);
    assert_eq!(v["frameIndex"], 4);
    assert_eq!(v["passes"].as_array().unwrap().len(), 1);
    let pass = &v["passes"][0];
    assert_eq!(pass["shader"], "canvas");
    assert_eq!(pass["uniforms"].as_object().unwrap().len(), p.len() + 1);
    for (key, value) in &p {
        assert_eq!(
            pass["uniforms"][key],
            serde_json::json!(super::pass::encode(*value)),
            "{key}"
        );
    }
    assert_eq!(
        pass["uniforms"]["sampledTicks"],
        serde_json::json!(super::pass::encode(16000.0))
    );
    assert_eq!(p, original);
    let rational = resolve(&p, 16015, FrameRate::FPS_29_97).unwrap();
    assert_eq!(rational["frameIndex"], 3);
    assert_eq!(
        rational["passes"][0]["uniforms"]["sampledTicks"],
        serde_json::json!(super::pass::encode(12012.0))
    );
    let beyond = resolve(&p, 240000, FrameRate::FPS_30).unwrap();
    assert_eq!(
        beyond["passes"][0]["uniforms"]["sampledTicks"],
        serde_json::json!(super::pass::encode(240000.0))
    );
}
#[test]
fn negative_time_still_requires_full_schedule_and_safe_clock() {
    let p = with_stroke();
    let v = resolve(&p, -1, FrameRate::FPS_29_97).unwrap();
    assert_eq!(v["frameIndex"], -1);
    assert_eq!(v["passes"], serde_json::json!([]));
    for time in [-1, 16000] {
        let mut broken = p.clone();
        broken.remove("stroke0Wetness");
        assert!(resolve(&broken, time, FrameRate::FPS_30).is_err());
        assert!(resolve(&p, time, FrameRate::new(90, 1)).is_err());
        assert!(resolve(&p, time, FrameRate::new(0, 1)).is_err());
    }
    assert!(resolve(&p, i64::MIN, FrameRate::FPS_30).is_err());
    let mut broken = p.clone();
    broken.insert("stroke0Opacity".into(), 0.0);
    broken.remove("stroke0Wetness");
    assert!(resolve(&broken, -1, FrameRate::FPS_30).is_err());
}
#[test]
fn catalogue_bounds_and_native_cross_field_admission_never_clamp() {
    let p = with_stroke();
    for f in definition()
        .fields
        .into_iter()
        .filter(|f| p.contains_key(f.key))
    {
        for value in [f.min - 1.0, f.max + 1.0, f64::NAN] {
            let mut q = p.clone();
            q.insert(f.key.into(), value);
            assert!(validate_canvas_schedule(&q).is_err(), "{}={value}", f.key);
        }
        if f.step == 1.0 {
            let mut q = p.clone();
            q.insert(f.key.into(), f.default + 0.5);
            assert!(validate_canvas_schedule(&q).is_err());
        }
    }
    for key in p.keys() {
        let mut q = p.clone();
        q.remove(key);
        assert!(validate_canvas_schedule(&q).is_err(), "{key}");
    }
    for key in ["amount", "sampledTicks", "stroke1Radius", "stroke0Unknown"] {
        let mut q = p.clone();
        q.insert(key.into(), 0.1);
        assert!(validate_canvas_schedule(&q).is_err());
    }
    let mut q = p.clone();
    q.insert("stroke0EndTicks".into(), 12001.0);
    assert!(validate_canvas_schedule(&q).is_err());
    let mut q = p.clone();
    for key in ["lightX", "lightY", "lightZ"] {
        q.insert(key.into(), 0.0);
    }
    assert!(validate_canvas_schedule(&q).is_err());
    let mut q = p.clone();
    q.insert("columns".into(), 128.0);
    q.insert("rows".into(), 128.0);
    q.insert("durationTicks".into(), 7200000.0);
    q.insert("stroke0Bristles".into(), 32.0);
    assert!(validate_canvas_schedule(&q).is_err());
}

fn effect_pass(value: &serde_json::Value) -> crate::EffectPass {
    crate::EffectPass {
        shader: value["shader"].as_str().unwrap().into(),
        uniforms: value["uniforms"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| {
                let words = value
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_f64().unwrap() as f32)
                    .collect();
                (key.clone(), crate::UniformValue::Vector(words))
            })
            .collect(),
    }
}
fn active_pass(p: &BTreeMap<String, f64>) -> crate::EffectPass {
    effect_pass(&resolve(p, 16000, FrameRate::FPS_30).unwrap()["passes"][0])
}
#[test]
fn pass_transport_roundtrips_exact_f64_bits_and_safe_js_endpoint() {
    let mut p = with_stroke();
    p.insert("stroke0Opacity".into(), 0.500125);
    p.insert(
        "stroke0Radius".into(),
        f64::from_bits(0.15f64.to_bits() + 1),
    );
    p.insert("lightX".into(), -0.0);
    let pass = active_pass(&p);
    let decoded: CanvasPass = decode_pass(&pass).unwrap();
    for (key, value) in &p {
        assert_eq!(
            decoded.parameters()[key].to_bits(),
            value.to_bits(),
            "{key}"
        );
    }
    assert_eq!(decoded.sampled_ticks(), 16000);
    assert_eq!(decoded.strokes().len(), 1);
    assert_eq!(decoded.config().light[0].to_bits(), (-0.0f64).to_bits());
    assert_ne!((0.500125f64 as f32) as f64, 0.500125);
    let v = resolve(&p, 9007199254740991, FrameRate::new(120000, 1)).unwrap();
    let decoded = decode_pass(&effect_pass(&v["passes"][0])).unwrap();
    assert_eq!(decoded.sampled_ticks(), 9007199254740991);
}
#[test]
fn malformed_words_and_nonfinite_decoded_values_are_rejected() {
    let pass = active_pass(&with_stroke());
    for value in [
        crate::UniformValue::Number(1.0),
        crate::UniformValue::Vector(vec![]),
        crate::UniformValue::Vector(vec![0.0; 3]),
        crate::UniformValue::Vector(vec![0.0; 5]),
    ] {
        let mut bad = pass.clone();
        bad.uniforms.insert("version".into(), value);
        assert!(decode_pass(&bad).is_err());
    }
    for word in [f32::NAN, f32::INFINITY, -1.0, -0.0, 65536.0, 0.5] {
        for index in 0..4 {
            let mut bad = pass.clone();
            let mut words = super::pass::encode(1.0);
            words[index] = word;
            bad.uniforms.insert(
                "version".into(),
                crate::UniformValue::Vector(words.to_vec()),
            );
            assert!(decode_pass(&bad).is_err());
        }
    }
    for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut bad = pass.clone();
        bad.uniforms.insert(
            "drying".into(),
            crate::UniformValue::Vector(super::pass::encode(number).to_vec()),
        );
        assert!(decode_pass(&bad).is_err());
    }
}
#[test]
fn pass_schema_sourceflags_unknowns_and_unsafe_sampled_ticks_are_rejected() {
    let pass = active_pass(&with_stroke());
    for ticks in [-1.0, -0.0, 0.5, 9007199254740992.0, f64::MAX] {
        let mut bad = pass.clone();
        bad.uniforms.insert(
            "sampledTicks".into(),
            crate::UniformValue::Vector(super::pass::encode(ticks).to_vec()),
        );
        assert!(decode_pass(&bad).is_err());
    }
    for key in [
        "sourceFlags",
        "sourcePremultiplied",
        "amount",
        "unknown",
        "stroke1Radius",
    ] {
        let mut bad = pass.clone();
        bad.uniforms.insert(
            key.into(),
            crate::UniformValue::Vector(super::pass::encode(1.0).to_vec()),
        );
        assert!(decode_pass(&bad).is_err());
    }
    let mut bad = pass.clone();
    bad.shader = "frost".into();
    assert!(decode_pass(&bad).is_err());
    for key in pass.uniforms.keys() {
        let mut bad = pass.clone();
        bad.uniforms.remove(key);
        assert!(decode_pass(&bad).is_err(), "{key}");
    }
    let mut bad = pass.clone();
    for i in 0..192 {
        bad.uniforms
            .insert(format!("bad{i}"), crate::UniformValue::Number(0.0));
    }
    assert!(decode_pass(&bad).is_err());
}
#[test]
fn lossless_decoding_still_performs_full_native_cross_field_admission() {
    let pass = active_pass(&with_stroke());
    for (key, value) in [
        ("version", 2.0),
        ("stroke0EndTicks", 12001.0),
        ("stroke0Radius", 0.004),
        ("stroke0Bristles", 5.5),
        ("stroke0Opacity", 1.1),
        ("stroke0StartTicks", 9007199254740992.0),
    ] {
        let mut bad = pass.clone();
        bad.uniforms.insert(
            key.into(),
            crate::UniformValue::Vector(super::pass::encode(value).to_vec()),
        );
        assert!(decode_pass(&bad).is_err(), "{key}");
    }
}
