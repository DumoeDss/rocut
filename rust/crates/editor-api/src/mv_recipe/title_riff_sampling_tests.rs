//! Synthetic resource facts test public graph/time/admission contracts, not pixels.
use super::tests::author;
use crate::{mv_image_dimensions, mv_recipe::Recipe, programmatic_resources::Resource};
use serde_json::{Value, json};

fn resources() -> Vec<Resource> {
    ["title.ttf","hud.ttf","ruby.ttf","subtitle.ttf","character.png","sky.png"].into_iter().enumerate().map(|(i,id)| {
        let sha=format!("{:064x}",i+1);
        let mut resource=json!({"id":id,"kind":if i<4 {"font"}else{"image"},"attachmentKey":format!("programmatic-sha256-{sha}"),
            "sha256":sha,"mimeType":if i<4 {"font/ttf"}else{"image/png"},"byteLength":100});
        if i<4 {resource["font"]=json!({"family":id,"weight":400,"style":"normal"});}
        serde_json::from_value(resource).unwrap()
    }).collect()
}
fn title() -> Value {
    json!({"id":"title","scene":{"kind":"titleRiff","role":"graphics","span":{"startFrame":0,"durationFrames":600},"settings":author(false)}})
}
fn recipe(root: &str, extra: Vec<Value>) -> Value {
    let mut nodes = vec![title()];
    nodes.extend(extra);
    json!({"version":1,"root":root,"songStartSeconds":2.25,"outputRoles":["graphics"],"nodes":nodes})
}
fn requests(recipe: &Value, frame: u64) -> Value {
    let recipe: Recipe = serde_json::from_value(recipe.clone()).unwrap();
    serde_json::to_value(
        recipe
            .sampled_font_metric_requests(frame, 2000, 17, 1920, 1080, None, &resources())
            .unwrap(),
    )
    .unwrap()
}
fn static_requests(recipe: &Value) -> Value {
    let recipe: Recipe = serde_json::from_value(recipe.clone()).unwrap();
    serde_json::to_value(recipe.font_metric_requests(&resources()).unwrap()).unwrap()
}
#[test]
fn sampled_metrics_reuse_nested_reference_sequence_integer_reverse_maps_and_gaps() {
    let direct = recipe("title", vec![]);
    let mapped = recipe(
        "ref",
        vec![
            json!({"id":"ref","scene":{"kind":"ref","input":"sequence","timeMap":[{"atFrame":0,"sourceFrame":40},{"atFrame":20,"sourceFrame":10}]}}),
            json!({"id":"sequence","scene":{"kind":"sequence","items":[{"input":"title","span":{"startFrame":10,"durationFrames":31},"timeMap":[{"atFrame":10,"sourceFrame":400},{"atFrame":40,"sourceFrame":360}]}]}}),
        ],
    );
    // Root1 -> ref38 -> sequence362, using the same weighted integer floors.
    assert_eq!(requests(&mapped, 1), requests(&direct, 362));
    for (at, mapped_frame) in [(20, 400), (0, 360), (1, 362), (20, 400)] {
        assert_eq!(requests(&mapped, at), requests(&direct, mapped_frame));
    }
    let gap = recipe(
        "sequence",
        vec![
            json!({"id":"sequence","scene":{"kind":"sequence","items":[{"input":"title","span":{"startFrame":10,"durationFrames":10},"timeMap":[{"atFrame":10,"sourceFrame":400}]}]}}),
        ],
    );
    assert_eq!(requests(&gap, 20), static_requests(&gap));
    assert_eq!(requests(&gap, 10), requests(&direct, 400));
}
#[test]
fn transition_and_panel_visibility_share_exact_resource_traversal() {
    let direct = recipe("title", vec![]);
    let transition = recipe(
        "mix",
        vec![
            json!({"id":"black","scene":{"kind":"solid","role":"graphics","color":[0,0,0,1]}}),
        json!({"id":"mix","scene":{"kind":"transition","from":"black","to":"title","span":{"startFrame":300,"durationFrames":60},"easing":"linear","style":{"kind":"xfade"}}}),
        ],
    );
    assert_eq!(requests(&transition, 300), static_requests(&transition));
    assert_eq!(requests(&transition, 301), requests(&direct, 301));
    assert_eq!(requests(&transition, 360), requests(&direct, 360));
    let panels = recipe(
        "panels",
        vec![json!({"id":"panels","scene":{"kind":"panels","panels":[{
            "input":"title","polygon":[[0,0],[1,0],[1,1],[0,1]],
            "opening":{"span":{"startFrame":300,"durationFrames":60},"angle":0,"easing":"linear"},
            "camera":{"motion":{"startFrame":0,"durationFrames":600},"from":{"x":0,"y":0,"zoom":1},"to":{"x":0,"y":0,"zoom":1},"easing":"linear"}
        }]}})],
    );
    assert_eq!(requests(&panels, 300), static_requests(&panels));
    assert_eq!(requests(&panels, 301), requests(&direct, 301));
}
fn image_facts(recipe: &Recipe, character: [u32; 2]) -> mv_image_dimensions::Context {
    let requests = recipe.image_dimension_requests(&resources()).unwrap();
    let measured = requests
        .iter()
        .map(|r| {
            let size = if r.resource.id == "character.png" {
                character
            } else {
                [480, 270]
            };
            mv_image_dimensions::Measurement {
                resource: r.resource.clone(),
                width: size[0],
                height: size[1],
            }
        })
        .collect::<Vec<_>>();
    mv_image_dimensions::Context::new(&requests, &measured).unwrap()
}
#[test]
fn actual_mask_geometry_is_charged_without_downsampling_or_arbitrary_one_megapixel_cap() {
    let recipe: Recipe = serde_json::from_value(recipe("title", vec![])).unwrap();
    assert!(
        recipe
            .validate(&resources(), 600, 1920, 1080, 2000)
            .is_empty()
    );
    let normal = image_facts(&recipe, [2048, 1536]);
    assert!(
        recipe
            .check_with_images(&resources(), 600, 1920, 1080, 2000, Some(&normal))
            .is_ok()
    );
    let too_large = image_facts(&recipe, [4096, 4096]);
    let error = recipe
        .check_with_images(&resources(), 600, 1920, 1080, 2000, Some(&too_large))
        .unwrap_err();
    assert!(error.contains("temporary raster surface budget"));
    let beyond_shared_side = image_facts(&recipe, [4097, 32]);
    assert!(
        recipe
            .check_with_images(
                &resources(),
                600,
                1920,
                1080,
                2000,
                Some(&beyond_shared_side)
            )
            .is_err()
    );
}
fn frame_request(frame: u64) -> Value {
    json!({"source":{"version":1,"runtime":"canvas-worker","code":"","width":1920,"height":1080,"frameRate":{"numerator":60,"denominator":1},
        "durationFrames":600,"seed":17,"resources":resources(),"recipe":recipe("title",vec![])},
        "clipStart":0,"clipDuration":1200000,"trimStart":0,"timelineTime":frame*2000})
}
fn resolve(request: &Value) -> Value {
    serde_json::from_str(&crate::programmatic::resolve_programmatic_frame_json(
        request.to_string(),
    ))
    .unwrap()
}
#[test]
fn public_frame_discovery_is_current_sample_exact_and_admission_precedes_render() {
    let request = frame_request(400);
    let pending = resolve(&request);
    assert!(pending.get("error").is_none(), "{pending}");
    assert!(pending["frame"].get("recipePlan").is_none());
    assert_eq!(
        pending["frame"]["fontMetricRequests"],
        requests(&recipe("title", vec![]), 400)
    );
    assert_eq!(pending["frame"]["timelineTime"], 800000);
    assert_eq!(pending["frame"]["sampleTime"], 800000);
    let mut oversized = request.clone();
    oversized["imageDimensions"]=pending["frame"]["imageDimensionRequests"].as_array().unwrap().iter().map(|r|json!({
        "resource":r["resource"],"width":4096,"height":if r["resource"]["id"]=="character.png"{4096}else{32}
    })).collect();
    assert!(
        resolve(&oversized)["error"]
            .as_str()
            .unwrap()
            .contains("temporary raster surface budget")
    );
    assert_ne!(
        pending["frame"]["fontMetricRequests"],
        resolve(&frame_request(399))["frame"]["fontMetricRequests"]
    );
}
