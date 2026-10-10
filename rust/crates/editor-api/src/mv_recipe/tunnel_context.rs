//! Node-bound runtime facts; never an authored/deserializable admission token.
use super::{
    model::{Recipe, Scene},
    tunnel::{Admission, Measurement, Metrics, Stack},
};
use crate::programmatic_resources::Resource;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    pub node_id: String,
    pub font_stack: Stack,
    pub font_size: u32,
    pub characters: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Measured {
    node_id: String,
    font_stack: Stack,
    font_size: u32,
    advances: BTreeMap<String, f64>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BoundStack {
    node_id: String,
    font_stack: Stack,
}
pub(crate) struct Admitted {
    nodes: Vec<(String, Admission)>,
}
pub(crate) struct Context {
    metrics: BTreeMap<String, Metrics>,
}
impl Recipe {
    pub(crate) fn tunnel_font_byte_requests(
        &self,
        resources: &[Resource],
    ) -> Result<Vec<Resource>, String> {
        let mut seen = BTreeSet::new();
        let mut result = Vec::new();
        for node in &self.nodes {
            if let Scene::Tunnel { settings, .. } = &node.scene {
                for id in [
                    &settings.fonts.mincho800,
                    &settings.fonts.dot400,
                    &settings.fonts.heavy900,
                    &settings.fonts.noto400,
                    &settings.fonts.noto800,
                    &settings.fonts.noto900,
                ] {
                    if seen.insert(id) {
                        result.push(
                            resources
                                .iter()
                                .find(|r| &r.id == id && r.kind == "font")
                                .ok_or("Tunnel missing declared font")?
                                .clone(),
                        );
                    }
                }
            }
        }
        Ok(result)
    }
}
impl Admitted {
    pub(crate) fn new(
        recipe: &Recipe,
        resources: &[Resource],
        bytes: &BTreeMap<String, &[u8]>,
    ) -> Result<Self, String> {
        let mut nodes = Vec::new();
        for node in &recipe.nodes {
            if let Scene::Tunnel { settings, .. } = &node.scene {
                nodes.push((node.id.clone(), settings.admit_fonts(resources, bytes)?));
            }
        }
        Ok(Self { nodes })
    }
    pub(crate) fn requests(&self) -> Vec<Request> {
        self.nodes
            .iter()
            .flat_map(|(id, a)| {
                a.metric_requests().into_iter().map(|r| Request {
                    node_id: id.clone(),
                    font_stack: r.font_stack,
                    font_size: r.font_size,
                    characters: r.characters,
                })
            })
            .collect()
    }
    pub(crate) fn stacks(&self) -> Vec<BoundStack> {
        self.requests()
            .into_iter()
            .map(|r| BoundStack {
                node_id: r.node_id,
                font_stack: r.font_stack,
            })
            .collect()
    }
    pub(crate) fn bind(&self, measured: &[Measured]) -> Result<Context, String> {
        if measured.len() != self.nodes.len() * 3 {
            return Err("Tunnel requires complete node-bound measurements".into());
        }
        let mut metrics = BTreeMap::new();
        for (id, a) in &self.nodes {
            let facts: Vec<_> = measured
                .iter()
                .filter(|m| &m.node_id == id)
                .map(|m| Measurement {
                    font_stack: m.font_stack.clone(),
                    font_size: m.font_size,
                    advances: m.advances.clone(),
                })
                .collect();
            metrics.insert(id.clone(), a.bind_metrics(&facts)?);
        }
        if measured.iter().any(|m| !metrics.contains_key(&m.node_id)) {
            return Err("Tunnel measurements reference an unknown node".into());
        }
        Ok(Context { metrics })
    }
}
impl Context {
    pub(in crate::mv_recipe) fn metrics(&self, id: &str) -> Result<&Metrics, String> {
        self.metrics
            .get(id)
            .ok_or_else(|| "Tunnel missing node-bound admitted metrics".into())
    }
}
