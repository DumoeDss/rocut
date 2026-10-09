use super::{catalog::mv_recipe_catalog_json, generator_model::*, transition_model::Transition};
use serde_json::{Value, json};

fn suggested(parameters: &Value) -> Value {
    parameters
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, field)| {
            let value = match field["type"].as_str().unwrap() {
                "resource" => json!(format!("fixture-{}", field["kind"].as_str().unwrap())),
                "tuple" => field["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v["suggested"].clone())
                    .collect(),
                _ => field["suggested"].clone(),
            };
            (key.clone(), value)
        })
        .collect()
}
fn valid(kind: &str, settings: Value) -> bool {
    match kind {
        "kanjiSlam" => serde_json::from_value::<super::kanji_slam::KanjiSlam>(settings).is_ok_and(|v|
            v.valid(0, &super::model::Span { start_frame: 0, duration_frames: 60 }, 4000)),
        "titleRiff" => serde_json::from_value::<super::title_riff::TitleRiff>(settings).is_ok_and(|v|
            v.valid(0, &super::model::Span { start_frame: 0, duration_frames: 60 }, 4000)),
        "ember" => serde_json::from_value::<super::ember::Ember>(settings).is_ok_and(|v|
            v.valid(0, &super::model::Span { start_frame: 0, duration_frames: 60 }, 4000)),
        "converge" => serde_json::from_value::<super::converge::Converge>(settings).is_ok_and(|v|
            v.valid(0, &super::model::Span { start_frame: 0, duration_frames: 60 }, 4000)),
        "typeCard" => serde_json::from_value::<super::type_card::TypeCard>(settings).is_ok_and(|v| v.valid()),
        "afterimage" => serde_json::from_value::<super::afterimage::Afterimage>(settings).is_ok_and(|v| v.valid()),
        "cloth" => serde_json::from_value::<super::cloth::Cloth>(settings).is_ok_and(|v| v.valid()),
        "shatter" => {
            serde_json::from_value::<super::shatter::Shatter>(settings).is_ok_and(|v| v.valid())
        }
        "grid" => serde_json::from_value::<super::grid::Grid>(settings).is_ok_and(|v| v.valid()),
        "hexFloat" => {
            serde_json::from_value::<super::hex_float::HexFloat>(settings).is_ok_and(|v| {
                v.valid() && v.work(640.0, 360.0) <= super::catalog::GENERATOR_PRIMITIVES
            })
        }
        "asciiSweep" => serde_json::from_value::<super::ascii_sweep::AsciiSweep>(settings)
            .is_ok_and(|v| v.valid() && v.fits(640.0, 360.0)),
        "particleScroll" => {
            serde_json::from_value::<super::particle_scroll::ParticleScroll>(settings)
                .is_ok_and(|v| v.valid())
        }
        "glyphRain" => serde_json::from_value::<GlyphRain>(settings).is_ok_and(|v| v.valid()),
        "particleReveal" => {
            serde_json::from_value::<ParticleReveal>(settings).is_ok_and(|v| v.valid())
        }
        "peel" | "bend" => {
            let mut settings = settings;
            settings["kind"] = json!(kind);
            serde_json::from_value::<Transition>(settings).is_ok_and(|v| v.valid())
        }
        _ => panic!("uncovered catalog kind"),
    }
}

fn entries<'a>(catalog: &'a Value, group: &str) -> Vec<(&'a str, &'a Value)> {
    catalog[group].as_object().unwrap().iter().flat_map(|(kind, entry)| {
        let variants = entry.get("variants").and_then(Value::as_object);
        match variants {
            Some(values) => values.values().map(|v| (kind.as_str(), v)).collect(),
            None => vec![(kind.as_str(), entry)],
        }
    }).collect()
}

#[test]
fn catalog_suggestions_are_explicit_and_validate_against_the_real_models() {
    let c: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    assert_eq!(c["availability"], "implemented-not-runtime-probed");
    assert_eq!(c["generatorPrimitiveBudget"], 4096);
    for group in ["generators", "transitionParameters"] {
        for (kind, entry) in entries(&c, group) {
            let base = suggested(&entry["parameters"]);
            assert!(valid(kind, base.clone()), "{kind}: {base}");
            for key in base.as_object().unwrap().keys() {
                let mut missing = base.clone();
                missing.as_object_mut().unwrap().remove(key);
                if entry["parameters"][key]["required"] == false {
                    assert!(valid(kind, missing), "optional field {kind}.{key}");
                } else {
                    assert!(!valid(kind, missing), "required field {kind}.{key}");
                }
            }
        }
    }
}

#[test]
fn every_numeric_and_enum_catalog_bound_is_enforced_by_validation() {
    let c: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    for group in ["generators", "transitionParameters"] {
        for (kind, entry) in entries(&c, group) {
            let base = suggested(&entry["parameters"]);
            for (key, field) in entry["parameters"].as_object().unwrap() {
                let invalid = match field["type"].as_str().unwrap() {
                    "number" => {
                        let mut values = vec![
                            json!(field["min"].as_f64().unwrap() - 1.0),
                            json!(field["max"].as_f64().unwrap() + 1.0),
                        ];
                        if field["integer"] == true {
                            values.push(json!(field["min"].as_f64().unwrap() + 0.5));
                        }
                        values
                    }
                    "enum" => {
                        for option in field["options"].as_array().unwrap() {
                            let mut settings = base.clone();
                            settings[key] = option.clone();
                            assert!(valid(kind, settings), "{kind}.{key} option {option}");
                        }
                        vec![json!("invalid")]
                    }
                    _ => continue,
                };
                for value in invalid {
                    let mut settings = base.clone();
                    settings[key] = value;
                    assert!(!valid(kind, settings.clone()), "{kind}: {settings}");
                }
            }
        }
    }
}
