use super::{GlassObjectParams, parse_glass_object_params_json, resolve_glass_object_params_json};

#[test]
fn defaults_are_complete_versioned_three_material_values() {
    let params = parse_glass_object_params_json(r#"{"version":1}"#).unwrap();
    assert_eq!(params, GlassObjectParams::default());
    assert_eq!(
        serde_json::to_value(&params).unwrap(),
        serde_json::json!({
            "version": 1, "transmission": 1.0, "ior": 1.5, "thickness": 0.5,
            "roughness": 0.1, "dispersion": 0.0, "attenuationDistance": 1000.0,
            "environmentIntensity": 1.0, "color": "#ffffff"
        })
    );
}

#[test]
fn finite_boundaries_and_fractional_coefficients_are_not_clamped_or_quantized() {
    for (key, minimum, maximum) in [
        ("transmission", 0.0, 1.0),
        ("ior", 1.0, 2.333),
        ("thickness", 0.0, 64.0),
        ("roughness", 0.0, 1.0),
        ("dispersion", 0.0, 1.0),
        ("attenuationDistance", 0.001, 1_000_000.0),
        ("environmentIntensity", 0.0, 16.0),
    ] {
        for value in [minimum, maximum] {
            let mut input = serde_json::json!({ "version": 1 });
            input[key] = value.into();
            let params = parse_glass_object_params_json(&input.to_string()).unwrap();
            assert_eq!(
                serde_json::to_value(params).unwrap()[key].as_f64().unwrap(),
                value
            );
        }
        for value in [minimum - 0.00001, maximum + 0.00001] {
            let mut input = serde_json::json!({ "version": 1 });
            input[key] = value.into();
            assert_eq!(
                parse_glass_object_params_json(&input.to_string())
                    .unwrap_err()
                    .path,
                key
            );
        }
    }
    let precise: f64 = 0.123456789012345;
    let params =
        parse_glass_object_params_json(&format!(r#"{{"version":1,"roughness":{precise}}}"#))
            .unwrap();
    assert_eq!(params.roughness.to_bits(), precise.to_bits());
    let negative_zero =
        parse_glass_object_params_json(r#"{"version":1,"transmission":-0.0}"#).unwrap();
    assert_eq!(negative_zero.transmission.to_bits(), (-0.0f64).to_bits());
}

#[test]
fn unknown_fields_duplicates_types_and_unversioned_inputs_are_rejected() {
    for input in [
        r#"{}"#,
        r#"{"version":0}"#,
        r#"{"version":2}"#,
        r#"{"version":1.0}"#,
        r#"{"version":"1"}"#,
        r#"{"version":1,"version":1}"#,
        r#"{"version":1,"roughness":0,"roughness":1}"#,
        r#"{"version":1,"scene":{}}"#,
        r#"{"version":1,"frameTime":0}"#,
        r#"{"version":1,"model":"x"}"#,
        r#"{"version":1,"resources":[]}"#,
        "[]",
        "null",
        "1",
        "{",
        r#"{"version":1,"roughness":NaN}"#,
        r#"{"version":1,"roughness":1e999}"#,
    ] {
        assert!(parse_glass_object_params_json(input).is_err(), "{input}");
    }
    for key in [
        "transmission",
        "ior",
        "thickness",
        "roughness",
        "dispersion",
        "attenuationDistance",
        "environmentIntensity",
        "color",
    ] {
        for value in ["null", "true", "[]", "{}"] {
            assert!(
                parse_glass_object_params_json(&format!(r#"{{"version":1,"{key}":{value}}}"#))
                    .is_err()
            );
        }
        if key != "color" {
            assert!(
                parse_glass_object_params_json(&format!(r#"{{"version":1,"{key}":"1"}}"#)).is_err()
            );
        }
    }
}

#[test]
fn color_is_exact_six_ascii_hex_digits_and_preserves_authored_case() {
    for color in ["#ffffff", "#000000", "#Ab12CD"] {
        let input = serde_json::json!({ "version": 1, "color": color });
        assert_eq!(
            parse_glass_object_params_json(&input.to_string())
                .unwrap()
                .color,
            color
        );
    }
    for color in [
        "",
        "white",
        "ffffff",
        "#fff",
        "#ffffffff",
        "#GG0000",
        "#12345 ",
        "#１２３４５６",
        " #ffffff",
    ] {
        let input = serde_json::json!({ "version": 1, "color": color });
        assert_eq!(
            parse_glass_object_params_json(&input.to_string())
                .unwrap_err()
                .path,
            "color"
        );
    }
}

#[test]
fn typed_validation_rejects_nonfinite_values_before_renderer_serialization() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for key in [
            "transmission",
            "ior",
            "thickness",
            "roughness",
            "dispersion",
            "attenuationDistance",
            "environmentIntensity",
        ] {
            let mut params = GlassObjectParams::default();
            match key {
                "transmission" => params.transmission = value,
                "ior" => params.ior = value,
                "thickness" => params.thickness = value,
                "roughness" => params.roughness = value,
                "dispersion" => params.dispersion = value,
                "attenuationDistance" => params.attenuation_distance = value,
                _ => params.environment_intensity = value,
            }
            assert_eq!(params.validate().unwrap_err().path, key);
        }
    }
}

#[test]
fn json_adapter_returns_complete_success_or_structured_failure_and_recovers() {
    let success = resolve_glass_object_params_json(r#"{"version":1}"#.into());
    let value: serde_json::Value = serde_json::from_str(&success).unwrap();
    assert_eq!(value["version"], 1);
    assert_eq!(value["ok"], true);
    assert_eq!(
        value["params"],
        serde_json::to_value(GlassObjectParams::default()).unwrap()
    );
    let failure: serde_json::Value = serde_json::from_str(&resolve_glass_object_params_json(
        r#"{"version":1,"ior":0}"#.into(),
    ))
    .unwrap();
    assert_eq!(failure["ok"], false);
    assert_eq!(failure["error"]["path"], "ior");
    assert!(failure.get("params").is_none());
    assert_eq!(
        resolve_glass_object_params_json(r#"{"version":1}"#.into()),
        success
    );
}
