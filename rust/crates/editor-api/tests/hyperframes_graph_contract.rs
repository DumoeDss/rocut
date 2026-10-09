use editor_api::resolve_hyperframes_audio_graph_json;
use serde_json::{Value, json};

// This is also the minimal host/collector wire example: browser snapshot facts
// are nested unchanged; resources and the rational output clock come from host.
fn request() -> Value {
    json!({
        "version":1,"semanticsProfile":"rocut-hyperframes-0.8.139-audio-graph-v1",
        "frameRate":{"numerator":30,"denominator":1},"sampleRate":48000,
        "firstFrame":45,"frameCount":15,"durationFrames":120,
        "sources":[{"id":"a".repeat(64),"mimeType":"audio/wav","byteLength":4096}],
        "snapshot":{"version":1,"nativeVersion":"0.8.139","time":1,
            "tracks":[{"instanceId":"track#1","authorId":"voice","resourceId":"a".repeat(64),
                "type":"audio","authoredMuted":false,"ancestorHidden":false,"observedAt":1,
                "native":{"start":0.25,"end":2.25,"duration":2,"mediaStart":0.125,
                    "sourceDuration":4,"playbackRate":1,"rate":1,"loop":false,"volume":2,
                    "fades":{"fadeIn":0.1,"fadeOut":0.2},
                    "volumeKeyframes":[{"time":0,"volume":1},{"time":2,"volume":2}]},
                "attributes":{"groupRenderId":"bus#1","groupAuthorId":"bus","fxChain":null,
                    "automation":null,"muted":false,"hasAudio":null}}],
            "buses":[{"instanceId":"bus#1","authorId":"bus","hidden":false,
                "attributes":{"volume":"0.5suffix","fxChain":null,"automation":null}}]}
    })
}

fn raw(input: &str) -> Value {
    serde_json::from_str(&resolve_hyperframes_audio_graph_json(input.into())).unwrap()
}

fn resolve(input: &Value) -> Value {
    raw(&input.to_string())
}

fn prepared(input: &Value) -> Value {
    let result = resolve(input);
    assert!(result.get("error").is_none(), "{result}");
    result["plan"].clone()
}

fn reject(input: &Value) {
    let result = resolve(input);
    assert!(result.get("error").is_some(), "accepted {input}");
    assert!(result.get("plan").is_none());
}

fn many_tracks(count: usize) -> Value {
    let mut input = request();
    let original = input["snapshot"]["tracks"][0].clone();
    input["snapshot"]["tracks"] = json!(
        (0..count)
            .map(|index| {
                let mut track = original.clone();
                track["instanceId"] = json!(format!("track#{index}"));
                track
            })
            .collect::<Vec<_>>()
    );
    input
}

