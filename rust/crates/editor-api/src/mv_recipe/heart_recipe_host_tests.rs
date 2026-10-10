use super::*;
use crate::{
    mv_audio::Data,
    mv_image_dimensions::{Context as Images, Measurement},
    programmatic_resources::Resource,
};
use serde_json::{Value, json};

fn resource(id: &str) -> Resource {
    serde_json::from_value(json!({"id":id,"kind":"image","mimeType":"image/png",
        "byteLength":1,"sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","a".repeat(64))})).unwrap()
}
fn analysis() -> Data {
    serde_json::from_value(json!({"schema":"rocut-mv-audio/1","duration":10,"fps":1,
        "provenance":{"schema":"creator-mv-audio/1","inputSha256":"a".repeat(64),"vocalSha256":null,
        "manifestSha256":"b".repeat(64),"musicSha256":"c".repeat(64),"envelopesSha256":"d".repeat(64),
        "review":{"status":"accepted","reference":"dedicated native host test evidence"}},
        "beats":[0,60000,120000,180000,240000,300000],"downbeats":[0,240000],
        "channels":{"mix_rms":vec![0.0;10],"low_power":vec![0.0;10],"mid_power":vec![0.0;10],"high_power":vec![0.0;10]},
        "scales":{"mix_rms":1,"low_power":1,"mid_power":1,"high_power":1}})).unwrap()
}
fn recipe(expanded: bool) -> Recipe {
    let leaf = json!({"id":"heart","scene":{"kind":"heartShatter","role":"subject","bpm":120,
        "span":{"startFrame":0,"durationFrames":60},"settings":{"heart":"heart"}}});
    let nodes = if expanded {
        vec![
            leaf,
            json!({"id":"mix","scene":{"kind":"transition","from":"heart","to":"heart",
        "span":{"startFrame":0,"durationFrames":60},"easing":"linear","style":{"kind":"xfade"}}}),
        ]
    } else {
        vec![leaf]
    };
    serde_json::from_value(json!({"version":1,"root":if expanded {"mix"} else {"heart"},"songStartSeconds":0,
        "outputRoles":["subject"],"nodes":nodes,"audio":{"resource":"analysis","inputSha256":"a".repeat(64)}})).unwrap()
}
fn plan(expanded: bool, extra_width: u32) -> Result<Value, String> {
    let recipe = recipe(expanded);
    let mut resources = vec![resource("heart")];
    // The descriptor producer admits the declared analysis MIME separately.
    let analysis_resource: Resource = serde_json::from_value(json!({"id":"analysis","kind":"analysis","mimeType":"application/json",
        "byteLength":1,"sha256":"b".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","b".repeat(64))})).unwrap();
    resources.push(analysis_resource);
    if extra_width > 0 {
        resources.push(resource("unused"));
    }
    let requests = crate::mv_image_dimensions::requests(
        &resources,
        &resources
            .iter()
            .filter(|r| r.kind == "image")
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
    )?;
    let measured: Vec<_> = requests
        .iter()
        .map(|r| Measurement {
            resource: r.resource.clone(),
            width: if r.resource.id == "unused" {
                extra_width
            } else {
                20
            },
            height: 20,
        })
        .collect();
    let images = Images::new(&requests, &measured)?;
    let resolved = recipe.resolve_with_resources(
        // Interior transition frame: endpoint resolution intentionally drops
        // the inactive side and cannot prove simultaneous-lease admission.
        30,
        4000,
        1,
        1920,
        1080,
        Some(&analysis()),
        &resources,
        0,
        None,
        None,
        Some(&images),
    )?;
    serde_json::to_value(resolved).map_err(|e| e.to_string())
}
#[test]
fn public_plan_has_complete_outer_reservation_before_any_native_factory() {
    let value = plan(false, 0).unwrap();
    let host = &value["root"]["request"]["reservation"]["host"];
    let outer = host["recipeReservationBytes"].as_u64().unwrap();
    let ceiling = host["sessionCeilingBytes"].as_u64().unwrap();
    assert!(outer >= 1920 * 1080 * 4 * 6);
    assert!(ceiling > 0);
    assert_eq!(outer + ceiling, crate::mv_heart_owner::MAX_OWNER_BYTES);
    assert_eq!(host["maxLiveSessions"], 1);
    assert_eq!(
        host["rasterByteLimit"],
        crate::mv_heart_owner::MAX_OWNER_BYTES
    );
}
#[test]
fn expanded_transition_requests_share_remaining_budget_not_the_whole_cap() {
    let value = plan(true, 0).unwrap();
    let from = &value["root"]["from"]["request"]["reservation"]["host"];
    let to = &value["root"]["to"]["request"]["reservation"]["host"];
    assert_eq!(from, to);
    assert_eq!(from["maxLiveSessions"], 2);
    let outer = from["recipeReservationBytes"].as_u64().unwrap();
    let ceiling = from["sessionCeilingBytes"].as_u64().unwrap();
    assert!(outer + 2 * ceiling <= crate::mv_heart_owner::MAX_OWNER_BYTES);
    assert!(ceiling < plan(false,0).unwrap()["root"]["request"]["reservation"]["host"]["sessionCeilingBytes"].as_u64().unwrap());
}
#[test]
fn invisible_declared_images_are_charged_with_exact_native_dimensions() {
    let a = plan(false, 0).unwrap();
    let b = plan(false, 1024).unwrap();
    let outer = |v: &Value| {
        v["root"]["request"]["reservation"]["host"]["recipeReservationBytes"]
            .as_u64()
            .unwrap()
    };
    assert!(outer(&b) >= outer(&a) + 1024 * 20 * 8);
}
