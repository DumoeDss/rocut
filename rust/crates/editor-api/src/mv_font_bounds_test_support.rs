use super::{Bounds, BoundsRequest, Context, Measurement, Request};
use serde_json::{Value, json};

pub(super) fn resource(id: &str) -> Value {
    json!({"id":id,"kind":"font","attachmentKey":"fonts/bounds.ttf",
        "mimeType":"font/ttf","byteLength":123,"sha256":"a".repeat(64),
        "font":{"family":"Bounds","style":"italic","weight":500,"axes":{"TEST":550.0}}})
}
pub(super) fn item(text: &str, size: f64, tracking: f64, align: &str, baseline: &str) -> Value {
    json!({"version":1,"text":text,"fontSizePx":size,"letterSpacingPx":tracking,"align":align,"baseline":baseline})
}
pub(super) fn request() -> Value {
    json!([{"resource":resource("font"),"glyphs":["A"],
        "advances":[{"text":"AV","fontSizePx":22,"letterSpacingPx":0}],
        "bounds":[item("",22.0,0.0,"left","alphabetic"),
            item("残",1000.0,0.0,"left","alphabetic"),
            item("😀a\u{0301}",20.5,1.25,"center","middle")]}])
}
pub(super) fn measurements(requests: &Value) -> Value {
    json!(requests.as_array().unwrap().iter().map(|font| {
        let glyphs:Vec<_>=font["glyphs"].as_array().unwrap().iter()
            .map(|text|json!({"text":text,"left":2,"right":3,"ascent":4,"descent":1})).collect();
        let advances:Vec<_>=font["advances"].as_array().unwrap().iter().map(|a| {
            let mut a=a.clone(); a["width"]=if a["text"]=="" {json!(0)} else {json!(13.125)}; a
        }).collect();
        let bounds:Vec<_>=font["bounds"].as_array().unwrap().iter().map(|a| {
            let mut a=a.clone();
            for (field,value) in [("left",-2.0),("right",52.0),("ascent",80.0),("descent",-3.0)] {
                a[field]=if a["text"]=="" {json!(0)} else {json!(value)};
            } a
        }).collect();
        json!({"resource":font["resource"],"glyphs":glyphs,"advances":advances,"bounds":bounds})
    }).collect::<Vec<_>>())
}
pub(super) fn context(requests: Value, measured: Value) -> Result<Context, String> {
    let requests: Vec<Request> = serde_json::from_value(requests).map_err(|e| e.to_string())?;
    let measured: Vec<Measurement> = serde_json::from_value(measured).map_err(|e| e.to_string())?;
    Context::new(&requests, &measured)
}
pub(super) fn lookup(context: &Context, font: &str, item: Value) -> Result<Bounds, String> {
    let request: BoundsRequest = serde_json::from_value(item).map_err(|e| e.to_string())?;
    context.bounds(font, &request)
}
