use effects::{resolve_stylized_effect_json, stylized_effect_catalog_json};
use serde_json::{Value, json};

fn resolve(params: Value, time: i64) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType":"displacement", "params":params, "localTime":time,
            "frameRate":{"numerator":24000,"denominator":1001}
        })
        .to_string(),
    ))
    .unwrap()
}

#[test]
fn catalog_exposes_a_seeded_continuous_spatial_input_effect() {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    let definition = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == "displacement")
        .expect("native displacement catalog entry");
    assert_eq!(definition["animated"], false);
    let fields = definition["fields"].as_array().unwrap();
    assert_eq!(fields.len(), 9);
    for (key, min, max, default) in [
        ("amount", 0.0, 1.0, 1.0),
        ("displacement", -0.25, 0.25, 0.04),
        ("cellSize", 4.0, 256.0, 32.0),
        ("dispersion", 0.0, 0.1, 0.0),
        ("seed", 0.0, 65535.0, 1.0),
        ("centerX", -1.0, 2.0, 0.5),
        ("centerY", -1.0, 2.0, 0.5),
        ("radius", 0.0, 2.0, 0.5),
        ("feather", 0.0, 1.0, 0.15),
    ] {
        let field = fields.iter().find(|f| f["key"] == key).unwrap();
        assert_eq!(
            (
                field["min"].as_f64(),
                field["max"].as_f64(),
                field["default"].as_f64()
            ),
            (Some(min), Some(max), Some(default))
        );
        assert_eq!(field["keyframable"], key != "seed", "{key}");
        assert!(field.get("required").is_none());
    }
    assert_eq!(
        resolve(json!({}), 0)["passes"][0]["uniforms"],
        json!({
            "amount":1.0,"displacement":0.04,"cellSize":32.0,"dispersion":0.0,
            "seed":1.0,"centerX":0.5,"centerY":0.5,"radius":0.5,"feather":0.15,"frame":0.0
        })
    );
}

#[test]
fn normalization_preserves_interpolated_grid_values_and_bounds_author_controls() {
    let p = resolve(
        json!({"cellSize":8.125,"seed":3.75,"displacement":-0.125}),
        0,
    );
    assert_eq!(p["passes"][0]["uniforms"]["cellSize"], 8.125);
    assert_eq!(p["passes"][0]["uniforms"]["seed"], 4.0);
    assert_eq!(p["passes"][0]["uniforms"]["displacement"], -0.125);
    for (key, low, high) in [
        ("displacement", -0.25, 0.25),
        ("cellSize", 4.0, 256.0),
        ("dispersion", 0.0, 0.1),
        ("seed", 0.0, 65535.0),
        ("centerX", -1.0, 2.0),
        ("centerY", -1.0, 2.0),
        ("radius", 0.0, 2.0),
        ("feather", 0.0, 1.0),
    ] {
        assert_eq!(
            resolve(json!({key:low-1.0}), 0)["passes"][0]["uniforms"][key],
            low
        );
        assert_eq!(
            resolve(json!({key:high+1.0}), 0)["passes"][0]["uniforms"][key],
            high
        );
    }
    assert_eq!(resolve(json!({"amount":0}), 0)["passes"], json!([]));
    for params in [
        json!({"cellSize":"8"}),
        json!({"seed":null}),
        json!({"phase":1}),
    ] {
        assert!(resolve(params, 0)["error"].is_string());
    }
}

#[test]
fn raw_clock_does_not_change_seeded_space_and_reverse_seek_repeats_passes() {
    let params = json!({"seed":77,"centerX":0.42,"centerY":0.33,"radius":0.21,"cellSize":12.75});
    let expected = resolve(params.clone(), 0)["passes"].clone();
    for time in [75075, -1, 240000, 0, -75075] {
        assert_eq!(resolve(params.clone(), time)["passes"], expected);
    }
    assert_ne!(
        resolve(json!({"seed":78}), 0)["passes"],
        resolve(json!({"seed":77}), 0)["passes"]
    );
    let before = resolve(params.clone(), 0);
    let saved = serde_json::to_string(&params).unwrap();
    assert_eq!(resolve(serde_json::from_str(&saved).unwrap(), 0), before);
}
