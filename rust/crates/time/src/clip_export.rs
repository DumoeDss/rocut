//! Read-only export planning. Each clip retains its authored timeline interval;
//! the renderer evaluates the full composition in that interval, not source bytes.
use std::collections::HashSet;

use bridge::export;
use serde::{Deserialize, Serialize};

use crate::MediaTime;

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportClipRef {
    pub track_id: String,
    pub element_id: String,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportClipCandidate {
    pub reference: ExportClipRef,
    pub name: String,
    pub track_name: String,
    pub media_id: Option<String>,
    pub start_time: MediaTime,
    pub duration: MediaTime,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ExportClipSelection {
    All,
    Elements { references: Vec<ExportClipRef> },
    Media { ids: Vec<String> },
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipExportOptions {
    pub clips: Vec<ExportClipCandidate>,
    pub selection: ExportClipSelection,
    pub timeline_duration: MediaTime,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedClipExport {
    pub reference: ExportClipRef,
    pub name: String,
    pub track_name: String,
    pub filename_stem: String,
    pub start_time: MediaTime,
    pub end_time: MediaTime,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipExportPlan {
    pub clips: Vec<PlannedClipExport>,
    pub error: Option<String>,
}

#[export]
pub fn plan_clip_exports(options: ClipExportOptions) -> ClipExportPlan {
    match plan(options) {
        Ok(clips) => ClipExportPlan { clips, error: None },
        Err(error) => ClipExportPlan {
            clips: vec![],
            error: Some(error.into()),
        },
    }
}

fn plan(options: ClipExportOptions) -> Result<Vec<PlannedClipExport>, &'static str> {
    const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
    let total = options.timeline_duration.as_ticks();
    if !(0..=MAX_SAFE_INTEGER).contains(&total) {
        return Err("Invalid timeline duration");
    }
    let mut identities = HashSet::new();
    for clip in &options.clips {
        if clip.reference.track_id.is_empty()
            || clip.reference.element_id.is_empty()
            || !identities.insert(clip.reference.clone())
        {
            return Err("Timeline has missing or duplicate clip identities");
        }
    }
    if let ExportClipSelection::Elements { references } = &options.selection {
        if references
            .iter()
            .any(|reference| !identities.contains(reference))
        {
            return Err("A selected clip no longer exists. Reopen Export clips");
        }
    }
    let mut clips: Vec<_> = options
        .clips
        .into_iter()
        .filter(|clip| match &options.selection {
            ExportClipSelection::All => true,
            ExportClipSelection::Elements { references } => references.contains(&clip.reference),
            ExportClipSelection::Media { ids } => {
                clip.media_id.as_ref().is_some_and(|id| ids.contains(id))
            }
        })
        .collect();
    clips.sort_by(|a, b| {
        a.start_time
            .cmp(&b.start_time)
            .then_with(|| a.reference.track_id.cmp(&b.reference.track_id))
            .then_with(|| a.reference.element_id.cmp(&b.reference.element_id))
    });
    clips
        .into_iter()
        .enumerate()
        .map(|(index, clip)| {
            let start = clip.start_time.as_ticks();
            let duration = clip.duration.as_ticks();
            let end = start.checked_add(duration).ok_or("Clip time overflow")?;
            if start < 0 || duration <= 0 || end > total {
                return Err("A selected clip has an invalid timeline range");
            }
            let safe_name: String = clip
                .name
                .chars()
                .map(|c| {
                    if c.is_control() || "<>:\"/\\|?*".contains(c) {
                        '-'
                    } else {
                        c
                    }
                })
                .take(80)
                .collect();
            let safe_name = safe_name.trim_matches([' ', '.']);
            let safe_name = if safe_name.is_empty() {
                "clip"
            } else {
                safe_name
            };
            Ok(PlannedClipExport {
                filename_stem: format!("{:03}-{}", index + 1, safe_name),
                reference: clip.reference,
                name: clip.name,
                track_name: clip.track_name,
                start_time: clip.start_time,
                end_time: MediaTime::from_ticks(end),
            })
        })
        .collect()
}
