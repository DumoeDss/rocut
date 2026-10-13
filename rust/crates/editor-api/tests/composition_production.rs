use editor_api::resolve_composition_production_json;
use serde_json::{Value, json};
fn resolve(v: Value) -> Value {
    serde_json::from_str(&resolve_composition_production_json(v.to_string())).unwrap()
}
fn source() -> Value {
    json!({"version":1,"runtime":"html-document","code":"<!doctype html><html><body>Fixed</body></html>","width":64,"height":32,"frameRate":{"numerator":30,"denominator":1},"durationFrames":30,"seed":0})
}
fn request() -> Value {
    json!({"schemaVersion":1,"idempotencyKey":"fixed-operation","archive":{"source":source(),"manifestSha256":"a".repeat(64)},"options":{"format":"mp4","quality":"high"}})
}
fn record() -> Value {
    resolve(json!({"action":"admit","request":request(),"now":10}))["record"].clone()
}
fn transition(record: Value, event: Value) -> Value {
    resolve(json!({"action":"transition","record":record,"event":event,"now":11}))
}
#[test]
fn fixed_request_is_normalized_bound_and_not_compiled() {
    let r = record();
    assert_eq!(r["phase"], "reserved");
    assert_eq!(r["request"]["options"]["includeAudio"], true);
    assert_eq!(r["request"]["options"]["videoChroma"], "420");
    assert_eq!(r["requestId"], r["requestHash"]);
    assert!(r["source"].is_null());
    assert!(r["compiledSource"].is_null());
    assert_eq!(
        resolve(json!({"action":"verify","record":r}))["status"],
        "verified"
    );
}
#[test]
fn document_compile_creates_only_isolated_scene_not_completed_mp4() {
    let compiling = transition(record(), json!({"kind":"compileIntent"}))["record"].clone();
    let result = transition(compiling, json!({"kind":"compiled","source":source()}));
    assert_eq!(result["status"], "updated");
    let r = &result["record"];
    assert_eq!(r["phase"], "compiled");
    assert_eq!(r["source"]["revision"], 0);
    assert_eq!(r["source"]["data"]["scenes"].as_array().unwrap().len(), 1);
    assert_eq!(r["source"]["data"]["metadata"]["duration"], 120000);
    assert_eq!(
        r["source"]["data"]["scenes"][0]["tracks"]["main"]["elements"],
        json!([])
    );
    assert_eq!(
        r["source"]["data"]["scenes"][0]["tracks"]["overlay"][0]["elements"][0]["programmatic"],
        source()
    );
}
#[test]
fn replay_uses_original_without_new_dispatch_authority() {
    let r = record();
    let replay = resolve(json!({"action":"admit","request":request(),"existing":r,"now":100}));
    assert_eq!(replay["status"], "replay");
    assert_eq!(replay["record"]["createdAt"], 10);
    let mut changed = request();
    changed["archive"]["manifestSha256"] = json!("b".repeat(64));
    assert_eq!(
        resolve(json!({"action":"admit","request":changed,"existing":record(),"now":100}))["status"],
        "rejected"
    );
}
#[test]
fn recovery_of_reserved_or_compiling_never_restarts_compilation() {
    for r in [
        record(),
        transition(record(), json!({"kind":"compileIntent"}))["record"].clone(),
    ] {
        let unknown = transition(r, json!({"kind":"recover"}))["record"].clone();
        assert_eq!(unknown["phase"], "outcome-unknown");
        assert_eq!(
            transition(unknown, json!({"kind":"compileIntent"}))["status"],
            "rejected"
        );
    }
}
#[test]
fn compiled_source_substitution_and_native_project_injection_are_refused() {
    let compiling = transition(record(), json!({"kind":"compileIntent"}))["record"].clone();
    let mut changed = source();
    changed["code"] = json!("changed");
    assert_eq!(
        transition(
            compiling.clone(),
            json!({"kind":"compiled","source":changed})
        )["status"],
        "rejected"
    );
    let mut forged =
        transition(compiling, json!({"kind":"compiled","source":source()}))["record"].clone();
    forged["source"]["data"]["currentSceneId"] = json!("user-scene");
    assert_eq!(
        resolve(json!({"action":"verify","record":forged}))["status"],
        "rejected"
    );
}
#[test]
fn hash_geometry_options_and_unknown_fields_are_checked() {
    let mut hash = record();
    hash["requestHash"] = json!("f".repeat(64));
    assert_eq!(
        resolve(json!({"action":"verify","record":hash}))["status"],
        "rejected"
    );
    for mutate in ["manifest", "range", "geometry", "path", "runtime"] {
        let mut r = request();
        match mutate {
            "manifest" => r["archive"]["manifestSha256"] = json!("not-sha"),
            "range" => r["options"]["range"] = json!({"startTime":0,"endTime":10}),
            "geometry" => r["archive"]["source"]["width"] = json!(0),
            "path" => r["sourceDirectory"] = json!("C:/user-project"),
            "runtime" => r["archive"]["source"]["runtime"] = json!("canvas-worker"),
            _ => unreachable!(),
        }
        assert_eq!(
            resolve(json!({"action":"admit","request":r,"now":10}))["status"],
            "rejected",
            "{mutate}"
        );
    }
}
