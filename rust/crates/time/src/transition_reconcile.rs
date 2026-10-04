//! Ordinary UI edits can discard stale existing links. Explicit edits to a link
//! must fail instead; otherwise an invalid duration would look like a successful removal.
use crate::{
    FrameRate, TransitionClip, TransitionGraphEvaluation, TransitionLink, evaluate_transition_graph,
};
use serde::Serialize;
use std::collections::BTreeSet;

crate::strict_object::strict_object! {
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviousTransitionGraph {
    pub clip_ids: Vec<String>,
    pub links: Vec<TransitionLink>,
}
}

pub struct TransitionGraphReconciliation {
    pub graph: TransitionGraphEvaluation,
    pub removed: Vec<usize>,
}

/// New clip IDs arise from split/duplicate/paste: incoming relations are not
/// copied implicitly. An explicit public create batch uses strict evaluation,
/// and a UI user may attach a new relation after inserting the clip.
pub fn reconcile_transition_graph(
    clips: &[TransitionClip],
    links: &[TransitionLink],
    frame_rate: FrameRate,
    previous: &PreviousTransitionGraph,
) -> TransitionGraphReconciliation {
    let ids: BTreeSet<_> = previous.clip_ids.iter().map(String::as_str).collect();
    let old_links: BTreeSet<_> = previous
        .links
        .iter()
        .map(|link| {
            (
                link.outgoing_clip_id.as_str(),
                link.incoming_clip_id.as_str(),
                link.duration_frames,
            )
        })
        .collect();
    let mut removed = BTreeSet::new();
    let mut retained = Vec::new();
    let mut original_indices = Vec::new();
    for (index, link) in links.iter().enumerate() {
        if !ids.contains(link.incoming_clip_id.as_str()) {
            removed.insert(index);
        } else {
            retained.push(link.clone());
            original_indices.push(index);
        }
    }
    let mut graph = evaluate_transition_graph(clips, &retained, frame_rate);
    for entry in &mut graph.accepted {
        entry.link_index = original_indices[entry.link_index];
    }
    for entry in &mut graph.rejected {
        entry.link_index = original_indices[entry.link_index];
    }
    graph.rejected.retain(|entry| {
        let link = &links[entry.link_index];
        if old_links.contains(&(
            link.outgoing_clip_id.as_str(),
            link.incoming_clip_id.as_str(),
            link.duration_frames,
        )) {
            removed.insert(entry.link_index);
            false
        } else {
            true
        }
    });
    TransitionGraphReconciliation {
        graph,
        removed: removed.into_iter().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MediaTime, TransitionSource};
    fn c(id: &str, start: i64, duration: i64) -> TransitionClip {
        TransitionClip {
            id: id.into(),
            track_id: "video".into(),
            start: MediaTime::from_ticks(start),
            duration: MediaTime::from_ticks(duration),
            source: TransitionSource::Image,
        }
    }
    fn link() -> TransitionLink {
        TransitionLink {
            outgoing_clip_id: "a".into(),
            incoming_clip_id: "b".into(),
            duration_frames: 30,
        }
    }
    fn previous() -> PreviousTransitionGraph {
        PreviousTransitionGraph {
            clip_ids: vec!["a".into(), "b".into()],
            links: vec![link()],
        }
    }
    #[test]
    fn ordinary_move_or_delete_removes_existing_relation() {
        for clips in [
            vec![c("a", 0, 240_000), c("b", 244_000, 240_000)],
            vec![c("b", 240_000, 240_000)],
        ] {
            let result =
                reconcile_transition_graph(&clips, &[link()], FrameRate::FPS_30, &previous());
            assert_eq!(result.removed, vec![0]);
            assert!(result.graph.rejected.is_empty());
        }
    }
    #[test]
    fn explicit_invalid_add_or_duration_edit_is_not_silently_removed() {
        let clips = vec![c("a", 0, 240_000), c("b", 240_000, 240_000)];
        let invalid = TransitionLink {
            duration_frames: 9999,
            ..link()
        };
        for previous in [
            previous(),
            PreviousTransitionGraph {
                links: vec![],
                ..previous()
            },
        ] {
            let result = reconcile_transition_graph(
                &clips,
                &[invalid.clone()],
                FrameRate::FPS_30,
                &previous,
            );
            assert!(result.removed.is_empty());
            assert_eq!(result.graph.rejected.len(), 1);
        }
    }
    #[test]
    fn split_or_duplicate_drops_copied_link_without_poisoning_original() {
        let clips = vec![
            c("a", 0, 240_000),
            c("b", 240_000, 120_000),
            c("copy", 360_000, 120_000),
        ];
        let copy = TransitionLink {
            incoming_clip_id: "copy".into(),
            ..link()
        };
        let result =
            reconcile_transition_graph(&clips, &[link(), copy], FrameRate::FPS_30, &previous());
        assert_eq!(result.removed, vec![1]);
        assert!(result.graph.rejected.is_empty());
        assert_eq!(result.graph.accepted[0].link_index, 0);
    }
    #[test]
    fn accepts_explicit_valid_add_to_existing_clip_and_keeps_indices_after_cleanup() {
        let clips = vec![
            c("a", 0, 240_000),
            c("b", 240_000, 240_000),
            c("copy", 480_000, 240_000),
        ];
        let copy = TransitionLink {
            incoming_clip_id: "copy".into(),
            ..link()
        };
        let result = reconcile_transition_graph(
            &clips,
            &[copy, link()],
            FrameRate::FPS_30,
            &PreviousTransitionGraph {
                links: vec![],
                ..previous()
            },
        );
        assert_eq!(result.removed, vec![0]);
        assert!(result.graph.rejected.is_empty());
        assert_eq!(result.graph.accepted[0].link_index, 1);
    }
}
