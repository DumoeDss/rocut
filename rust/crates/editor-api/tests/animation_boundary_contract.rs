#[path = "../src/animation_boundary/mod.rs"]
mod animation_boundary;
#[path = "../src/animation_numeric/mod.rs"]
mod animation_numeric;

use animation_boundary::*;
use animation_numeric::{Extrapolation, Handle, ScalarKey, Segment, ValidatedChannel};
use serde_json::{Value, json};

fn key(time: u64, value: f64, segment: &str) -> Value {
    json!({"time": time, "value": value, "segmentToNext": segment})
}
fn channel(keys: Vec<Value>) -> Value {
    json!({"keys": keys, "extrapolation": {"before": "hold", "after": "hold"}})
}
fn sample_item(id: &str, keys: Vec<Value>, times: Vec<f64>) -> Value {
    json!({"id": id, "channel": channel(keys), "fallbackValue": 0.5, "times": times})
}
fn inspection_item(id: &str, keys: Vec<Value>, nodes: u32) -> Value {
    json!({"id": id, "channel": channel(keys), "fallbackValue": 0.5,
        "domain": {"start": 0, "end": 120000}, "bounds": {"min": 0, "max": 1, "displayMultiplier": 1},
        "budget": {"maxNodes": nodes}})
}
fn request(items: Vec<Value>) -> Value {
    json!({"version": VERSION, "numericSemantics": NUMERIC_SEMANTICS, "items": items})
}
fn run_sample(items: Vec<Value>) -> Value {
    sample(request(items))
}
fn sample(input: Value) -> Value {
    decode(sample_scalar_animation_batch_json(input.to_string()))
}
fn inspect(items: Vec<Value>, nodes: u32) -> Value {
    let mut input = request(items);
    input["budget"] = json!({"maxNodes": nodes});
    decode(inspect_scalar_animation_domains_json(input.to_string()))
}
fn decode(output: String) -> Value {
    assert!(output.len() <= MAX_OUTPUT_BYTES);
    let result: Value = serde_json::from_str(&output).unwrap();
    assert_eq!(result["version"], 1);
    assert!(result.get("ok").is_none());
    result
}
fn request_error(result: &Value, code: &str) {
    assert_eq!(result["kind"], "request-error", "{result}");
    assert_eq!(result["error"]["code"], code, "{result}");
    assert!(result.get("results").is_none());
}
fn item_error(result: &Value, index: usize, code: &str) {
    assert_eq!(result["kind"], "batch-result");
    let item = &result["results"][index];
    assert_eq!(item["status"], "error", "{item}");
    assert_eq!(item["error"]["code"], code, "{item}");
    assert!(item.get("values").is_none());
}
fn smooth() -> Vec<Value> {
    let mut first = key(0, 0.0, "bezier");
    first["rightHandle"] = json!({"dt": 50400, "dv": 0});
    let mut last = key(120000, 1.0, "linear");
    last["leftHandle"] = json!({"dt": -50400, "dv": 0});
    vec![first, last]
}

#[test]
fn empty_batches_are_explicit_and_ordered_mixed_samples_are_isolated() {
    assert_eq!(run_sample(vec![])["results"], json!([]));
    let mut invalid = sample_item("bad", vec![], vec![0.0]);
    invalid["channel"]["extra"] = json!(true);
    let output = run_sample(vec![
        sample_item("empty", vec![], vec![-1.5, 0.25]),
        invalid,
        sample_item(
            "linear",
            vec![key(0, 0.0, "linear"), key(10, 1.0, "step")],
            vec![7.5, 2.5, 0.0],
        ),
    ]);
    assert_eq!(output["numericSemantics"], NUMERIC_SEMANTICS);
    assert_eq!(output["results"][0]["values"], json!([0.5, 0.5]));
    assert_eq!(output["results"][2]["values"], json!([0.75, 0.25, 0.0]));
    assert_eq!(output["results"][0]["id"], "empty");
    assert_eq!(output["results"][1]["id"], "bad");
    assert_eq!(output["results"][2]["id"], "linear");
    item_error(&output, 1, "unknown-field");
}

