use super::catalog::{NumberRule, OPACITY, RECT_ORIGIN, RECT_SIZE};
use super::generator_model::Fit;
use super::mesh_model::MeshImagePlan;
use super::replay::{ReplayBudget, replay};
use crate::programmatic_resources::Resource;
use serde::{Deserialize, Serialize};

#[path = "cloth_catalog.rs"]
mod catalog;
#[path = "cloth_constraints.rs"]
mod constraints;
#[path = "cloth_mesh.rs"]
mod mesh;
#[path = "cloth_model.rs"]
mod model;
#[cfg(test)]
#[path = "cloth_tests.rs"]
mod tests;

pub(super) use catalog::catalog_entry;
pub const MAX_SIMULATION_WORK: u64 = 80_000_000;
const MAX_DURATION: u64 = 3_600_000;
const STEP_TICKS: u64 = 1_000;
const MAX_MEMORY: u64 = 8 * 1024 * 1024;
const MAX_IDENTITY_BYTES: u64 = 8_192;
const DT: f64 = 1.0 / 120.0;

const fn rule(min: f64, max: f64, integer: bool, suggested: f64) -> NumberRule {
    NumberRule {
        min,
        max,
        integer,
        suggested,
    }
}
const CELLS: NumberRule = rule(2.0, 24.0, true, 12.0);
const GRAVITY: NumberRule = rule(0.0, 4.0, false, 1.5);
const WIND: NumberRule = rule(-4.0, 4.0, false, 0.0);
const GUST: NumberRule = rule(0.0, 2.0, false, 0.4);
const FREQUENCY: NumberRule = rule(0.0, 5.0, false, 0.8);
const DAMPING: NumberRule = rule(0.0, 10.0, false, 2.0);
const STRETCH: NumberRule = rule(0.0, 0.001, false, 0.000001);
const BEND: NumberRule = rule(0.0, 0.1, false, 0.001);
const ITERATIONS: NumberRule = rule(2.0, 12.0, true, 6.0);
const PERSPECTIVE: NumberRule = rule(0.0, 0.8, false, 0.6);
const SHADING: NumberRule = rule(0.0, 1.0, false, 0.45);
const EVENT_TICKS: NumberRule = rule(0.0, MAX_DURATION as f64, true, 0.0);
const CENTER: NumberRule = rule(0.0, 1.0, false, 0.5);
const RADIUS: NumberRule = rule(0.01, 2.0, false, 0.25);
const VELOCITY: NumberRule = rule(-3.0, 3.0, false, 0.0);

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Pins {
    TopEdge,
    TopCorners,
    LeftEdge,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub at_ticks: u64,
    pub center: [f64; 2],
    pub radius: f64,
    pub velocity: [f64; 3],
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cloth {
    pub image: String,
    pub rect: [f64; 4],
    pub fit: Fit,
    pub columns: u32,
    pub rows: u32,
    pub pins: Pins,
    pub gravity: f64,
    pub wind: [f64; 3],
    pub gust: f64,
    pub gust_frequency: f64,
    pub damping: f64,
    pub stretch_compliance: f64,
    pub bend_compliance: f64,
    pub solver_iterations: u32,
    pub perspective: f64,
    pub shading: f64,
    pub opacity: f64,
    pub events: Vec<Event>,
}

impl Cloth {
    pub fn valid(&self) -> bool {
        !self.image.is_empty()
            && self.image.len() <= 240
            && CELLS.valid(self.columns)
            && CELLS.valid(self.rows)
            && self.rect[..2].iter().all(|v| RECT_ORIGIN.valid(*v))
            && self.rect[2..].iter().all(|v| RECT_SIZE.valid(*v))
            && GRAVITY.valid(self.gravity)
            && self.wind.iter().all(|v| WIND.valid(*v))
            && GUST.valid(self.gust)
            && FREQUENCY.valid(self.gust_frequency)
            && DAMPING.valid(self.damping)
            && STRETCH.valid(self.stretch_compliance)
            && BEND.valid(self.bend_compliance)
            && ITERATIONS.valid(self.solver_iterations)
            && PERSPECTIVE.valid(self.perspective)
            && SHADING.valid(self.shading)
            && OPACITY.valid(self.opacity)
            && self.events.len() <= 16
            && self.events.iter().all(|e| {
                e.at_ticks <= MAX_DURATION
                    && e.center.iter().all(|v| CENTER.valid(*v))
                    && RADIUS.valid(e.radius)
                    && e.velocity.iter().all(|v| VELOCITY.valid(*v))
            })
            && self
                .events
                .windows(2)
                .all(|pair| pair[0].at_ticks <= pair[1].at_ticks)
    }

    pub fn work(&self) -> u32 {
        self.columns.saturating_mul(self.rows).saturating_mul(4)
    }

    /// Charge total source age, including initialization, not a checkpoint suffix.
    pub fn sim_work(&self, duration_ticks: u64) -> Option<u64> {
        if !self.valid() {
            return None;
        }
        let cost = model::work_cost(self)?;
        (duration_ticks / STEP_TICKS)
            .checked_mul(cost.1)?
            .checked_add(cost.0)
    }

    pub fn valid_duration(&self, duration_ticks: u64) -> bool {
        (1..=MAX_DURATION).contains(&duration_ticks)
            && self.events.iter().all(|e| e.at_ticks < duration_ticks)
            && self
                .sim_work(duration_ticks)
                .is_some_and(|work| work <= MAX_SIMULATION_WORK)
    }

    pub fn plan(
        &self,
        elapsed_ticks: u64,
        seed: u32,
        width: u32,
        height: u32,
        resource: &Resource,
    ) -> Result<MeshImagePlan, String> {
        if !self.valid()
            || elapsed_ticks > MAX_DURATION
            || !(1..=4096).contains(&width)
            || !(1..=4096).contains(&height)
            || resource.id != self.image
            || resource.kind != "image"
        {
            return Err("Invalid Cloth settings, image, dimensions or source age".into());
        }
        if self
            .sim_work(elapsed_ticks)
            .is_none_or(|work| work > MAX_SIMULATION_WORK)
        {
            return Err("Cloth simulation work limit exceeded".into());
        }
        let model = model::Model::new(self, seed, width, height, resource)?;
        let output = replay(&model, elapsed_ticks, budget(), None, || false)
            .map_err(|error| format!("Cloth replay failed: {error:?}"))?;
        Ok(mesh::plan(
            &model,
            output.checkpoint.state(),
            elapsed_ticks == 0,
        ))
    }

    fn pinned(&self, index: usize) -> bool {
        let x = index % (self.columns as usize + 1);
        let y = index / (self.columns as usize + 1);
        match self.pins {
            Pins::TopEdge => y == 0,
            Pins::TopCorners => y == 0 && (x == 0 || x == self.columns as usize),
            Pins::LeftEdge => x == 0,
        }
    }

    fn uv(&self, index: usize) -> [f64; 2] {
        [
            (index % (self.columns as usize + 1)) as f64 / self.columns as f64,
            (index / (self.columns as usize + 1)) as f64 / self.rows as f64,
        ]
    }
}

fn budget() -> ReplayBudget {
    ReplayBudget {
        max_steps: MAX_DURATION / STEP_TICKS,
        max_work: MAX_SIMULATION_WORK,
        max_state_bytes: MAX_MEMORY,
    }
}
