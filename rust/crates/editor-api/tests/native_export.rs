use editor_api::resolve_native_export_job_json;
use serde_json::{Value, json};

fn resolve(input: Value) -> Value {
    serde_json::from_str(&resolve_native_export_job_json(input.to_string())).unwrap()
}
fn source() -> Value {
    json!({"projectId":"project","revision":7,"data":{
        "scenes":[{"id":"scene","clips":[]}],"currentSceneId":"scene",
        "settings":{"width":1920,"height":1080,"fps":{"numerator":30,"denominator":1}},
        "version":2,"metadata":{"thumbnail":"volatile"}}})
}
fn request() -> Value {
    json!({"schemaVersion":1,"projectId":"project","expectedRevision":7,
        "idempotencyKey":"native-request-1","options":{"format":"webm","quality":"very_high"}})
}
fn admit(request: Value, source: Value, existing: Option<Value>) -> Value {
    let mut input =
        json!({"action":"admit","request":request,"source":source,"jobId":"job-1","now":10});
    if let Some(record) = existing {
        input["existing"] = record;
    }
    resolve(input)
}
fn record() -> Value {
    admit(request(), source(), None)["record"].clone()
}
fn transition(record: Value, event: Value, now: u64) -> Value {
    resolve(
        json!({"action":"transition","record":record,"event":event,"now":now,"source":source()}),
    )
}
fn output() -> Value {
    json!({"descriptor":"file:job-1.webm","bytes":1234,"sha256":"a".repeat(64)})
}
fn rejected(value: &Value, code: &str) {
    assert_eq!(value["status"], "rejected");
    assert_eq!(value["error"]["code"], code);
}

