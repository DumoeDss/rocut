use super::*;
use serde_json::{Value, json};
fn frame() -> LiquidObjectTransportFrame {
    LiquidObjectTransportFrame {
        session_id: "native-frame".into(),
        index: 5,
        time: 1.25,
        seed: 19,
    }
}
fn command(session: &mut LiquidObjectTransportSession, value: Value) -> Value {
    serde_json::from_str(&session.command_json(&value.to_string())).unwrap()
}
fn opened() -> LiquidObjectTransportSession {
    let mut session = LiquidObjectTransportSession::new(frame()).unwrap();
    assert_eq!(
        command(&mut session, json!({"operation":"open","frame":frame()}))["ok"],
        true
    );
    session
}
fn reserve(
    session: &mut LiquidObjectTransportSession,
    id: u32,
    mesh: u32,
    vertices: usize,
    bytes: usize,
) -> Value {
    command(
        session,
        json!({"operation":"reserve","identity":{"frame":frame(),"requestId":id},
        "meshId":mesh,"vertices":vertices,"requestJsonBytes":bytes,"requestEnvelopeBytes":bytes.saturating_add(256)}),
    )
}
fn settle(session: &mut LiquidObjectTransportSession, id: u32) -> Value {
    command(
        session,
        json!({"operation":"settle","identity":{"frame":frame(),"requestId":id},
        "responseJsonBytes":100,"responseEnvelopeBytes":356}),
    )
}
#[test]
fn policy_preserves_core_limits_and_positive_deadlines() {
    let p = liquid_object_transport_policy();
    assert_eq!(
        p.max_vertices_per_request,
        effects::liquid_object::MAX_LIQUID_OBJECT_VERTICES
    );
    assert_eq!(p.max_request_json_bytes, 12_000_000);
    assert!(p.max_vertices_per_frame >= p.max_vertices_per_request);
    assert!(p.request_timeout_ms <= p.frame_timeout_ms);
    assert!(p.termination_timeout_ms <= p.cleanup_timeout_ms);
    assert!(serde_json::from_str::<Value>(&liquid_object_transport_policy_json()).is_ok());
}
#[test]
fn cumulative_vertices_and_terminal_no_refund() {
    let mut s = opened();
    for id in 1..=2 {
        assert_eq!(reserve(&mut s, id, id, 100000, 100)["ok"], true);
        assert_eq!(settle(&mut s, id)["ok"], true);
    }
    let error = reserve(&mut s, 3, 3, 1, 100);
    assert_eq!(error["ok"], false);
    assert_eq!(error["totals"]["vertices"], 200000);
    assert_eq!(reserve(&mut s, 3, 3, 1, 1)["error"], error["error"]);
    assert!(error["totals"]["retainedPayloadBytes"].as_u64().unwrap() > 0);
}
#[test]
fn cumulative_mesh_and_request_budgets_are_independent() {
    let p = liquid_object_transport_policy();
    let mut meshes = opened();
    for id in 1..=p.max_meshes_per_frame as u32 {
        assert_eq!(reserve(&mut meshes, id, id, 1, 100)["ok"], true);
        settle(&mut meshes, id);
    }
    assert_eq!(
        reserve(&mut meshes, p.max_meshes_per_frame as u32 + 1, 999, 1, 100)["ok"],
        false
    );
    let mut requests = opened();
    for id in 1..=p.max_requests_per_frame as u32 {
        assert_eq!(reserve(&mut requests, id, 1, 1, 100)["ok"], true);
        settle(&mut requests, id);
    }
    let rejected = reserve(
        &mut requests,
        p.max_requests_per_frame as u32 + 1,
        1,
        1,
        100,
    );
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["totals"]["meshes"], 1);
}
#[test]
fn full_encoded_envelopes_and_retained_bytes_accumulate() {
    let mut s = opened();
    let mut rejected = false;
    for id in 1..=64 {
        let result = reserve(&mut s, id, 1, 1, 11_000_000);
        if result["ok"] == false {
            rejected = true;
            break;
        }
        settle(&mut s, id);
    }
    assert!(rejected);
    assert_eq!(reserve(&mut s, 99, 1, 1, 1)["ok"], false);
    let mut s = opened();
    assert_eq!(reserve(&mut s, 1, 1, 1, 100)["ok"], true);
    let bad = command(
        &mut s,
        json!({"operation":"settle","identity":{"frame":frame(),"requestId":1},
        "responseJsonBytes":1,"responseEnvelopeBytes":100000}),
    );
    assert_eq!(bad["ok"], false);
    assert_eq!(bad["pending"], true);
}
#[test]
fn retained_and_encoded_limits_each_reject_without_other_limits_exhausted() {
    let mut retained = opened();
    assert_eq!(reserve(&mut retained, 1, 1, 100000, 10_000_000)["ok"], true);
    settle(&mut retained, 1);
    let denied = reserve(&mut retained, 2, 2, 100000, 10_000_000);
    assert_eq!(denied["ok"], false);
    assert_eq!(denied["totals"]["requests"], 1);
    let mut encoded = opened();
    for id in 1..=3 {
        let admitted = command(
            &mut encoded,
            json!({"operation":"reserve","identity":{"frame":frame(),"requestId":id},
            "meshId":1,"vertices":1,"requestJsonBytes":6_000_000,"requestEnvelopeBytes":12_000_000}),
        );
        assert_eq!(admitted["ok"], true);
        settle(&mut encoded, id);
    }
    let denied = command(
        &mut encoded,
        json!({"operation":"reserve","identity":{"frame":frame(),"requestId":4},
        "meshId":1,"vertices":1,"requestJsonBytes":6_000_000,"requestEnvelopeBytes":12_000_000}),
    );
    assert_eq!(denied["ok"], false);
    assert_eq!(denied["totals"]["requests"], 3);
}
#[test]
fn identity_order_inflight_and_phase_reject_terminal() {
    for operation in ["close", "fail"] {
        let mut s = opened();
        reserve(&mut s, 1, 1, 1, 100);
        let rejected = command(&mut s, json!({"operation":operation,"frame":frame()}));
        assert_eq!(rejected["ok"], false);
        assert_eq!(rejected["pending"], true);
        assert_eq!(settle(&mut s, 1)["ok"], false);
    }
    let mut s = opened();
    assert_eq!(reserve(&mut s, 2, 1, 1, 100)["ok"], false);
    let mut s = opened();
    reserve(&mut s, 1, 1, 1, 100);
    assert_eq!(reserve(&mut s, 2, 2, 1, 100)["ok"], false);
    let mut s = opened();
    reserve(&mut s, 1, 1, 1, 100);
    let mut wrong = frame();
    wrong.seed += 1;
    assert_eq!(
        command(
            &mut s,
            json!({"operation":"settle","identity":{"frame":wrong,"requestId":1},"responseJsonBytes":1,"responseEnvelopeBytes":1})
        )["ok"],
        false
    );
}
#[test]
fn strict_json_arithmetic_and_closed_identity() {
    for raw in [
        r#"{"operation":"open","frame":{},"unknown":1}"#,
        r#"{"operation":"open","operation":"close"}"#,
    ] {
        let mut s = opened();
        let value: Value = serde_json::from_str(&s.command_json(raw)).unwrap();
        assert_eq!(value["ok"], false);
    }
    let mut s = opened();
    assert_eq!(reserve(&mut s, 1, 1, usize::MAX, usize::MAX)["ok"], false);
    let mut s = opened();
    assert_eq!(
        command(&mut s, json!({"operation":"close","frame":frame()}))["ok"],
        true
    );
    assert_eq!(reserve(&mut s, 1, 1, 1, 100)["ok"], false);
    let mut s = opened();
    reserve(&mut s, 1, 1, 1, 100);
    command(&mut s, json!({"operation":"fail","frame":frame()}));
    let disposed = command(&mut s, json!({"operation":"dispose","frame":frame()}));
    assert_eq!(disposed["phase"], "disposed");
    assert_eq!(disposed["totals"]["requests"], 1);
    assert_eq!(disposed["ok"], false);
}
