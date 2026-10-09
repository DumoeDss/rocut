use editor_api::normalize_hyperframes_fx_chain_json;
use serde_json::{Value, json};

fn raw(input: &str) -> Value {
    serde_json::from_str(&normalize_hyperframes_fx_chain_json(input.into())).unwrap()
}

fn resolve(input: Value) -> Value {
    raw(&input.to_string())
}

fn chain(nodes: Value) -> Value {
    json!({"version":1,"nodes":nodes})
}

fn one(kind: &str, params: Value) -> Value {
    let result = resolve(chain(json!([{"type":kind,"params":params}])));
    assert!(result.get("error").is_none(), "{result}");
    result["chain"]["nodes"][0]["params"].clone()
}

// Independent expected values transcribed from the pinned 0.8.139 public
// contract, not imported from the implementation's registry. Each entry is
// [type, defaults, minima, maxima]; enums keep their default in bound checks.
const EXPECTED: &str = r#"[
 ["gain",{"gain":0},{"gain":-60},{"gain":12}],
 ["peaking",{"frequency":1000,"gain":0,"q":1},{"frequency":20,"gain":-40,"q":0.1},{"frequency":20000,"gain":40,"q":20}],
 ["lowshelf",{"frequency":200,"gain":0},{"frequency":20,"gain":-40},{"frequency":2000,"gain":40}],
 ["highshelf",{"frequency":4000,"gain":0},{"frequency":500,"gain":-40},{"frequency":20000,"gain":40}],
 ["highpass",{"frequency":300,"q":0.707,"poles":"2"},{"frequency":20,"q":0.1,"poles":"2"},{"frequency":20000,"q":20,"poles":"2"}],
 ["lowpass",{"frequency":8000,"q":0.707,"poles":"2"},{"frequency":100,"q":0.1,"poles":"2"},{"frequency":20000,"q":20,"poles":"2"}],
 ["compressor",{"threshold":-24,"ratio":4,"attack":20,"release":250,"knee":2.83,"makeup":0,"mix":1},{"threshold":-60,"ratio":1,"attack":0.01,"release":0.01,"knee":1,"makeup":0,"mix":0},{"threshold":0,"ratio":20,"attack":2000,"release":9000,"knee":8,"makeup":36,"mix":1}],
 ["limiter",{"limit":-1,"attack":5,"release":50,"level_out":0},{"limit":-24,"attack":0.1,"release":1,"level_out":-24},{"limit":0,"attack":80,"release":8000,"level_out":24}],
 ["gate",{"threshold":-35,"range":-24,"ratio":10,"attack":1,"release":100,"knee":2.83},{"threshold":-80,"range":-80,"ratio":1,"attack":0.01,"release":0.01,"knee":1},{"threshold":0,"range":0,"ratio":20,"attack":9000,"release":9000,"knee":8}],
 ["saturate",{"type":"tanh","threshold":-6,"output":0,"oversample":4},{"type":"tanh","threshold":-40,"output":-24,"oversample":1},{"type":"tanh","threshold":0,"output":24,"oversample":8}],
 ["bitcrush",{"bits":8,"samples":1,"mix":1},{"bits":1,"samples":1,"mix":0},{"bits":32,"samples":250,"mix":1}],
 ["pitchshift",{"semitones":0,"mix":1},{"semitones":-12,"mix":0},{"semitones":12,"mix":1}],
 ["delay",{"time":250,"feedback":0.35,"mix":0.4},{"time":1,"feedback":0.01,"mix":0},{"time":5000,"feedback":0.95,"mix":1}],
 ["chorus",{"delay":7,"depth":2,"speed":1,"mix":0.5},{"delay":1,"depth":0,"speed":0.01,"mix":0},{"delay":100,"depth":10,"speed":10,"mix":1}],
 ["phaser",{"in_gain":0.4,"out_gain":0.74,"delay":3,"decay":0.4,"speed":0.5,"type":"0"},{"in_gain":0,"out_gain":0,"delay":0.1,"decay":0,"speed":0.1,"type":"0"},{"in_gain":1,"out_gain":2,"delay":5,"decay":0.99,"speed":2,"type":"0"}],
 ["reverb",{"size":0.7,"damping":0.5,"wet":0.35,"dry":0.7},{"size":0.05,"damping":0,"wet":0,"dry":0},{"size":1,"damping":1,"wet":1,"dry":1}]
]"#;

