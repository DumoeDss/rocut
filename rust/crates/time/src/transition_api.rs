//! Serializable boundary shared by transaction policy, preview and export.
use bridge::export;
use serde::{Deserialize, Serialize};

use crate::{
    ClipTransitionSample, ClipTransitionWindow, FrameRate, MediaTime, PreviousTransitionGraph,
    RejectedTransitionLink, TransitionClip, TransitionLink, evaluate_transition_graph,
    reconcile_transition_graph,
};

crate::strict_object::strict_object! {
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipTransitionsOptions {
    pub clips: Vec<TransitionClip>,
    pub links: Vec<TransitionLink>,
    pub frame_rate: FrameRate,
    #[serde(default)]
    pub playhead: Option<MediaTime>,
    /// Only UI edit reconciliation supplies prior state. Public transactions omit it.
    #[serde(default)]
    pub previous: Option<PreviousTransitionGraph>,
}
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EvaluatedTransitionLink {
    pub link_index: usize,
    pub window: ClipTransitionWindow,
    /// None when validation alone was requested or playhead is outside this window.
    pub sample: Option<ClipTransitionSample>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipTransitionsEvaluation {
    pub accepted: Vec<EvaluatedTransitionLink>,
    pub rejected: Vec<RejectedTransitionLink>,
    /// Original input indices to clear atomically with an ordinary UI edit.
    pub removed: Vec<usize>,
}

#[export]
pub fn evaluate_clip_transitions(options: ClipTransitionsOptions) -> ClipTransitionsEvaluation {
    let (graph, removed) = if let Some(previous) = &options.previous {
        let result = reconcile_transition_graph(
            &options.clips,
            &options.links,
            options.frame_rate,
            previous,
        );
        (result.graph, result.removed)
    } else {
        (
            evaluate_transition_graph(&options.clips, &options.links, options.frame_rate),
            vec![],
        )
    };
    ClipTransitionsEvaluation {
        accepted: graph
            .accepted
            .into_iter()
            .map(|entry| EvaluatedTransitionLink {
                link_index: entry.link_index,
                window: entry.plan.window(),
                sample: options.playhead.and_then(|time| entry.plan.sample(time)),
            })
            .collect(),
        rejected: graph.rejected,
        removed,
    }
}
