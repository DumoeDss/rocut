//! Serializable boundary shared by transaction policy, preview and export.
use bridge::export;
use serde::{Deserialize, Serialize};

use crate::{
    ClipTransitionSample, ClipTransitionWindow, FrameRate, MediaTime, RejectedTransitionLink,
    TransitionClip, TransitionLink, evaluate_transition_graph,
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
}

#[export]
pub fn evaluate_clip_transitions(options: ClipTransitionsOptions) -> ClipTransitionsEvaluation {
    let graph = evaluate_transition_graph(&options.clips, &options.links, options.frame_rate);
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
    }
}