fn same_value(actual: &Value, expected: &Value) {
    if expected.is_number() {
        assert_eq!(actual.as_f64(), expected.as_f64());
    } else if let Some(expected) = expected.as_object() {
        assert_eq!(actual.as_object().unwrap().len(), expected.len());
        for (key, value) in expected {
            same_value(&actual[key], value);
        }
    } else {
        assert_eq!(actual, expected);
    }
}

#[test]
fn all_sixteen_effects_have_native_defaults_and_independent_bounds() {
    let fixtures: Value = serde_json::from_str(EXPECTED).unwrap();
    assert_eq!(fixtures.as_array().unwrap().len(), 16);
    for fixture in fixtures.as_array().unwrap() {
        let kind = fixture[0].as_str().unwrap();
        for missing in [
            Value::Null,
            json!({}),
            json!([]),
            json!("text"),
            json!(false),
        ] {
            same_value(&one(kind, missing), &fixture[1]);
        }
        for (input, expected_index) in [(-1e12, 2), (1e12, 3)] {
            let mut params = fixture[1].clone();
            for value in params.as_object_mut().unwrap().values_mut() {
                if value.is_number() {
                    *value = json!(input);
                }
            }
            params["unknown"] = json!(123);
            same_value(&one(kind, params), &fixture[expected_index]);
        }
    }
    assert!(one("lowshelf", json!({"q": 5})).get("q").is_none());
    assert!(one("highshelf", json!({"q": 5})).get("q").is_none());
}

#[test]
fn number_coercion_uses_nonempty_js_number_not_truthiness_or_parse_float() {
    for (input, expected) in [
        ("0x10", 16.0),
        ("0X20", 32.0),
        ("0b101", 5.0),
        ("0o17", 15.0),
        (" +12.5e1 ", 125.0),
        (".5", 1.0),
        ("1.", 1.0),
        ("00025", 25.0),
        ("-0x10", 250.0),
        ("+0b10", 250.0),
        ("4ms", 250.0),
        ("", 250.0),
        (" \t\n", 250.0),
        ("Infinity", 250.0),
        ("1e999", 250.0),
        ("NaN", 250.0),
        ("1_000", 250.0),
        ("0x", 250.0),
        ("0b2", 250.0),
    ] {
        assert_eq!(
            one("delay", json!({"time":input}))["time"].as_f64(),
            Some(expected),
            "{input}"
        );
    }
    for wrong in [
        Value::Null,
        json!(false),
        json!(true),
        json!([]),
        json!([25]),
        json!({}),
    ] {
        assert_eq!(one("delay", json!({"time":wrong}))["time"], 250.0);
    }
    let whitespace = "\u{0009}\u{000a}\u{000b}\u{000c}\u{000d} \u{00a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";
    assert_eq!(
        one(
            "delay",
            json!({"time":format!("{whitespace}12{whitespace}")})
        )["time"],
        12.0
    );
    for whitespace in ['\u{0085}', '\u{180e}', '\u{200b}'] {
        assert_eq!(
            one("delay", json!({"time":format!("{whitespace}12")}))["time"],
            250.0
        );
    }
    assert_eq!(
        one("delay", json!({"time":format!("{}12", "0".repeat(4000))}))["time"],
        12.0
    );
    assert_eq!(
        one("delay", json!({"time":format!("0x{}c", "0".repeat(4000))}))["time"],
        12.0
    );
    // A near-maximum finite hex integer versus the halfway value rounding to infinity.
    assert_eq!(
        one(
            "delay",
            json!({"time":format!("0x{}{}", "f".repeat(13), "0".repeat(243))})
        )["time"],
        5000.0
    );
    assert_eq!(
        one(
            "delay",
            json!({"time":format!("0x{}c{}", "f".repeat(13), "0".repeat(242))})
        )["time"],
        250.0
    );
}

