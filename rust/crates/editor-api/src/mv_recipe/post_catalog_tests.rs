use crate::mv_recipe::{model::Effect, post_automation, post_catalog};
use serde_json::{Value, json};

fn samples() -> Vec<Value> {
    vec![
        json!({"kind":"lightLeak","amount":0.5,"alpha":"preserve","speed":1,"seedOffset":0}),
        json!({"kind":"invert","amount":0.5}),
        json!({"kind":"flash","amount":0.5,"color":[0.2,0.4,0.6]}),
        json!({"kind":"fade","amount":0.5}),
        json!({"kind":"letterbox","amount":0.5,"heightFraction":0.1}),
        json!({"kind":"quantizationDither","amount":0.5}),
        json!({"kind":"grade","exposure":0,"contrast":1,"saturation":1,"lift":[0,0,0],"gain":[1,1,1]}),
        json!({"kind":"palette","colors":[[0,0,0,1],[1,1,1,1]],"mix":0.5}),
        json!({"kind":"vignette","amount":0.5}),
        json!({"kind":"grain","amount":0.5,"fps":30}),
        json!({"kind":"lineBoil","amount":1,"cellSize":16,"fps":30}),
        json!({"kind":"glitch","amount":0.5,"bands":8,"fps":30}),
        json!({"kind":"chromaticAberration","amount":1,"center":[0.5,0.5]}),
        json!({"kind":"zoomBlur","amount":0.5,"center":[0.5,0.5]}),
        json!({"kind":"bloom","amount":1,"threshold":0.5,"radius":8,"alpha":"preserve"}),
    ]
}

fn valid(value: &Value) -> bool {
    serde_json::from_value::<Effect>(value.clone()).is_ok_and(|effect| effect.valid())
}

fn options(rule: &Value) -> &Vec<Value> {
    rule.get("options")
        .or_else(|| rule.get("values"))
        .unwrap()
        .as_array()
        .unwrap()
}

// Every candidate is labelled by the schema, then exercised through the real
// serde model and Effect::valid rather than a second catalog validator.
fn probes(rule: &Value, value: &Value) -> Vec<(Value, bool)> {
    match rule["type"].as_str().unwrap() {
        "number" | "integer" => {
            let min = rule["min"].as_f64().unwrap();
            let max = rule["max"].as_f64().unwrap();
            let integer = rule["type"] == "integer" || rule["integer"] == true;
            let bound = |v: f64| if integer { json!(v as u64) } else { json!(v) };
            let mut out = vec![
                (bound(min), true),
                (bound(max), true),
                (json!(min - 1.0), false),
                (json!(max + 1.0), false),
                (json!("not a number"), false),
                (Value::Null, false),
            ];
            if integer {
                out.push((json!(min + 0.5), false));
            }
            out
        }
        "enum" => {
            let mut out: Vec<_> = options(rule).iter().cloned().map(|v| (v, true)).collect();
            out.push((json!("unknown"), false));
            out.push((json!(0), false));
            out
        }
        "rgb" | "rgba" | "tuple" => {
            let values = value.as_array().unwrap();
            let items: Vec<Value> = if rule["type"] == "tuple" {
                rule["items"].as_array().unwrap().clone()
            } else {
                vec![
                    json!({"type":"number","min":rule["min"],"max":rule["max"]});
                    rule["length"].as_u64().unwrap() as usize
                ]
            };
            assert_eq!(items.len(), values.len());
            let mut out = vec![
                (json!([]), false),
                (json!(vec![0; values.len() + 1]), false),
            ];
            for (index, item) in items.iter().enumerate() {
                for (next, accepted) in probes(item, &values[index]) {
                    let mut copy = values.clone();
                    copy[index] = next;
                    out.push((json!(copy), accepted));
                }
            }
            out
        }
        "array" => {
            let values = value.as_array().unwrap();
            let min = rule["minItems"].as_u64().unwrap() as usize;
            let max = rule["maxItems"].as_u64().unwrap() as usize;
            let mut out = vec![
                (json!(vec![values[0].clone(); min]), true),
                (json!(vec![values[0].clone(); max]), true),
                (json!(vec![values[0].clone(); min - 1]), false),
                (json!(vec![values[0].clone(); max + 1]), false),
            ];
            for (next, accepted) in probes(&rule["items"], &values[0]) {
                let mut copy = values.clone();
                copy[0] = next;
                out.push((json!(copy), accepted));
            }
            out
        }
        other => panic!("Untested schema {other}"),
    }
}

