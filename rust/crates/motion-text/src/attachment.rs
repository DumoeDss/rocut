//! Validate an immutable, already resolved native sequence without replanning it.
use crate::planner::*;
use serde_json::Value;
use std::collections::BTreeSet;

pub fn validate_sequence_attachment(bytes: &[u8]) -> Result<MotionTextSequenceInput, String> {
    if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
        return Err("JIZURA attachment byte limit exceeded".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "JIZURA attachment is not UTF8")?;
    let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    fn bounded(v: &Value, depth: usize, count: &mut usize) -> bool {
        *count += 1;
        if depth > 8 || *count > 10000 {
            return false;
        }
        match v {
            Value::String(s) => s.chars().count() <= 16384,
            Value::Array(a) => a.iter().all(|v| bounded(v, depth + 1, count)),
            Value::Object(a) => a.values().all(|v| bounded(v, depth + 1, count)),
            _ => true,
        }
    }
    if !bounded(&value["defaults"]["parameters"], 0, &mut 0)
        || value["cues"].as_array().is_some_and(|cues| {
            cues.iter().any(|c| {
                c["text"].as_str().is_none_or(|s| s.chars().count() > 1024)
                    || !bounded(&c["overrides"]["parameters"], 0, &mut 0)
            })
        })
        || value["resolvedPlan"]["cuts"]
            .as_array()
            .is_some_and(|cuts| cuts.iter().any(|c| !bounded(&c["parameters"], 0, &mut 0)))
    {
        return Err("JIZURA bounded text/parameter validation failed".into());
    }
    let input: MotionTextSequenceInput =
        serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
    // Identity, not equality: a sequence keeps rendering under the engine that
    // wrote it as long as that engine's catalog is a known one. The catalog
    // content is what decides the look, so a stamp-only move between releases
    // must not invalidate saved projects.
    let engine_version = value["engine"]["version"].as_str().unwrap_or_default();
    let catalog_hash = value["engine"]["catalogHash"].as_str().unwrap_or_default();
    let known_engine = engine_version == crate::JIZURA_ENGINE_VERSION
        || crate::JIZURA_LEGACY_ENGINE_VERSIONS.contains(&engine_version);
    let known_catalog = catalog_hash == crate::JIZURA_CATALOG_HASH
        || crate::JIZURA_LEGACY_CATALOG_HASHES.contains(&catalog_hash);
    if value["schemaVersion"] != 1
        || value["engine"]["id"] != "jizura"
        || !known_engine
        || !known_catalog
        || input.duration <= 0
        || input.duration > 21600 * 120000
        || input.cues.len() > 4096
        || input.engine.tokenizer_version != MOTION_TEXT_TOKENIZER_VERSION
    {
        return Err("JIZURA attachment schema/engine/duration mismatch".into());
    }
    let plan = input
        .resolved_plan
        .as_ref()
        .ok_or("JIZURA attachment requires resolved plan")?;
    if plan.version != MOTION_TEXT_PLAN_VERSION
        || plan.sequence_revision != input.revision
        || plan.cuts.len() > 4096
    {
        return Err("JIZURA attachment stale/oversized plan".into());
    }
    // Reuse the native planner's source/cue validation, but keep all saved cuts unchanged.
    let checked = plan_motion_text_sequence(MotionTextPlanOptions {
        sequence: input.clone(),
        catalog: MotionTextPlannerCatalog::default(),
        renderer_support: None,
        randomize_groups: Vec::new(),
        variation: None,
    });
    if checked.plan.is_none() {
        return Err("JIZURA attachment native sequence validation failed".into());
    }
    let mut cue_ids = BTreeSet::new();
    for cue in &input.cues {
        cue_ids.insert(cue.id.as_str());
    }
    let mut cut_ids = BTreeSet::new();
    let mut ranges = Vec::new();
    let mut characters = 0usize;
    for cut in &plan.cuts {
        let end = cut
            .start_time
            .checked_add(cut.duration)
            .ok_or("JIZURA cut range overflow")?;
        if cut.id.is_empty()
            || !cut_ids.insert(cut.id.as_str())
            || !cue_ids.contains(cut.cue_id.as_str())
            || cut.start_time < 0
            || cut.duration <= 0
            || end > input.duration
            || cut.text.chars().count() > 1024
            || cut.preset.decor.len() > 16
            || cut.preset.fx.len() > 16
        {
            return Err("JIZURA attachment invalid resolved cut".into());
        }
        let cue = input
            .cues
            .iter()
            .find(|c| c.id == cut.cue_id)
            .ok_or("Missing JIZURA cue")?;
        if cut.start_time < cue.start_time || end > cue.start_time + cue.duration {
            return Err("JIZURA cut outside its cue".into());
        }
        characters = characters
            .checked_add(cut.text.chars().count())
            .ok_or("JIZURA text overflow")?;
        if characters > 131072 {
            return Err("JIZURA attachment text limit exceeded".into());
        }
        ranges.push((cut.start_time, end));
    }
    ranges.sort_unstable();
    if ranges.windows(2).any(|p| p[1].0 < p[0].1) {
        return Err("JIZURA resolved cuts overlap".into());
    }
    Ok(input)
}
