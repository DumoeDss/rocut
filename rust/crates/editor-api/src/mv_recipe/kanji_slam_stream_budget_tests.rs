//! Real-font-outline-sized transport regression, not Canvas/pixel acceptance.
use super::support::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn ready(words: &[&str], fire: bool, frame: u64, hidden: bool) -> Value {
    let mut recipe = recipe(
        if hidden { "black" } else { "kanji" },
        if hidden { vec![black()] } else { vec![] },
    );
    let settings = &mut recipe["nodes"][0]["scene"]["settings"];
    settings["glyphs"] = json!(words);
    settings["fire"] = json!(fire);
    if hidden {
        recipe["nodes"][0]["scene"]["span"]["startFrame"] = json!(240);
    }
    let mut result = measured(request(recipe, frame));
    for font in result["fontMetrics"].as_array_mut().unwrap() {
        if font["resource"]["id"] != "monument" {
            continue;
        }
        for bound in font["bounds"].as_array_mut().unwrap() {
            // Pinned ZenOldMincho900 glyf outline bounds at1000 UPEM, scaled
            // to1500px. Browser must independently supply its actual metrics.
            let [x0, y0, x1, y1] = match bound["text"].as_str().unwrap() {
                "は" => [130, -23, 926, 763],
                "夜" => [45, -73, 955, 832],
                "光" => [30, -73, 973, 833],
                "救" => [37, -73, 971, 833],
                "っ" => [175, 33, 799, 460],
                "て" => [100, -20, 872, 743],
                other => panic!("Unexpected glyph {other}"),
            };
            bound["left"] = json!(-f64::from(x0) * 1.5);
            bound["right"] = json!(f64::from(x1) * 1.5);
            bound["ascent"] = json!(f64::from(y1) * 1.5);
            bound["descent"] = json!(-f64::from(y0) * 1.5);
        }
    }
    result
}

#[test]
fn full_size_generic_and_fire_words_stream_below_the_unchanged40mi_cap() {
    for fire in [false, true] {
        for frame in [0, 48, 120] {
            let result = resolve(&ready(&["は夜光", "救って"], fire, frame, false));
            assert!(result.get("error").is_none(), "{result}");
            let commands = result["frame"]["recipePlan"]["root"]["data"]["commands"]
                .as_array()
                .unwrap();
            let mut live = BTreeMap::new();
            let mut peak = 0u64;
            for command in commands {
                match command["kind"].as_str().unwrap() {
                    "surface" => {
                        let size = command["size"].as_array().unwrap();
                        live.insert(
                            command["id"].as_str().unwrap(),
                            2 * size[0].as_u64().unwrap() * size[1].as_u64().unwrap(),
                        );
                        peak = peak.max(live.values().sum());
                    }
                    "appendSurface" => {
                        assert!(live.contains_key(command["surface"].as_str().unwrap()));
                    }
                    "releaseSurface" => {
                        assert!(live.remove(command["surface"].as_str().unwrap()).is_some());
                    }
                    _ => {}
                }
            }
            // Backing peak only; production additionally checked all retained
            // payload and transient filters against the same40Mi envelope.
            assert!(peak < 32 * 1024 * 1024, "unexpected streaming peak {peak}");
            assert!(live.is_empty());
            assert_eq!(
                commands
                    .iter()
                    .filter(|c| c["kind"] == "surface" && c["id"] == "ks-glyph-layer")
                    .count(),
                1
            );
        }
    }
}

#[test]
fn repeated_letters_keep_one_art_payload_and_hidden_glyphs_stay_validated() {
    let result = resolve(&ready(&["は夜は夜は"], false, 0, false));
    assert!(result.get("error").is_none(), "{result}");
    let commands = result["frame"]["recipePlan"]["root"]["data"]["commands"]
        .as_array()
        .unwrap();
    assert_eq!(
        commands
            .iter()
            .flat_map(|c| c["commands"].as_array().into_iter().flatten())
            .filter(|c| c["kind"] == "rectBatch")
            .count(),
        2
    );
    let mut hidden = ready(&["は夜光", "救って"], false, 0, true);
    assert!(resolve(&hidden).get("error").is_none());
    for font in hidden["fontMetrics"].as_array_mut().unwrap() {
        for bound in font["bounds"].as_array_mut().unwrap() {
            if bound["text"] == "救" {
                bound["left"] = json!(0);
                bound["right"] = json!(3000);
                bound["ascent"] = json!(3000);
                bound["descent"] = json!(0);
            }
        }
    }
    assert!(
        resolve(&hidden)["error"]
            .as_str()
            .unwrap()
            .contains("measured whole-source scratch")
    );
}