#[test]
fn all_fifteen_finishing_schemas_match_real_types_bounds_and_required_fields() {
    let catalog = post_catalog::finishing();
    let effects = catalog["effects"].as_object().unwrap();
    assert_eq!(effects.len(), 15);
    for sample in samples() {
        let kind = sample["kind"].as_str().unwrap();
        let parameters = effects[kind]["parameters"].as_object().unwrap();
        assert_eq!(
            parameters.len(),
            sample.as_object().unwrap().len() - 1,
            "{kind}"
        );
        assert!(valid(&sample), "{kind}");
        for (key, rule) in parameters {
            let mut missing = sample.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert_eq!(
                valid(&missing),
                rule["required"] == false,
                "{kind}.{key} required"
            );
            for (value, accepted) in probes(rule, &sample[key]) {
                let mut candidate = sample.clone();
                candidate[key] = value;
                assert_eq!(valid(&candidate), accepted, "{kind}.{key}: {candidate}");
            }
        }
    }
}

fn curve(value: f64, frame: u32) -> post_automation::AmountCurve {
    serde_json::from_value(
        json!({"effect":0,"keyframes":[{"frame":frame,"value":value,"easing":"linear"}]}),
    )
    .unwrap()
}

#[test]
fn machine_targets_and_amount_bounds_match_audio_and_real_automation_admission() {
    let catalog = post_catalog::finishing();
    assert_eq!(catalog["automation"]["targetParameter"], "amount");
    let targets = catalog["automation"]["targetEffects"].as_array().unwrap();
    assert_eq!(targets.len(), 13);
    for sample in samples() {
        let kind = sample["kind"].as_str().unwrap().to_owned();
        let mut effect: Effect = serde_json::from_value(sample).unwrap();
        let max = effect.audio_amount().map(|(_, max)| max);
        assert_eq!(targets.contains(&json!(kind)), max.is_some(), "{kind}");
        let rule = &catalog["effects"][&kind]["parameters"]["amount"];
        if let Some(max) = max {
            assert_eq!(rule["min"].as_f64(), Some(0.0), "{kind}");
            assert_eq!(rule["max"].as_f64(), Some(max), "{kind}");
            for (value, accepted) in [
                (0.0, true),
                (max, true),
                (-0.001, false),
                (max + 0.001, false),
            ] {
                assert_eq!(
                    post_automation::valid(&[curve(value, 30)], &[effect.clone()], 30),
                    accepted,
                    "{kind} {value}"
                );
                *effect.audio_amount().unwrap().0 = value;
                assert_eq!(effect.valid(), accepted, "{kind} static {value}");
            }
            *effect.audio_amount().unwrap().0 = f64::NAN;
            assert!(!effect.valid(), "{kind} NaN");
            let mut nonfinite = curve(0.0, 0);
            nonfinite.keyframes[0].value = f64::INFINITY;
            assert!(!post_automation::valid(&[nonfinite], &[effect], 30));
        } else {
            assert!(rule.is_null(), "{kind} has no fictional amount");
            assert!(!post_automation::valid(&[curve(0.5, 0)], &[effect], 30));
        }
    }
}

#[test]
fn automation_catalog_preserves_key_frame_and_easing_contracts() {
    let catalog = post_catalog::finishing();
    let automation = &catalog["automation"];
    assert_eq!(automation["maxCurves"], 8);
    assert_eq!(automation["maxKeyframes"], post_automation::MAX_KEYS);
    let effect: Effect = serde_json::from_value(json!({"kind":"invert","amount":0.5})).unwrap();
    for easing in automation["easings"].as_array().unwrap() {
        let curve = serde_json::from_value(
            json!({"effect":0,"keyframes":[{"frame":30,"value":1,"easing":easing}]}),
        )
        .unwrap();
        assert!(post_automation::valid(&[curve], &[effect.clone()], 30));
    }
    assert!(!post_automation::valid(
        &[curve(0.5, 31)],
        &[effect.clone()],
        30
    ));
    assert!(!post_automation::valid(
        &[curve(0.5, 0), curve(0.5, 1)],
        &[effect.clone()],
        30
    ));
    let mut keys = curve(0.5, 0);
    keys.keyframes.clear();
    assert!(!post_automation::valid(&[keys], &[effect.clone()], 30));
    let keys: Vec<_> = (0..post_automation::MAX_KEYS)
        .map(|frame| json!({"frame":frame,"value":0.5,"easing":"linear"}))
        .collect();
    let mut full: post_automation::AmountCurve =
        serde_json::from_value(json!({"effect":0,"keyframes":keys})).unwrap();
    assert!(post_automation::valid(&[full], &[effect.clone()], 256));
    full = serde_json::from_value(json!({"effect":0,"keyframes":keys})).unwrap();
    full.keyframes.push(curve(0.5, 256).keyframes.remove(0));
    assert!(!post_automation::valid(&[full], &[effect.clone()], 256));
    let mut duplicate = curve(0.5, 1);
    duplicate.keyframes.push(curve(0.6, 1).keyframes.remove(0));
    assert!(!post_automation::valid(&[duplicate], &[effect], 30));
}
