//! Synthetic transport facts, never a browser pixel/font acceptance fixture.
use crate::mv_recipe::Recipe;
use serde_json::{Value, json};

pub(super) fn author() -> Value {
    let mut value = catalog_author("kanjiSlam", "default");
    value["fonts"] = json!({"monument":"monument","lyric":"lyric","counter":"counter"});
    value["char"] = json!("character");
    value["bg"] = json!("sky");
    value["glyphs"] = json!(["救", "って", "夜"]);
    value["beats"]["songTicks"] = (0..40).map(|i| json!(i * 60000)).collect();
    value
}
pub(super) fn catalog_author(kind: &str, variant: &str) -> Value {
    let catalog: Value = serde_json::from_str(&crate::mv_recipe::mv_recipe_catalog_json()).unwrap();
    catalog["generators"][kind]["variants"][variant]["parameters"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, field)| {
            let value = if field["type"] == "resource" {
                json!(format!("fixture-{}", field["kind"].as_str().unwrap()))
            } else {
                field["suggested"].clone()
            };
            (key.clone(), value)
        })
        .collect()
}
pub(super) fn resources() -> Value {
    ["monument","lyric","counter","character","sky"].into_iter().enumerate().map(|(i,id)| {
        let sha = format!("{:064x}",i+1);
        let mut value = json!({"id":id,"kind":if i<3 {"font"}else{"image"},"attachmentKey":format!("programmatic-sha256-{sha}"),
            "sha256":sha,"mimeType":if i<3 {"font/ttf"}else{"image/png"},"byteLength":100});
        if i<3 {value["font"] = json!({"family":id,"weight":400,"style":"normal"});}
        value
    }).collect()
}
pub(super) fn recipe(root: &str, extra: Vec<Value>) -> Value {
    let mut nodes = vec![
        json!({"id":"kanji","scene":{"kind":"kanjiSlam","role":"graphics","span":{"startFrame":0,"durationFrames":240},"settings":author()}}),
    ];
    nodes.extend(extra);
    json!({"version":1,"root":root,"songStartSeconds":4,"outputRoles":["foreground","graphics","subject","background"],"nodes":nodes})
}
pub(super) fn request(recipe: Value, frame: u64) -> Value {
    json!({"source":{"version":1,"runtime":"canvas-worker","code":"","width":1920,"height":1080,"frameRate":{"numerator":60,"denominator":1},
        "durationFrames":600,"seed":17,"resources":resources(),"recipe":recipe},
        "clipStart":0,"clipDuration":1200000,"trimStart":0,"timelineTime":frame*2000})
}
pub(super) fn resolve(request: &Value) -> Value {
    serde_json::from_str(&crate::programmatic::resolve_programmatic_frame_json(
        request.to_string(),
    ))
    .unwrap()
}
pub(super) fn measured(mut request: Value) -> Value {
    let pending = resolve(&request);
    assert!(pending.get("error").is_none(), "{pending}");
    assert!(pending["frame"].get("recipePlan").is_none());
    request["fontMetrics"] = pending["frame"]["fontMetricRequests"].as_array().unwrap().iter().map(|r| {
        json!({"resource":r["resource"],"glyphs":[],"advances":[],"bounds":r["bounds"].as_array().into_iter().flatten().map(|b| {
            let size=b["fontSizePx"].as_f64().unwrap();
            let mut value=b.clone();
            for (key,amount) in [("left",0.0),("right",size*0.55),("ascent",size*0.7),("descent",size*0.06)] {
                value[key]=json!(if b["text"]=="" {0.0}else{amount});
            }
            value
        }).collect::<Vec<_>>()})
    }).collect();
    request["imageDimensions"] = pending["frame"]["imageDimensionRequests"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| json!({"resource":r["resource"],"width":192,"height":320}))
        .collect();
    request
}
pub(super) fn font_requests(value: &Value, frame: u64) -> Value {
    let recipe: Recipe = serde_json::from_value(value.clone()).unwrap();
    let resources: Vec<crate::programmatic_resources::Resource> =
        serde_json::from_value(resources()).unwrap();
    serde_json::to_value(
        recipe
            .sampled_font_metric_requests(frame, 2000, 17, 1920, 1080, None, &resources)
            .unwrap(),
    )
    .unwrap()
}
pub(super) fn black() -> Value {
    json!({"id":"black","scene":{"kind":"solid","role":"background","color":[0,0,0,1]}})
}
