#[path = "type_card_resources.rs"]
mod type_card;

pub use self::type_card::{frame, reject, resolve};
use editor_api::mv_recipe_catalog_json;
use serde_json::{Value, json};

// Author-data construction only. Scene time, geometry and randomness are never
// implemented here; the existing fixture imports reviewed data through the real
// prepare_mv_audio_json API, including manifest/file fingerprint checks.
fn suggestion(field: &Value) -> Value {
    if let Some(value) = field.get("suggested") {
        return value.clone();
    }
    match field["type"].as_str() {
        Some("object") => field["properties"]
            .as_object()
            .expect("catalog object properties")
            .iter()
            .map(|(key, value)| (key.clone(), suggestion(value)))
            .collect(),
        Some("tuple") => field["items"]
            .as_array()
            .expect("catalog tuple items")
            .iter()
            .map(suggestion)
            .collect(),
        _ => panic!("Missing converge catalog author suggestion: {field}"),
    }
}

fn scene() -> Value {
    let catalog: Value = serde_json::from_str(&mv_recipe_catalog_json()).unwrap();
    let mut settings: Value = catalog["generators"]["converge"]["parameters"]
        .as_object()
        .expect("public converge catalog parameters")
        .iter()
        .map(|(key, field)| (key.clone(), suggestion(field)))
        .collect();
    settings["seed"] = json!(7);
    settings["whiteAtTicks"] = json!(240000);
    settings["beats"] = json!({"kind":"analysis"});
    settings["grain"] = json!(0.07);
    json!({"kind":"converge","role":"graphics","settings":settings,
        "span":{"startFrame":0,"durationFrames":300}})
}

pub fn request() -> Value {
    let mut r = type_card::request("flicker");
    r["source"]["resources"]
        .as_array_mut()
        .unwrap()
        .retain(|resource| resource["kind"] == "analysis");
    r["source"]["recipe"]["root"] = json!("converge");
    r["source"]["recipe"]["outputRoles"] = json!(["graphics"]);
    r["source"]["recipe"]["nodes"] = json!([{"id":"converge","scene":scene()}]);
    r
}

pub fn manual_equivalent(r: &Value) -> Value {
    let mut manual = r.clone();
    let ticks = manual["analysis"]["beats"].clone();
    for node in manual["source"]["recipe"]["nodes"].as_array_mut().unwrap() {
        if node["scene"]["kind"] == "converge" {
            node["scene"]["settings"]["beats"] = json!({"kind":"manual","songTicks":ticks});
        }
    }
    manual
}

fn panel(input: &str, left: f64, right: f64) -> Value {
    json!({"input":input,"polygon":[[left,0],[right,0],[right,1],[left,1]],
        "opening":{"span":{"startFrame":0,"durationFrames":1},"angle":0,"easing":"linear"},
        "camera":{"motion":{"startFrame":0,"durationFrames":300},
            "from":{"x":0,"y":0,"zoom":1},"to":{"x":0,"y":0,"zoom":1},"easing":"linear"}})
}

pub fn combined() -> Value {
    let mut r = type_card::combined();
    // One full converge (including grain), one minimal quiet glyph and one
    // sequence fit the unchanged expanded-primitive budget; no duplicate vortex.
    let converge = scene();
    r["source"]["recipe"]["nodes"][2]["scene"] = json!({"kind":"panels",
        "panels":[panel("converge",0.0,0.32),panel("card",0.34,0.65),panel("sequence",0.67,1.0)],
        "collapse":null,"border":null});
    r["source"]["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"converge","scene":converge}));
    r["source"]["recipe"]["outputRoles"] = json!(["graphics", "foreground", "background"]);
    r["source"]["recipe"]["post"][0]["roles"] = json!(["graphics", "foreground"]);
    r
}

pub fn reverse(r: &mut Value, input: &str, end: u64) {
    r["source"]["recipe"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"reverse",
        "scene":{"kind":"ref","input":input,
            "timeMap":[{"atFrame":0,"sourceFrame":end},{"atFrame":end,"sourceFrame":0}]}}));
    r["source"]["recipe"]["root"] = json!("reverse");
}
