//! Static-only port of @hyperframes/core 0.8.139 dist/audio/audioFxTail.js.
//! See NOTICE for upstream attribution. These estimates exclude automation and
//! must never be used as the final render duration or graph execution plan.
use super::fx_model::{FxChain, FxNode};

fn node_tail(node: &FxNode) -> f64 {
    if !node.enabled {
        return 0.0;
    }
    let number = |key| node.number(key).unwrap_or(0.0);
    match node.kind {
        "reverb" if number("wet") > 0.0 => 0.6 + number("size").clamp(0.0, 1.0) * 2.6,
        "delay" if number("mix") > 0.0 => {
            let gap = (number("time") / 1000.0).min(5.0);
            let feedback = number("feedback").clamp(0.0, 0.999);
            if feedback <= 0.0 {
                gap
            } else {
                (0.001f64.ln() / feedback.ln()).ceil() * gap
            }
        }
        "chorus" if number("mix") > 0.0 => number("delay") / 1000.0,
        "pitchshift" if number("mix") > 0.0 => 0.2,
        _ => 0.0,
    }
}

/// Matches chainTailSeconds(chain, undefined), not an automation-aware tail.
pub(super) fn static_tail_seconds(chain: &FxChain) -> f64 {
    chain
        .nodes
        .iter()
        .map(node_tail)
        .sum::<f64>()
        .clamp(0.0, 5.0)
}
