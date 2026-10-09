use effects::{resolve_stylized_effect_json, stylized_effect_catalog_json};
use serde_json::{Value, json};

fn request() -> Value {
    json!({"effectType":"vhs", "params":{}, "localTime":0, "frameRate":{"numerator":30,"denominator":1}})
}
fn resolve(value: &Value) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(value.to_string())).unwrap()
}

#[test]
fn catalog_is_versioned_and_every_default_resolves() {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    assert_eq!(
        catalog
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![
            "vhs",
            "glitch",
            "retro-dither",
            "ascii",
            "mono-dither",
            "lens",
            "magnify",
            "displacement",
            "laser",
            "decrypt-reveal",
            "ripple",
            "force-field",
            "liquid",
            "droplets",
            "clouds"
        ]
    );
    for definition in catalog.as_array().unwrap() {
        assert_eq!(definition["version"], 1);
        let mut r = request();
        r["effectType"] = definition["id"].clone();
        let result = resolve(&r);
        if matches!(definition["id"].as_str(), Some("ripple" | "force-field")) {
            assert_eq!(
                result["passes"],
                json!([]),
                "no scheduled impacts is neutral"
            );
            continue;
        }
        assert_eq!(result["passes"][0]["shader"], definition["id"]);
        for field in definition["fields"].as_array().unwrap() {
            if definition["id"] == "liquid"
                && (field["key"] == "startTicks" || field["required"] == false)
            {
                assert!(
                    result["passes"][0]["uniforms"]
                        .get(field["key"].as_str().unwrap())
                        .is_none()
                );
                continue;
            }
            assert_eq!(
                result["passes"][0]["uniforms"][field["key"].as_str().unwrap()],
                field["default"]
            );
        }
    }
}

#[test]
fn frame_clock_uses_integer_rational_grid_and_signed_handles() {
    let mut r = request();
    for (ticks, frame) in [
        (0, 0),
        (3999, 0),
        (4000, 1),
        (60000, 15),
        (-1, -1),
        (-4001, -2),
        (60000, 15),
    ] {
        r["localTime"] = json!(ticks);
        assert_eq!(resolve(&r)["frameIndex"], frame);
    }
    r["frameRate"] = json!({"numerator":24000,"denominator":1001});
    for (ticks, frame) in [(75075, 15), (75074, 14), (80080, 16), (75075, 15)] {
        r["localTime"] = json!(ticks);
        assert_eq!(resolve(&r)["frameIndex"], frame);
    }
    r["localTime"] = json!(-1);
    assert_eq!(resolve(&r)["passes"][0]["uniforms"]["frame"], 16777215.0);
    r["effectType"] = json!("retro-dither");
    assert_eq!(resolve(&r)["passes"][0]["uniforms"]["frame"], 0.0);
}

#[test]
fn clamps_controls_rounds_discrete_and_keeps_continuous_animation() {
    let mut r = request();
    r["params"] = json!({"amount":3,"bleed":2.333,"noise":-9,"seed":2.9});
    let u = resolve(&r)["passes"][0]["uniforms"].clone();
    assert_eq!(u["amount"], 1.0);
    assert_eq!(u["bleed"], 2.333);
    assert_eq!(u["noise"], 0.0);
    assert_eq!(u["seed"], 3.0);
    r["params"] = json!({"amount":0});
    assert_eq!(resolve(&r)["passes"], json!([]));
}

#[test]
fn rejects_untrusted_time_rate_keys_and_types() {
    let cases = [
        ("localTime", json!(0.5)),
        ("localTime", json!(9007199254740992u64)),
        ("frameRate", json!({"numerator":7,"denominator":3})),
        ("frameRate", json!({"numerator":0,"denominator":1})),
        ("params", json!({"typo":1})),
        ("params", json!({"amount":"1"})),
        ("params", json!({"seed":null})),
        ("effectType", json!("not-an-effect")),
    ];
    for (key, value) in cases {
        let mut r = request();
        r[key] = value;
        assert!(resolve(&r)["error"].is_string(), "unexpected success: {r}");
    }
}
