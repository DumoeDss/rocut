use editor_api::{resolve_programmatic_audio_source_json, resolve_programmatic_frame_json};
use serde_json::{Value, json};

fn attachment(id: &str, kind: &str, mime: &str) -> Value {
    let prefix = if kind == "source" {
        "programmatic-source-sha256-"
    } else {
        "programmatic-sha256-"
    };
    json!({"id":id,"kind":kind,"mimeType":mime,"byteLength":1,
        "sha256":"a".repeat(64),"attachmentKey":format!("{prefix}{}", "a".repeat(64))})
}
fn source() -> Value {
    json!({"version":1,"runtime":"html-document","code":"","documentId":"build.html",
        "width":64,"height":64,"frameRate":{"numerator":30000,"denominator":1001},"durationFrames":60,"seed":1,
        "resources":[attachment("build.html","document","text/html")],
        "audio":{"version":1,"mode":"native","volumeDb":-6},
        "build":{"version":1,"engine":"remotion","engineVersion":"4.0.440","compositionId":"Audio",
            "entryFile":"index.tsx","inputs":[attachment("index.tsx","source","application/octet-stream")],
            "toolchainLock":attachment("_rocut/toolchain-lock.json","source","application/octet-stream")}})
}
fn plan(s: Value) -> Value {
    serde_json::from_str(&resolve_programmatic_audio_source_json(
        json!({"source":s,"sampleRate":44100}).to_string(),
    ))
    .unwrap()
}

#[test]
fn declared_soundtrack_has_authoritative_gain_and_source_sample_range() {
    let p = plan(source());
    assert!(p.get("error").is_none(), "{p}");
    assert_eq!(p["plan"]["range"]["outputFrames"], 88288);
    assert_eq!(p["plan"]["range"]["firstFrame"], 0);
    assert!((p["plan"]["gain"].as_f64().unwrap() - 0.5011872336272722).abs() < 1e-12);
    let mut s = source();
    s["audio"]["muted"] = json!(true);
    assert_eq!(plan(s)["plan"]["muted"], true);
    let mut silent = source();
    silent.as_object_mut().unwrap().remove("audio");
    assert_eq!(plan(silent)["plan"], Value::Null);
}

#[test]
fn source_audio_contract_rejects_invalid_and_unsupported_engine_settings() {
    for audio in [
        Value::Null,
        json!({"version":1,"mode":"native","muted":1}),
        json!({"version":2,"mode":"native"}),
        json!({"version":1,"mode":"muted"}),
        json!({"version":1,"mode":"native","volumeDb":21}),
        json!({"version":1,"mode":"native","volumeDb":-61}),
        json!({"version":1,"mode":"native","unknown":true}),
    ] {
        let mut s = source();
        s["audio"] = audio;
        assert!(plan(s).get("error").is_some());
    }
    let mut s = source();
    s["build"]["engine"] = json!("three");
    s["build"].as_object_mut().unwrap().remove("compositionId");
    assert!(plan(s).get("error").is_some());
    let mut s = source();
    s["durationFrames"] = json!(36001);
    assert!(plan(s).get("error").is_some());
    let frame: Value = serde_json::from_str(&resolve_programmatic_frame_json(
        json!({
            "source":source(),"clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":0
        })
        .to_string(),
    ))
    .unwrap();
    assert_eq!(frame["frame"]["index"], 0);
}

#[test]
fn compiled_hyperframes_uses_the_same_source_audio_policy() {
    let p = plan(hyperframes_source());
    assert!(p.get("error").is_none(), "{p}");
    assert!(p["plan"].get("profile").is_none());
    assert_eq!(p, plan(source()));
}

fn hyperframes_source() -> Value {
    let mut s = source();
    s["build"]["engine"] = json!("hyperframes");
    s["build"]["engineVersion"] = json!("0.8.139");
    s["build"]["entryFile"] = json!("index.html");
    s["build"]["inputs"] = json!([attachment(
        "index.html",
        "source",
        "application/octet-stream"
    )]);
    s["build"].as_object_mut().unwrap().remove("compositionId");
    s
}

fn frame(source: Value) -> Value {
    serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":source,"clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":0})
            .to_string(),
    ))
    .unwrap()
}

