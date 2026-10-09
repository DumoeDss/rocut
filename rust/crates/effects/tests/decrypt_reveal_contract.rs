use effects::{resolve_stylized_effect_json, stylized_effect_catalog_json};
use serde_json::{Value, json};

fn resolve(params: Value, time: i64) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(
        json!({"effectType":"decrypt-reveal", "params":params, "localTime":time,
            "frameRate":{"numerator":24000,"denominator":1001}})
        .to_string(),
    ))
    .unwrap()
}

#[test]
fn catalog_exposes_explicit_progress_spatial_controls_and_character_color() {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    let definition = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == "decrypt-reveal")
        .expect("native decrypt reveal definition");
    assert_eq!(definition["version"], 1);
    assert_eq!(definition["animated"], false);
    let fields = definition["fields"].as_array().unwrap();
    assert_eq!(fields.len(), 12);
    for (key, min, max, default) in [
        ("amount", 0.0, 1.0, 1.0),
        ("progress", 0.0, 1.0, 0.5),
        ("cellSize", 6.0, 64.0, 12.0),
        ("contrast", -2.0, 2.0, 1.0),
        ("seed", 0.0, 65535.0, 1.0),
        ("centerX", -1.0, 2.0, 0.5),
        ("centerY", -1.0, 2.0, 0.5),
        ("radius", 0.0, 2.0, 0.5),
        ("feather", 0.0, 1.0, 0.15),
        ("colorR", 0.0, 1.0, 0.2),
        ("colorG", 0.0, 1.0, 1.0),
        ("colorB", 0.0, 1.0, 0.55),
    ] {
        let f = fields.iter().find(|f| f["key"] == key).unwrap();
        assert_eq!(
            (f["min"].as_f64(), f["max"].as_f64(), f["default"].as_f64()),
            (Some(min), Some(max), Some(default))
        );
        assert_eq!(f["keyframable"], key != "seed", "{key}");
        assert!(f.get("required").is_none());
    }
    assert_eq!(
        resolve(json!({}), 0)["passes"][0]["uniforms"],
        json!({
            "amount":1.0,"progress":0.5,"cellSize":12.0,"contrast":1.0,"seed":1.0,
            "centerX":0.5,"centerY":0.5,"radius":0.5,"feather":0.15,
            "colorR":0.2,"colorG":1.0,"colorB":0.55,"frame":0.0
        })
    );
}

#[test]
fn resolver_bounds_controls_without_quantizing_continuous_cell_sizes() {
    assert_eq!(
        resolve(json!({"cellSize":8.125,"progress":0.375}), 0)["passes"][0]["uniforms"]["cellSize"],
        8.125
    );
    for (key, low, high) in [
        ("amount", 0.0, 1.0),
        ("progress", 0.0, 1.0),
        ("cellSize", 6.0, 64.0),
        ("contrast", -2.0, 2.0),
        ("seed", 0.0, 65535.0),
        ("centerX", -1.0, 2.0),
        ("centerY", -1.0, 2.0),
        ("radius", 0.0, 2.0),
        ("feather", 0.0, 1.0),
        ("colorR", 0.0, 1.0),
        ("colorG", 0.0, 1.0),
        ("colorB", 0.0, 1.0),
    ] {
        let below = resolve(json!({key:low - 1.0}), 0);
        if key == "amount" {
            assert_eq!(below["passes"], json!([]));
        } else {
            assert_eq!(below["passes"][0]["uniforms"][key], low);
        }
        assert_eq!(
            resolve(json!({key:high + 1.0}), 0)["passes"][0]["uniforms"][key],
            high
        );
    }
    for params in [
        json!({"progress":"0.5"}),
        json!({"seed":null}),
        json!({"eventTime":0}),
    ] {
        assert!(resolve(params, 0)["error"].is_string());
    }
}

#[test]
fn explicit_parameters_roundtrip_without_a_clock_or_seek_history() {
    let params = json!({"seed":73,"progress":0.375,"cellSize":8.125,"centerX":0.2,"radius":0.6});
    let expected = resolve(params.clone(), 0)["passes"].clone();
    for time in [75075, -1, 240000, 0, -75075] {
        assert_eq!(resolve(params.clone(), time)["passes"], expected);
    }
    let saved = serde_json::to_string(&params).unwrap();
    assert_eq!(
        resolve(serde_json::from_str(&saved).unwrap(), 0)["passes"],
        expected
    );
    assert_ne!(
        resolve(json!({"seed":74}), 0)["passes"],
        resolve(json!({"seed":73}), 0)["passes"]
    );
    assert_eq!(resolve(json!({"amount":0}), 0)["passes"], json!([]));
}
