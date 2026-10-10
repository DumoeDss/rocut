use super::{
    fonts::{Admission, Stack},
    model::Metrics,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricRequest {
    pub font_stack: Stack,
    pub font_size: u32,
    pub characters: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Measurement {
    pub font_stack: Stack,
    pub font_size: u32,
    pub advances: BTreeMap<String, f64>,
}
impl Admission {
    pub(in crate::mv_recipe) fn metric_requests(&self) -> Vec<MetricRequest> {
        ["mincho800", "dot400", "heavy900"]
            .into_iter()
            .map(|role| &self.stacks[role])
            .map(|stack| MetricRequest {
                font_stack: stack.clone(),
                font_size: 100,
                characters: stack.routes.keys().cloned().collect(),
            })
            .collect()
    }
    /// Echoed browser facts alone never create admission: complete requests must
    /// match the stacks authenticated from real font bytes in this Rust value.
    pub(in crate::mv_recipe) fn bind_metrics(
        &self,
        measurements: &[Measurement],
    ) -> Result<Metrics, String> {
        if measurements.len() != self.stacks.len() {
            return Err("tunnel incomplete stack measurements".into());
        }
        let mut seen = BTreeSet::new();
        let mut maps = BTreeMap::new();
        for measurement in measurements {
            let role = &measurement.font_stack.role;
            let expected = self
                .stacks
                .get(role)
                .ok_or("tunnel unexpected measured stack")?;
            if !seen.insert(role)
                || &measurement.font_stack != expected
                || measurement.font_size != 100
                || measurement.advances.len() != expected.routes.len()
                || measurement.advances.iter().any(|(ch, v)| {
                    !expected.routes.contains_key(ch)
                        || !v.is_finite()
                        || !(0.0..=4096.0).contains(v)
                })
            {
                return Err("tunnel native measurement identity/advance mismatch".into());
            }
            maps.insert(role.clone(), measurement.advances.clone());
        }
        Ok(Metrics {
            stacks: self.stacks.clone(),
            mincho_800: maps
                .remove("mincho800")
                .ok_or("tunnel missing mincho metrics")?,
            dot_400: maps.remove("dot400").ok_or("tunnel missing dot metrics")?,
        })
    }
}
