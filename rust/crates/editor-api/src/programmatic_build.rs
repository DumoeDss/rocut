//! Portable, bounded source archives. Paths are materialized only by host adapters.
use crate::{
    model::Issue,
    programmatic_resources::{Resource, validate},
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Build {
    version: u32,
    engine: String,
    engine_version: String,
    entry_file: String,
    #[serde(default, deserialize_with = "optional_value")]
    composition_id: Option<Value>,
    #[serde(default, deserialize_with = "optional_value")]
    input_props: Option<Value>,
    #[serde(default, deserialize_with = "optional_capabilities")]
    capabilities: Option<Vec<BuildCapability>>,
    inputs: Vec<Resource>,
    toolchain_lock: Resource,
}

#[derive(Deserialize)]
enum BuildCapability {
    #[serde(rename = "particle-surface-v1")]
    ParticleSurface,
}

fn optional_capabilities<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<BuildCapability>>, D::Error> {
    Vec::<BuildCapability>::deserialize(d).map(Some)
}

fn optional_value<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}

pub fn deserialize_build<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Build>, D::Error> {
    Build::deserialize(d).map(Some)
}

impl Build {
    pub fn supports_native_audio(&self) -> bool {
        matches!(self.engine.as_str(), "remotion" | "hyperframes")
    }
    pub fn supports_hyperframes_graph_audio(&self) -> bool {
        // The graph-v1 adapter implements only this pinned upstream semantics.
        self.engine == "hyperframes" && self.engine_version == "0.8.139"
    }
    pub fn is_three(&self) -> bool {
        self.engine == "three"
    }

    pub fn validate(&self) -> Vec<Issue> {
        let mut resources = self.inputs.clone();
        resources.push(self.toolchain_lock.clone());
        let mut issues = validate(&resources);
        let mut issue = |message| issues.push(Issue::new("editing.programmatic.build", message));
        let version_parts: Vec<_> = self.engine_version.split('.').collect();
        if self.version != 1
            || !matches!(self.engine.as_str(), "hyperframes" | "remotion" | "three")
            || self.engine_version.is_empty()
            || self.engine_version.len() > 40
            || version_parts.len() != 3
            || version_parts
                .iter()
                .any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()))
        {
            issue("Unsupported build version/engine or invalid engine version");
        }
        if self.engine == "remotion" {
            if !self
                .composition_id
                .as_ref()
                .and_then(Value::as_str)
                .is_some_and(|id| {
                    !id.is_empty()
                        && id.len() <= 256
                        && id.chars().all(|c| {
                            c.is_ascii_alphanumeric()
                                || c == '-'
                                || ('\u{4e00}'..='\u{9fff}').contains(&c)
                        })
                })
            {
                issue("Remotion build requires a valid compositionId");
            }
        } else if self.composition_id.is_some() {
            issue("compositionId is only supported for Remotion builds");
        }
        if let Some(props) = &self.input_props {
            if !matches!(self.engine.as_str(), "remotion" | "three")
                || !props.is_object()
                || props.to_string().len() > 262144
            {
                issue(
                    "inputProps require a Remotion/Three JSON object of at most 262144 UTF-8 bytes",
                );
            }
        }
        if let Some(capabilities) = &self.capabilities {
            if self.engine != "three" || capabilities.len() != 1 {
                issue(
                    "capabilities require exactly one particle-surface-v1 declaration on a Three build",
                );
            }
        }
        if self.inputs.is_empty() || !self.inputs.iter().any(|r| r.id == self.entry_file) {
            issue("Build entryFile must name an archived input");
        }
        if resources.iter().any(|r| r.kind != "source")
            || self.toolchain_lock.id != "_rocut/toolchain-lock.json"
        {
            issue("Build archives require source resources and the canonical toolchain lock ID");
        }
        let mut ids = HashSet::new();
        for r in &self.inputs {
            let lower = r.id.to_ascii_lowercase();
            if !ids.insert(lower.clone())
                || lower.split('/').any(|part| {
                    let stem = part.split('.').next().unwrap_or("");
                    part.ends_with('.')
                        || matches!(part, "node_modules" | "_rocut" | ".git")
                        || matches!(stem, "con" | "prn" | "aux" | "nul")
                        || ["com", "lpt"].iter().any(|p| {
                            stem.strip_prefix(p).is_some_and(|n| {
                                matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
                            })
                        })
                })
            {
                issue(
                    "Build paths must be unambiguous portable files without reserved directories/devices",
                );
            }
        }
        for id in &ids {
            let mut parent = id.as_str();
            while let Some((path, _)) = parent.rsplit_once('/') {
                if ids.contains(path) {
                    issue("Build file and directory paths must not collide");
                }
                parent = path;
            }
        }
        issues
    }
}
