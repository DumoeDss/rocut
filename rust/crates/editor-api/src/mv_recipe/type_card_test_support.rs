use super::{Sample, TypeCard, catalog};
use crate::{
    mv_font_metrics::{Context, Measurement},
    mv_recipe::Recipe,
    programmatic_resources::Resource,
};
use serde_json::{Value, json};

pub(super) fn settings(mode: &str) -> Value {
    catalog::catalog_entry()["variants"][mode]["parameters"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), catalog::suggestion(v)))
        .collect()
}
pub(super) fn model(mode: &str) -> TypeCard {
    serde_json::from_value(settings(mode)).unwrap()
}
pub(super) fn resources() -> Vec<Resource> {
    vec![serde_json::from_value(json!({"id":"fixture-font","kind":"font","mimeType":"font/woff2",
        "font":{"family":"Fixture","style":"normal","weight":400},"byteLength":1,"sha256":"ab".repeat(32),
        "attachmentKey":format!("programmatic-sha256-{}","ab".repeat(32))})).unwrap()]
}
pub(super) fn recipe(settings: Value) -> Value {
    json!({"version":1,"root":"card","songStartSeconds":0,"outputRoles":["graphics"],"nodes":[
        {"id":"card","scene":{"kind":"typeCard","role":"graphics","span":{"startFrame":0,"durationFrames":240},"settings":settings}}]})
}
pub(super) fn context(settings: Value) -> Context {
    let r: Recipe = serde_json::from_value(recipe(settings)).unwrap();
    let requests = r.font_metric_requests(&resources()).unwrap();
    let measured: Vec<Measurement> = requests
        .iter()
        .map(|r| {
            serde_json::from_value(
                json!({"resource":r.resource,"glyphs":r.glyphs.iter().map(|g| {
            json!({"text":g,"left":20,"right":30,"ascent":40,"descent":10})
        }).collect::<Vec<_>>()}),
            )
            .unwrap()
        })
        .collect();
    Context::new(&requests, &measured).unwrap()
}
pub(super) fn sample(seconds: f64, fonts: Option<&Context>) -> Sample<'_> {
    Sample {
        elapsed_ticks: (seconds * 120_000.0).round() as u64,
        duration_ticks: 480_000,
        shot_start_ticks: 0,
        song_ticks: (seconds * 120_000.0).round() as u64,
        width: 1920.0,
        height: 1080.0,
        seed: 0,
        fonts,
        analysis: None,
    }
}
