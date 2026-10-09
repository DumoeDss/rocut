//! Complete native titleRiff draw transport. Pixel/export acceptance is separate
//! from authoring availability; no original scripts execute in production.
#[path = "title_riff_budget.rs"]
mod budget;
#[path = "title_riff_catalog.rs"]
mod catalog;
#[path = "title_riff_clock.rs"]
mod clock;
#[path = "title_riff_disc.rs"]
mod disc;
#[path = "ember_draw.rs"]
mod draw;
#[path = "ember_ease.rs"]
mod ease;
#[path = "title_riff_fonts.rs"]
mod fonts;
#[path = "title_riff_glyphs.rs"]
mod glyphs;
#[path = "converge_grain.rs"]
mod grain;
#[path = "title_riff_images.rs"]
mod images;
#[path = "title_riff_labels.rs"]
mod labels;
#[path = "converge_math.rs"]
mod math;
#[path = "title_riff_model.rs"]
mod model;
#[path = "title_riff_ornaments.rs"]
mod ornaments;
#[path = "title_riff_palette.rs"]
mod palette;
#[path = "title_riff_particles.rs"]
mod particles;
#[path = "ember_plan.rs"]
mod plan;
#[path = "title_riff_producer.rs"]
mod producer;
#[cfg(test)]
#[path = "title_riff_producer_tests.rs"]
mod producer_tests;
#[path = "title_riff_raster.rs"]
mod raster;
#[cfg(test)]
#[path = "title_riff_sampling_tests.rs"]
mod sampling_tests;
#[path = "title_riff_state.rs"]
mod state;
#[path = "ember_surface.rs"]
mod surface;
#[cfg(test)]
#[path = "title_riff_tests.rs"]
mod tests;
#[path = "title_riff_text.rs"]
mod text;
#[path = "title_riff_textures.rs"]
mod textures;
#[path = "title_riff_validate.rs"]
mod validate;

pub(super) use catalog::catalog_entry;
pub use model::TitleRiff;
pub use plan::Plan;
pub(super) struct Sample<'a> {
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub song_ticks: u64,
    pub analysis: Option<&'a crate::mv_audio::Data>,
}

pub(super) fn append_font_requests(
    recipe: &crate::mv_recipe::Recipe,
    resources: &[crate::programmatic_resources::Resource],
    requests: &mut Vec<crate::mv_font_metrics::Request>,
) -> Result<(), String> {
    for node in &recipe.nodes {
        if let crate::mv_recipe::model::Scene::TitleRiff { settings, .. } = &node.scene {
            fonts::static_requests(settings, resources, requests)?;
        }
    }
    Ok(())
}

impl TitleRiff {
    pub(super) fn sampled_requests(
        &self,
        sample: &Sample<'_>,
        resources: &[crate::programmatic_resources::Resource],
        requests: &mut Vec<crate::mv_font_metrics::Request>,
    ) -> Result<(), String> {
        let clock = clock::Clock::new(self, sample)?;
        let state = state::State::new(self, &clock);
        let labels = labels::labels(self, &clock, &state, [1.0; 4], [1.0; 4]);
        fonts::static_requests(self, resources, requests)?;
        fonts::sampled_requests(&labels, resources, requests)
    }
}