#[test]
fn explicit_graph_profile_is_returned_without_changing_source_clock_or_gain() {
    let mut s = hyperframes_source();
    s["audio"]["profile"] = json!("hyperframes-graph-v1");
    let mut p = plan(s.clone());
    assert!(p.get("error").is_none(), "{p}");
    assert_eq!(p["plan"]["profile"], "hyperframes-graph-v1");
    p["plan"].as_object_mut().unwrap().remove("profile");
    assert_eq!(p, plan(hyperframes_source()));
    assert_eq!(frame(s.clone())["frame"]["index"], 0);

    // A muted source is still validated; mute must not hide an unsupported profile.
    s["audio"]["muted"] = json!(true);
    assert_eq!(plan(s.clone())["plan"]["muted"], true);
    assert_eq!(plan(s)["plan"]["profile"], "hyperframes-graph-v1");
}

#[test]
fn profile_requires_an_exact_known_string_not_a_null_or_serde_enum_object() {
    for profile in [
        Value::Null,
        json!(""),
        json!("native"),
        json!("hyperframes-graph-v2"),
        json!("rocut-hyperframes-0.8.139-audio-graph-v1"),
        json!("HYPERFRAMES-GRAPH-V1"),
        json!(true),
        json!(1),
        json!(["hyperframes-graph-v1"]),
        json!({"hyperframes-graph-v1":null}),
    ] {
        let mut s = hyperframes_source();
        s["audio"]["profile"] = profile.clone();
        s["audio"]["muted"] = json!(true);
        assert!(plan(s.clone()).get("error").is_some(), "accepted {profile}");
        assert!(
            frame(s).get("error").is_some(),
            "picture accepted {profile}"
        );
    }
}

#[test]
fn graph_profile_never_downgrades_to_other_engines_or_unpinned_versions() {
    for (engine, version) in [
        ("remotion", "4.0.440"),
        ("three", "0.185.1"),
        ("hyperframes", "0.8.138"),
        ("hyperframes", "0.8.140"),
        ("hyperframes", "0.08.139"),
    ] {
        let mut s = hyperframes_source();
        s["audio"]["profile"] = json!("hyperframes-graph-v1");
        s["build"]["engine"] = json!(engine);
        s["build"]["engineVersion"] = json!(version);
        if engine == "remotion" {
            s["build"]["compositionId"] = json!("Audio");
        }
        let result = plan(s.clone());
        assert!(
            result["error"]
                .as_str()
                .unwrap()
                .contains("hyperframes-graph-v1")
                || engine == "three",
            "{result}"
        );
        assert!(frame(s).get("error").is_some());
    }
    let mut uncompiled = hyperframes_source();
    uncompiled["audio"]["profile"] = json!("hyperframes-graph-v1");
    uncompiled.as_object_mut().unwrap().remove("build");
    assert!(plan(uncompiled.clone()).get("error").is_some());
    assert!(frame(uncompiled).get("error").is_some());

    let mut canvas = hyperframes_source();
    canvas["audio"]["profile"] = json!("hyperframes-graph-v1");
    canvas["runtime"] = json!("canvas-worker");
    assert!(plan(canvas.clone()).get("error").is_some());
    assert!(frame(canvas).get("error").is_some());
}

#[test]
fn legacy_native_audio_keeps_its_existing_version_admission() {
    let legacy = plan(hyperframes_source());
    for version in ["0.8.138", "0.8.140"] {
        let mut s = hyperframes_source();
        s["build"]["engineVersion"] = json!(version);
        assert_eq!(plan(s), legacy);
    }
}

#[test]
fn native_export_timing_requires_the_graph_profile_and_survives_source_admission() {
    let mut s = hyperframes_source();
    s["audio"]["timing"] = json!("native-exporter");
    assert!(plan(s.clone()).get("error").is_some());
    s["audio"]["profile"] = json!("hyperframes-graph-v1");
    let mut selected = plan(s.clone());
    assert_eq!(selected["plan"]["timing"], "native-exporter");
    selected["plan"].as_object_mut().unwrap().remove("timing");
    let mut default = s.clone();
    default["audio"].as_object_mut().unwrap().remove("timing");
    assert_eq!(selected, plan(default));
    assert_eq!(frame(s.clone())["frame"]["index"], 0);
    for timing in [Value::Null, json!("sample-aligned"), json!(1), json!({})] {
        s["audio"]["timing"] = timing;
        assert!(plan(s.clone()).get("error").is_some());
        assert!(frame(s.clone()).get("error").is_some());
    }
}