#[test]
fn json_syntax_duplicates_and_trailing_values_are_atomic_request_errors() {
    for input in [
        "",
        "  \r\n\t",
        "{",
        "null",
        "[]",
        "{} {}",
        "{\"version\":NaN}",
        "{\"version\":Infinity}",
        "{\"version\":1e309}",
    ] {
        let output = decode(sample_scalar_animation_batch_json(input.into()));
        assert_eq!(output["kind"], "request-error", "{input}");
        assert!(output.get("results").is_none());
    }
    for input in [
        r#"{"version":1,"version":1}"#,
        r#"{"items":[{"id":"a","id":"b"}]}"#,
        r#"{"items":[{"channel":{"keys":[{"value":1,"value":2}]}}]}"#,
        r#"{"version":1,"\u0076ersion":1}"#,
    ] {
        request_error(
            &decode(sample_scalar_animation_batch_json(input.into())),
            "duplicate-field",
        );
    }
}

#[test]
fn versions_semantics_unknown_fields_and_ids_have_stable_request_codes() {
    for version in [json!(2), json!(1.0), json!("1"), json!(null)] {
        let mut input = request(vec![]);
        input["version"] = version;
        request_error(&sample(input), "unsupported-version");
    }
    let mut input = request(vec![]);
    input["numericSemantics"] = json!("scalar-f64-v2");
    request_error(&sample(input), "unsupported-semantics");
    let mut input = request(vec![]);
    input["unknown"] = json!(1);
    request_error(&sample(input), "unknown-field");
    for item in [json!({}), json!({"id": ""}), json!({"id": 3}), json!(false)] {
        request_error(&run_sample(vec![item]), "invalid-id");
    }
    request_error(
        &run_sample(vec![
            sample_item("same", vec![], vec![]),
            sample_item("same", vec![], vec![]),
        ]),
        "duplicate-id",
    );
    let mut input = request(vec![]);
    input.as_object_mut().unwrap().remove("version");
    request_error(&sample(input), "missing-field");
}