#[test]
fn enums_are_exact_strings_and_ui_steps_do_not_round_numbers() {
    for (kind, key, values) in [
        ("highpass", "poles", vec!["1", "2"]),
        ("lowpass", "poles", vec!["1", "2"]),
        ("phaser", "type", vec!["0", "1"]),
        (
            "saturate",
            "type",
            vec![
                "tanh", "atan", "cubic", "exp", "alg", "quintic", "sin", "erf", "hard",
            ],
        ),
    ] {
        for value in values {
            assert_eq!(one(kind, json!({key:value}))[key], value);
        }
    }
    assert_eq!(one("highpass", json!({"poles":1}))["poles"], "2");
    assert_eq!(one("saturate", json!({"type":"TANH"}))["type"], "tanh");
    for (kind, key, value) in [
        ("saturate", "oversample", 3.25),
        ("bitcrush", "samples", 9.125),
        ("bitcrush", "bits", 8.123),
        ("pitchshift", "semitones", 0.25),
        ("delay", "time", 12.375),
        ("highpass", "frequency", 300.125),
    ] {
        assert_eq!(one(kind, json!({key:value}))[key].as_f64(), Some(value));
    }
}

#[test]
fn zero_sign_matches_js_min_max_including_native_amount_underflow() {
    for (kind, key, negative) in [
        ("gain", "gain", true),
        ("compressor", "threshold", true),
        ("compressor", "makeup", false),
        ("delay", "mix", false),
    ] {
        let value = one(kind, json!({key:"-0"}))[key].as_f64().unwrap();
        assert_eq!(value, 0.0);
        assert_eq!(value.is_sign_negative(), negative, "{kind}/{key}");
    }
    for token in ["-0", "-1e-999"] {
        let result = raw(&format!(
            r#"{{"version":1,"nodes":[{{"type":"gain","presetAmount":{token}}}]}}"#
        ));
        let amount = result["chain"]["nodes"][0]["presetAmount"]
            .as_f64()
            .unwrap();
        assert_eq!(amount, 0.0);
        assert!(!amount.is_sign_negative());
    }
}

#[test]
fn stable_metadata_enabled_and_amount_match_parse_not_serialization() {
    let node = json!({"type":"gain","id":"  ","fromPreset":"preset-1","label":" Name ",
        "fromEq":"eq-1","fromCarve":true,"fromLeveller":true,"presetAmount":1,"extra":42});
    let result = resolve(chain(json!([node.clone(),node,{"type":"gain"}])));
    let nodes = &result["chain"]["nodes"];
    for index in 0..2 {
        for (key, expected) in [
            ("id", "  "),
            ("fromPreset", "preset-1"),
            ("label", " Name "),
            ("fromEq", "eq-1"),
        ] {
            assert_eq!(nodes[index][key], expected);
        }
        assert_eq!(nodes[index]["fromCarve"], true);
        assert_eq!(nodes[index]["fromLeveller"], true);
        assert_eq!(nodes[index]["enabled"], true);
        assert_eq!(nodes[index]["presetAmount"], 1.0);
        assert!(nodes[index].get("extra").is_none());
    }
    assert!(nodes[2].get("id").is_none());
    for enabled in [
        Value::Null,
        json!(0),
        json!("false"),
        json!(true),
        json!([]),
    ] {
        assert_eq!(
            resolve(chain(json!([{"type":"gain","enabled":enabled}])))["chain"]["nodes"][0]["enabled"],
            true
        );
    }
    let result = resolve(chain(
        json!([{"type":"gain","enabled":false,"id":"","label":42,
        "fromCarve":1,"fromLeveller":"true","presetAmount":"0.5"}]),
    ));
    let node = &result["chain"]["nodes"][0];
    assert_eq!(node["enabled"], false);
    for key in ["id", "label", "fromCarve", "fromLeveller", "presetAmount"] {
        assert!(node.get(key).is_none());
    }
    for (amount, expected) in [(-3.0, 0.0), (0.25, 0.25), (3.0, 1.0)] {
        assert_eq!(resolve(chain(json!([{"type":"gain","presetAmount":amount}])))["chain"]["nodes"][0]["presetAmount"].as_f64(),Some(expected));
    }
}

