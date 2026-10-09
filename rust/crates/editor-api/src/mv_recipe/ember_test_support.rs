use super::{Sample, catalog, model::Ember};
use crate::{
    mv_audio::Data, mv_font_metrics, mv_image_dimensions, mv_recipe::Recipe,
    programmatic_resources::Resource,
};
use serde_json::{Value, json};

pub(super) fn author(mode: &str) -> Value {
    catalog::catalog_entry()["variants"][mode]["parameters"]
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
pub(super) fn model(mode: &str) -> Ember {
    serde_json::from_value(author(mode)).unwrap()
}
pub(super) fn resources() -> Vec<Resource> {
    [json!({"id":"fixture-font","kind":"font","mimeType":"font/woff2","byteLength":1,
        "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","a".repeat(64)),
        "font":{"family":"Ember Fixture","style":"normal","weight":400}}),
        json!({"id":"fixture-image","kind":"image","mimeType":"image/png","byteLength":1,
            "sha256":"b".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","b".repeat(64))})]
        .into_iter().map(|v|serde_json::from_value(v).unwrap()).collect()
}
pub(super) fn recipe(settings: Value) -> Recipe {
    serde_json::from_value(json!({"version":1,"root":"ember","songStartSeconds":0,"outputRoles":["foreground"],
        "nodes":[{"id":"ember","scene":{"kind":"ember","role":"foreground","span":{"startFrame":0,"durationFrames":60},"settings":settings}}]})).unwrap()
}
pub(super) fn fonts(settings: Value) -> mv_font_metrics::Context {
    let requests = recipe(settings).font_metric_requests(&resources()).unwrap();
    let measured=requests.iter().map(|r|serde_json::from_value(json!({"resource":r.resource,"glyphs":[],
        "advances":r.advances.iter().map(|a|json!({"text":a.text,"fontSizePx":a.font_size_px,"letterSpacingPx":a.letter_spacing_px,
            "width":a.text.chars().count() as f64*11.5})).collect::<Vec<_>>()})).unwrap()).collect::<Vec<_>>();
    mv_font_metrics::Context::new(&requests, &measured).unwrap()
}
pub(super) fn image() -> mv_image_dimensions::Context {
    let requests = recipe(author("collapse"))
        .image_dimension_requests(&resources())
        .unwrap();
    let measured = requests
        .iter()
        .map(|r| {
            serde_json::from_value(json!({"resource":r.resource,"width":640,"height":480})).unwrap()
        })
        .collect::<Vec<_>>();
    mv_image_dimensions::Context::new(&requests, &measured).unwrap()
}
pub(super) fn audio() -> Data {
    let data:Data=serde_json::from_value(json!({"schema":"rocut-mv-audio/1","duration":24,"fps":4,
        "provenance":{"schema":"creator-mv-audio/1","inputSha256":"a".repeat(64),"manifestSha256":"b".repeat(64),
            "musicSha256":"c".repeat(64),"envelopesSha256":"d".repeat(64),"review":{"status":"accepted","reference":"synthetic Ember unit fixture"}},
        "beats":(0..52).map(|i|i*55200).collect::<Vec<_>>(),"downbeats":[],
        "channels":{"mix_rms":vec![0.35;96],"low_power":vec![0.15;96],"mid_power":vec![0.25;96],"high_power":vec![0.1;96]},
        "scales":{"mix_rms":1,"low_power":1,"mid_power":1,"high_power":1},
        "strongOnsets":{"method":"reference-onset-residual-p99-v1","normalizationScale":1,
            "events":[{"atTicks":2340000,"strength":0.75}]}})).unwrap();
    data.validate().unwrap();
    data
}
pub(super) fn sample<'a>(
    ticks: u64,
    audio: Option<&'a Data>,
    fonts: Option<&'a mv_font_metrics::Context>,
    images: Option<&'a mv_image_dimensions::Context>,
) -> Sample<'a> {
    Sample {
        shot_start_ticks: 0,
        shot_end_ticks: 240000,
        song_ticks: ticks,
        width: 1920.0,
        height: 1080.0,
        analysis: audio,
        fonts,
        images,
    }
}
