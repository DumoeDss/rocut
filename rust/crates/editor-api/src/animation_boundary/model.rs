use super::{NUMERIC_SEMANTICS, VERSION};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Error {
    pub code: &'static str,
    pub path: String,
    pub message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_index: Option<usize>,
}

impl Error {
    pub fn new(code: &'static str, path: impl Into<String>, message: &'static str) -> Self {
        Self {
            code,
            path: path.into(),
            message,
            key_index: None,
            sample_index: None,
        }
    }
}

pub(super) struct Request {
    pub items: Vec<(String, Value)>,
    pub max_nodes: u32,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(super) enum Response {
    RequestError {
        version: u8,
        error: Error,
    },
    #[serde(rename_all = "camelCase")]
    BatchResult {
        version: u8,
        numeric_semantics: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        budget: Option<RequestBudget>,
        results: Vec<Item>,
    },
}

impl Response {
    pub fn request_error(error: Error) -> Self {
        Self::RequestError {
            version: VERSION,
            error,
        }
    }
    pub fn batch(results: Vec<Item>, budget: Option<RequestBudget>) -> Self {
        Self::BatchResult {
            version: VERSION,
            numeric_semantics: NUMERIC_SEMANTICS,
            budget,
            results,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RequestBudget {
    pub max_nodes: u32,
    pub visited_nodes: u32,
}

#[derive(Serialize)]
pub(super) struct Item {
    pub id: String,
    #[serde(flatten)]
    pub result: ResultKind,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub(super) enum ResultKind {
    Values {
        values: Vec<f64>,
    },
    Error {
        error: Error,
    },
    #[serde(rename_all = "camelCase")]
    Safe {
        domain: Range,
        values: Enclosure,
        displayed: Enclosure,
        visited_nodes: u32,
        budget: ItemBudget,
        numeric_semantics: &'static str,
        certificate_version: u8,
    },
    #[serde(rename_all = "camelCase")]
    Violation {
        domain: Range,
        time: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<f64>,
        reason: Error,
        visited_nodes: u32,
        budget: ItemBudget,
    },
    #[serde(rename_all = "camelCase")]
    Unresolved {
        domain: Range,
        unproven_domain: Range,
        reason: Error,
        visited_nodes: u32,
        budget: ItemBudget,
    },
}

#[derive(Clone, Copy, Serialize)]
pub(super) struct Range {
    pub start: f64,
    pub end: f64,
}

#[derive(Serialize)]
pub(super) struct Enclosure {
    pub min: f64,
    pub max: f64,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ItemBudget {
    pub requested_nodes: u32,
    pub effective_nodes: u32,
}