#[test]
fn native_structure_and_json_number_overflow_remain_distinct() {
    for version in ["1", "1.0", "1e0", "1.0000000000000001"] {
        assert!(
            raw(&format!("{{\"version\":{version},\"nodes\":[]}}"))
                .get("error")
                .is_none()
        );
    }
    for input in [
        "null",
        "[]",
        "1",
        r#"{"version":"1","nodes":[]}"#,
        r#"{"version":2,"nodes":[]}"#,
        r#"{"version":1,"nodes":{}}"#,
        r#"{"version":1,"nodes":[null]}"#,
        r#"{"version":1,"nodes":[[]]}"#,
        r#"{"version":1,"nodes":[{"type":"unknown","enabled":false}]}"#,
    ] {
        assert!(raw(input).get("error").is_some(), "{input}");
    }
    for token in ["1e999", "-1e999"] {
        let result = raw(&format!(
            r#"{{"version":1,"nodes":[{{"type":"delay","enabled":{token},"presetAmount":{token},"params":{{"time":{token}}}}}]}}"#
        ));
        assert_eq!(result["chain"]["nodes"][0]["params"]["time"], 250.0);
        assert_eq!(result["chain"]["nodes"][0]["enabled"], true);
        assert!(result["chain"]["nodes"][0].get("presetAmount").is_none());
    }
    for token in [
        "01e999",
        "-01e999",
        "1e",
        "1e+",
        "1e999.0",
        "1e999true",
        "+1e999",
        "1.e999",
        ".1e999",
        "1e999-1",
    ] {
        let result = raw(&format!(
            r#"{{"version":1,"nodes":[{{"type":"delay","params":{{"time":{token}}}}}]}}"#
        ));
        assert!(
            result.get("error").is_some(),
            "malformed JSON accepted: {token}"
        );
    }
    assert_eq!(
        resolve(chain(json!([{"type":"gain","label":"escaped \\\" 1e999"}])))["chain"]["nodes"][0]
            ["label"],
        "escaped \\\" 1e999"
    );
}

#[test]
fn limits_reject_exact_plus_one_without_truncation() {
    let node = json!({"type":"gain"});
    assert!(
        resolve(chain(json!(vec![node.clone(); 32])))
            .get("error")
            .is_none()
    );
    assert!(resolve(chain(json!(vec![node; 33]))).get("error").is_some());
    let input = chain(json!([])).to_string();
    let input = format!("{input}{}", " ".repeat(128 * 1024 - input.len()));
    assert!(raw(&input).get("error").is_none());
    assert!(raw(&(input + " ")).get("error").is_some());
    for (length, rejected) in [(256, false), (257, true)] {
        for key in ["id", "fromPreset", "label", "fromEq"] {
            let text = format!("{}{}", "é".repeat(128), "a".repeat(length - 256));
            assert_eq!(
                resolve(chain(json!([{"type":"gain",key:text}])))
                    .get("error")
                    .is_some(),
                rejected
            );
        }
    }
    for (length, rejected) in [(4096, false), (4097, true)] {
        let text = format!("{}{}", "字".repeat(1365), "a".repeat(length - 4095));
        for request in [
            json!({"version":1,"nodes":[],"unknown":text}),
            json!({"version":1,"nodes":[],text:0}),
        ] {
            assert_eq!(resolve(request).get("error").is_some(), rejected);
        }
    }
    for (extra, rejected) in [(62, false), (63, true)] {
        let mut request = chain(json!([]));
        for index in 0..extra {
            request[format!("key{index}")] = Value::Null;
        }
        assert_eq!(resolve(request).get("error").is_some(), rejected);
    }
    for (nulls, rejected) in [(4092, false), (4093, true)] {
        let request = json!({"version":1,"nodes":[],"unknown":vec![Value::Null;nulls]});
        assert_eq!(resolve(request).get("error").is_some(), rejected);
    }
    for (arrays, rejected) in [(7, false), (8, true)] {
        let mut nested = Value::Null;
        for _ in 0..arrays {
            nested = json!([nested]);
        }
        assert_eq!(
            resolve(json!({"version":1,"nodes":[],"unknown":nested}))
                .get("error")
                .is_some(),
            rejected
        );
    }
}

