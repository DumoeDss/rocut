use super::super::model::*;
use std::cell::RefCell;
#[cfg(test)]
#[path = "evaluate_clock_tests.rs"]
mod tests;

#[derive(Clone, Copy)]
pub(in crate::mv_recipe) struct Clock<'a> {
    pub(in crate::mv_recipe) frame: u64,
    pub(super) source_ticks: u64,
    pub(super) sequence_source_ticks: u64,
    pub(super) step: u64,
    pub(super) song_start_ticks: u64,
    pub(super) fps: f64,
    pub(in crate::mv_recipe) width: f64,
    pub(in crate::mv_recipe) height: f64,
    pub(in crate::mv_recipe) seed: u32,
    pub(super) audio: Option<&'a crate::mv_audio::Data>,
    pub(super) root_song_seconds: f64,
    pub(in crate::mv_recipe) resources: &'a [crate::programmatic_resources::Resource],
    pub(super) sequences: Option<&'a crate::image_sequence::Context<'a>>,
    pub(super) fonts: Option<&'a crate::mv_font_metrics::Context>,
    pub(super) tunnel_fonts: Option<&'a crate::mv_recipe::tunnel_context::Context>,
    pub(super) night_traversal: Option<&'a RefCell<crate::mv_recipe::night_recipe::Traversal>>,
    pub(super) images: Option<&'a crate::mv_image_dimensions::Context>,
    pub(super) font_requests: Option<&'a RefCell<Vec<crate::mv_font_metrics::Request>>>,
}
impl<'a> Clock<'a> {
    pub(super) fn new(
        recipe: &Recipe,
        index: u64,
        step: u64,
        seed: u32,
        width: u32,
        height: u32,
        audio: Option<&'a crate::mv_audio::Data>,
        resources: &'a [crate::programmatic_resources::Resource],
        sequence_source_ticks: u64,
        sequences: Option<&'a crate::image_sequence::Context<'a>>,
        fonts: Option<&'a crate::mv_font_metrics::Context>,
        images: Option<&'a crate::mv_image_dimensions::Context>,
        font_requests: Option<&'a RefCell<Vec<crate::mv_font_metrics::Request>>>,
    ) -> Result<Self, String> {
        if let Some(binding) = &recipe.audio {
            let data = audio.ok_or("Missing MV audio analysis attachment")?;
            data.validate()?;
            if data.provenance.input_sha256 != binding.input_sha256 {
                return Err("MV audio analysis is for a different song digest".into());
            }
        } else if audio.is_some() {
            return Err("Unexpected audio analysis without a recipe binding".into());
        }
        // The same integer clock feeds normal evaluation and metric discovery.
        let source_ticks = index.checked_mul(step).ok_or("MV source time overflow")?;
        let song_start_ticks = (recipe.song_start_seconds * 120_000.0).round() as u64;
        let song_ticks = song_start_ticks
            .checked_add(source_ticks)
            .ok_or("MV song time overflow")?;
        Ok(Self {
            frame: index,
            source_ticks,
            sequence_source_ticks,
            step,
            song_start_ticks,
            fps: 120_000.0 / step as f64,
            width: f64::from(width),
            height: f64::from(height),
            seed,
            audio,
            root_song_seconds: song_ticks as f64 / 120_000.0,
            resources,
            sequences,
            fonts,
            tunnel_fonts: None,
            night_traversal: None,
            images,
            font_requests,
        })
    }
    pub(super) fn title_sample(
        &self,
        span: &Span,
    ) -> Result<super::super::title_riff::Sample<'_>, String> {
        let sample = self.ember_sample(span)?;
        Ok(super::super::title_riff::Sample {
            shot_start_ticks: sample.shot_start_ticks,
            shot_end_ticks: sample.shot_end_ticks,
            song_ticks: sample.song_ticks,
            analysis: sample.analysis,
        })
    }
    pub(super) fn ember_sample(
        &self,
        span: &Span,
    ) -> Result<super::super::ember::Sample<'_>, String> {
        let start = u64::from(span.start_frame)
            .checked_mul(self.step)
            .and_then(|v| v.checked_add(self.song_start_ticks))
            .ok_or("Ember shot start overflow")?;
        let end = u64::from(span.duration_frames)
            .checked_mul(self.step)
            .and_then(|v| v.checked_add(start))
            .ok_or("Ember shot end overflow")?;
        Ok(super::super::ember::Sample {
            shot_start_ticks: start,
            shot_end_ticks: end,
            song_ticks: self
                .song_start_ticks
                .checked_add(self.source_ticks)
                .ok_or("Ember song time overflow")?,
            width: self.width,
            height: self.height,
            analysis: self.audio,
            fonts: self.fonts,
            images: self.images,
        })
    }
    pub(in crate::mv_recipe) fn image_dimensions(
        self,
        id: &str,
    ) -> Result<crate::mv_image_dimensions::Dimensions, String> {
        self.images
            .ok_or("Missing decoded image dimensions")?
            .image(id)
    }
    pub(in crate::mv_recipe) fn elapsed(self, span: &Span) -> Result<u64, String> {
        let start = u64::from(span.start_frame)
            .checked_mul(self.step)
            .ok_or("MV simulation span start overflow")?;
        let duration = u64::from(span.duration_frames)
            .checked_mul(self.step)
            .ok_or("MV simulation span duration overflow")?;
        Ok(self.source_ticks.saturating_sub(start).min(duration))
    }
    pub(super) fn remap(self, frame: u64) -> Self {
        Self {
            frame,
            source_ticks: frame * self.step,
            sequence_source_ticks: frame * self.step,
            ..self
        }
    }
    /// Native meta wrappers can freeze/reverse at an exact song tick. Structural
    /// frame intervals use the containing source frame; continuous leaf clocks
    /// keep the unrounded tick rather than quantizing through a frame number.
    pub(super) fn remap_song_ticks(self, song_ticks: i64) -> Result<Self, String> {
        let song_ticks =
            u64::try_from(song_ticks).map_err(|_| "MV reference precedes supported song domain")?;
        let source_ticks = song_ticks
            .checked_sub(self.song_start_ticks)
            .ok_or("MV reference precedes this authored source domain")?;
        Ok(Self {
            frame: source_ticks / self.step,
            source_ticks,
            sequence_source_ticks: source_ticks,
            ..self
        })
    }
    pub(super) fn source_frame(self) -> f64 {
        self.source_ticks as f64 / self.step as f64
    }
    pub(super) fn song_seconds(self) -> f64 {
        (self.song_start_ticks + self.source_ticks) as f64 / 120_000.0
    }
    pub(in crate::mv_recipe) fn sample(self, rate: u32) -> u64 {
        // Never floor (seconds * rate): e.g. frame 246 at 60fps becomes
        // 122.99999999999999 at 30fps and would incorrectly repeat frame 122.
        (self.song_start_ticks + self.source_ticks) * u64::from(rate) / 120_000
    }
    pub(super) fn drawing(self, rate: Option<u32>) -> (f64, f64) {
        match rate {
            None => (self.song_seconds(), self.source_frame()),
            Some(q) => {
                let sample = self.sample(q);
                let local_numerator = i128::from(sample) * 120_000
                    - i128::from(self.song_start_ticks) * i128::from(q);
                (
                    sample as f64 / f64::from(q),
                    local_numerator as f64 / (120_000.0 * f64::from(q)) * self.fps,
                )
            }
        }
    }
}
