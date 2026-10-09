#[path = "support/hyperframes_execution.rs"]
mod support;
use editor_api::resolve_hyperframes_audio_graph_json;
use serde_json::{Value, json};
use support::*;

fn authored(input: &mut Value, nodes: Value, lanes: Value) {
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["attributes"]["fxChain"] = json!(json!({"version":1,"nodes":nodes}).to_string());
    track["attributes"]["automation"] = json!(json!({"version":1,"lanes":lanes}).to_string());
}

#[test]
fn fx_and_volume_keep_separate_clocks_and_payloads_across_full_and_crop() {
    let mut input = request();
    authored(
        &mut input,
        json!([{"id":"g","type":"gain","params":{"gain":3}}]),
        json!([
            {"target":"volume","points":[{"t":0,"v":2},{"t":0.1,"v":2}]},
            {"target":"fx.g.gain","points":[{"t":0,"v":-6,"curve":0.5},{"t":0.1,"v":0}]}
        ]),
    );
    input["graph"]["snapshot"]["tracks"][0]["resolvedAuthorGain"]["source"] =
        json!("normalized-volume-lane");
    let full = prepared(&input);
    let stage = &full["tracks"][0]["fxStage"];
    assert_eq!(
        stage["nativeFxAutomation"]["lanes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        stage["nativeFxAutomation"]["lanes"][0]["target"],
        "fx.g.gain"
    );
    assert_eq!(
        stage["nativeFxAutomation"]["lanes"][0]["points"][0]["v"],
        -6.0
    );
    assert_eq!(full["tracks"][0]["fader"]["points"][0]["v"], 2.0);
    assert_eq!(stage["automationCurveValues"], 10);
    assert!(
        full["workingSet"]["automationBufferBytes"]
            .as_u64()
            .unwrap()
            >= 40
    );
    input["graph"]["firstFrame"] = json!(1);
    input["graph"]["frameCount"] = json!(1);
    let crop = prepared(&input);
    assert_eq!(crop["tracks"], full["tracks"]);
    assert_eq!(crop["renderFrames"], 4800);
    assert_eq!(crop["outputFrames"], 1600);
    let admitted: Value = serde_json::from_str(&resolve_hyperframes_audio_graph_json(
        input["graph"].to_string(),
    ))
    .unwrap();
    assert!(admitted.get("error").is_none(), "{admitted}");
    assert_eq!(
        admitted["plan"]["tracks"][0]["fxAutomation"]["lanes"][0]["target"],
        "fx.g.gain"
    );
}

#[test]
fn bus_volume_projection_does_not_erase_fx_lane_or_change_global_history() {
    let mut input = request();
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["groupRenderId"] = json!("bus#1");
    input["graph"]["snapshot"]["buses"] = json!([{
        "instanceId":"bus#1","authorId":null,"hidden":false,
        "attributes":{
            "volume":"0.5", "fxChain":json!({"version":1,"nodes":[{"id":"g","type":"gain"}]}).to_string(),
            "automation":json!({"version":1,"lanes":[
                {"target":"volume","points":[{"t":0,"v":0.5},{"t":0.1,"v":1}]},
                {"target":"fx.g.gain","points":[{"t":0.04,"v":-12},{"t":0.08,"v":0}]}
            ]}).to_string()
        }
    }]);
    let full = prepared(&input);
    assert_eq!(full["buses"][0]["fader"]["events"][0]["value"], 0.5);
    assert_eq!(
        full["buses"][0]["fxStage"]["nativeFxAutomation"]["lanes"][0]["points"][0]["t"],
        0.04
    );
    input["graph"]["firstFrame"] = json!(2);
    input["graph"]["frameCount"] = json!(1);
    assert_eq!(prepared(&input)["buses"], full["buses"]);
}

#[test]
fn dynamic_tail_retains_first_lane_even_though_native_scheduler_uses_last() {
    let mut input = request();
    authored(
        &mut input,
        json!([{"id":"d","type":"delay","params":{"time":500,"feedback":0.5,"mix":0.5}}]),
        json!([
            {"target":"fx.d.time","points":[{"t":0,"v":100},{"t":0.1,"v":200}]},
            {"target":"fx.d.time","points":[{"t":0,"v":1000}]},
            {"target":"fx.d.feedback","points":[{"t":0,"v":0.1},{"t":0.1,"v":0.25}]}
        ]),
    );
    let result = prepared(&input);
    let stage = &result["tracks"][0]["fxStage"];
    assert_eq!(
        stage["nativeFxAutomation"]["lanes"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(stage["nativeTailSeconds"], 1.0);
    assert_eq!(stage["expectedOutputFrames"], 52800);
    assert_eq!(result["renderFrames"], 4800);
}

#[test]
fn all_stages_count_automation_points_even_if_muted_or_outside_crop() {
    let mut input = request();
    let points: Vec<_> = (0..512)
        .map(|i| json!({"t":i as f64 / 1000.0,"v":-6}))
        .collect();
    let lanes: Vec<_> = (0..8)
        .map(|_| json!({"target":"fx.g.gain","points":points}))
        .collect();
    authored(&mut input, json!([{"id":"g","type":"gain"}]), json!(lanes));
    let original = input["graph"]["snapshot"]["tracks"][0].clone();
    input["graph"]["snapshot"]["tracks"] = json!(
        (0..9)
            .map(|i| {
                let mut track = original.clone();
                track["instanceId"] = json!(format!("track#{i}"));
                track["authoredMuted"] = json!(true);
                track
            })
            .collect::<Vec<_>>()
    );
    input["graph"]["frameCount"] = json!(1);
    rejected(&input, "global automation");
}

#[test]
fn native_noop_and_orphan_lanes_remain_explicit_in_admission_diagnostics() {
    let mut input = request();
    authored(
        &mut input,
        json!([{"id":"h","type":"highpass","params":{"poles":"1"}}]),
        json!([
            {"target":"fx.h.poles","points":[{"t":0,"v":2}]},
            {"target":"fx.missing.frequency","points":[{"t":0,"v":1000}]},
            {"target":"fx.h.q","points":[{"t":0,"v":0.5},{"t":0.1,"v":4}]}
        ]),
    );
    let plan = prepared(&input);
    let stage = &plan["tracks"][0]["fxStage"];
    assert_eq!(
        stage["nativeFxAutomation"]["lanes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(stage["nativeFxAutomation"]["lanes"][0]["target"], "fx.h.q");
    assert_eq!(stage["automationScheduledEvents"], 0);
    assert_eq!(stage["automationDiagnostics"].as_array().unwrap().len(), 3);
    // Native drops do not grant permission to ignore a genuinely unsupported clock.
    input["graph"]["snapshot"]["tracks"][0]["attributes"]["automation"] =
        json!(r#"{"version":1,"lanes":[{"target":"rate","points":[{"t":0,"v":1}]}]}"#);
    rejected(&input, "rate");
}
