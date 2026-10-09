//! Automation-aware port of core 0.8.139 audio/audioFxTail.js. This is the
//! native renderer's capped output-extension policy, NOT an acoustic upper
//! bound or a claim that five seconds of preroll restores arbitrary DSP state.
//! Adapted and modified from @hyperframes/core, Copyright 2026 HeyGen, Inc.,
//! Apache-2.0. Full license and modification notice: rust/wasm/NOTICE.
use super::fx_automation::Lane;
use super::fx_model::{FxChain, FxNode};

fn knob_max(node: &FxNode, key: &str, lanes: &[Lane]) -> f64 {
    if let Some(id) = &node.id {
        let target = format!("fx.{id}.{key}");
        // Intentional native first-lane semantics, even though the scheduler's
        // repeated cancel-and-schedule makes the LAST duplicate lane audible.
        if let Some(lane) = lanes.iter().find(|lane| lane.target == target) {
            if !lane.points.is_empty() {
                return lane
                    .points
                    .iter()
                    .map(|point| point.v)
                    .fold(f64::NEG_INFINITY, f64::max);
            }
        }
    }
    node.number(key).unwrap_or(0.0)
}

pub(super) fn tail_seconds(chain: &FxChain, lanes: &[Lane]) -> f64 {
    chain
        .nodes
        .iter()
        .filter(|node| node.enabled)
        .map(|node| {
            let knob = |key| knob_max(node, key, lanes);
            match node.kind {
                "reverb" if knob("wet") > 0.0 => 0.6 + knob("size").clamp(0.0, 1.0) * 2.6,
                "delay" if knob("mix") > 0.0 => {
                    let gap = (knob("time") / 1000.0).min(5.0);
                    let feedback = knob("feedback").clamp(0.0, 0.999);
                    if gap <= 0.0 {
                        0.0
                    } else if feedback <= 0.0 {
                        gap
                    } else {
                        (0.001_f64.ln() / feedback.ln()).ceil() * gap
                    }
                }
                "chorus" if knob("mix") > 0.0 => knob("delay") / 1000.0,
                "pitchshift" if knob("mix") > 0.0 => 0.2,
                _ => 0.0,
            }
        })
        .sum::<f64>()
        .min(5.0)
}
