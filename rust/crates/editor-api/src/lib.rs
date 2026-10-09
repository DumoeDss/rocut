//! Shared validation for the agent-visible editing surface. Registries are supplied
//! by the provider; rules are independent of a browser, CLI or React session.
mod animation;
mod effect_params;
mod model;
mod image_sequence;
pub use image_sequence::{validate_image_sequence_manifest_json, validate_image_sequence_image_bytes};
mod mv_audio;
mod mv_font_metrics;
mod mv_image_dimensions;
pub use mv_image_dimensions::inspect_programmatic_image_bytes;
pub use mv_audio::prepare_mv_audio_json;
mod mv_recipe;
pub use mv_recipe::mv_recipe_catalog_json;
mod particle_surface;
mod particle_surface_bridge;
pub use particle_surface_bridge::sample_particle_surface_json;
mod particle_transport_policy;
pub use particle_transport_policy::particle_transport_policy_json;
mod programmatic;
mod programmatic_audio;
pub use programmatic_audio::{
    normalize_hyperframes_fx_chain_json,
    resolve_hyperframes_audio_graph_json,
    resolve_hyperframes_audio_discovery_json,
    resolve_hyperframes_bus_fader_json,
    apply_hyperframes_audio_track_gain_pcm, prepare_hyperframes_audio_dry_track_pcm,
    resolve_hyperframes_audio_execution_plan_json,
    mix_hyperframes_audio_bus_pcm, mix_hyperframes_audio_master_pcm,
    resolve_hyperframes_audio_seek_json,
    resolve_hyperframes_audio_observations_json,
    mix_programmatic_audio_pcm, programmatic_audio_policy_json, resolve_native_audio_decode_json,
    resolve_programmatic_audio_range_json, resolve_programmatic_audio_schedule_json,
    resolve_programmatic_audio_source_json,
    resolve_hyperframes_audio_frame_json,
    resolve_remotion_audio_frame_json,
};
mod programmatic_build;
mod programmatic_resources;
pub use programmatic_resources::validate_programmatic_resources_json;
pub use programmatic::resolve_programmatic_frame_json;
mod scenes;
pub use scenes::{plan_scene_mutation_json, validate_scene_state_json};
mod video_export;
pub use video_export::resolve_video_export_json;

use bridge::export;
use model::*;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[export]
pub fn validate_clip_editing_json(input: String) -> String {
    let issues = match serde_json::from_str::<Request>(&input) {
        Ok(request) => validate(&request),
        Err(error) => vec![Issue::new(
            "editing",
            &format!("Invalid editing schema: {error}"),
        )],
    };
    serde_json::to_string(&issues).expect("issues serialize")
}

pub(crate) fn validate_params(
    values: &BTreeMap<String, Value>,
    definitions: &[Param],
    path: &str,
    issues: &mut Vec<Issue>,
) {
    for (key, value) in values {
        let location = format!("{path}.{key}");
        match definitions.iter().find(|param| param.key == *key) {
            None => issues.push(Issue::new(
                &location,
                "Unknown parameter; consult editing/catalog",
            )),
            Some(param) => validate_value(value, param, &location, issues),
        }
    }
}

pub(crate) fn validate_value(value: &Value, param: &Param, path: &str, issues: &mut Vec<Issue>) {
    let valid = match param.kind.as_str() {
        "number" => value.as_f64().is_some_and(|n| {
            let display = n * param.display_multiplier.unwrap_or(1.0);
            n.is_finite()
                && display.is_finite()
                && param.min.is_none_or(|min| display >= min)
                && param.max.is_none_or(|max| display <= max)
        }),
        "boolean" => value.is_boolean(),
        "select" => value
            .as_str()
            .is_some_and(|s| param.options.iter().any(|o| o.value == s)),
        "text" | "font" | "color" => value.is_string(),
        _ => false,
    };
    if !valid {
        issues.push(Issue::new(path, "Invalid parameter type, option or range"));
    }
}

