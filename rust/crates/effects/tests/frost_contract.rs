use effects::{
    MAX_FROST_STROKES, resolve_stylized_effect_json, stylized_effect_catalog_json,
    validate_frost_schedule,
};
use serde_json::{Value, json};
fn resolve(params: Value, time: i64) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(json!({"effectType":"frost","params":params,"localTime":time,"frameRate":{"numerator":30,"denominator":1}}).to_string())).unwrap()
}
#[test]
fn frost_public_catalog_and_transport_have_complete_native_schedule_admission() {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    let frost = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == "frost")
        .unwrap();
    assert_eq!(frost["animated"], true);
    assert_eq!(frost["version"], 1);
    assert_eq!(MAX_FROST_STROKES, 16);
    let fields = frost["fields"].as_array().unwrap();
    assert_eq!(fields.len(), 125);
    for key in [
        "holdTicks",
        "recoveryTicks",
        "seed",
        "strokeCount",
        "stroke0TimeTicks",
        "stroke15Strength",
    ] {
        assert_eq!(
            fields.iter().find(|f| f["key"] == key).unwrap()["keyframable"],
            false
        );
    }
    assert_eq!(resolve(json!({}), 0)["passes"][0]["shader"], "frost");
    assert!(resolve(json!({"strokeCount":1}), 0).get("error").is_some());
    assert!(
        resolve(json!({"stroke0FromX":0.5}), 0)
            .get("error")
            .is_some()
    );
    assert!(resolve(json!({"coverage":2}), 0).get("error").is_some());
    assert!(
        validate_frost_schedule(&std::collections::BTreeMap::from([("unknown".into(), 1.0)]))
            .is_err()
    );
}
#[test]
fn frost_public_neutral_negative_and_malicious_transport_are_distinct() {
    assert_eq!(resolve(json!({"amount":0}), 0)["passes"], json!([]));
    assert_eq!(resolve(json!({}), -1)["passes"], json!([]));
    assert!(
        resolve(json!({"amount":0,"seed":1.5}), -1)
            .get("error")
            .is_some()
    );
    for input in [
        "{}",
        "{\"effectType\":\"frost\",\"params\":{\"coverage\":1e400},\"localTime\":0,\"frameRate\":{\"numerator\":30,\"denominator\":1}}",
    ] {
        assert!(
            serde_json::from_str::<Value>(&resolve_stylized_effect_json(input.into()))
                .unwrap()
                .get("error")
                .is_some()
        );
    }
}
