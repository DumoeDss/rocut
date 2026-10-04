//! Shared validation/reconciliation policy for persistent incoming transitions.
//! Invalid links are reported, never repaired by moving clips or fabricating media.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::{
    ClipTransitionOptions, ClipTransitionPlan, FrameRate, TransitionClip, TransitionPlanError,
    plan_clip_transition,
};

crate::strict_object::strict_object! {
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Serialize, Clone, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransitionLink {
    pub outgoing_clip_id: String,
    pub incoming_clip_id: String,
    pub duration_frames: u32,
}
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(tag = "code", content = "reason", rename_all = "kebab-case")]
pub enum TransitionGraphError {
    MissingClip,
    AmbiguousClip,
    DuplicateIncoming,
    DuplicateOutgoing,
    InvalidPlan(TransitionPlanError),
    OverlappingWindows,
}

#[derive(Clone, Debug)]
pub struct PlannedTransitionLink {
    /// Original input position. Stable even when some other links are rejected.
    pub link_index: usize,
    pub plan: ClipTransitionPlan,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RejectedTransitionLink {
    pub link_index: usize,
    pub error: TransitionGraphError,
}

#[derive(Clone, Debug)]
pub struct TransitionGraphEvaluation {
    pub accepted: Vec<PlannedTransitionLink>,
    pub rejected: Vec<RejectedTransitionLink>,
}

fn counts<'a>(ids: impl Iterator<Item = &'a str>) -> BTreeMap<&'a str, usize> {
    let mut result = BTreeMap::new();
    for id in ids {
        *result.entry(id).or_insert(0) += 1;
    }
    result
}

/// Evaluate the entire candidate graph, not each transaction operation in isolation.
/// A hidden track is still a valid graph: visibility belongs to rendering, not storage.
/// Reconciliation keeps exactly the accepted links. All participants in an overlap
/// are rejected (including transitive chains); ordering never chooses a winner.
/// API callers instead reject the candidate if any rejected link exists.
pub fn evaluate_transition_graph(
    clips: &[TransitionClip],
    links: &[TransitionLink],
    frame_rate: FrameRate,
) -> TransitionGraphEvaluation {
    let clip_counts = counts(clips.iter().map(|clip| clip.id.as_str()));
    let by_id: BTreeMap<_, _> = clips.iter().map(|clip| (clip.id.as_str(), clip)).collect();
    let incoming_counts = counts(links.iter().map(|link| link.incoming_clip_id.as_str()));
    let outgoing_counts = counts(links.iter().map(|link| link.outgoing_clip_id.as_str()));
    let mut accepted = Vec::new();
    let mut rejected = Vec::new();
    for (link_index, link) in links.iter().enumerate() {
        let plan = (|| {
            let outgoing = by_id
                .get(link.outgoing_clip_id.as_str())
                .ok_or(TransitionGraphError::MissingClip)?;
            let incoming = by_id
                .get(link.incoming_clip_id.as_str())
                .ok_or(TransitionGraphError::MissingClip)?;
            if clip_counts[outgoing.id.as_str()] > 1 || clip_counts[incoming.id.as_str()] > 1 {
                return Err(TransitionGraphError::AmbiguousClip);
            }
            if incoming_counts[incoming.id.as_str()] > 1 {
                return Err(TransitionGraphError::DuplicateIncoming);
            }
            if outgoing_counts[outgoing.id.as_str()] > 1 {
                return Err(TransitionGraphError::DuplicateOutgoing);
            }
            plan_clip_transition(ClipTransitionOptions {
                outgoing: (*outgoing).clone(),
                incoming: (*incoming).clone(),
                duration_frames: link.duration_frames,
                frame_rate,
            })
            .map_err(TransitionGraphError::InvalidPlan)
        })();
        match plan {
            Ok(plan) => accepted.push(PlannedTransitionLink { link_index, plan }),
            Err(error) => rejected.push(RejectedTransitionLink { link_index, error }),
        }
    }
    // Sweep windows separately per track. Tracking the furthest end detects every
    // overlap participant in O(n log n), without input-order-dependent pruning.
    let mut ordered: Vec<_> = accepted.iter().collect();
    ordered.sort_by_key(|entry| {
        let link = &links[entry.link_index];
        let track = by_id[link.incoming_clip_id.as_str()].track_id.as_str();
        (track, entry.plan.window().start)
    });
    let mut conflicts = BTreeSet::new();
    let mut furthest: Option<(&str, &PlannedTransitionLink)> = None;
    for entry in ordered {
        let track = by_id[links[entry.link_index].incoming_clip_id.as_str()]
            .track_id
            .as_str();
        if let Some((previous_track, previous)) = furthest {
            if previous_track == track {
                if entry.plan.window().start < previous.plan.window().end {
                    conflicts.insert(previous.link_index);
                    conflicts.insert(entry.link_index);
                }
                if entry.plan.window().end <= previous.plan.window().end {
                    continue;
                }
            }
        }
        furthest = Some((track, entry));
    }
    accepted.retain(|entry| !conflicts.contains(&entry.link_index));
    rejected.extend(
        conflicts
            .into_iter()
            .map(|link_index| RejectedTransitionLink {
                link_index,
                error: TransitionGraphError::OverlappingWindows,
            }),
    );
    rejected.sort_by_key(|entry| entry.link_index);
    TransitionGraphEvaluation { accepted, rejected }
}
