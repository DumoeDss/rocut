use super::*;

fn options() -> CreateMotionTextStructuredCuesOptions {
    CreateMotionTextStructuredCuesOptions {
        sequence_id: "structured:test".to_owned(),
        source: "\r\n  A! | *B* / [x]  \r\n\r\n  A! | *B* / [x]  \n".to_owned(),
        cues: vec![2, 4]
            .into_iter()
            .enumerate()
            .map(|(i, line)| MotionTextStructuredCue {
                line_id: format!("line:{i}"),
                source_line: line,
                text: "  A! | *B* / [x]  ".to_owned(),
                start_ticks: 13 + i as i64 * 120000,
                end_ticks: 110013 + i as i64 * 120000,
            })
            .collect(),
        language: "en".to_owned(),
        duration_ticks: 300000,
        seed: Some(7),
        starter_preset: MotionTextStarterPreset::CleanCaption,
        renderer_support: [
            (MotionTextPresetGroup::Style, "base"),
            (MotionTextPresetGroup::Layout, "center"),
            (MotionTextPresetGroup::Enter, "fade"),
            (MotionTextPresetGroup::Hold, "still"),
            (MotionTextPresetGroup::Exit, "fade"),
            (MotionTextPresetGroup::Treat, "none"),
            (MotionTextPresetGroup::Bg, "transparent"),
            (MotionTextPresetGroup::Cam, "static"),
        ]
        .into_iter()
        .map(|(group, id)| MotionTextRendererPresetSupport {
            group,
            id: id.to_owned(),
        })
        .collect(),
    }
}

#[test]
fn preserves_exact_source_blanks_repeats_and_tick_endpoints() {
    let input = options();
    let output = create_motion_text_structured_cues(input.clone());
    assert!(output.sequence_json.is_some(), "{:?}", output.diagnostics);
    let sequence: Value = serde_json::from_str(output.sequence_json.as_ref().unwrap()).unwrap();
    assert_eq!(sequence["source"]["text"], input.source);
    assert_eq!(sequence["cues"].as_array().unwrap().len(), 2);
    for (i, cue) in input.cues.iter().enumerate() {
        assert_eq!(sequence["cues"][i]["text"], cue.text);
        assert_eq!(sequence["cues"][i]["sourceLine"], cue.source_line);
        assert_eq!(sequence["cues"][i]["startTime"], cue.start_ticks);
        assert_eq!(
            sequence["cues"][i]["duration"],
            cue.end_ticks - cue.start_ticks
        );
        assert_eq!(sequence["cues"][i]["timingSource"], "manual");
        assert_eq!(output.line_mappings[i].line_id, cue.line_id);
    }
    assert_ne!(
        output.line_mappings[0].cue_id,
        output.line_mappings[1].cue_id
    );
    assert_eq!(output, create_motion_text_structured_cues(input));
}

#[test]
fn invalid_source_identity_order_and_times_are_rejected() {
    let changes: Vec<Box<dyn Fn(&mut CreateMotionTextStructuredCuesOptions)>> = vec![
        Box::new(|v| v.cues[0].text = "changed".to_owned()),
        Box::new(|v| v.cues[0].source_line = 1),
        Box::new(|v| v.cues[1].line_id = v.cues[0].line_id.clone()),
        Box::new(|v| v.cues[1].source_line = 2),
        Box::new(|v| v.cues[0].start_ticks = -1),
        Box::new(|v| v.cues[0].end_ticks = v.cues[0].start_ticks),
        Box::new(|v| v.cues[1].start_ticks = v.cues[0].end_ticks - 1),
        Box::new(|v| v.cues[1].end_ticks = v.duration_ticks + 1),
        Box::new(|v| v.duration_ticks = MAX_SAFE_TICKS + 1),
        Box::new(|v| v.duration_ticks = 0),
        Box::new(|v| v.cues.clear()),
    ];
    for change in changes {
        let mut input = options();
        change(&mut input);
        let result = create_motion_text_structured_cues(input);
        assert!(result.sequence_json.is_none());
        assert!(result.line_mappings.is_empty());
        assert!(has_errors(&result.diagnostics));
    }
}

#[test]
fn stable_cue_identity_depends_on_line_id_not_repeated_text() {
    let input = options();
    let first = create_motion_text_structured_cues(input.clone());
    let mut changed = input;
    changed.cues[0].line_id = "different-line".to_owned();
    let second = create_motion_text_structured_cues(changed);
    assert_ne!(
        first.line_mappings[0].cue_id,
        second.line_mappings[0].cue_id
    );
    assert_eq!(
        first.line_mappings[1].cue_id,
        second.line_mappings[1].cue_id
    );
}

#[test]
fn preserves_bare_cr_and_rejects_blank_line_cues() {
    let mut input = options();
    input.source = input.source.replace("\r\n", "\r");
    let output = create_motion_text_structured_cues(input.clone());
    let sequence: Value = serde_json::from_str(output.sequence_json.as_ref().unwrap()).unwrap();
    assert_eq!(sequence["source"]["text"], input.source);
    input.cues[0].source_line = 1;
    input.cues[0].text.clear();
    assert!(
        create_motion_text_structured_cues(input)
            .sequence_json
            .is_none()
    );
}
