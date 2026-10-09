use super::support::*;
use serde_json::{Value, json};

#[test]
fn hidden_shots_cannot_hide_missing_image_or_future_glyph_facts() {
    let mut hidden = recipe("black", vec![black()]);
    hidden["nodes"][0]["scene"]["span"] = json!({"startFrame":240,"durationFrames":240});
    let ready = measured(request(hidden, 0));
    for path in ["/imageDimensions", "/fontMetrics/0/bounds"] {
        let mut bad = ready.clone();
        bad.pointer_mut(path).unwrap().as_array_mut().unwrap().pop();
        let error = resolve(&bad);
        assert!(error.get("error").is_some(), "missing {path}: {error}");
        assert!(error.get("frame").is_none());
    }
    let mut bad = ready.clone();
    bad["fontMetrics"][0]["bounds"][0]["right"] = json!(100000000);
    assert!(resolve(&bad).get("error").is_some());
    let mut bad = ready;
    // Finite and individually within4096 surface sides, but the mandatory
    // fill/line/shadow lifetimes exceed the measured whole-source envelope.
    for bound in bad["fontMetrics"][0]["bounds"].as_array_mut().unwrap() {
        bound["right"] = json!(3000);
        bound["ascent"] = json!(3000);
        bound["descent"] = json!(0);
    }
    let error = resolve(&bad);
    assert!(
        error["error"]
            .as_str()
            .unwrap()
            .contains("measured whole-source scratch"),
        "{error}"
    );
}

#[test]
fn provisional_discovery_does_not_admit_oversized_decoded_character_or_other_images() {
    let ready = measured(request(recipe("kanji", vec![]), 48));
    for (width, height) in [(4097, 32), (4096, 4096)] {
        let mut bad = ready.clone();
        bad["imageDimensions"][0]["width"] = json!(width);
        bad["imageDimensions"][0]["height"] = json!(height);
        let result = resolve(&bad);
        assert!(result.get("error").is_some(), "{result}");
        assert!(result.get("frame").is_none());
    }
    // Sky is not the wind-mask image, but its decoded cost still participates
    // in the unchanged whole-source budget.
    let mut bad = ready;
    let sky = bad["imageDimensions"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["resource"]["id"] == "sky")
        .unwrap();
    sky["width"] = json!(4096);
    sky["height"] = json!(4096);
    let result = resolve(&bad);
    assert!(result.get("error").is_some(), "{result}");
}

fn analysis(digest: &str) -> Value {
    let channels: Value = ["mix_rms", "low_power", "mid_power", "high_power"]
        .into_iter()
        .map(|key| (key.to_string(), json!(vec![0.0; 16])))
        .collect();
    let scales: Value = ["mix_rms", "low_power", "mid_power", "high_power"]
        .into_iter()
        .map(|key| (key.to_string(), json!(1)))
        .collect();
    json!({"schema":"rocut-mv-audio/1","provenance":{"schema":"creator-mv-audio/1","inputSha256":digest,
        "manifestSha256":"a".repeat(64),"musicSha256":"b".repeat(64),"envelopesSha256":"c".repeat(64),"vocalSha256":null,
        "review":{"status":"accepted","reference":"synthetic transport test"}},"duration":16,"fps":1,
        "beats":(0..32).map(|i|i*60000).collect::<Vec<_>>(),"downbeats":[],"channels":channels,"scales":scales})
}

#[test]
fn mixed_title_riff_image_is_counted_independently_of_the_kanji_character() {
    let mut title = catalog_author("titleRiff", "intro");
    title["fonts"] = json!({"title":"monument","hud":"lyric","ruby":"lyric","subtitle":"counter"});
    title["char"] = json!("title-character");
    title["sky"] = json!("sky");
    let mixed = recipe(
        "kanji",
        vec![
            json!({"id":"title","scene":{"kind":"titleRiff","role":"graphics","settings":title,"span":{"startFrame":0,"durationFrames":240}}}),
        ],
    );
    let mut r = request(mixed, 48);
    let sha = "9".repeat(64);
    r["source"]["resources"].as_array_mut().unwrap().push(json!({"id":"title-character","kind":"image","attachmentKey":format!("programmatic-sha256-{sha}"),"sha256":sha,"mimeType":"image/png","byteLength":100}));
    let mut ready = measured(r);
    assert_eq!(ready["imageDimensions"].as_array().unwrap().len(), 3);
    let result = resolve(&ready);
    assert!(result.get("error").is_none(), "{result}");
    let image = ready["imageDimensions"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["resource"]["id"] == "title-character")
        .unwrap();
    image["width"] = json!(4096);
    image["height"] = json!(4096);
    let error = resolve(&ready);
    assert!(
        error["error"]
            .as_str()
            .unwrap()
            .contains("temporary raster surface budget"),
        "{error}"
    );
}
#[test]
fn hidden_analysis_shot_requires_reviewed_binding_and_rejects_another_song() {
    let mut hidden = recipe("black", vec![black()]);
    hidden["nodes"][0]["scene"]["settings"]["beats"] = json!({"kind":"analysis"});
    hidden["nodes"][0]["scene"]["span"] = json!({"startFrame":240,"durationFrames":240});
    let mut r = request(hidden, 0);
    assert!(resolve(&r).get("error").is_some());
    let digest = "d".repeat(64);
    r["source"]["resources"].as_array_mut().unwrap().push(json!({"id":"analysis","kind":"analysis","attachmentKey":format!("programmatic-sha256-{}","e".repeat(64)),
        "sha256":"e".repeat(64),"mimeType":"application/json","byteLength":100}));
    r["source"]["recipe"]["audio"] = json!({"resource":"analysis","inputSha256":digest});
    assert!(
        resolve(&r)["error"]
            .as_str()
            .unwrap()
            .contains("Missing MV audio")
    );
    r["analysis"] = analysis(&"f".repeat(64));
    assert!(
        resolve(&r)["error"]
            .as_str()
            .unwrap()
            .contains("different song digest")
    );
    r["analysis"] = analysis(&digest);
    let result = resolve(&measured(r));
    assert!(result.get("error").is_none(), "{result}");
}