fn unique_id(id: &str, ids: &mut BTreeSet<String>, path: &str, issues: &mut Vec<Issue>) {
    if id.is_empty() || id.contains('.') || !ids.insert(id.to_owned()) {
        issues.push(Issue::new(
            path,
            "IDs must be nonempty, unique and contain no dots",
        ));
    }
}

fn validate(request: &Request) -> Vec<Issue> {
    let mut issues = Vec::new();
    let e = &request.editing;
    let kind = e.kind.as_str();
    let programmatic = kind == "graphic" && e.definition_id.as_deref() == Some("programmatic");
    if programmatic != e.programmatic.is_some() {
        issues.push(Issue::new(
            "editing.programmatic",
            "Programmatic content requires graphic definitionId programmatic and a source",
        ));
    }
    if let Some(source) = &e.programmatic {
        issues.extend(source.validate());
        if !source.contains_clip(request.trim_start, request.duration) {
            issues.push(Issue::new(
                "editing.programmatic",
                "Clip exceeds programmatic source duration",
            ));
        }
    }
    let lane = match kind {
        "video" | "image" => "video",
        "graphic" | "sticker" | "motion-text" => "graphic",
        "audio" => "audio",
        "text" => "text",
        "effect" => "effect",
        _ => "invalid",
    };
    if lane != request.track_kind {
        issues.push(Issue::new(
            "editing.type",
            "Element type is incompatible with track",
        ));
    }
    let media = match kind {
        "video" => Some("video"),
        "image" => Some("image"),
        "audio" => request.asset_kind.as_deref(),
        _ => None,
    };
    if media != request.asset_kind.as_deref()
        || (kind == "audio" && !matches!(media, Some("audio" | "video")))
    {
        issues.push(Issue::new(
            "editing.type",
            "Element type does not match source asset",
        ));
    }
    if (kind == "motion-text") != request.has_motion_text {
        issues.push(Issue::new(
            "editing.type",
            "Motion text requires matching content.sequenceId",
        ));
    }
    if e.is_source_audio_enabled.is_some() && kind != "video" {
        issues.push(Issue::new(
            "editing.isSourceAudioEnabled",
            "Only video has source audio",
        ));
    }
    if e.hidden.is_some() && matches!(kind, "audio" | "effect") {
        issues.push(Issue::new(
            "editing.hidden",
            "This element uses track visibility/mute",
        ));
    }
    if kind != "graphic" && e.definition_id.is_some() {
        issues.push(Issue::new(
            "editing.definitionId",
            "Only graphics have a definitionId",
        ));
    }
    if kind != "sticker"
        && (e.sticker_id.is_some() || e.intrinsic_width.is_some() || e.intrinsic_height.is_some())
    {
        issues.push(Issue::new(
            "editing.stickerId",
            "Sticker metadata requires sticker type",
        ));
    }
    if kind == "sticker" && e.sticker_id.as_ref().is_none_or(|s| s.is_empty()) {
        issues.push(Issue::new("editing.stickerId", "A sticker ID is required"));
    }
    for n in [e.intrinsic_width, e.intrinsic_height]
        .into_iter()
        .flatten()
    {
        if !n.is_finite() || n <= 0.0 {
            issues.push(Issue::new(
                "editing.intrinsicWidth",
                "Sticker dimensions must be positive",
            ));
        }
    }
    if kind == "effect" {
        if !e
            .effect_type
            .as_ref()
            .is_some_and(|id| request.catalog.effects.contains_key(id))
            || (request.has_adjustment && e.effect_type.as_deref() != Some("color-adjustment"))
        {
            issues.push(Issue::new(
                "editing.effectType",
                "Effect layers require a registered effectType; adjustment is only valid for color-adjustment",
            ));
        }
    } else if e.effect_type.is_some() || request.has_adjustment {
        issues.push(Issue::new(
            "editing.effectType",
            "Adjustment is only valid on effect layers",
        ));
    }
    let mut definitions = request
        .catalog
        .elements
        .get(kind)
        .cloned()
        .unwrap_or_default();
    if kind == "effect" {
        effect_params::validate(
            e.effect_type.as_deref().unwrap_or_default(), &e.params, "editing.params", &mut issues,
        );
        if let Some(params) = e
            .effect_type
            .as_ref()
            .and_then(|id| request.catalog.effects.get(id))
        {
            definitions.extend(params.clone());
            if !request.has_adjustment {
                for param in params {
                    if param.required != Some(false) && !e.params.contains_key(&param.key) {
                        issues.push(Issue::new(
                            &format!("editing.params.{}", param.key),
                            "Required effect layer parameter missing",
                        ));
                    }
                }
            }
        }
        if !e.animations.is_empty() {
            issues.push(Issue::new(
                "editing.animations",
                "The current effect-layer renderer does not animate layer parameters",
            ));
        }
    }
    if kind == "graphic" {
        match e
            .definition_id
            .as_ref()
            .and_then(|id| request.catalog.graphics.get(id))
        {
            Some(params) => definitions.extend(params.clone()),
            None => issues.push(Issue::new(
                "editing.definitionId",
                "Unknown graphic definition",
            )),
        }
    }
    validate_params(&e.params, &definitions, "editing.params", &mut issues);
    let visual = !matches!(kind, "audio" | "effect");
    if !visual && !e.effects.is_empty() {
        issues.push(Issue::new(
            "editing.effects",
            "Effects require a visual element",
        ));
    }
    let mut effect_ids = BTreeSet::new();
    for effect in &e.effects {
        let path = format!("editing.effects.{}", effect.id);
        effect_params::validate(&effect.kind, &effect.params, &format!("{path}.params"), &mut issues);
        unique_id(&effect.id, &mut effect_ids, &path, &mut issues);
        match request.catalog.effects.get(&effect.kind) {
            None => issues.push(Issue::new(&path, "Unknown effect type")),
            Some(params) => {
                validate_params(
                    &effect.params,
                    params,
                    &format!("{path}.params"),
                    &mut issues,
                );
                for param in params {
                    if param.required != Some(false) && !effect.params.contains_key(&param.key) {
                        issues.push(Issue::new(
                            &format!("{path}.params.{}", param.key),
                            "Required effect parameter missing; use catalog defaults",
                        ));
                    }
                }
            }
        }
    }
    if !matches!(kind, "video" | "image" | "graphic") && !e.masks.is_empty() {
        issues.push(Issue::new(
            "editing.masks",
            "Element does not support masks",
        ));
    }
    let mut mask_ids = BTreeSet::new();
    for mask in &e.masks {
        let path = format!("editing.masks.{}", mask.id);
        unique_id(&mask.id, &mut mask_ids, &path, &mut issues);
        match request.catalog.masks.get(&mask.kind) {
            None => issues.push(Issue::new(&path, "Unknown mask type")),
            Some(schema) => {
                let mut params = mask.params.clone();
                if mask.kind == "freeform" {
                    match params
                        .remove("path")
                        .and_then(|value| serde_json::from_value::<Vec<PathPoint>>(value).ok())
                    {
                        None => issues.push(Issue::new(
                            &path,
                            "Freeform mask requires typed path points",
                        )),
                        Some(points) => {
                            let mut ids = BTreeSet::new();
                            for point in &points {
                                unique_id(&point.id, &mut ids, &path, &mut issues);
                            }
                        }
                    }
                }
                validate_params(
                    &params,
                    &schema.params,
                    &format!("{path}.params"),
                    &mut issues,
                );
                for key in &schema.required {
                    if !mask.params.contains_key(key) {
                        issues.push(Issue::new(
                            &format!("{path}.params.{key}"),
                            "Required mask parameter missing; use catalog defaults",
                        ));
                    }
                }
            }
        }
    }
    animation::validate(request, &definitions, &mut issues);
    issues
}
