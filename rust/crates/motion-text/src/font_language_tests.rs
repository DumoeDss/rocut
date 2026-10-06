use crate::{
    CreateMotionTextSequenceOptions, InspectMotionTextFontOptions, MotionTextSourceFormat,
    MotionTextStarterPreset, create_motion_text_sequence, inspect_motion_text_font,
};
use serde_json::Value;
use std::{fs, path::PathBuf};

#[test]
fn korean_default_asset_is_resolved_and_covers_multilingual_text() {
    let source = "바람\n밤의 도시, 그리고 아침!\n風 hello 바람 中文，123！";
    for language in ["ko", "ko-KR"] {
        let renderer_support = [
            ("style", "base"),
            ("layout", "center"),
            ("enter", "fade"),
            ("hold", "still"),
            ("exit", "fade"),
            ("treat", "none"),
            ("bg", "transparent"),
            ("cam", "static"),
        ]
        .into_iter()
        .map(|(group, id)| {
            serde_json::from_value(serde_json::json!({"group": group, "id": id})).unwrap()
        })
        .collect();
        let result = create_motion_text_sequence(CreateMotionTextSequenceOptions {
            sequence_id: "sequence:korean-font".to_owned(),
            source: source.to_owned(),
            source_format: MotionTextSourceFormat::Plain,
            language: language.to_owned(),
            duration: 1_800_000,
            seed: Some(83),
            starter_preset: MotionTextStarterPreset::CleanCaption,
            renderer_support,
        });
        let document: Value =
            serde_json::from_str(result.sequence_json.as_deref().expect("valid Korean input"))
                .unwrap();
        assert_eq!(document["defaults"]["fontId"], "gothic_bold_ko");
        let cuts = document["resolvedPlan"]["cuts"].as_array().unwrap();
        assert!(!cuts.is_empty());
        assert!(cuts.iter().all(|cut| cut["fontId"] == "gothic_bold_ko"));
        let font = document["fonts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|font| font["id"] == "gothic_bold_ko")
            .unwrap();
        let bytes = fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../apps/web/public")
                .join(font["builtinPath"].as_str().unwrap()),
        )
        .unwrap();
        let inspection = inspect_motion_text_font(InspectMotionTextFontOptions {
            bytes,
            text: source.to_owned(),
            face_index: 0,
        })
        .inspection
        .unwrap();
        assert_eq!(font["contentDigest"], inspection.content_digest);
        assert!(inspection.missing_code_points.is_empty());
    }
}