#[test]
fn prepares_routing_and_distinct_native_faders_without_claiming_execution() {
    let mut input = request();
    input["snapshot"]["tracks"][0]["attributes"]["fxChain"] =
        json!(r#"{"version":1,"nodes":[{"type":"delay","id":"echo","params":{"time":100}}]}"#);
    input["snapshot"]["buses"][0]["attributes"]["fxChain"] =
        json!(r#"{"version":1,"nodes":[{"type":"compressor"}]}"#);
    let plan = prepared(&input);
    assert_eq!(plan["stage"], "admission-only");
    assert_eq!(plan["executionReady"], false);
    assert_eq!(plan["statePolicy"], "canonical-composition-from-zero");
    assert_eq!(plan["renderStartSample"], 0);
    assert_eq!(plan["renderFrames"], 192000);
    assert_eq!(plan["sampleOrigin"], 72000);
    assert_eq!(plan["cropStartSample"], 72000);
    assert_eq!(plan["outputFrames"], 24000);
    assert_eq!(plan["budget"]["canonicalPcmBytes"], 1536000);
    assert_eq!(plan["budget"]["outputPcmBytes"], 192000);
    assert_eq!(plan["budget"]["estimatedDryPcmBytes"], 1536000);
    assert_eq!(plan["budget"]["fxNodeCount"], 2);
    let track = &plan["tracks"][0];
    assert_eq!(track["resolvedBusInstanceId"], "bus#1");
    assert_eq!(track["timing"]["mediaStart"], 0.125);
    assert_eq!(track["fader"]["kind"], "native-track-fader");
    assert_eq!(track["fader"]["evaluated"], false);
    assert_eq!(track["fader"]["authoredVolume"], 2.0);
    assert_eq!(track["fader"]["volumeKeyframes"][1]["time"], 2.0);
    assert_eq!(track["fxChain"]["nodes"][0]["params"]["time"], 100.0);
    let bus = &plan["buses"][0];
    assert_eq!(bus["memberInstanceIds"], json!(["track#1"]));
    assert_eq!(
        bus["fader"],
        json!({"kind":"native-bus-fader","evaluated":false,"rawVolume":"0.5suffix"})
    );
    assert!(plan.get("staticTailSeconds").is_none());
}

#[test]
fn full_and_partial_requests_share_canonical_history_and_absolute_sample_grid() {
    for (sample_rate, first, origin, output, canonical) in
        [(48000, 1, 1601, 1602, 4804), (44100, 2, 2942, 1472, 4414)]
    {
        let mut input = request();
        input["frameRate"] = json!({"numerator":30000,"denominator":1001});
        input["sampleRate"] = json!(sample_rate);
        input["durationFrames"] = json!(3);
        input["firstFrame"] = json!(first);
        input["frameCount"] = json!(1);
        input["snapshot"]["time"] = json!(0);
        input["snapshot"]["tracks"][0]["observedAt"] = json!(0);
        let partial = prepared(&input);
        assert_eq!(partial["renderFrames"], canonical);
        assert_eq!(partial["cropStartSample"], origin);
        assert_eq!(partial["outputFrames"], output);
        input["firstFrame"] = json!(0);
        input["frameCount"] = json!(3);
        let full = prepared(&input);
        assert_eq!(full["renderFrames"], partial["renderFrames"]);
        assert_eq!(full["tracks"], partial["tracks"]);
        assert_eq!(full["buses"], partial["buses"]);
        assert_eq!(full["outputFrames"], canonical);
    }
}

#[test]
fn snapshot_clock_must_fit_the_composition_even_when_all_observation_times_agree() {
    for time in [4.0, 4.00000005] {
        let mut input = request();
        input["snapshot"]["time"] = json!(time);
        input["snapshot"]["tracks"][0]["observedAt"] = json!(time);
        prepared(&input);
    }
    let mut input = request();
    input["snapshot"]["time"] = json!(4.001);
    input["snapshot"]["tracks"][0]["observedAt"] = json!(4.001);
    assert!(
        resolve(&input)["error"]
            .as_str()
            .unwrap()
            .contains("composition duration")
    );
}

#[test]
fn inactive_muted_hidden_and_zero_duration_tracks_survive_admission() {
    let mut input = many_tracks(4);
    let tracks = input["snapshot"]["tracks"].as_array_mut().unwrap();
    tracks[0]["native"]["start"] = json!(0);
    tracks[0]["native"]["duration"] = json!(0);
    tracks[0]["native"]["end"] = json!(0);
    tracks[1]["native"]["start"] = json!(10);
    tracks[1]["native"]["end"] = json!(12);
    tracks[2]["authoredMuted"] = json!(true);
    tracks[3]["ancestorHidden"] = json!(true);
    tracks[3]["native"]["rate"] = json!(2);
    tracks[3]["native"]["playbackRate"] = json!(2);
    tracks[3]["native"]["loop"] = json!(true);
    input["snapshot"]["buses"][0]["hidden"] = json!(true);
    let plan = prepared(&input);
    assert_eq!(plan["tracks"].as_array().unwrap().len(), 4);
    assert_eq!(plan["tracks"][1]["timing"]["start"], 10.0);
    assert_eq!(plan["tracks"][2]["authoredMuted"], true);
    assert_eq!(plan["tracks"][3]["ancestorHidden"], true);
    assert_eq!(plan["tracks"][3]["timing"]["loop"], true);
    assert_eq!(plan["tracks"][3]["timing"]["mediaStart"], 0.125);
    assert_eq!(plan["buses"][0]["hidden"], true);
    assert_eq!(
        plan["buses"][0]["memberInstanceIds"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(plan["budget"]["estimatedDryPcmBytes"], 1536000);
}

#[test]
fn repeated_author_ids_route_only_by_unique_compiled_instance_ids() {
    let mut input = many_tracks(2);
    let mut second_bus = input["snapshot"]["buses"][0].clone();
    second_bus["instanceId"] = json!("bus#2");
    input["snapshot"]["buses"]
        .as_array_mut()
        .unwrap()
        .push(second_bus);
    input["snapshot"]["tracks"][1]["attributes"]["groupRenderId"] = json!("bus#2");
    let plan = prepared(&input);
    assert_eq!(plan["buses"][0]["memberInstanceIds"], json!(["track#0"]));
    assert_eq!(plan["buses"][1]["memberInstanceIds"], json!(["track#1"]));
    for id in ["", " ", "bus#1", "track#0"] {
        let mut invalid = input.clone();
        invalid["snapshot"]["tracks"][1]["instanceId"] = json!(id);
        reject(&invalid);
    }
    let mut invalid = input.clone();
    invalid["snapshot"]["buses"][1]["instanceId"] = json!("bus#1");
    reject(&invalid);
    for group in [Value::Null, json!("missing"), json!("bus")] {
        let mut invalid = input.clone();
        invalid["snapshot"]["tracks"][1]["attributes"]["groupRenderId"] = group;
        reject(&invalid);
    }
    input["snapshot"]["buses"][0]["attributes"]["groupRenderId"] = json!("bus#2");
    reject(&input);
}

#[test]
fn video_groupability_uses_authored_attributes_not_runtime_mute_or_boolean_coercion() {
    for (muted, has_audio, groupable) in [
        (false, Value::Null, true),
        (false, json!("true"), true),
        (false, json!("false"), false),
        (false, json!("TRUE"), false),
        (false, json!(""), false),
        (true, Value::Null, false),
        (true, json!("true"), false),
    ] {
        let mut input = request();
        input["sources"][0]["mimeType"] = json!("video/mp4");
        let track = &mut input["snapshot"]["tracks"][0];
        track["type"] = json!("video");
        track["authoredMuted"] = json!(true);
        track["attributes"]["muted"] = json!(muted);
        track["attributes"]["hasAudio"] = has_audio;
        if !groupable {
            track["attributes"]["groupRenderId"] = json!("inert-missing-bus");
        }
        let plan = prepared(&input);
        assert_eq!(plan["tracks"][0]["audibleMedia"], groupable);
        assert_eq!(
            plan["tracks"][0]["resolvedBusInstanceId"],
            if groupable {
                json!("bus#1")
            } else {
                Value::Null
            }
        );
        assert_eq!(plan["tracks"].as_array().unwrap().len(), 1);
    }
}

#[test]
fn rejects_versions_clocks_unknown_fields_and_unadmitted_resources() {
    for (pointer, value) in [
        ("/version", json!(2)),
        ("/semanticsProfile", json!("engine-export")),
        ("/snapshot/version", json!(2)),
        ("/snapshot/nativeVersion", json!("0.8.140")),
        ("/snapshot/time", json!(-1)),
        ("/snapshot/time", json!(4.001)),
        ("/snapshot/time", json!(86401)),
        ("/snapshot/tracks/0/observedAt", json!(1.001)),
        ("/snapshot/tracks/0/native/start", json!(-1)),
        ("/snapshot/tracks/0/native/end", json!(2.5)),
        ("/snapshot/tracks/0/native/duration", json!(-1)),
        ("/snapshot/tracks/0/native/mediaStart", json!(-0.1)),
        ("/snapshot/tracks/0/native/sourceDuration", json!(0)),
        ("/snapshot/tracks/0/native/sourceDuration", Value::Null),
        ("/snapshot/tracks/0/native/fades/fadeIn", json!(-1)),
        ("/snapshot/tracks/0/native/playbackRate", json!(17)),
        ("/snapshot/tracks/0/native/rate", json!(2)),
        ("/snapshot/tracks/0/type", json!("image")),
        ("/snapshot/tracks/0/type", json!("video")),
        ("/snapshot/tracks/0/resourceId", json!("b".repeat(64))),
        ("/sampleRate", json!(96000)),
        ("/frameRate/numerator", json!(0)),
        ("/frameRate/denominator", json!(1002)),
        ("/frameCount", json!(0)),
        ("/firstFrame", json!(120)),
        ("/durationFrames", json!(0)),
        ("/sources/0/id", json!("not-a-content-hash")),
        ("/sources/0/byteLength", json!(0)),
    ] {
        let mut input = request();
        *input.pointer_mut(pointer).unwrap() = value;
        reject(&input);
    }
    let mut input = request();
    input["extra"] = json!(true);
    reject(&input);
    let mut input = request();
    let duplicate_source = input["sources"][0].clone();
    input["sources"]
        .as_array_mut()
        .unwrap()
        .push(duplicate_source);
    reject(&input);
}

#[test]
fn unsupported_automation_and_rate_lanes_fail_even_on_muted_inactive_tracks() {
    for automation in [
        " ",
        "{}",
        r#"{"version":1,"lanes":[{"target":"rate","points":[{"t":0,"v":1}]}]}"#,
    ] {
        for pointer in [
            "/snapshot/tracks/0/attributes/automation",
            "/snapshot/buses/0/attributes/automation",
        ] {
            let mut input = request();
            input["snapshot"]["tracks"][0]["authoredMuted"] = json!(true);
            input["snapshot"]["tracks"][0]["native"]["start"] = json!(10);
            input["snapshot"]["tracks"][0]["native"]["end"] = json!(12);
            *input.pointer_mut(pointer).unwrap() = json!(automation);
            assert!(
                resolve(&input)["error"]
                    .as_str()
                    .unwrap()
                    .contains("automation")
            );
        }
    }
    let mut input = request();
    input["snapshot"]["tracks"][0]["native"]["rate"] =
        json!({"target":"rate","points":[{"t":0,"v":1}]});
    assert!(
        resolve(&input)["error"]
            .as_str()
            .unwrap()
            .contains("rate automation")
    );
    input["snapshot"]["tracks"][0]["native"]["rate"] = json!(1);
    input["snapshot"]["tracks"][0]["attributes"]["automation"] = json!("");
    prepared(&input);
    for automation in [
        r#"{"version":1,"lanes":[]}"#,
        r#"{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1}]}]}"#,
    ] {
        for pointer in [
            "/snapshot/tracks/0/attributes/automation",
            "/snapshot/buses/0/attributes/automation",
        ] {
            *input.pointer_mut(pointer).unwrap() = json!(automation);
            let plan = prepared(&input);
            assert_eq!(plan["executionReady"], false);
        }
    }
}

#[test]
fn canonical_and_complete_dry_budgets_cannot_be_evaded_by_a_tiny_crop_or_mute() {
    let mut input = request();
    input["frameRate"] = json!({"numerator":375,"denominator":4});
    input["durationFrames"] = json!(32768);
    input["firstFrame"] = json!(32767);
    input["frameCount"] = json!(1);
    let plan = prepared(&input);
    assert_eq!(plan["budget"]["canonicalPcmBytes"], 128 * 1024 * 1024);
    assert_eq!(plan["outputFrames"], 512);
    input["durationFrames"] = json!(32769);
    reject(&input);
    let mut input = request();
    input["snapshot"]["tracks"][0]["authoredMuted"] = json!(true);
    input["snapshot"]["tracks"][0]["native"]["sourceDuration"] = json!(400);
    assert!(
        resolve(&input)["error"]
            .as_str()
            .unwrap()
            .contains("dry-PCM")
    );
    let mut input = many_tracks(2);
    let mut second_source = input["sources"][0].clone();
    second_source["id"] = json!("b".repeat(64));
    input["sources"].as_array_mut().unwrap().push(second_source);
    input["snapshot"]["tracks"][1]["resourceId"] = json!("b".repeat(64));
    for track in input["snapshot"]["tracks"].as_array_mut().unwrap() {
        track["native"]["sourceDuration"] = json!(200);
        track["ancestorHidden"] = json!(true);
    }
    reject(&input);
}

#[test]
fn per_object_and_global_topology_fx_and_keyframe_counts_are_bounded() {
    prepared(&many_tracks(64));
    reject(&many_tracks(65));
    let mut input = request();
    let bus = input["snapshot"]["buses"][0].clone();
    for index in 2..=32 {
        let mut next = bus.clone();
        next["instanceId"] = json!(format!("bus#{index}"));
        input["snapshot"]["buses"]
            .as_array_mut()
            .unwrap()
            .push(next);
    }
    prepared(&input);
    let mut next = bus;
    next["instanceId"] = json!("bus#33");
    input["snapshot"]["buses"]
        .as_array_mut()
        .unwrap()
        .push(next);
    reject(&input);
    let mut input = many_tracks(8);
    let fx =
        json!({"version":1,"nodes":vec![json!({"type":"gain","enabled":false});32]}).to_string();
    for track in input["snapshot"]["tracks"].as_array_mut().unwrap() {
        track["attributes"]["fxChain"] = json!(fx);
    }
    assert_eq!(prepared(&input)["budget"]["fxNodeCount"], 256);
    input["snapshot"]["buses"][0]["attributes"]["fxChain"] =
        json!(r#"{"version":1,"nodes":[{"type":"gain"}]}"#);
    reject(&input);
    let mut input = many_tracks(8);
    let points = json!(
        (0..4096)
            .map(|index| json!({"time":index,"volume":1}))
            .collect::<Vec<_>>()
    );
    for track in input["snapshot"]["tracks"].as_array_mut().unwrap() {
        track["native"]["volumeKeyframes"] = points.clone();
    }
    assert_eq!(prepared(&input)["budget"]["volumeKeyframeCount"], 32768);
    let mut extra = input["snapshot"]["tracks"][0].clone();
    extra["instanceId"] = json!("track#9");
    extra["native"]["volumeKeyframes"] = json!([{"time":0,"volume":1}]);
    input["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(extra);
    reject(&input);
    let mut input = request();
    input["snapshot"]["tracks"][0]["native"]["volumeKeyframes"] = points;
    input["snapshot"]["tracks"][0]["native"]["volumeKeyframes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"time":4096,"volume":1}));
    reject(&input);
}

#[test]
fn text_and_json_byte_limits_are_explicit_utf8_budgets() {
    let input = request().to_string();
    let exact = format!("{input}{}", " ".repeat(2 * 1024 * 1024 - input.len()));
    assert!(raw(&exact).get("error").is_none());
    assert!(raw(&(exact + " ")).get("error").is_some());
    for pointer in [
        "/snapshot/tracks/0/authorId",
        "/snapshot/buses/0/authorId",
        "/snapshot/tracks/0/instanceId",
        "/snapshot/tracks/0/attributes/groupAuthorId",
    ] {
        let mut input = request();
        *input.pointer_mut(pointer).unwrap() = json!("é".repeat(128));
        prepared(&input);
        *input.pointer_mut(pointer).unwrap() = json!(format!("{}x", "é".repeat(128)));
        reject(&input);
    }
    for pointer in [
        "/snapshot/buses/0/attributes/volume",
        "/snapshot/tracks/0/attributes/hasAudio",
    ] {
        let mut input = request();
        *input.pointer_mut(pointer).unwrap() = json!("é".repeat(2048));
        prepared(&input);
        *input.pointer_mut(pointer).unwrap() = json!(format!("{}x", "é".repeat(2048)));
        reject(&input);
    }
}

#[test]
fn source_encoded_limits_and_native_normalized_keyframes_are_enforced() {
    let mut input = request();
    input["sources"] = json!((0..5).map(|index|json!({
        "id":if index==0 {"a".repeat(64)} else {format!("{index:064x}")},
        "mimeType":"audio/wav","byteLength":match index {0..=2=>16*1024*1024,3=>16*1024*1024-1,_=>1}
    })).collect::<Vec<_>>());
    assert_eq!(
        prepared(&input)["budget"]["encodedSourceBytes"],
        64 * 1024 * 1024
    );
    input["sources"][4]["byteLength"] = json!(2);
    reject(&input);
    for points in [
        json!([{"time":0,"volume":1},{"time":0,"volume":2}]),
        json!([{"time":1,"volume":1},{"time":0,"volume":2}]),
        json!([{"time":-1,"volume":1}]),
        json!([{"time":0,"volume":-1}]),
        json!([{"time":0,"volume":4}]),
        json!([{"time":0,"volume":1,"curve":0.5}]),
    ] {
        let mut input = request();
        input["snapshot"]["tracks"][0]["native"]["volumeKeyframes"] = points;
        reject(&input);
    }
}
