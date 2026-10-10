use super::{InkObjectParams, parse_ink_object_params_json, resolve_ink_object_params_json};

#[test]
fn complete_defaults_and_exact_fractional_values() {
    let p = parse_ink_object_params_json(r#"{"version":1}"#).unwrap();
    assert_eq!(p, InkObjectParams::default());
    let dto = serde_json::to_value(&p).unwrap();
    assert_eq!(dto.as_object().unwrap().len(), 8);
    assert_eq!(dto["contourWidth"], 2.0);
    assert_eq!(dto["seed"], 19);
    let p = parse_ink_object_params_json(
        r#"{"version":1,"contourWidth":8.125,"inkDensity":0.123456789012345,"paperTexture":-0.0}"#,
    )
    .unwrap();
    assert_eq!(p.contour_width, 8.125);
    assert_eq!(p.ink_density.to_bits(), 0.123456789012345f64.to_bits());
    assert_eq!(p.paper_texture.to_bits(), (-0.0f64).to_bits());
}

#[test]
fn ranges_reject_instead_of_clamp_and_accept_boundaries() {
    for (key, min, max) in [
        ("contourWidth", 0.0, 16.0),
        ("inkDensity", 0.0, 1.0),
        ("paperTexture", 0.0, 1.0),
        ("paperScale", 1.0, 256.0),
    ] {
        for value in [min, max] {
            let mut input = serde_json::json!({"version":1});
            input[key] = value.into();
            let result = parse_ink_object_params_json(&input.to_string()).unwrap();
            assert_eq!(serde_json::to_value(result).unwrap()[key], value);
        }
        for value in [min - 0.001, max + 0.001] {
            let mut input = serde_json::json!({"version":1});
            input[key] = value.into();
            assert_eq!(
                parse_ink_object_params_json(&input.to_string())
                    .unwrap_err()
                    .path,
                key
            );
        }
    }
}

#[test]
fn strict_json_and_seed_reject_unknown_time_types_duplicates() {
    for input in [
        "{}",
        "null",
        "[]",
        "{",
        r#"{"version":2}"#,
        r#"{"version":1.0}"#,
        r#"{"version":1,"version":1}"#,
        r#"{"version":1,"seed":0.5}"#,
        r#"{"version":1,"seed":-1}"#,
        r#"{"version":1,"seed":65536}"#,
        r#"{"version":1,"seed":19.0}"#,
        r#"{"version":1,"time":0}"#,
        r#"{"version":1,"modelId":"x"}"#,
        r#"{"version":1,"inkDensity":0,"inkDensity":1}"#,
    ] {
        assert!(parse_ink_object_params_json(input).is_err(), "{input}");
    }
    for key in [
        "contourWidth",
        "inkDensity",
        "paperTexture",
        "paperScale",
        "seed",
        "inkColor",
        "paperColor",
    ] {
        for value in ["null", "true", "[]", "{}"] {
            assert!(
                parse_ink_object_params_json(&format!(r#"{{"version":1,"{key}":{value}}}"#))
                    .is_err()
            );
        }
    }
    for seed in [0, 65535] {
        assert_eq!(
            parse_ink_object_params_json(&format!(r#"{{"version":1,"seed":{seed}}}"#))
                .unwrap()
                .seed,
            seed
        );
    }
}

#[test]
fn colors_are_exact_and_preserve_case() {
    for key in ["inkColor", "paperColor"] {
        for value in ["#Ab12CD", "#000000"] {
            let p = parse_ink_object_params_json(
                &serde_json::json!({"version":1, (key):value}).to_string(),
            )
            .unwrap();
            assert_eq!(serde_json::to_value(p).unwrap()[key], value);
        }
        for value in ["#fff", "#12345678", "#GG0000", "#１２３４５６", "white"] {
            assert_eq!(
                parse_ink_object_params_json(
                    &serde_json::json!({"version":1, (key):value}).to_string()
                )
                .unwrap_err()
                .path,
                key
            );
        }
    }
}

#[test]
fn typed_nonfinite_admission_and_resolver_failure_recovery() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for key in ["contourWidth", "inkDensity", "paperTexture", "paperScale"] {
            let mut p = InkObjectParams::default();
            match key {
                "contourWidth" => p.contour_width = value,
                "inkDensity" => p.ink_density = value,
                "paperTexture" => p.paper_texture = value,
                _ => p.paper_scale = value,
            }
            assert_eq!(p.validate().unwrap_err().path, key);
        }
    }
    let first = resolve_ink_object_params_json(r#"{"version":1}"#.into());
    let failure: serde_json::Value = serde_json::from_str(&resolve_ink_object_params_json(
        r#"{"version":1,"paperScale":0}"#.into(),
    ))
    .unwrap();
    assert_eq!(failure["ok"], false);
    assert_eq!(failure["error"]["path"], "paperScale");
    assert!(failure.get("params").is_none());
    let success: serde_json::Value = serde_json::from_str(&first).unwrap();
    assert_eq!(success["version"], 1);
    assert_eq!(success["ok"], true);
    assert_eq!(
        success["params"],
        serde_json::to_value(InkObjectParams::default()).unwrap()
    );
    assert_eq!(
        resolve_ink_object_params_json(r#"{"version":1}"#.into()),
        first
    );
}