#[test]
fn utf8_decoded_string_and_input_capacity_limits_are_enforced() {
    let id = "\u{754c}".repeat(85) + "a";
    assert_eq!(id.len(), MAX_STRING_BYTES);
    assert_eq!(
        run_sample(vec![sample_item(&id, vec![], vec![])])["results"][0]["id"],
        id
    );
    let id = "\u{754c}".repeat(86);
    request_error(
        &run_sample(vec![sample_item(&id, vec![], vec![])]),
        "string-bytes",
    );
    let escaped = format!(r#"{{"{}":0}}"#, "\\u0061".repeat(257));
    request_error(
        &decode(sample_scalar_animation_batch_json(escaped)),
        "string-bytes",
    );
    request_error(
        &decode(sample_scalar_animation_batch_json(
            " ".repeat(MAX_INPUT_BYTES + 1),
        )),
        "input-bytes",
    );
    let mut input = String::with_capacity(MAX_INPUT_BYTES + 1);
    input.push_str("{}");
    request_error(
        &decode(sample_scalar_animation_batch_json(input)),
        "input-bytes",
    );
    request_error(
        &decode(sample_scalar_animation_batch_json(
            " ".repeat(MAX_INPUT_BYTES),
        )),
        "empty-input",
    );
}

#[test]
fn parser_depth_and_value_counts_are_bounded() {
    let input = format!(
        "{}0{}",
        "[".repeat(MAX_JSON_DEPTH + 1),
        "]".repeat(MAX_JSON_DEPTH + 1)
    );
    request_error(
        &decode(sample_scalar_animation_batch_json(input)),
        "json-depth",
    );
    let input = format!("[{}0]", "0,".repeat(MAX_JSON_NODES));
    request_error(
        &decode(sample_scalar_animation_batch_json(input)),
        "json-nodes",
    );
}

#[test]
fn canonical_key_fields_are_required_and_metadata_is_not_interpreted() {
    for field in ["time", "value", "segmentToNext"] {
        let mut source = key(0, 1.0, "linear");
        source.as_object_mut().unwrap().remove(field);
        item_error(
            &run_sample(vec![sample_item("a", vec![source], vec![0.0])]),
            0,
            "missing-field",
        );
    }
    for field in ["id", "tangentMode", "tangent", "extra"] {
        let mut source = key(0, 1.0, "linear");
        source[field] = json!("flat");
        let output = run_sample(vec![sample_item("a", vec![source], vec![0.0])]);
        item_error(&output, 0, "unknown-field");
        assert_eq!(output["results"][0]["error"]["keyIndex"], 0);
    }
    let mut item = sample_item("a", vec![], vec![]);
    item["channel"]
        .as_object_mut()
        .unwrap()
        .remove("extrapolation");
    item_error(&run_sample(vec![item]), 0, "missing-field");
}

#[test]
fn unsafe_fractional_or_noninteger_key_time_tokens_are_rejected() {
    for time in [
        json!(-1),
        json!(0.5),
        json!(1.0),
        json!(9007199254740992u64),
        json!("1"),
        json!(null),
    ] {
        let mut source = key(0, 1.0, "linear");
        source["time"] = time;
        item_error(
            &run_sample(vec![sample_item("a", vec![source], vec![])]),
            0,
            "invalid-key-time",
        );
    }
    // A fractional token can round to a safe integer f64. Do not accept it as a
    // canonical integer key simply because its rounded value has zero fraction.
    let input = request(vec![sample_item("a", vec![key(0, 1.0, "linear")], vec![])])
        .to_string()
        .replace("\"time\":0", "\"time\":9007199254740990.5");
    item_error(
        &decode(sample_scalar_animation_batch_json(input)),
        0,
        "invalid-key-time",
    );
}

#[test]
fn unordered_keys_and_invalid_handles_are_not_normalized() {
    for keys in [
        vec![key(2, 0.0, "linear"), key(1, 1.0, "linear")],
        vec![key(1, 0.0, "linear"), key(1, 1.0, "linear")],
    ] {
        let output = run_sample(vec![sample_item("a", keys, vec![1.0])]);
        item_error(&output, 0, "unordered-keys");
        assert_eq!(output["results"][0]["error"]["keyIndex"], 1);
    }
    for (field, dt) in [
        ("leftHandle", json!(1)),
        ("rightHandle", json!(-1)),
        ("rightHandle", json!(0.5)),
        ("rightHandle", json!(9007199254740992u64)),
    ] {
        let mut source = key(0, 1.0, "linear");
        source[field] = json!({"dt": dt, "dv": 0});
        item_error(
            &run_sample(vec![sample_item("a", vec![source], vec![])]),
            0,
            "invalid-handle",
        );
    }
}

#[test]
fn finite_f64_bits_roundtrip_without_clamp_or_fallback_substitution() {
    let values = [
        0.0,
        -0.0,
        f64::from_bits(1),
        -f64::from_bits(1),
        f64::MIN_POSITIVE,
        0.10000000000000002,
        f64::MAX,
        -f64::MAX,
    ];
    let items = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let mut item = sample_item(&index.to_string(), vec![], vec![-1.25, 0.5, f64::MAX]);
            item["fallbackValue"] = json!(value);
            item
        })
        .collect();
    let output = run_sample(items);
    for (index, expected) in values.iter().enumerate() {
        for value in output["results"][index]["values"].as_array().unwrap() {
            assert_eq!(value.as_f64().unwrap().to_bits(), expected.to_bits());
        }
    }
}

#[test]
fn sampling_matches_the_frozen_kernel_at_fractional_and_large_local_times() {
    let base = animation_numeric::MAX_SAFE_TICKS - 20;
    for (name, segment) in [
        ("step", Segment::Step),
        ("linear", Segment::Linear),
        ("bezier", Segment::Bezier),
    ] {
        for (before_name, before) in [
            ("hold", Extrapolation::Hold),
            ("linear", Extrapolation::Linear),
        ] {
            for start in [0, base] {
                let keys = [
                    ScalarKey {
                        time: start,
                        value: 0.2,
                        segment,
                        left: None,
                        right: Some(Handle { dt: 50, dv: 0.7 }),
                    },
                    ScalarKey {
                        time: start + 20,
                        value: 0.8,
                        segment: Segment::Linear,
                        left: Some(Handle { dt: -50, dv: -0.4 }),
                        right: None,
                    },
                ];
                let kernel =
                    ValidatedChannel::new(&keys, before, Extrapolation::Linear, 0.5).unwrap();
                let times =
                    [-2.5, 0.0, 0.25, 1.5, 9.25, 19.75, 20.0, 21.5].map(|time| start as f64 + time);
                let mut a = key(start, 0.2, name);
                a["rightHandle"] = json!({"dt": 50, "dv": 0.7});
                let mut b = key(start + 20, 0.8, "linear");
                b["leftHandle"] = json!({"dt": -50, "dv": -0.4});
                let mut item = sample_item("parity", vec![a, b], times.to_vec());
                item["channel"]["extrapolation"] =
                    json!({"before": before_name, "after": "linear"});
                let output = run_sample(vec![item]);
                for (index, time) in times.iter().enumerate() {
                    assert_eq!(
                        output["results"][0]["values"][index]
                            .as_f64()
                            .unwrap()
                            .to_bits(),
                        kernel.sample(*time).unwrap().to_bits()
                    );
                }
            }
        }
    }
}