#[test]
fn normalized_defaults_and_canonical_source_identity() {
    let original = record();
    assert_eq!(original["phase"], "reserved");
    assert_eq!(original["request"]["options"]["includeAudio"], true);
    assert_eq!(original["request"]["options"]["videoChroma"], "420");
    assert_eq!(original["requestHash"].as_str().unwrap().len(), 64);
    let mut changed = source();
    changed["data"]["metadata"] = json!({"thumbnail":"new","updatedAt":999});
    let normalized = admit(original["request"].clone(), changed.clone(), None);
    assert_eq!(
        normalized["record"]["sourceDigest"],
        original["sourceDigest"]
    );
    assert_eq!(normalized["record"]["requestHash"], original["requestHash"]);
    changed["data"]["scenes"][0]["clips"] = json!([{"name":"Unicode 镜头"}]);
    assert_ne!(
        admit(request(), changed, None)["record"]["sourceDigest"],
        original["sourceDigest"]
    );
    let reordered: Value = serde_json::from_str(r#"{"data":{"version":2,"settings":{"fps":{"denominator":1,"numerator":30},"height":1080,"width":1920},"currentSceneId":"scene","scenes":[{"clips":[],"id":"scene"}]},"revision":7,"projectId":"project"}"#).unwrap();
    assert_eq!(
        admit(request(), reordered, None)["record"]["requestHash"],
        original["requestHash"]
    );
}

#[test]
fn exact_same_key_replays_before_current_revision_fence() {
    let original = record();
    let mut current = source();
    current["revision"] = json!(8);
    current["data"]["settings"]["width"] = json!(1280);
    let replay = admit(request(), current.clone(), Some(original.clone()));
    assert_eq!(replay["status"], "replay");
    assert_eq!(replay["record"], original);
    rejected(&admit(request(), current, None), "revision-conflict");
    for options in [
        json!({"format":"mp4","quality":"very_high"}),
        json!({"format":"webm","quality":"low"}),
        json!({"format":"webm","quality":"very_high","includeAudio":false}),
    ] {
        let mut changed = request();
        changed["options"] = options;
        rejected(
            &admit(changed, source(), Some(original.clone())),
            "idempotency-conflict",
        );
    }
}

#[test]
fn persisted_and_live_native_snapshots_share_render_projection() {
    let mut persisted = source();
    persisted["data"]["scenes"][0]["createdAt"] = json!("2026-08-01T00:00:00Z");
    persisted["data"]["scenes"][0]["updatedAt"] = json!("2026-08-01T00:00:00+00:00");
    let frozen = admit(request(), persisted.clone(), None)["record"].clone();
    let mut live = persisted.clone();
    live["data"]["scenes"][0]["createdAt"] = json!("2026-08-01T00:00:00.000Z");
    live["data"]["scenes"][0]["updatedAt"] = json!("2026-08-01T00:00:00.000Z");
    live["data"]["scenes"][0]["bookmarks"] = json!([]);
    live["data"]["motionTextSequences"] = json!([]);
    assert_eq!(
        admit(request(), live.clone(), None)["record"]["sourceDigest"],
        frozen["sourceDigest"]
    );
    assert_eq!(
        resolve(json!({"action":"verify","record":frozen,"source":live}))["status"],
        "verified"
    );
    persisted["data"]["scenes"][0]["bookmarks"] = json!([{"time":120000}]);
    assert_ne!(
        admit(request(), persisted, None)["record"]["sourceDigest"],
        frozen["sourceDigest"]
    );
}

#[test]
fn motion_text_content_changes_fence_dispatch_and_completion() {
    let mut original = source();
    original["data"]["motionTextSequences"] =
        json!([{"id":"sequence","cues":[{"text":"first"}],"resolvedPlan":{"glyphs":[1]}}]);
    let frozen = admit(request(), original.clone(), None)["record"].clone();
    let dispatched = resolve(json!({"action":"transition","record":frozen,"event":{"kind":"dispatched"},"now":11,"source":original}))["record"].clone();
    for field in ["cue", "plan", "remove"] {
        let mut changed = original.clone();
        match field {
            "cue" => changed["data"]["motionTextSequences"][0]["cues"][0]["text"] = json!("second"),
            "plan" => {
                changed["data"]["motionTextSequences"][0]["resolvedPlan"]["glyphs"] = json!([2])
            }
            _ => changed["data"]["motionTextSequences"] = json!([]),
        }
        for (record, event) in [
            (frozen.clone(), json!({"kind":"dispatched"})),
            (
                dispatched.clone(),
                json!({"kind":"complete","output":output()}),
            ),
        ] {
            rejected(
                &resolve(
                    json!({"action":"transition","record":record,"event":event,"now":12,"source":changed}),
                ),
                "revision-conflict",
            );
        }
    }
    for field in ["motionTextSequences", "bookmarks"] {
        let mut invalid = source();
        if field == "bookmarks" {
            invalid["data"]["scenes"][0][field] = Value::Null;
        } else {
            invalid["data"][field] = Value::Null;
        }
        rejected(&admit(request(), invalid, None), "invalid-source");
    }
}

#[test]
fn strict_abi_and_existing_codec_policy_are_not_bypassed() {
    for options in [
        json!({"format":"mp4","quality":"high","videoChroma":"444"}),
        json!({"format":"mp4","quality":"high","videoQuantizer":8}),
        json!({"format":"webm","quality":"high","videoQuantizer":64}),
        json!({"format":"webm","quality":"high","range":{"startTime":3,"endTime":3}}),
    ] {
        let mut request = request();
        request["options"] = options;
        rejected(&admit(request, source(), None), "invalid-request");
    }
    for invalid in [
        json!({"videoQuantizer":1.5}),
        json!({"videoQuantizer":null}),
        json!({"range":null}),
        json!({"command":"shell"}),
        json!({"range":{"startTime":0,"endTime":9007199254740992_u64}}),
    ] {
        let mut request = request();
        for (key, value) in invalid.as_object().unwrap() {
            request["options"][key] = value.clone();
        }
        assert_eq!(admit(request, source(), None)["status"], "rejected");
    }
    let mut accepted_request = request();
    accepted_request["options"]["videoQuantizer"] = json!(8);
    assert_eq!(
        admit(accepted_request, source(), None)["status"],
        "reserved"
    );
    let mut missing_source = source();
    missing_source["data"] = json!({});
    rejected(&admit(request(), missing_source, None), "invalid-source");
}

#[test]
fn bounded_actual_container_headers_reject_text_and_wrong_format() {
    let mp4 = vec![0, 0, 0, 24, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm'];
    let webm = vec![0x1a, 0x45, 0xdf, 0xa3, 0x9f];
    for (format, bytes) in [("mp4", mp4.clone()), ("webm", webm.clone())] {
        let result = resolve(
            json!({"action":"validateOutput","format":format,"bytes":bytes,"byteLength":1234}),
        );
        assert_eq!(result["status"], "output-valid");
        assert_eq!(result["scope"], "container-header-only");
    }
    for (format, bytes, size) in [
        ("mp4", webm, 1234),
        ("webm", mp4.clone(), 1234),
        ("mp4", b"arbitrary provider text".to_vec(), 1234),
        ("mp4", mp4, 10),
        ("webm", vec![0; 65], 1234),
    ] {
        rejected(
            &resolve(
                json!({"action":"validateOutput","format":format,"bytes":bytes,"byteLength":size}),
            ),
            "invalid-output",
        );
    }
}

#[test]
fn all_active_transitions_fence_project_revision_and_render_content() {
    let original = record();
    let dispatched =
        transition(original.clone(), json!({"kind":"dispatched"}), 11)["record"].clone();
    let running = transition(
        dispatched.clone(),
        json!({"kind":"running","progress":0.5}),
        12,
    )["record"]
        .clone();
    for (record, event) in [
        (original, json!({"kind":"dispatched"})),
        (dispatched, json!({"kind":"running","progress":0.6})),
        (
            running.clone(),
            json!({"kind":"complete","output":output()}),
        ),
    ] {
        for field in ["revision", "content", "projectId"] {
            let mut source = source();
            match field {
                "revision" => source["revision"] = json!(8),
                "projectId" => source["projectId"] = json!("foreign"),
                _ => source["data"]["currentSceneId"] = json!("other"),
            }
            rejected(
                &resolve(
                    json!({"action":"transition","record":record,"event":event,"now":13,"source":source}),
                ),
                "revision-conflict",
            );
        }
    }
    rejected(
        &transition(
            running.clone(),
            json!({"kind":"running","progress":0.4}),
            13,
        ),
        "phase-conflict",
    );
    assert_eq!(
        resolve(json!({"action":"verify","record":running,"source":source()}))["status"],
        "verified"
    );
}

#[test]
fn unknown_dispatch_and_restart_never_authorize_relaunch() {
    for event in [
        json!({"kind":"dispatchUnknown","error":"send outcome uncertain"}),
        json!({"kind":"recover"}),
    ] {
        let recovered = transition(record(), event, 11)["record"].clone();
        assert_eq!(recovered["phase"], "outcome-unknown");
        rejected(
            &transition(recovered.clone(), json!({"kind":"dispatched"}), 12),
            "phase-conflict",
        );
        rejected(
            &transition(
                recovered.clone(),
                json!({"kind":"complete","output":output()}),
                12,
            ),
            "phase-conflict",
        );
        assert_eq!(
            admit(request(), source(), Some(recovered))["status"],
            "replay"
        );
    }
    let legacy = json!({"id":"old","status":"completed","outputPath":"C:/foreign.mp4"});
    assert_eq!(
        resolve(json!({"action":"verify","record":legacy.clone()}))["status"],
        "unverified"
    );
    rejected(&admit(request(), source(), Some(legacy)), "unverified");
}

#[test]
fn cancel_intent_is_not_terminal_and_survives_recovery() {
    let dispatched = transition(record(), json!({"kind":"dispatched"}), 11)["record"].clone();
    rejected(
        &transition(dispatched.clone(), json!({"kind":"cancelConfirmed"}), 12),
        "cancel-conflict",
    );
    let intent = transition(dispatched, json!({"kind":"cancelRequest"}), 12)["record"].clone();
    assert_eq!(intent["phase"], "dispatched");
    assert_eq!(intent["cancelRequested"], true);
    rejected(
        &transition(
            intent.clone(),
            json!({"kind":"complete","output":output()}),
            13,
        ),
        "phase-conflict",
    );
    let recovered = transition(intent, json!({"kind":"recover"}), 13)["record"].clone();
    assert_eq!(recovered["cancelRequested"], true);
    let cancelled = transition(recovered, json!({"kind":"cancelConfirmed"}), 14)["record"].clone();
    assert_eq!(cancelled["phase"], "cancelled");
    assert_eq!(cancelled["cancelRequested"], true);
    rejected(
        &transition(cancelled, json!({"kind":"dispatched"}), 15),
        "terminal-conflict",
    );
}

#[test]
fn output_evidence_and_terminal_receipts_cannot_be_replaced() {
    let running = transition(record(), json!({"kind":"dispatched"}), 11)["record"].clone();
    for bad in [
        json!({"descriptor":"file:../outside","bytes":10,"sha256":"a".repeat(64)}),
        json!({"descriptor":"file:job.webm","bytes":0,"sha256":"a".repeat(64)}),
        json!({"descriptor":"file:job.webm","bytes":1234,"sha256":"invalid"}),
    ] {
        rejected(
            &transition(running.clone(), json!({"kind":"complete","output":bad}), 12),
            "invalid-output",
        );
    }
    let completed =
        transition(running, json!({"kind":"complete","output":output()}), 12)["record"].clone();
    assert_eq!(completed["phase"], "completed");
    assert_eq!(
        resolve(json!({"action":"verify","record":completed,"output":output()}))["status"],
        "verified"
    );
    let mut changed = output();
    changed["sha256"] = json!("b".repeat(64));
    rejected(
        &resolve(json!({"action":"verify","record":completed,"output":changed.clone()})),
        "output-conflict",
    );
    rejected(
        &transition(
            completed.clone(),
            json!({"kind":"complete","output":changed}),
            13,
        ),
        "terminal-conflict",
    );
    assert_eq!(
        transition(completed.clone(), json!({"kind":"recover"}), 13)["record"],
        completed
    );
    assert_eq!(
        transition(
            completed.clone(),
            json!({"kind":"complete","output":output()}),
            13
        )["record"],
        completed
    );
}

#[test]
fn tampered_records_and_backwards_clocks_are_refused() {
    let original = record();
    for key in ["requestHash", "sourceDigest"] {
        let mut record = original.clone();
        record[key] = json!("tampered");
        rejected(
            &resolve(json!({"action":"verify","record":record})),
            "invalid-record",
        );
    }
    let mut unsafe_identity = original.clone();
    unsafe_identity["jobId"] = json!("../tampered");
    rejected(
        &resolve(json!({"action":"verify","record":unsafe_identity})),
        "invalid-record",
    );
    let mut changed = original.clone();
    changed["request"]["options"]["quality"] = json!("low");
    rejected(
        &resolve(json!({"action":"verify","record":changed})),
        "invalid-record",
    );
    rejected(
        &transition(original, json!({"kind":"dispatched"}), 9),
        "invalid-clock",
    );
}

#[test]
fn explicit_null_evidence_cannot_silently_become_new_admission_or_no_fence() {
    rejected(
        &resolve(
            json!({"action":"admit","request":request(),"source":source(),"jobId":"job-2","now":10,"existing":null}),
        ),
        "unverified",
    );
    rejected(
        &resolve(json!({"action":"verify","record":record(),"source":null})),
        "invalid-schema",
    );
    rejected(
        &resolve(json!({"action":"verify","record":record(),"output":null})),
        "invalid-schema",
    );
}

#[test]
fn publication_intent_is_not_completion_and_recovery_only_confirms_frozen_bytes() {
    let active = transition(record(), json!({"kind":"dispatched"}), 11)["record"].clone();
    let event = json!({"kind":"publicationStart","output":output(),"stagingDescriptor":"file:job-1.webm.staged"});
    let intent = transition(active.clone(), event.clone(), 12)["record"].clone();
    assert_eq!(intent["phase"], "publishing");
    assert!(intent["output"].is_null());
    assert_eq!(intent["publication"]["output"], output());
    assert_eq!(
        transition(intent.clone(), json!({"kind":"recover"}), 13)["record"],
        intent
    );
    let unknown = transition(
        intent.clone(),
        json!({"kind":"dispatchUnknown","error":"publication filesystem uncertain"}),
        13,
    )["record"]
        .clone();
    assert_eq!(unknown["publication"], intent["publication"]);
    let mut changed = output();
    changed["sha256"] = json!("b".repeat(64));
    rejected(
        &transition(
            unknown.clone(),
            json!({"kind":"publicationConfirmed","output":changed}),
            14,
        ),
        "output-conflict",
    );
    rejected(
        &transition(
            active.clone(),
            json!({"kind":"publicationConfirmed","output":output()}),
            12,
        ),
        "phase-conflict",
    );
    rejected(
        &transition(unknown.clone(), event.clone(), 14),
        "phase-conflict",
    );
    let cancelled = transition(active, json!({"kind":"cancelRequest"}), 12)["record"].clone();
    rejected(&transition(cancelled, event, 13), "phase-conflict");
    let requested = transition(unknown, json!({"kind":"cancelRequest"}), 14)["record"].clone();
    rejected(
        &transition(requested.clone(), json!({"kind":"cancelConfirmed"}), 15),
        "cancel-conflict",
    );
    // The original encoded snapshot may publish after current project edits.
    let mut edited = source();
    edited["revision"] = json!(8);
    let completed = resolve(
        json!({"action":"transition","record":requested,"event":{"kind":"publicationConfirmed","output":output()},"now":15,"source":edited}),
    );
    assert_eq!(completed["record"]["phase"], "completed");
    assert_eq!(completed["record"]["output"], output());
    assert_eq!(completed["record"]["cancelRequested"], true);
    assert_eq!(
        resolve(json!({"action":"verify","record":completed["record"]}))["status"],
        "verified"
    );
    assert!(completed["record"]["publication"].is_null());
}
