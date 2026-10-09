use effects::{resolve_stylized_effect_json, stylized_effect_catalog_json};
use serde_json::{Value, json};

fn resolve(kind: &str, params: Value, ticks: i64) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType":kind, "params":params, "localTime":ticks,
            "frameRate":{"numerator":24000,"denominator":1001}
        })
        .to_string(),
    ))
    .unwrap()
}

#[test]
fn lens_catalog_exposes_keyframable_geometry_and_optics() {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    let lens = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == "lens")
        .expect("native lens definition");
    for key in [
        "centerX",
        "centerY",
        "radius",
        "feather",
        "zoom",
        "refraction",
        "dispersion",
    ] {
        let field = lens["fields"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["key"] == key)
            .unwrap();
        assert_eq!(field["keyframable"], true, "{key}");
    }
    let result = resolve("lens", json!({}), 0);
    assert_eq!(
        result["passes"][0]["uniforms"],
        json!({
            "amount":1.0,"zoom":2.0,"refraction":0.0,"dispersion":0.0,
            "centerX":0.5,"centerY":0.5,"radius":0.25,"feather":0.15,"frame":0.0
        })
    );
    assert_eq!(resolve("lens", json!({"amount":0}), 0)["passes"], json!([]));
}

#[test]
fn magnify_adds_explicit_hud_and_pulse_controls_without_a_wall_clock() {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    let fields = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "magnify")
        .unwrap()["fields"]
        .as_array()
        .unwrap();
    assert_eq!(fields.len(), 11);
    for key in ["hud", "pulse", "lineWidth"] {
        assert_eq!(
            fields.iter().find(|f| f["key"] == key).unwrap()["keyframable"],
            true
        );
    }
    let expected = resolve("magnify", json!({"hud":0.5,"pulse":0.25}), 0)["passes"].clone();
    for time in [75075, -1, 240000, 0] {
        assert_eq!(
            resolve("magnify", json!({"hud":0.5,"pulse":0.25}), time)["passes"],
            expected
        );
    }
    assert_eq!(
        resolve("magnify", json!({"amount":0}), 0)["passes"],
        json!([])
    );
    assert_eq!(
        resolve("magnify", json!({"pulse":3,"lineWidth":0.1}), 0)["passes"][0]["uniforms"]["pulse"],
        1.0
    );
    assert_eq!(
        resolve("magnify", json!({"pulse":3,"lineWidth":0.1}), 0)["passes"][0]["uniforms"]["lineWidth"],
        0.5
    );
    assert!(resolve("magnify", json!({"pulse":"click"}), 0)["error"].is_string());
}

#[test]
fn local_styling_is_opt_in_and_does_not_change_existing_defaults() {
    for kind in ["ascii", "retro-dither"] {
        let base = resolve(kind, json!({}), 0);
        assert_eq!(base["passes"][0]["uniforms"]["local"], 0.0);
        let local = resolve(
            kind,
            json!({"local":1,"centerX":0.2,"centerY":0.8,"radius":0.3}),
            -1,
        );
        assert_eq!(local["passes"][0]["uniforms"]["local"], 1.0);
        assert_eq!(local["passes"][0]["uniforms"]["centerX"], 0.2);
        assert_eq!(local["passes"][0]["uniforms"]["radius"], 0.3);
    }
    // A raw time value never implicitly moves the lens. Explicit keyframe
    // sampling supplies positions before normalization, independent of seek order.
    let p = json!({"centerX":0.333,"centerY":0.7,"zoom":1.125,"refraction":0.25});
    let expected = resolve("lens", p.clone(), 75075)["passes"].clone();
    for ticks in [0, 75075, -1, 900900, 75075] {
        assert_eq!(resolve("lens", p.clone(), ticks)["passes"], expected);
    }
}

#[test]
fn only_additive_ascii_and_dither_region_fields_are_optional() {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    let mut optional_count = 0;
    for entry in catalog.as_array().unwrap() {
        for field in entry["fields"].as_array().unwrap() {
            let optional = matches!(entry["id"].as_str(), Some("ascii" | "retro-dither"))
                && matches!(
                    field["key"].as_str(),
                    Some("local" | "centerX" | "centerY" | "radius" | "feather")
                );
            if optional {
                assert_eq!(field["required"], false);
                optional_count += 1;
            } else {
                assert!(field.get("required").is_none());
            }
        }
    }
    assert_eq!(optional_count, 10);
}

#[test]
fn spatial_params_are_bounded_and_reject_unknown_or_mistyped_values() {
    let result = resolve(
        "lens",
        json!({"centerX":-3,"centerY":3,"radius":3,
        "feather":-1,"zoom":99,"refraction":99,"dispersion":99}),
        0,
    );
    let u = &result["passes"][0]["uniforms"];
    for (key, expected) in [
        ("centerX", -1.0),
        ("centerY", 2.0),
        ("radius", 2.0),
        ("feather", 0.0),
        ("zoom", 8.0),
        ("refraction", 1.0),
        ("dispersion", 0.1),
    ] {
        assert_eq!(u[key], expected, "{key}");
    }
    for p in [
        json!({"centerX":"0.5"}),
        json!({"radius":null}),
        json!({"trajectory":[]}),
        json!({"seed":1}),
    ] {
        assert!(resolve("lens", p, 0)["error"].is_string());
    }
}
