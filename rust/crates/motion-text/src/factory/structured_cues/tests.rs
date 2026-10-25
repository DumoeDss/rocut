use super::*;

fn options() -> CreateMotionTextStructuredCuesOptions {
    CreateMotionTextStructuredCuesOptions {
        sequence_id: "structured:test".to_owned(),
        text_syntax: None,
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

fn syntax_options(source: &str, selected: &[u32]) -> CreateMotionTextStructuredCuesOptions {
    let mut input = options();
    input.source = source.to_owned();
    input.text_syntax = Some(MotionTextStructuredTextSyntax::Jizura);
    input.cues = selected
        .iter()
        .enumerate()
        .map(|(i, line)| MotionTextStructuredCue {
            line_id: format!("syntax:{i}"),
            source_line: *line,
            text: source
                .replace("\r\n", "\n")
                .replace('\r', "\n")
                .split('\n')
                .nth(*line as usize - 1)
                .unwrap()
                .to_owned(),
            start_ticks: 17 + i as i64 * 120000,
            end_ticks: 100017 + i as i64 * 120000,
        })
        .collect();
    input
}

#[test]
fn explicit_jizura_preserves_raw_identity_and_fixed_clock_but_interprets_display() {
    let input = syntax_options(
        "[ti:original]\r\n[00:09]*救って*/世界! | whisper\r\n\r\n[間奏 9s]\r\nplain?",
        &[2, 4, 5],
    );
    let mut input = input;
    input.duration_ticks = 400000;
    let output = create_motion_text_structured_cues(input.clone());
    let sequence: Value =
        serde_json::from_str(output.sequence_json.as_deref().expect("syntax succeeds")).unwrap();
    assert_eq!(sequence["source"]["text"], input.source);
    assert_eq!(sequence["source"]["format"], "jizura");
    assert_eq!(sequence["cues"][0]["text"], "救って世界");
    assert_eq!(
        sequence["cues"][0]["emphasis"],
        serde_json::json!(["救って"])
    );
    assert_eq!(
        sequence["cues"][0]["segments"],
        serde_json::json!(["救って", "世界"])
    );
    assert_eq!(sequence["cues"][0]["impact"], true);
    assert_eq!(sequence["cues"][1]["interlude"], true);
    assert_eq!(sequence["cues"][1]["text"], "");
    assert_eq!(sequence["cues"][1]["gapBefore"], true);
    assert_eq!(sequence["cues"][2]["text"], "plain?");
    for (i, cue) in input.cues.iter().enumerate() {
        assert_eq!(sequence["cues"][i]["sourceLine"], cue.source_line);
        assert_eq!(sequence["cues"][i]["startTime"], cue.start_ticks);
        assert_eq!(
            sequence["cues"][i]["duration"],
            cue.end_ticks - cue.start_ticks
        );
        assert_eq!(output.line_mappings[i].line_id, cue.line_id);
    }
    let mut changed = input.clone();
    changed.cues[0].text = "救って世界".to_owned();
    let rejected = create_motion_text_structured_cues(changed);
    assert!(rejected.sequence_json.is_none());
    assert!(rejected.line_mappings.is_empty());
    let repeated = create_motion_text_structured_cues(input);
    assert_eq!(output, repeated);
}

#[test]
fn explicit_jizura_rejects_ignored_empty_and_expanded_selected_lines_without_partial_mappings() {
    for text in ["[ti:metadata]", "# comment", "/", "[00:01][00:02]expanded"] {
        let output =
            create_motion_text_structured_cues(syntax_options(&format!("valid\n{text}"), &[1, 2]));
        assert!(output.sequence_json.is_none(), "{text}");
        assert!(output.line_mappings.is_empty(), "{text}");
        assert!(
            output
                .diagnostics
                .iter()
                .any(|d| d.code == "invalid-structured-cue-syntax" && d.source_line == Some(2)),
            "{text}"
        );
    }
}

#[test]
fn explicit_literal_matches_default_even_for_syntax_and_ignored_source_lines() {
    let mut input = options();
    let default = create_motion_text_structured_cues(input.clone());
    input.text_syntax = Some(MotionTextStructuredTextSyntax::Literal);
    assert_eq!(default, create_motion_text_structured_cues(input));
    let mut ignored = syntax_options("[ti:literal]\n# literal", &[1, 2]);
    ignored.text_syntax = None;
    let output = create_motion_text_structured_cues(ignored);
    let sequence: Value = serde_json::from_str(output.sequence_json.as_deref().unwrap()).unwrap();
    assert_eq!(sequence["cues"][0]["text"], "[ti:literal]");
    assert_eq!(sequence["cues"][1]["text"], "# literal");
}

#[test]
fn explicit_jizura_interlude_label_and_declared_length_never_replace_fixed_endpoints() {
    for label in ["[間奏]", "[間奏 9s]"] {
        let input = syntax_options(label, &[1]);
        let output = create_motion_text_structured_cues(input.clone());
        let sequence: Value =
            serde_json::from_str(output.sequence_json.as_deref().unwrap()).unwrap();
        assert_eq!(sequence["cues"][0]["text"], "");
        assert_eq!(sequence["cues"][0]["interlude"], true);
        assert_eq!(sequence["cues"][0]["startTime"], input.cues[0].start_ticks);
        assert_eq!(
            sequence["cues"][0]["duration"],
            input.cues[0].end_ticks - input.cues[0].start_ticks
        );
    }
}

#[test]
fn explicit_jizura_scopes_line_diagnostics_to_selected_cues() {
    let source = "valid\n[18446744073709551616:01]broken";
    let selected = create_motion_text_structured_cues(syntax_options(source, &[1]));
    assert!(
        selected.sequence_json.is_some(),
        "{:?}",
        selected.diagnostics
    );
    assert_eq!(selected.line_mappings.len(), 1);
    assert!(
        !selected
            .diagnostics
            .iter()
            .any(|d| d.code == "invalid-lrc-time")
    );

    let rejected = create_motion_text_structured_cues(syntax_options(source, &[1, 2]));
    assert!(rejected.sequence_json.is_none());
    assert!(rejected.line_mappings.is_empty());
    assert!(
        rejected
            .diagnostics
            .iter()
            .any(|d| d.code == "invalid-lrc-time" && d.source_line == Some(2))
    );
}

#[test]
fn fixed_structured_timing_does_not_inherit_global_timing_allocator_warnings() {
    let output = create_motion_text_structured_cues(syntax_options("[00:09]valid\nuntimed", &[1]));
    assert!(output.sequence_json.is_some());
    assert!(
        !output
            .diagnostics
            .iter()
            .any(|d| d.code == "mixed-lrc-timing")
    );
}