#[test]
fn unicode_scalar_policy_rejects_unpaired_surrogates_without_replacing_them() {
    const ERROR: &str =
        "HyperFrames FX Unicode-scalar safety policy rejects unpaired UTF-16 surrogate escapes";
    for escaped in [
        r"\ud800",
        r"\udbff",
        r"\udc00",
        r"\udfff",
        r"\ud800x",
        r"\ud800\ud800",
        r"\ud800\u0041",
        r"\udc00\ud800",
        r"\ud800\\udc00",
    ] {
        for input in [
            format!(r#"{{"version":1,"nodes":[{{"type":"gain","label":"{escaped}"}}]}}"#),
            format!(r#"{{"version":1,"nodes":[],"unknown":"{escaped}"}}"#),
            format!(r#"{{"version":1,"nodes":[],"{escaped}":null}}"#),
        ] {
            let result = raw(&input);
            assert_eq!(result, json!({"error": ERROR}), "{input}");
        }
    }
    for escaped in [r"\u12G4", r"\u123", r"\q"] {
        let result = raw(&format!(
            r#"{{"version":1,"nodes":[{{"type":"gain","label":"{escaped}"}}]}}"#
        ));
        assert!(
            result["error"]
                .as_str()
                .unwrap()
                .starts_with("HyperFrames FX chain is not valid JSON:")
        );
    }
}

#[test]
fn paired_surrogates_and_literal_escape_text_remain_exact() {
    for (escaped, expected) in [
        (r"\ud800\udc00", "\u{10000}"),
        (r"\uDBFF\uDFFF", "\u{10ffff}"),
        (r"\uD83C\uDFB5", "\u{1f3b5}"),
        (r"\\ud800", r"\ud800"),
        (r"\uFFFD", "\u{fffd}"),
    ] {
        let result = raw(&format!(
            r#"{{"version":1,"nodes":[{{"type":"gain","label":"{escaped}"}}]}}"#
        ));
        assert!(result.get("error").is_none(), "{result}");
        assert_eq!(result["chain"]["nodes"][0]["label"], expected);
    }
}

#[test]
fn static_tail_is_serial_sum_capped_at_five_not_a_render_duration() {
    for (nodes, expected) in [
        (json!([]), 0.0),
        (
            json!([{"type":"gain"},{"type":"phaser"},{"type":"compressor"}]),
            0.0,
        ),
        (json!([{"type":"reverb","params":{"size":0.5}}]), 1.9),
        (
            json!([{"type":"delay","params":{"time":100,"feedback":0.1}}]),
            0.3,
        ),
        (
            json!([{"type":"chorus","params":{"delay":100,"depth":10}}]),
            0.1,
        ),
        (json!([{"type":"pitchshift","params":{"semitones":0}}]), 0.2),
        (
            json!([{"type":"reverb","enabled":false},{"type":"delay","params":{"mix":0}},
            {"type":"reverb","params":{"wet":0}},{"type":"chorus","params":{"mix":0}},
            {"type":"pitchshift","params":{"mix":0}}]),
            0.0,
        ),
        (
            json!([{"type":"reverb","presetAmount":0,"params":{"size":0.5}},
            {"type":"chorus","params":{"delay":100}},{"type":"pitchshift"}]),
            2.2,
        ),
        (
            json!([{"type":"reverb"},{"type":"delay","params":{"time":5000,"feedback":0.95}}]),
            5.0,
        ),
    ] {
        let result = resolve(chain(nodes));
        let actual = result["staticTailSeconds"].as_f64().unwrap();
        assert!((actual - expected).abs() < 1e-12, "{actual} != {expected}");
        assert!(result.get("capabilities").is_none());
    }
}