#[test]
fn nonfinite_later_sample_discards_earlier_values_but_not_other_items() {
    let item = sample_item(
        "overflow",
        vec![key(0, -f64::MAX, "linear"), key(10, f64::MAX, "linear")],
        vec![0.0, 5.0, 10.0],
    );
    let output = run_sample(vec![item, sample_item("next", vec![], vec![0.0])]);
    item_error(&output, 0, "non-finite-arithmetic");
    assert_eq!(output["results"][0]["error"]["sampleIndex"], 1);
    assert_eq!(output["results"][0]["error"]["keyIndex"], 0);
    assert_eq!(output["results"][1]["values"], json!([0.5]));
    assert!(!output.to_string().contains("null"));
}

#[test]
fn malformed_later_sample_also_discards_earlier_values() {
    let mut item = sample_item("bad-time", vec![], vec![]);
    item["times"] = json!([0, null, 1]);
    let output = run_sample(vec![item]);
    item_error(&output, 0, "finite-number");
    assert_eq!(output["results"][0]["error"]["sampleIndex"], 1);
}

#[test]
fn item_and_aggregate_count_limits_are_distinct_and_atomic() {
    let items = (0..=MAX_ITEMS)
        .map(|i| sample_item(&i.to_string(), vec![], vec![]))
        .collect();
    request_error(&run_sample(items), "item-count");
    item_error(
        &run_sample(vec![sample_item(
            "keys",
            vec![key(0, 1.0, "linear"); MAX_ITEM_KEYS + 1],
            vec![],
        )]),
        0,
        "item-key-count",
    );
    item_error(
        &run_sample(vec![sample_item(
            "samples",
            vec![],
            vec![0.0; MAX_ITEM_SAMPLES + 1],
        )]),
        0,
        "item-sample-count",
    );
    let items = (0..(MAX_REQUEST_KEYS / MAX_ITEM_KEYS + 1))
        .map(|i| {
            sample_item(
                &i.to_string(),
                vec![key(0, 1.0, "linear"); MAX_ITEM_KEYS],
                vec![],
            )
        })
        .collect();
    request_error(&run_sample(items), "request-key-count");
    let items = (0..17)
        .map(|i| sample_item(&i.to_string(), vec![], vec![0.0; MAX_ITEM_SAMPLES]))
        .collect();
    request_error(&run_sample(items), "request-sample-count");
}

