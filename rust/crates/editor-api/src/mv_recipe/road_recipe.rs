//! Public graph seam over the frozen Road producer. Reviewed song evidence
//! stays complete; no BPM or stop evidence is inferred from envelope samples.
use super::{model::Span, road, validate::range};
use crate::{
    mv_audio::{Data, StopKind},
    mv_image_dimensions::Context,
    programmatic_resources::Resource,
};
use serde::Deserialize;
#[path = "road_recipe_post.rs"]
mod post;
pub use post::NativePost;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Road {
    pub bpm: f64,
    #[serde(default)]
    pub mode: road::model::Mode,
    pub char: Option<String>,
    pub impact: Option<f64>,
    pub horizon: Option<f64>,
    pub open: Option<f64>,
    pub dolly: Option<f64>,
    pub slow_at: Option<f64>,
    pub freeze_at: Option<f64>,
    pub freeze_style: Option<road::model::FreezeStyle>,
}
pub(super) struct Sample<'a> {
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub analysis: Option<&'a Data>,
}

impl Road {
    fn args(&self) -> road::model::Args {
        road::model::Args {
            mode: self.mode.clone(),
            char: self.char.clone(),
            impact: self.impact,
            horizon: self.horizon,
            open: self.open,
            dolly: self.dolly,
            slow_at: self.slow_at,
            freeze_at: self.freeze_at,
            freeze_style: self.freeze_style.clone(),
        }
    }
    pub(super) fn valid(&self, start: u64, span: &Span, step: u64) -> bool {
        range(self.bpm, 1.0, 1000.0)
            && match self.mode {
                road::model::Mode::Tear => self.char.is_none(),
                road::model::Mode::Run => self.char.as_ref().is_some_and(|id| {
                    !id.is_empty() && id.len() <= 128 && !id.chars().any(char::is_control)
                }),
            }
            && [
                self.impact,
                self.horizon,
                self.open,
                self.dolly,
                self.slow_at,
                self.freeze_at,
            ]
            .into_iter()
            .flatten()
            .all(|n| range(n, 0.0, 21600.0))
            && u64::from(span.start_frame)
                .checked_add(u64::from(span.duration_frames))
                .and_then(|n| n.checked_mul(step))
                .and_then(|n| n.checked_add(start))
                .is_some_and(|n| n <= 2_592_000_000)
    }
    pub(super) fn resources_valid(&self, resources: &[Resource]) -> bool {
        match self.mode {
            road::model::Mode::Tear => self.char.is_none(),
            road::model::Mode::Run => self.char.as_ref().is_some_and(|id| {
                resources
                    .iter()
                    .filter(|r| r.id == *id && r.kind == "image")
                    .count()
                    == 1
            }),
        }
    }
    // Scene main/foreground, filter/refraction and original GL post scratch.
    pub(super) fn scratch_pixels(&self) -> u64 {
        1920 * 1080 * 8
    }
    // Actual serialized plans are charged by admit_plan, after generation.
    pub(super) fn plan_pixels(&self) -> u64 {
        0
    }
    pub(super) fn runtime_ready(
        &self,
        s: &Sample<'_>,
        images: Option<&Context>,
        resources: &[Resource],
    ) -> Result<(), String> {
        let (beats, stops, downbeats) = self.audio(s)?;
        let sample = road::model::Sample {
            song_ticks: s.song_ticks,
            shot_start_ticks: s.shot_start_ticks,
            shot_end_ticks: s.shot_end_ticks,
            beats,
            bpm: self.bpm,
            stops: &stops,
            downbeats,
            resources,
        };
        road::model::validate(&self.args(), &sample)?;
        self.session(images, resources).map(|_| ())
    }
    fn audio<'a>(&self, s: &Sample<'a>) -> Result<(&'a [u64], Vec<u64>, &'a [u64]), String> {
        let data = s
            .analysis
            .ok_or("Road requires explicit reviewed whole-song analysis binding")?;
        data.validate()?;
        let stops: Vec<_> = data
            .stops
            .as_ref()
            .ok_or("Road requires explicit reviewed stops evidence (empty array allowed)")?
            .iter()
            .filter(|v| v.kind == StopKind::Stop)
            .map(|v| (v.start * 120000.0).round() as u64)
            .collect();
        if stops.windows(2).any(|p| p[0] >= p[1]) {
            return Err(
                "Road stop starts must remain strictly increasing in reviewed order".into(),
            );
        }
        Ok((&data.beats, stops, &data.downbeats))
    }
    fn session(
        &self,
        images: Option<&Context>,
        resources: &[Resource],
    ) -> Result<road::Session, String> {
        let character = if self.mode == road::model::Mode::Run {
            let id = self
                .char
                .as_deref()
                .ok_or("Road run requires explicit real character resource")?;
            let resource = resources
                .iter()
                .find(|r| r.id == id && r.kind == "image")
                .ok_or("Road character resource missing")?
                .clone();
            let dimensions = images
                .ok_or("Road run requires native decoded image dimensions")?
                .image(id)?;
            Some(road::ImageFact {
                resource,
                width: dimensions.width,
                height: dimensions.height,
            })
        } else {
            None
        };
        road::Session::prepare(
            self.args(),
            resources.to_vec(),
            character,
            256 * 1024 * 1024,
        )
    }
    pub(super) fn produce(
        &self,
        s: &Sample<'_>,
        width: u32,
        height: u32,
        images: Option<&Context>,
        resources: &[Resource],
    ) -> Result<(road::plan::Plan, NativePost), String> {
        if width != 1920 || height != 1080 {
            return Err("Road public scene requires exact 1920x1080".into());
        }
        let (beats, stops, downbeats) = self.audio(s)?;
        let sample = road::model::Sample {
            song_ticks: s.song_ticks,
            shot_start_ticks: s.shot_start_ticks,
            shot_end_ticks: s.shot_end_ticks,
            beats,
            bpm: self.bpm,
            stops: &stops,
            downbeats,
            resources,
        };
        let plan = self.session(images, resources)?.frame(&sample)?;
        let post = post::resolve(self, s, beats)?;
        Ok((plan, post))
    }
}
#[path = "road_recipe_budget.rs"]
mod budget;
pub(super) use budget::admit_plan;
#[cfg(test)]
#[path = "road_recipe_tests.rs"]
mod tests;
