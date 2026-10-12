use super::*;
#[test]
fn strict_defaults_and_boundaries() {
    let p = parse_liquid_object_params_json(r#"{"version":1}"#).unwrap();
    assert_eq!(
        (p.amount, p.frequency, p.speed, p.twist),
        (0.35, 4.0, 1.0, 0.5)
    );
    for input in [
        r#"{"version":1,"amount":0,"frequency":0,"speed":0,"twist":-2}"#,
        r#"{"version":1,"amount":1,"frequency":16,"speed":16,"twist":2}"#,
    ] {
        assert!(parse_liquid_object_params_json(input).is_ok());
    }
}
#[test]
fn strict_invalid_parameters() {
    for input in [
        "{}",
        r#"{"version":2}"#,
        r#"{"version":1,"seed":19}"#,
        r#"{"version":1,"time":0}"#,
        r#"{"version":1,"amount":null}"#,
        r#"{"version":1,"enabled":1}"#,
        r#"{"version":1,"twist":2.01}"#,
        r#"{"version":1,"amount":0.1,"amount":0.2}"#,
    ] {
        assert!(parse_liquid_object_params_json(input).is_err(), "{input}");
    }
}
#[test]
fn strict_frames_require_integer_seed_and_absolute_time() {
    for suffix in [
        r#""seed":1.1,"time":0"#,
        r#""seed":-1,"time":0"#,
        r#""seed":0,"time":-1"#,
        r#""seed":0,"time":86401"#,
        r#""seed":0,"time":0,"dt":1"#,
    ] {
        let request =
            format!(r#"{{"version":1,"params":{{"version":1}},"positions":[0,0,0],{suffix}}}"#);
        let result: serde_json::Value =
            serde_json::from_str(&evaluate_liquid_object_frame_json(request)).unwrap();
        assert_eq!(result["ok"], false);
    }
}

#[test]
fn shared_domain_is_optional_strict_and_authoritative() {
    let request = |domain: Option<serde_json::Value>| {
        let mut input = serde_json::json!({
            "version": 1, "params": {"version": 1},
            "positions": [0, 0, 0], "time": 1.25, "seed": 19,
        });
        if let Some(domain) = domain {
            input["domain"] = domain;
        }
        serde_json::from_str::<serde_json::Value>(&evaluate_liquid_object_frame_json(
            input.to_string(),
        ))
        .unwrap()
    };
    assert_eq!(request(None)["ok"], true);
    let valid = serde_json::json!({"min": [-2, -1, 0], "max": [2, 1, 0]});
    assert_eq!(request(Some(valid))["ok"], true);
    for invalid in [
        serde_json::Value::Null,
        serde_json::json!({"min": [0, 0], "max": [1, 1, 1]}),
        serde_json::json!({"min": [0, 0, 0], "max": [1, 1, 1], "time": 99}),
        serde_json::json!({"min": [1, 1, 1], "max": [2, 2, 2]}),
        serde_json::json!({"min": [0, 0, 0], "max": [-1, 1, 1]}),
        serde_json::json!({"min": [0, 0, 0], "max": [1000001, 1, 1]}),
    ] {
        assert_eq!(request(Some(invalid))["ok"], false);
    }
}
