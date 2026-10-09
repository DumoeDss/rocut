#[path = "support/hyperframes_participation.rs"]
mod support;
use serde_json::{Value, json};
use support::*;

#[test]
fn all_four_inert_classes_accept_valid_fallback_facts_but_emit_no_fader_history() {
    for kind in INERT {
        let mut input = request(kind);
        admitted_inert(&input);
        // External facts from later seeks must NOT equal baseline snapshot time.
        input["graph"]["snapshot"]["tracks"][0]["resolvedAuthorGain"] =
            json!({"state":"unobserved"});
        admitted_inert(&input);
    }
}

#[test]
fn validates_each_native_fallback_branch_without_promoting_it_to_history() {
    // native volume, routing, previous volume, current volume, expected H.
    for (native, routed, previous, current, gain) in [
        (Some(0.5), true, None, 0.25, 0.5),
        (Some(0.5), true, Some(0.75), 0.25, 0.5),
        (Some(0.5), false, None, 0.25, 0.25),
        (Some(2.0), false, None, 0.25, 2.0),
        (Some(0.75), false, Some(0.5), 0.50005, 0.75),
        (Some(0.75), false, Some(0.5), 0.50011, 0.50011),
        (Some(0.75), false, Some(0.0), 0.0001, 0.75),
        (Some(-2.0), false, Some(0.25), 0.25, 0.0),
        (None, true, None, 0.25, 1.0),
        (None, false, None, 0.25, 0.25),
        (Some(100.0), true, None, 0.25, 10.0_f64.powf(12.0 / 20.0)),
    ] {
        let mut input = request("authored-muted");
        let track = &mut input["graph"]["snapshot"]["tracks"][0];
        track["native"]["volume"] = json!(native);
        track["resolvedAuthorGain"]["gainBeforeFades"] = json!(gain);
        track["resolvedAuthorGain"]["fallback"] = json!({"routed":routed,
            "previousRuntimeVolume":previous,"currentElementVolume":current,
            "baselineGain":native.unwrap_or(1.0_f64).clamp(0.0,10.0_f64.powf(12.0/20.0))});
        refresh(&mut input);
        admitted_inert(&input);
        input["observations"][0]["tracks"][0]["resolvedAuthorGain"]["gainBeforeFades"] =
            json!(0.123);
        rejected_both(&input);
    }
}

#[test]
fn malformed_inert_baseline_and_external_gain_facts_are_never_skipped() {
    for kind in INERT {
        for location in [
            "/graph/snapshot/tracks/0/resolvedAuthorGain",
            "/observations/0/tracks/0/resolvedAuthorGain",
        ] {
            for (field, value) in [
                ("/observedAt", json!(-1)),
                ("/observedAt", json!(0.1)),
                ("/gainBeforeFades", json!(-0.1)),
                ("/gainBeforeFades", json!(4)),
                ("/gainBeforeFades", json!(0.25)),
                ("/gainBeforeFades", Value::Null),
                ("/gainBeforeFades", json!("NaN")),
                ("/fades/fadeIn", json!(0.01)),
                ("/source", json!("normalized-GSAP")),
                ("/points", json!([])),
                ("/fallback", Value::Null),
                ("/fallback/routed", json!("false")),
                ("/fallback/baselineGain", json!(0.75)),
                ("/fallback/baselineGain", json!(-1)),
                ("/fallback/currentElementVolume", json!(1.1)),
                ("/fallback/currentElementVolume", json!(-0.1)),
                ("/fallback/previousRuntimeVolume", json!(1.1)),
                ("/fallback/previousRuntimeVolume", json!(-0.1)),
            ] {
                let mut input = request(kind);
                *input.pointer_mut(&format!("{location}{field}")).unwrap() = value;
                rejected_both(&input);
            }
            let mut input = request(kind);
            input.pointer_mut(location).unwrap()["fallback"]["futureField"] = json!(true);
            rejected_both(&input);
        }
    }
}

#[test]
fn participating_fallback_still_requires_complete_history_even_outside_output_crop() {
    let mut input = request("participating");
    for result in [observe(&input), execute(&input)] {
        assert!(
            result["error"]
                .as_str()
                .unwrap()
                .contains("complete native history")
        );
    }
    let native = &mut input["graph"]["snapshot"]["tracks"][0]["native"];
    native["end"] = json!(0.03);
    native["duration"] = json!(0.03);
    input["graph"]["firstFrame"] = json!(2);
    input["graph"]["frameCount"] = json!(1);
    refresh(&mut input);
    for result in [observe(&input), execute(&input)] {
        assert!(
            result["error"]
                .as_str()
                .unwrap()
                .contains("complete native history")
        );
    }
}

#[test]
fn inert_gain_acceptance_does_not_weaken_schema_clock_or_static_order_guards() {
    let base = request("authored-muted");
    for (path, value) in [
        ("/observations/0/tracks/0/observedAt", json!(0.03)),
        ("/observations/0/tracks/0/native/volume", json!(0.25)),
        ("/observations/0/tracks/0/authoredMuted", json!(false)),
        (
            "/observations/0/tracks/0/attributes/groupRenderId",
            json!("bus#2"),
        ),
    ] {
        let mut input = base.clone();
        *input.pointer_mut(path).unwrap() = value;
        assert!(observe(&input)["error"].is_string());
    }
    let mut reordered = base;
    let mut second = reordered["graph"]["snapshot"]["tracks"][0].clone();
    second["instanceId"] = json!("track#2");
    reordered["graph"]["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(second);
    refresh(&mut reordered);
    reordered["observations"][0]["tracks"]
        .as_array_mut()
        .unwrap()
        .reverse();
    assert!(
        observe(&reordered)["error"]
            .as_str()
            .unwrap()
            .contains("static declarations")
    );
}

#[test]
fn normalized_inert_facts_are_checked_but_do_not_become_required_fader_history() {
    for kind in INERT {
        let mut input = request(kind);
        let track = &mut input["graph"]["snapshot"]["tracks"][0];
        track["native"]["volumeKeyframes"] =
            json!([{"time":0,"volume":0.5},{"time":0.1,"volume":0.5}]);
        track["resolvedAuthorGain"]["source"] = json!("normalized-GSAP");
        track["resolvedAuthorGain"]["fallback"] = Value::Null;
        track["resolvedAuthorGain"]["points"] = json!([{"t":0,"v":0.5},{"t":0.1,"v":0.5}]);
        refresh(&mut input);
        admitted_inert(&input);
        input["observations"][0]["tracks"][0]["resolvedAuthorGain"]["points"][0]["v"] = json!(0.6);
        rejected_both(&input);
    }
}
