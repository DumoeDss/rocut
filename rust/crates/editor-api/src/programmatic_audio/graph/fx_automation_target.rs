//! Target binding from pinned audioAutomation.js and audio/audioFxGraph.js.
//! Registry ranges describe knobs, NOT necessarily an exposed AudioParam.
//! Adapted and modified from @hyperframes/core, Copyright 2026 HeyGen, Inc.,
//! Apache-2.0. Full license and modification notice: rust/wasm/NOTICE.
use super::fx_catalog::DEFINITIONS;
use super::fx_model::{FxChain, FxNode, FxValue, Parameter};

pub(super) struct Binding {
    pub min: f64,
    pub max: f64,
    pub log_scale: bool,
    /// One flag per actual AudioParam: native map functions force curve sampling,
    /// even for linear millisecond-to-second or complementary dry-gain maps.
    pub mapped_targets: Vec<bool>,
}

fn exposed(node: &FxNode, key: &str) -> Vec<bool> {
    if !node.enabled {
        return vec![];
    }
    if matches!(node.kind, "highpass" | "lowpass")
        && matches!(node.params.get("poles"), Some(FxValue::Enum("1")))
    {
        return vec![];
    }
    match (node.kind, key) {
        ("gain", "gain") | ("saturate", "output") => vec![true],
        ("peaking" | "lowshelf" | "highshelf", "frequency" | "gain")
        | ("peaking" | "highpass" | "lowpass", "q")
        | ("highpass" | "lowpass", "frequency")
        | ("delay", "feedback")
        | ("chorus", "speed")
        | ("phaser", "speed" | "in_gain" | "out_gain")
        | ("reverb", "wet" | "dry") => vec![false],
        ("delay", "time") | ("chorus", "delay" | "depth") => vec![true],
        ("delay" | "chorus", "mix") => vec![false, true],
        _ => vec![],
    }
}

/// None is a native resolveAutomation orphan/enum drop. Rate is normalized here
/// but separated from FX scheduling and admitted by the source-time planner.
pub(super) fn bind(target: &str, chain: &FxChain) -> Result<Option<Binding>, String> {
    if target == "volume" {
        return Ok(Some(Binding {
            min: 0.0,
            max: super::volume_lane::max_gain(),
            log_scale: false,
            mapped_targets: vec![],
        }));
    }
    if target == "rate" {
        return Ok(Some(Binding {
            min: super::rate_lane::MIN_RATE,
            max: super::rate_lane::MAX_RATE,
            log_scale: true,
            mapped_targets: vec![],
        }));
    }
    let parts: Vec<_> = target.split('.').collect();
    if parts.len() != 3 || parts[0] != "fx" || parts[1].is_empty() || parts[2].is_empty() {
        return Err("Unreadable HyperFrames automation target".into());
    }
    if parts[1] == "preset" {
        let id = parts[2];
        if !chain
            .nodes
            .iter()
            .any(|node| node.from_preset.as_deref() == Some(id))
        {
            return Ok(None);
        }
        // Native groups consecutive ENABLED nodes; a split preset owns one
        // wet/dry pair per run, and its lane drives every pair, not just the last.
        let mut previous = None;
        let mut mapped_targets = vec![];
        for node in chain.nodes.iter().filter(|node| node.enabled) {
            let preset = node.from_preset.as_deref();
            if preset == Some(id) && previous != preset {
                mapped_targets.extend([false, true]);
            }
            previous = preset;
        }
        return Ok(Some(Binding {
            min: 0.0,
            max: 1.0,
            log_scale: false,
            mapped_targets,
        }));
    }
    // Native resolution uses first ID match, but scheduling's Map uses the last
    // enabled match. Preserve the asymmetry instead of silently rewriting IDs.
    let Some(node) = chain
        .nodes
        .iter()
        .find(|node| node.id.as_deref() == Some(parts[1]))
    else {
        return Ok(None);
    };
    let parameter = DEFINITIONS
        .iter()
        .find(|def| def.id == node.kind)
        .and_then(|def| {
            def.params.iter().find(|param| match param {
                Parameter::Number { key, .. } | Parameter::Enum { key, .. } => *key == parts[2],
            })
        });
    let Some(Parameter::Number { min, max, .. }) = parameter else {
        return Ok(None);
    };
    let mapped_targets = chain
        .nodes
        .iter()
        .rev()
        .find(|node| node.enabled && node.id.as_deref() == Some(parts[1]))
        .map_or_else(Vec::new, |node| exposed(node, parts[2]));
    Ok(Some(Binding {
        min: *min,
        max: *max,
        log_scale: matches!(parts[2], "frequency" | "q")
            || (node.kind == "delay" && parts[2] == "time"),
        mapped_targets,
    }))
}
