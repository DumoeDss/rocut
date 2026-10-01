use super::*;

/// Explicit catalog edits change only one group. Locked cues/groups are never
/// rewritten; the ordinary planner also retains individual locked cut snapshots.
pub(super) fn apply(
    document: &mut Map<String, Value>,
    group: MotionTextPresetGroup,
    preset_id: &str,
    cue_ids: &[String],
) -> Result<(), CreateMotionTextSequenceResult> {
    if !valid_id(preset_id)
        || !jizura_planner_catalog()
            .choices
            .iter()
            .any(|entry| entry.group == group && entry.id == preset_id)
    {
        return Err(failed_build(
            "invalid-preset",
            "The selected preset is not in the motion-text catalog.",
        ));
    }
    let key = serde_json::to_value(group).expect("preset groups serialize");
    let key = key.as_str().expect("preset groups are strings");
    let cues = document
        .get_mut("cues")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            failed_build(
                "invalid-sequence",
                "Motion-text sequence cues must be an array.",
            )
        })?;
    let selected: BTreeSet<_> = cue_ids.iter().map(String::as_str).collect();
    if selected.len() != cue_ids.len()
        || selected.iter().any(|id| {
            !cues
                .iter()
                .any(|cue| cue.get("id").and_then(Value::as_str) == Some(*id))
        })
    {
        return Err(failed_build(
            "invalid-preset-cues",
            "Preset targets must be unique existing cues.",
        ));
    }
    for cue in cues {
        let cue = cue
            .as_object_mut()
            .ok_or_else(|| failed_build("invalid-sequence", "Motion-text cues must be objects."))?;
        if !selected.is_empty()
            && !cue
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| selected.contains(id))
        {
            continue;
        }
        if cue_has_lock(cue, "cue", "all")
            || cue_has_lock(cue, "cue", "preset")
            || cue_has_lock(cue, "preset-group", key)
        {
            continue;
        }
        let overrides = object_field_mut(cue, "overrides")?;
        let preset = object_field_mut(overrides, "preset")?;
        let value = if matches!(
            group,
            MotionTextPresetGroup::Decor | MotionTextPresetGroup::Fx
        ) {
            serde_json::json!([preset_id])
        } else {
            Value::String(preset_id.to_owned())
        };
        preset.insert(key.to_owned(), value);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn support() -> Vec<MotionTextRendererPresetSupport> {
        let mut entries: Vec<_> = jizura_planner_catalog()
            .choices
            .into_iter()
            .map(|choice| MotionTextRendererPresetSupport {
                group: choice.group,
                id: choice.id,
            })
            .collect();
        entries.extend(
            [
                (MotionTextPresetGroup::Style, "base"),
                (MotionTextPresetGroup::Enter, "fade"),
                (MotionTextPresetGroup::Exit, "fade"),
                (MotionTextPresetGroup::Bg, "transparent"),
                (MotionTextPresetGroup::Cam, "static"),
            ]
            .into_iter()
            .map(|(group, id)| MotionTextRendererPresetSupport {
                group,
                id: id.to_owned(),
            }),
        );
        entries
    }

    fn fixture() -> Value {
        let result = create_motion_text_sequence(CreateMotionTextSequenceOptions {
            sequence_id: "catalog-test".to_owned(),
            source: "First line\nSecond line".to_owned(),
            source_format: MotionTextSourceFormat::Plain,
            language: "en".to_owned(),
            duration: 1_800_000,
            seed: Some(7),
            starter_preset: MotionTextStarterPreset::CleanCaption,
            renderer_support: support(),
        });
        assert!(result.sequence_json.is_some(), "{:?}", result.diagnostics);
        serde_json::from_str(result.sequence_json.as_deref().expect("fixture sequence")).unwrap()
    }

    fn mutate(
        document: &Value,
        group: &str,
        id: &str,
        cue_ids: Value,
    ) -> CreateMotionTextSequenceResult {
        mutate_motion_text_sequence(MutateMotionTextSequenceOptions {
            sequence_json: document.to_string(), mutation_json: serde_json::json!({"kind":"apply-preset", "group":group, "presetId":id, "cueIds":cue_ids}).to_string(),
            renderer_support: support(),
        })
    }

    #[test]
    fn catalog_application_changes_only_the_selected_group_and_preserves_provenance() {
        let mut document = fixture();
        document["extensions"] = serde_json::json!({"opaque":"keep"});
        let result = mutate(&document, "style", "crimson", serde_json::json!([]));
        let applied: Value =
            serde_json::from_str(result.sequence_json.as_deref().expect("preset applies")).unwrap();
        assert_eq!(applied["revision"], 1);
        assert_eq!(applied["extensions"], document["extensions"]);
        assert_eq!(applied["engine"], document["engine"]);
        assert_eq!(applied["defaults"], document["defaults"]);
        for (before, after) in document["resolvedPlan"]["cuts"]
            .as_array()
            .unwrap()
            .iter()
            .zip(applied["resolvedPlan"]["cuts"].as_array().unwrap())
        {
            assert_eq!(after["preset"]["style"], "crimson");
            assert_eq!(after["preset"]["layout"], before["preset"]["layout"]);
            assert_eq!(after["startTime"], before["startTime"]);
        }
    }

    #[test]
    fn catalog_application_honors_cue_and_group_locks() {
        for lock in [
            serde_json::json!({"scope":"cue","key":"all"}),
            serde_json::json!({"scope":"cue","key":"preset"}),
            serde_json::json!({"scope":"preset-group","key":"style"}),
        ] {
            let mut document = fixture();
            document["cues"][0]["locks"] = serde_json::json!([lock]);
            let result = mutate(&document, "style", "crimson", serde_json::json!([]));
            let applied: Value = serde_json::from_str(
                result
                    .sequence_json
                    .as_deref()
                    .expect("unlocked cue applies"),
            )
            .unwrap();
            assert_eq!(applied["cues"][0], document["cues"][0]);
            assert_eq!(
                applied["resolvedPlan"]["cuts"][0]["preset"],
                document["resolvedPlan"]["cuts"][0]["preset"]
            );
            assert_eq!(
                applied["cues"][1]["overrides"]["preset"]["style"],
                "crimson"
            );
        }
    }

    #[test]
    fn catalog_application_scopes_cues_and_rejects_unknown_inputs() {
        let document = fixture();
        let id = document["cues"][1]["id"].clone();
        let result = mutate(&document, "style", "crimson", serde_json::json!([id]));
        let applied: Value =
            serde_json::from_str(result.sequence_json.as_deref().unwrap()).unwrap();
        assert_eq!(applied["cues"][0], document["cues"][0]);
        assert_eq!(
            applied["cues"][1]["overrides"]["preset"]["style"],
            "crimson"
        );
        assert!(
            mutate(&document, "style", "missing", serde_json::json!([]))
                .sequence_json
                .is_none()
        );
        assert!(
            mutate(
                &document,
                "style",
                "crimson",
                serde_json::json!(["missing"])
            )
            .sequence_json
            .is_none()
        );
    }

    #[test]
    fn catalog_application_supports_every_catalog_entry() {
        let document = fixture();
        for entry in jizura_planner_catalog().choices {
            let group = serde_json::to_value(entry.group).unwrap();
            let key = group.as_str().unwrap();
            let result = mutate(&document, key, &entry.id, serde_json::json!([]));
            assert!(
                result.sequence_json.is_some(),
                "{key}:{} {:?}",
                entry.id,
                result.diagnostics
            );
            let applied: Value =
                serde_json::from_str(result.sequence_json.as_deref().unwrap()).unwrap();
            let expected = if matches!(
                entry.group,
                MotionTextPresetGroup::Decor | MotionTextPresetGroup::Fx
            ) {
                serde_json::json!([entry.id])
            } else {
                serde_json::json!(entry.id)
            };
            assert_eq!(applied["cues"][1]["overrides"]["preset"][key], expected);
            assert_eq!(
                applied["resolvedPlan"]["cuts"][1]["preset"][key], expected,
                "{key}:{}",
                entry.id
            );
        }
    }

    #[test]
    fn catalog_application_preserves_locked_cut_snapshots() {
        let mut document = fixture();
        let cut_id = document["resolvedPlan"]["cuts"][0]["id"].clone();
        document["cues"][0]["locks"] = serde_json::json!([{"scope":"cut", "key":cut_id}]);
        let result = mutate(&document, "style", "crimson", serde_json::json!([]));
        let applied: Value =
            serde_json::from_str(result.sequence_json.as_deref().unwrap()).unwrap();
        assert_eq!(
            applied["resolvedPlan"]["cuts"][0],
            document["resolvedPlan"]["cuts"][0]
        );
        assert_eq!(
            applied["resolvedPlan"]["cuts"][1]["preset"]["style"],
            "crimson"
        );
    }
}
