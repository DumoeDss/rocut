use editor_api::validate_master_effects_json;
use serde_json::{Value, json};

fn request() -> Value {
    json!({"effects":[{"id":"grade","type":"exposure","enabled":true,"params":{"amount":0.5}}],
        "catalog":{"exposure":[{"key":"amount","type":"number","min":-2,"max":2}]}})
}

#[test]
fn ordered_stack_and_explicit_clear_are_admitted() {
    let mut value = request();
    assert_eq!(validate_master_effects_json(value.to_string()), "[]");
    value["effects"][0]["enabled"] = json!(false);
    assert_eq!(validate_master_effects_json(value.to_string()), "[]");
    value["effects"] = json!([]);
    assert_eq!(validate_master_effects_json(value.to_string()), "[]");
}

#[test]
fn disabled_entries_cannot_hide_invalid_ids_types_parameters_or_fields() {
    let invalid = [
        ("id", json!("bad.id")),
        ("type", json!("missing")),
        ("params", json!({"amount":3})),
        ("params", json!({"amount":"wrong"})),
        ("params", json!({"other":0})),
        ("params", json!({})),
        ("rawShader", json!("unsafe")),
    ];
    for (key, replacement) in invalid {
        let mut value = request();
        value["effects"][0]["enabled"] = json!(false);
        value["effects"][0][key] = replacement;
        let issues = validate_master_effects_json(value.to_string());
        assert_ne!(issues, "[]", "{key}");
        assert!(issues.contains("masterEffects"));
    }
}

#[test]
fn duplicate_ids_and_excessive_stacks_are_rejected_before_render() {
    let mut value = request();
    let effect = value["effects"][0].clone();
    value["effects"] = json!([effect.clone(), effect]);
    assert!(validate_master_effects_json(value.to_string()).contains("unique"));
    value["effects"] = Value::Array((0..256).map(|n| {
        json!({"id":format!("fx-{n}"),"type":"exposure","enabled":true,"params":{"amount":0}})
    }).collect());
    assert_eq!(validate_master_effects_json(value.to_string()), "[]");
    value["effects"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"extra","type":"exposure","enabled":true,"params":{"amount":0}}));
    assert!(validate_master_effects_json(value.to_string()).contains("256"));
    assert!(validate_master_effects_json(" ".repeat(1024 * 1024 + 1)).contains("1 MiB"));
}

#[test]
fn master_reuses_integer_seed_and_time_effect_schedule_policy() {
    let mut value = request();
    value["catalog"] = json!({"clouds":[{"key":"seed","type":"number","min":0,"max":999}]});
    value["effects"][0]["type"] = json!("clouds");
    value["effects"][0]["params"] = json!({"seed":1.5});
    assert!(validate_master_effects_json(value.to_string()).contains("integer"));
    value["effects"][0]["params"] = json!({"seed":2});
    assert_eq!(validate_master_effects_json(value.to_string()), "[]");
}
