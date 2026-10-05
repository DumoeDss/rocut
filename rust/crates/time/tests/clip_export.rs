use time::{
    ClipExportOptions, ExportClipCandidate, ExportClipRef, ExportClipSelection, MediaTime,
    plan_clip_exports,
};

fn candidate(id: &str, start: i64, duration: i64) -> ExportClipCandidate {
    ExportClipCandidate {
        reference: ExportClipRef {
            track_id: "video".into(),
            element_id: id.into(),
        },
        name: "同名视频.mp4".into(),
        track_name: "Video".into(),
        media_id: Some("asset".into()),
        start_time: MediaTime::from_ticks(start),
        duration: MediaTime::from_ticks(duration),
    }
}
fn options(clips: Vec<ExportClipCandidate>) -> ClipExportOptions {
    ClipExportOptions {
        clips,
        selection: ExportClipSelection::All,
        timeline_duration: MediaTime::from_ticks(1_200_000),
    }
}

#[test]
fn repeated_asset_instances_keep_distinct_authored_ranges_in_timeline_order() {
    let mut request = options(vec![
        candidate("later", 600_000, 240_000),
        candidate("first", 120_000, 120_000),
    ]);
    request.selection = ExportClipSelection::Media {
        ids: vec!["asset".into(), "asset".into()],
    };
    let plan = plan_clip_exports(request);
    assert!(plan.error.is_none());
    assert_eq!(plan.clips.len(), 2);
    assert_eq!(plan.clips[0].start_time.as_ticks(), 120_000);
    assert_eq!(plan.clips[0].end_time.as_ticks(), 240_000);
    assert_eq!(plan.clips[1].start_time.as_ticks(), 600_000);
    assert_eq!(plan.clips[1].end_time.as_ticks(), 840_000);
    assert_eq!(plan.clips[0].filename_stem, "001-同名视频.mp4");
    assert_eq!(plan.clips[1].filename_stem, "002-同名视频.mp4");
}

#[test]
fn explicit_selection_deduplicates_and_missing_selection_fails_closed() {
    let clip = candidate("one", 0, 120_000);
    let mut request = options(vec![clip.clone(), candidate("two", 120_000, 120_000)]);
    request.selection = ExportClipSelection::Elements {
        references: vec![clip.reference.clone(), clip.reference],
    };
    assert_eq!(plan_clip_exports(request.clone()).clips.len(), 1);
    request.selection = ExportClipSelection::Elements {
        references: vec![candidate("missing", 0, 1).reference],
    };
    let failed = plan_clip_exports(request);
    assert!(failed.error.is_some());
    assert!(failed.clips.is_empty());
}

#[test]
fn empty_selection_and_unused_assets_do_not_export_the_whole_project() {
    for selection in [
        ExportClipSelection::Elements { references: vec![] },
        ExportClipSelection::Media {
            ids: vec!["unused".into()],
        },
    ] {
        let mut request = options(vec![candidate("one", 0, 120_000)]);
        request.selection = selection;
        assert!(plan_clip_exports(request).clips.is_empty());
    }
}

#[test]
fn invalid_ranges_and_duplicate_identities_never_produce_partial_exports() {
    for (start, duration) in [
        (-1, 120_000),
        (0, 0),
        (0, -1),
        (1_200_000, 1),
        (i64::MAX, 1),
    ] {
        let plan = plan_clip_exports(options(vec![
            candidate("good", 0, 120_000),
            candidate("bad", start, duration),
        ]));
        assert!(plan.error.is_some());
        assert!(plan.clips.is_empty());
    }
    assert!(
        plan_clip_exports(options(vec![
            candidate("same", 0, 1),
            candidate("same", 1, 1)
        ]))
        .error
        .is_some()
    );
}

#[test]
fn filenames_cannot_escape_download_directory_and_reserved_names_are_prefixed() {
    let mut clips = vec![
        candidate("one", 0, 120_000),
        candidate("two", 120_000, 120_000),
        candidate("three", 240_000, 120_000),
    ];
    clips[0].name = "../恶意\\clip:\u{0}*. ".into();
    clips[1].name = "CON".into();
    clips[2].name = " ... ".into();
    let plan = plan_clip_exports(options(clips));
    assert_eq!(plan.clips[0].filename_stem, "001--恶意-clip---");
    assert_eq!(plan.clips[1].filename_stem, "002-CON");
    assert_eq!(plan.clips[2].filename_stem, "003-clip");
}
