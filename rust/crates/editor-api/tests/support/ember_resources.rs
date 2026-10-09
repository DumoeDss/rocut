#[path = "type_card_resources.rs"]
mod type_card;

use serde_json::{Value, json};
pub use type_card::{frame, reject, resolve};

// Author data and controlled platform transport facts, never a replacement for
// browser decoding, real-font measurement, original formula or pixel acceptance.
pub fn settings(mode: &str) -> Value {
    let palette = json!({"background":[0,0,0,1],"aura":[0.1,0.04,0.12,1],
        "dusk":[0.48,0.14,0.31,1],"verm":[0.78,0.22,0.23,1],"sunset":[0.94,0.4,0.23,1],
        "glow":[1,0.65,0.32,1],"hi":[1,0.89,0.69,1],"core":[1,0.96,0.9,1]});
    let mut value = json!({"mode":mode,"palette":palette,"grain":0.07});
    if mode == "collapse" {
        value["image"] = json!("cover.png");
        value["focus"] = json!([200, 40]);
        value["endTicks"] = json!(1080000);
        // Intentionally nonmonotonic authored order remains meaningful.
        value["keys"] = json!({"kind":"manual","values":[
            {"songTicks":0,"factor":1,"easing":"out","hit":false},
            {"songTicks":300000,"factor":0.86,"easing":"soft","hit":false},
            {"songTicks":400000,"factor":0.9,"easing":"soft","hit":false},
            {"songTicks":600000,"factor":0.5,"easing":"out","hit":true},
            {"songTicks":500000,"factor":0.35,"easing":"out","hit":true},
            {"songTicks":1000000,"factor":0.003,"easing":"in","hit":false}]});
    } else {
        value["beats"] = json!({"kind":"analysis"});
        value["hud"] =
            json!({"font":"fixture-font","title":"AŌ","clock":{"hour":17,"minute":42,"fps":30}});
        value["stopsTicks"] = json!([[60000, 72000]]);
        if mode == "breathe" {
            value["flaresTicks"] = json!([[100000, 160000], [140000, 190000]]);
            value["thumpsTicks"] = json!([240000]);
        } else {
            value["blackFrom"] = json!({"kind":"at","songTicks":1080000});
            value["crackAtTicks"] = json!(120000);
            value["ring"] = json!(176);
            value["seed"] = json!(5);
        }
    }
    value
}

fn image() -> Value {
    let sha = "e".repeat(64);
    json!({"id":"cover.png","kind":"image","mimeType":"image/png","sha256":sha,
        "byteLength":100,"attachmentKey":format!("programmatic-sha256-{sha}")})
}

pub fn complete_facts(request: &mut Value) {
    request.as_object_mut().unwrap().remove("fontMetrics");
    request.as_object_mut().unwrap().remove("imageDimensions");
    let discovered = resolve(request);
    assert!(discovered.get("error").is_none(), "{discovered}");
    if let Some(fonts) = discovered["frame"]["fontMetricRequests"].as_array() {
        request["fontMetrics"] = fonts
            .iter()
            .map(|font| {
                let advances: Vec<_> = font["advances"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|value| {
                        let mut measured = value.clone();
                        measured["width"] =
                            json!(value["text"].as_str().unwrap().chars().count() as f64 * 11.25);
                        measured
                    })
                    .collect();
                json!({"resource":font["resource"],"glyphs":[],"advances":advances})
            })
            .collect();
    }
    if let Some(images) = discovered["frame"]["imageDimensionRequests"].as_array() {
        request["imageDimensions"] = images
            .iter()
            .map(|image| json!({"resource":image["resource"],"width":360,"height":140}))
            .collect();
    }
}

pub fn request(mode: &str) -> Value {
    let mut r = type_card::request("quiet");
    r["source"]["recipe"]["nodes"][0]["scene"]["kind"] = json!("ember");
    r["source"]["recipe"]["nodes"][0]["scene"]["settings"] = settings(mode);
    r["source"]["resources"]
        .as_array_mut()
        .unwrap()
        .push(image());
    complete_facts(&mut r);
    r
}

fn panel(input: &str, left: f64, right: f64) -> Value {
    json!({"input":input,"polygon":[[left,0],[right,0],[right,1],[left,1]],
        "opening":{"span":{"startFrame":0,"durationFrames":1},"angle":0,"easing":"linear"},
        "camera":{"motion":{"startFrame":0,"durationFrames":300},
            "from":{"x":0,"y":0,"zoom":1},"to":{"x":0,"y":0,"zoom":1},"easing":"linear"}})
}

pub fn combined() -> Value {
    let mut r = type_card::combined();
    r["source"]["resources"]
        .as_array_mut()
        .unwrap()
        .push(image());
    r["source"]["recipe"]["nodes"][0]["scene"]["kind"] = json!("ember");
    r["source"]["recipe"]["nodes"][0]["scene"]["settings"] = settings("breathe");
    r["source"]["recipe"]["nodes"][2]["scene"] = json!({"kind":"panels",
        "panels":[panel("card",0.0,0.32),panel("collapse",0.34,0.65),panel("sequence",0.67,1.0)],"collapse":null,"border":null});
    r["source"]["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"collapse",
        "scene":{"kind":"ember","role":"graphics","span":{"startFrame":0,"durationFrames":300},"settings":settings("collapse")}}));
    r["source"]["recipe"]["outputRoles"] = json!(["foreground", "graphics", "background"]);
    complete_facts(&mut r);
    r
}

pub fn reverse(r: &mut Value, input: &str, end: u32) {
    r["source"]["recipe"]["nodes"].as_array_mut().unwrap().push(json!({"id":"reverse",
        "scene":{"kind":"ref","input":input,"timeMap":[{"atFrame":0,"sourceFrame":end},{"atFrame":end,"sourceFrame":0}]}}));
    r["source"]["recipe"]["root"] = json!("reverse");
}
