use time::{
    FrameRate, MediaTime, TransitionClip, TransitionGraphError, TransitionLink,
    TransitionPlanError, TransitionSource, evaluate_transition_graph,
};

fn clip(id: &str, track: &str, start: i64, duration: i64) -> TransitionClip {
    TransitionClip {
        id: id.into(),
        track_id: track.into(),
        start: MediaTime::from_ticks(start * 4_000),
        duration: MediaTime::from_ticks(duration * 4_000),
        source: TransitionSource::Image,
    }
}

fn link(outgoing: &str, incoming: &str, duration_frames: u32) -> TransitionLink {
    TransitionLink {
        outgoing_clip_id: outgoing.into(),
        incoming_clip_id: incoming.into(),
        duration_frames,
    }
}

fn chain() -> (Vec<TransitionClip>, Vec<TransitionLink>) {
    (
        vec![
            clip("a", "v1", 0, 30),
            clip("b", "v1", 30, 10),
            clip("c", "v1", 40, 10),
            clip("d", "v1", 50, 30),
        ],
        vec![link("a", "b", 10), link("b", "c", 10), link("c", "d", 10)],
    )
}

#[test]
fn retains_a_chain_including_touching_half_open_windows() {
    let (clips, links) = chain();
    let result = evaluate_transition_graph(&clips, &links, FrameRate::FPS_30);
    assert!(result.rejected.is_empty());
    assert_eq!(result.accepted.len(), 3);
    for pair in result.accepted.windows(2) {
        assert_eq!(pair[0].plan.window().end, pair[1].plan.window().start);
    }
    assert_eq!(clips[1].duration.as_ticks(), 40_000); // no ripple or geometry mutation
}

#[test]
fn removes_all_transitively_overlapping_windows_independent_of_input_order() {
    let (mut clips, mut links) = chain();
    for link in &mut links {
        link.duration_frames = 16;
    }
    for order in [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ] {
        let shuffled: Vec<_> = order.into_iter().map(|i| links[i].clone()).collect();
        clips.reverse();
        let result = evaluate_transition_graph(&clips, &shuffled, FrameRate::FPS_30);
        assert!(result.accepted.is_empty());
        assert_eq!(result.rejected.len(), 3);
        for (i, issue) in result.rejected.iter().enumerate() {
            assert_eq!(issue.link_index, i);
            assert_eq!(issue.error, TransitionGraphError::OverlappingWindows);
        }
    }
}

#[test]
fn equal_windows_on_different_tracks_are_independent() {
    let clips = vec![
        clip("a", "v1", 0, 30),
        clip("b", "v1", 30, 30),
        clip("x", "v2", 0, 30),
        clip("y", "v2", 30, 30),
    ];
    let result = evaluate_transition_graph(
        &clips,
        &[link("a", "b", 20), link("x", "y", 20)],
        FrameRate::FPS_30,
    );
    assert!(result.rejected.is_empty());
    assert_eq!(result.accepted.len(), 2);
}

#[test]
fn deleted_moved_trimmed_and_split_clips_do_not_leave_stale_links() {
    for mutation in 0..5 {
        let (mut clips, links) = chain();
        match mutation {
            0 => {
                clips.remove(0);
            }
            1 => clips[0].start = MediaTime::from_ticks(4_000),
            2 => clips[0].duration = MediaTime::from_ticks(116_000),
            3 => clips[0].track_id = "v2".into(),
            // A split keeps the left id and creates a new right id. Never silently retarget.
            _ => {
                clips[0].duration = MediaTime::from_ticks(60_000);
                clips.push(clip("a-right", "v1", 15, 15));
            }
        }
        let result = evaluate_transition_graph(&clips, &links, FrameRate::FPS_30);
        assert_eq!(
            result
                .accepted
                .iter()
                .map(|p| p.link_index)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(result.rejected.len(), 1);
        assert_eq!(result.rejected[0].link_index, 0);
    }
}

#[test]
fn both_sides_of_deleted_middle_clip_are_removed_without_harming_other_links() {
    let (mut clips, links) = chain();
    clips.retain(|clip| clip.id != "b");
    let result = evaluate_transition_graph(&clips, &links, FrameRate::FPS_30);
    assert_eq!(result.accepted.len(), 1);
    assert_eq!(result.accepted[0].link_index, 2);
    assert_eq!(result.rejected.len(), 2);
    assert!(
        result
            .rejected
            .iter()
            .all(|e| e.error == TransitionGraphError::MissingClip)
    );
}

#[test]
fn duplicate_clip_ids_and_incoming_or_outgoing_links_are_rejected() {
    let (mut clips, links) = chain();
    clips.push(clips[0].clone());
    let result = evaluate_transition_graph(&clips, &links, FrameRate::FPS_30);
    assert_eq!(
        result.rejected[0].error,
        TransitionGraphError::AmbiguousClip
    );
    assert_eq!(result.accepted.len(), 2);
    clips.pop();
    for (extra, expected) in [
        (link("c", "b", 10), TransitionGraphError::DuplicateIncoming),
        (link("a", "d", 10), TransitionGraphError::DuplicateOutgoing),
    ] {
        let result =
            evaluate_transition_graph(&clips, &[links[0].clone(), extra], FrameRate::FPS_30);
        assert!(result.accepted.is_empty());
        assert_eq!(result.rejected.len(), 2);
        assert!(result.rejected.iter().all(|e| e.error == expected));
    }
}

#[test]
fn changed_media_handles_use_the_same_planner_as_render_sampling() {
    let (mut clips, links) = chain();
    clips[0].source = TransitionSource::Video {
        trim_start: MediaTime::ZERO,
        source_duration: MediaTime::from_ticks(120_000),
        playback_rate: 1.0,
        freeze_frame: None,
    };
    let result = evaluate_transition_graph(&clips, &links, FrameRate::FPS_30);
    assert_eq!(
        result.rejected[0].error,
        TransitionGraphError::InvalidPlan(TransitionPlanError::MissingOutgoingHandle)
    );
    clips[0].source = TransitionSource::Video {
        trim_start: MediaTime::ZERO,
        source_duration: MediaTime::from_ticks(120_000),
        playback_rate: 1.0,
        freeze_frame: Some(MediaTime::ZERO),
    };
    let result = evaluate_transition_graph(&clips, &links, FrameRate::FPS_30);
    assert!(result.rejected.is_empty());
    assert_eq!(
        result.accepted[0]
            .plan
            .sample(result.accepted[0].plan.window().cut)
            .unwrap()
            .outgoing_source,
        Some(MediaTime::ZERO)
    );
}

#[test]
fn invalid_links_do_not_poison_other_valid_links_and_reconciliation_is_idempotent() {
    let (clips, mut links) = chain();
    links[1].duration_frames = 0;
    let result = evaluate_transition_graph(&clips, &links, FrameRate::FPS_30);
    assert_eq!(
        result.rejected[0].error,
        TransitionGraphError::InvalidPlan(TransitionPlanError::InvalidDuration)
    );
    let retained: Vec<_> = result
        .accepted
        .iter()
        .map(|p| links[p.link_index].clone())
        .collect();
    let reconciled = evaluate_transition_graph(&clips, &retained, FrameRate::FPS_30);
    assert!(reconciled.rejected.is_empty());
    assert_eq!(reconciled.accepted.len(), 2);
    assert!(
        evaluate_transition_graph(&[], &[], FrameRate::FPS_30)
            .rejected
            .is_empty()
    );
}
