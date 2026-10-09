//! One admission model shared by source validation and emitted-frame checks.
//! This is a conservative allocation/copy model, never a measured RSS claim.
use super::{Sample, TitleRiff, clock::Clock, fonts::ink_request};
use crate::{mv_font_metrics, mv_image_dimensions};

pub(super) const MAX_PLAN_BYTES: usize = 4 * 1024 * 1024;
const FRAME_PIXELS: u64 = 1920 * 1080;
const PAPER_PAYLOAD: u64 = 9 * 240 * 135;
const GRAIN_SCRATCH: u64 = 2 * 256 * 256;

impl TitleRiff {
    pub(in crate::mv_recipe) fn work(&self) -> u32 {
        super::producer::MAX_DRAW_COMMANDS as u32
    }
    pub(in crate::mv_recipe) fn plan_pixels(&self) -> u64 {
        (MAX_PLAN_BYTES as u64 * 3 + 3) / 4
    }
    pub(in crate::mv_recipe) fn scratch_pixels(
        &self,
        images: Option<&mv_image_dimensions::Context>,
    ) -> Result<u64, String> {
        // Four full design surfaces at the monument peak; or back/front,
        // print screen, and two exact-size image masks. Gray plan vectors are
        // retained independently of releaseSurface; inline grain is retained.
        let masks = if !self.outro() && self.cues.sil >= 0 {
            match images {
                Some(images) => {
                    let image = images.image(&self.character)?;
                    if image.width > 4096 || image.height > 4096 {
                        return Err(
                            "titleRiff character mask exceeds shared4096dimension surface limit"
                                .into(),
                        );
                    }
                    4 * u64::from(image.width) * u64::from(image.height)
                }
                // Pre-decode admission is provisional. Final admission repeats
                // the same whole-source budget with verified dimensions.
                None => 0,
            }
        } else {
            0
        };
        Ok((8 * FRAME_PIXELS).max(6 * FRAME_PIXELS + masks) + PAPER_PAYLOAD + GRAIN_SCRATCH)
    }
    pub(in crate::mv_recipe) fn runtime_ready(
        &self,
        sample: &Sample<'_>,
        fonts: &mv_font_metrics::Context,
        images: &mv_image_dimensions::Context,
    ) -> Result<(), String> {
        let clock = Clock::new(self, sample)?;
        if self.exit && clock.end <= clock.at(self.cues.exit) + 0.05 {
            return Err(
                "titleRiff exit cue must leave a positive authored sun-expansion interval".into(),
            );
        }
        for id in self.images() {
            images.image(id)?;
        }
        self.scratch_pixels(Some(images))?;
        for text in &self.glyphs {
            fonts.bounds(&self.fonts.title, &ink_request(text))?;
        }
        Ok(())
    }
}