#[test]
fn exact_count_limits_are_accepted_and_output_remains_bounded() {
    let items = (0..MAX_ITEMS)
        .map(|i| sample_item(&i.to_string(), vec![], vec![]))
        .collect();
    assert_eq!(
        run_sample(items)["results"].as_array().unwrap().len(),
        MAX_ITEMS
    );
    let items = (0..16)
        .map(|i| {
            let mut item = sample_item(&i.to_string(), vec![], vec![0.0; MAX_ITEM_SAMPLES]);
            item["fallbackValue"] = json!(-f64::MAX);
            item
        })
        .collect();
    let output = run_sample(items);
    let total: usize = output["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["values"].as_array().unwrap().len())
        .sum();
    assert_eq!(total, MAX_REQUEST_SAMPLES);
    let keys = (0..MAX_ITEM_KEYS)
        .map(|i| key(i as u64, 1.0, "step"))
        .collect::<Vec<_>>();
    let output = run_sample(
        (0..4)
            .map(|i| sample_item(&i.to_string(), keys.clone(), vec![2.5]))
            .collect(),
    );
    for item in output["results"].as_array().unwrap() {
        assert_eq!(item["values"], json!([1.0]));
    }
}

#[test]
fn safe_inspection_reports_enclosures_domain_and_semantics_without_admission_flag() {
    let mut item = inspection_item(
        "linear",
        vec![key(0, 0.0, "linear"), key(120000, 1.0, "linear")],
        0,
    );
    item["bounds"] = json!({"min": -2, "max": 0, "displayMultiplier": -2});
    let output = inspect(vec![item], 1);
    let result = &output["results"][0];
    assert_eq!(result["status"], "safe");
    assert_eq!(result["values"], json!({"min": 0.0, "max": 1.0}));
    assert_eq!(result["displayed"], json!({"min": -2.0, "max": 0.0}));
    assert_eq!(result["domain"], json!({"start": 0.0, "end": 120000.0}));
    assert_eq!(result["certificateVersion"], 1);
    assert_eq!(result["numericSemantics"], NUMERIC_SEMANTICS);
    assert_eq!(result["visitedNodes"], 0);
    assert_eq!(output["budget"], json!({"maxNodes": 1, "visitedNodes": 0}));
}

#[test]
fn ordinary_smooth_curve_uses_one_certificate_node() {
    let output = inspect(
        vec![
            inspection_item("small", smooth(), 1),
            inspection_item("large", smooth(), 65536),
        ],
        MAX_REQUEST_NODES,
    );
    for result in output["results"].as_array().unwrap() {
        assert_eq!(result["status"], "safe");
        assert_eq!(result["visitedNodes"], 1);
        assert!(result["values"]["min"].as_f64().unwrap() >= 0.0);
        assert!(result["values"]["max"].as_f64().unwrap() <= 1.0);
    }
}

#[test]
fn near_boundary_curve_remains_unresolved_not_invalid() {
    let mut keys = smooth();
    keys[0]["value"] = json!(1.0_f64.next_down());
    let output = inspect(vec![inspection_item("near-boundary", keys, 4096)], 8192);
    let result = &output["results"][0];
    assert_eq!(result["status"], "unresolved");
    assert_eq!(result["reason"]["code"], "budget-exhausted");
    assert_eq!(result["visitedNodes"], 4096);
    assert!(result.get("values").is_none());
}

#[test]
fn inspection_request_budget_is_actual_cumulative_and_never_truncates_items() {
    let keys = (0..=9)
        .map(|index| {
            key(
                index * 12000,
                if index % 2 == 0 { 0.25 } else { 0.75 },
                "bezier",
            )
        })
        .collect();
    let output = inspect(
        vec![
            inspection_item("zero-cost", vec![], 10),
            inspection_item("first", keys, 65536),
            inspection_item("unstarted", vec![], 65536),
        ],
        8,
    );
    assert_eq!(output["results"].as_array().unwrap().len(), 3);
    assert_eq!(output["results"][0]["status"], "safe");
    assert_eq!(output["results"][1]["status"], "unresolved");
    assert_eq!(
        output["results"][1]["budget"],
        json!({"requestedNodes": 65536, "effectiveNodes": 8})
    );
    assert_eq!(
        output["results"][1]["reason"]["code"],
        "request-budget-exhausted"
    );
    assert_eq!(output["results"][1]["visitedNodes"], 8);
    assert_eq!(output["results"][2]["id"], "unstarted");
    assert_eq!(
        output["results"][2]["reason"]["code"],
        "request-budget-exhausted"
    );
    assert_eq!(output["results"][2]["visitedNodes"], 0);
    assert_eq!(output["results"][2]["budget"]["effectiveNodes"], 0);
    assert_eq!(output["budget"]["visitedNodes"], 8);
}

#[test]
fn zero_request_budget_validates_errors_and_marks_only_valid_items_unresolved() {
    let mut domain = inspection_item("domain", vec![], 1);
    domain["domain"]["start"] = json!(120001);
    let mut bounds = inspection_item("bounds", vec![], 1);
    bounds["bounds"]["min"] = json!(2);
    let budget = inspection_item("budget", vec![], 65537);
    let keys = inspection_item(
        "keys",
        vec![key(2, 0.0, "linear"), key(1, 1.0, "linear")],
        1,
    );
    let output = inspect(
        vec![
            inspection_item("valid", vec![], 0),
            domain,
            bounds,
            budget,
            keys,
        ],
        0,
    );
    assert_eq!(output["results"][0]["status"], "unresolved");
    assert_eq!(
        output["results"][0]["reason"]["code"],
        "request-budget-exhausted"
    );
    item_error(&output, 1, "invalid-domain");
    item_error(&output, 2, "invalid-bounds");
    item_error(&output, 3, "invalid-budget");
    item_error(&output, 4, "unordered-keys");
    assert_eq!(output["budget"]["visitedNodes"], 0);
}

#[test]
fn inspection_budgets_are_required_integer_values_without_implicit_defaults() {
    let mut request = request(vec![]);
    request["budget"] = json!({"maxNodes": MAX_REQUEST_NODES + 1});
    request_error(
        &decode(inspect_scalar_animation_domains_json(request.to_string())),
        "invalid-budget",
    );
    request.as_object_mut().unwrap().remove("budget");
    request_error(
        &decode(inspect_scalar_animation_domains_json(request.to_string())),
        "missing-field",
    );
    for budget in [
        json!({"maxNodes": -1}),
        json!({"maxNodes": 1.0}),
        json!({"maxNodes": 1, "unknown": true}),
        json!({}),
    ] {
        let mut item = inspection_item("budget", vec![], 0);
        item["budget"] = budget;
        assert_eq!(inspect(vec![item], 1)["results"][0]["status"], "error");
    }
}

#[test]
fn item_zero_budget_can_prove_constant_but_not_nonconstant_bezier() {
    let output = inspect(
        vec![
            inspection_item(
                "constant",
                vec![key(0, 1.0, "bezier"), key(120000, 1.0, "linear")],
                0,
            ),
            inspection_item("smooth", smooth(), 0),
        ],
        1,
    );
    assert_eq!(output["results"][0]["status"], "safe");
    assert_eq!(output["results"][1]["status"], "unresolved");
    assert_eq!(output["results"][1]["reason"]["code"], "budget-exhausted");
    assert_eq!(output["budget"]["visitedNodes"], 0);
}

#[test]
fn violations_have_replayable_witness_and_nonfinite_arithmetic_omits_value() {
    let keys = vec![key(0, -f64::MAX, "linear"), key(120000, f64::MAX, "linear")];
    let mut arithmetic = inspection_item("arithmetic", keys, 1);
    arithmetic["bounds"] = json!({"displayMultiplier": 1});
    let output = inspect(
        vec![
            inspection_item("range", vec![key(0, 1.5, "linear")], 1),
            arithmetic,
        ],
        1,
    );
    let range = &output["results"][0];
    assert_eq!(range["status"], "violation");
    assert_eq!(range["reason"]["code"], "outside-bounds");
    let sampled = run_sample(vec![sample_item(
        "replay",
        vec![key(0, 1.5, "linear")],
        vec![range["time"].as_f64().unwrap()],
    )]);
    assert_eq!(
        range["value"].as_f64().unwrap().to_bits(),
        sampled["results"][0]["values"][0]
            .as_f64()
            .unwrap()
            .to_bits()
    );
    let arithmetic = &output["results"][1];
    assert_eq!(arithmetic["status"], "violation");
    assert_eq!(arithmetic["reason"]["code"], "non-finite-arithmetic");
    assert!(arithmetic.get("value").is_none());
    assert!(!output.to_string().contains("null"));
}

#[test]
fn display_overflow_has_finite_scalar_witness_and_no_null_substitution() {
    let mut item = inspection_item("display", vec![], 0);
    item["fallbackValue"] = json!(f64::MAX);
    item["bounds"] = json!({"displayMultiplier": 2});
    let output = inspect(vec![item], 1);
    assert_eq!(output["results"][0]["status"], "violation");
    assert_eq!(
        output["results"][0]["reason"]["code"],
        "non-finite-arithmetic"
    );
    assert_eq!(output["results"][0]["value"].as_f64().unwrap(), f64::MAX);
}

#[test]
fn fractional_negative_domain_is_preserved_without_frame_or_clip_mapping() {
    let mut item = inspection_item(
        "local",
        vec![key(0, 0.0, "linear"), key(10, 1.0, "linear")],
        0,
    );
    item["domain"] = json!({"start": -1.25, "end": 2.5});
    item["channel"]["extrapolation"]["before"] = json!("linear");
    item["bounds"] = json!({"displayMultiplier": 1});
    let output = inspect(vec![item], 1);
    assert_eq!(output["results"][0]["status"], "safe");
    assert_eq!(
        output["results"][0]["domain"],
        json!({"start": -1.25, "end": 2.5})
    );
    assert_eq!(
        output["results"][0]["values"],
        json!({"min": -0.125, "max": 0.25})
    );
}

#[test]
fn inspection_item_budget_is_shared_across_segments_not_reset_per_segment() {
    let keys = (0..32)
        .map(|i| key(i * 120000, if i % 2 == 0 { 0.2 } else { 0.8 }, "bezier"))
        .collect();
    let mut item = inspection_item("long", keys, 20);
    item["domain"]["end"] = json!(31 * 120000);
    let output = inspect(vec![item], 100);
    assert_eq!(output["results"][0]["status"], "unresolved");
    assert_eq!(output["results"][0]["visitedNodes"], 20);
    assert_eq!(output["results"][0]["reason"]["code"], "budget-exhausted");
    assert!(output["results"][0]["reason"]["keyIndex"].as_u64().unwrap() > 0);
    assert_eq!(output["budget"]["visitedNodes"], 20);
}

#[test]
fn unknown_fields_are_rejected_at_every_nested_schema_boundary() {
    for pointer in [
        "",
        "/channel",
        "/channel/extrapolation",
        "/channel/keys/0",
        "/channel/keys/0/rightHandle",
        "/domain",
        "/bounds",
        "/budget",
    ] {
        let mut source = key(0, 0.5, "linear");
        source["rightHandle"] = json!({"dt": 0, "dv": 0});
        let mut item = inspection_item("unknown", vec![source], 1);
        item.pointer_mut(pointer).unwrap()["a/b~c"] = json!(0);
        let output = inspect(vec![item], 1);
        item_error(&output, 0, "unknown-field");
        assert_eq!(
            output["results"][0]["error"]["path"],
            format!("$/items/0{pointer}/a~1b~0c")
        );
    }
}

#[test]
fn optional_numeric_fields_are_absent_not_null_and_required_fields_never_default() {
    for pointer in [
        "/channel/keys/0/leftHandle",
        "/bounds/min",
        "/bounds/max",
        "/domain/start",
        "/bounds/displayMultiplier",
        "/fallbackValue",
    ] {
        let mut item = inspection_item("null", vec![key(0, 0.5, "linear")], 0);
        let (parent, field) = pointer.rsplit_once('/').unwrap();
        item.pointer_mut(parent).unwrap()[field] = Value::Null;
        assert_eq!(
            inspect(vec![item], 1)["results"][0]["status"],
            "error",
            "{pointer}"
        );
    }
    for (parent, field) in [
        ("", "fallbackValue"),
        ("/domain", "end"),
        ("/bounds", "displayMultiplier"),
        ("/channel/extrapolation", "before"),
    ] {
        let mut item = inspection_item("missing", vec![], 0);
        item.pointer_mut(parent)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove(field);
        item_error(&inspect(vec![item], 1), 0, "missing-field");
    }
}

#[test]
fn failed_item_does_not_consume_inspection_budget_or_affect_next_request() {
    let mut invalid = inspection_item("invalid", smooth(), 65536);
    invalid["bounds"]["max"] = json!(-1);
    let output = inspect(vec![invalid, inspection_item("valid", smooth(), 16)], 16);
    item_error(&output, 0, "invalid-bounds");
    assert_eq!(output["results"][1]["budget"]["effectiveNodes"], 16);
    assert_eq!(output["results"][1]["status"], "safe");
    assert_eq!(output["results"][1]["visitedNodes"], 1);
    assert_eq!(output["budget"]["visitedNodes"], 1);
    let again = inspect(vec![inspection_item("valid", smooth(), 16)], 16);
    assert_eq!(output["results"][1], again["results"][0]);
}

#[test]
fn escaped_strings_and_ids_use_decoded_utf8_bytes_and_duplicate_identity() {
    let input = format!(
        r#"{{"version":1,"numericSemantics":"scalar-f64-v1","items":[{{"id":"{}","channel":{{"keys":[],"extrapolation":{{"before":"hold","after":"hold"}}}},"fallbackValue":1,"times":[]}}]}}"#,
        r"\u0061".repeat(256)
    );
    let output = decode(sample_scalar_animation_batch_json(input));
    assert_eq!(output["results"][0]["id"].as_str().unwrap().len(), 256);
    let input = request(vec![
        sample_item("a", vec![], vec![]),
        sample_item("b", vec![], vec![]),
    ])
    .to_string()
    .replace("\"id\":\"b\"", r#""id":"\u0061""#);
    request_error(
        &decode(sample_scalar_animation_batch_json(input)),
        "duplicate-id",
    );
}
