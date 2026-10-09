use effects::{resolve_stylized_effect_json, stylized_effect_catalog_json};
use serde_json::{Value, json};

fn resolve(params: Value, time: i64) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType":"laser", "params":params, "localTime":time,
            "frameRate":{"numerator":24000,"denominator":1001}
        })
        .to_string(),
    ))
    .unwrap()
}

#[test]
fn laser_catalog_has_explicit_reveal_color_and_discrete_direction_controls() {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    let entry = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == "laser")
        .expect("laser catalog entry");
    assert_eq!(entry["animated"], false);
    let fields = entry["fields"].as_array().unwrap();
    assert_eq!(fields.len(), 9);
    for (key, min, max, default) in [
        ("amount", 0.0, 1.0, 1.0),
        ("progress", 0.0, 1.0, 0.0),
        ("direction", 0.0, 3.0, 0.0),
        ("width", 0.0, 0.25, 0.015),
        ("feather", 0.0, 1.0, 0.25),
        ("glow", 0.0, 1.0, 0.65),
        ("colorR", 0.0, 1.0, 0.2),
        ("colorG", 0.0, 1.0, 0.85),
        ("colorB", 0.0, 1.0, 1.0),
    ] {
        let field = fields.iter().find(|f| f["key"] == key).unwrap();
        assert_eq!(field["min"], min);
        assert_eq!(field["max"], max);
        assert_eq!(field["default"], default);
        assert_eq!(field["keyframable"], key != "direction");
        assert!(field.get("required").is_none());
    }
    assert_eq!(
        resolve(json!({}), 0)["passes"][0]["uniforms"],
        json!({
            "amount":1.0,"progress":0.0,"direction":0.0,"width":0.015,"feather":0.25,
            "glow":0.65,"colorR":0.2,"colorG":0.85,"colorB":1.0,"frame":0.0
        })
    );
    assert_eq!(resolve(json!({"amount":0}), 0)["passes"], json!([]));
}

#[test]
fn laser_normalization_preserves_continuous_values_and_rejects_bad_schema() {
    let result = resolve(json!({"progress":0.375,"width":0.0125,"direction":1.6}), 0);
    assert_eq!(result["passes"][0]["uniforms"]["progress"], 0.375);
    assert_eq!(result["passes"][0]["uniforms"]["width"], 0.0125);
    assert_eq!(result["passes"][0]["uniforms"]["direction"], 2.0);
    for (key, low, high) in [
        ("progress", 0.0, 1.0),
        ("direction", 0.0, 3.0),
        ("width", 0.0, 0.25),
        ("feather", 0.0, 1.0),
        ("glow", 0.0, 1.0),
        ("colorR", 0.0, 1.0),
        ("colorG", 0.0, 1.0),
        ("colorB", 0.0, 1.0),
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
    for params in [
        json!({"direction":"left"}),
        json!({"progress":null}),
        json!({"seed":1}),
    ] {
        assert!(resolve(params, 0)["error"].is_string());
    }
}

#[test]
fn laser_passes_depend_on_explicit_progress_not_clip_clock_or_seek_order() {
    let params = json!({"progress":0.425,"direction":3,"width":0.035,"glow":0.4});
    let expected = resolve(params.clone(), 0)["passes"].clone();
    for time in [75075, -1, 240000, 0, -75075] {
        assert_eq!(resolve(params.clone(), time)["passes"], expected);
    }
    assert_ne!(
        resolve(json!({"progress":0.2}), 0)["passes"],
        resolve(json!({"progress":0.8}), 0)["passes"]
    );
    let saved = serde_json::to_string(&params).unwrap();
    assert_eq!(
        resolve(serde_json::from_str(&saved).unwrap(), 0),
        resolve(params, 0)
    );
}
