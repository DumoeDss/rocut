use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
pub(super) struct FxChain {
    pub version: u8,
    pub nodes: Vec<FxNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FxNode {
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_carve: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_preset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_eq: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_leveller: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset_amount: Option<f64>,
    pub enabled: bool,
    pub params: BTreeMap<&'static str, FxValue>,
}

impl FxNode {
    pub fn number(&self, key: &str) -> Option<f64> {
        match self.params.get(key) {
            Some(FxValue::Number(value)) => Some(*value),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub(super) enum FxValue {
    Number(f64),
    Enum(&'static str),
}

pub(super) enum Parameter {
    Number {
        key: &'static str,
        min: f64,
        max: f64,
        default: f64,
        // The pinned registry's declaration, not a promise of graph support.
        #[allow(dead_code)]
        automatable: bool,
    },
    Enum {
        key: &'static str,
        options: &'static [&'static str],
        default: &'static str,
    },
}

pub(super) struct Definition {
    pub id: &'static str,
    // Kept for the future native graph planner; normalization executes no DSP.
    #[allow(dead_code)]
    pub web: &'static str,
    pub params: &'static [Parameter],
}
